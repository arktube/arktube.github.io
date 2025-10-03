// js/makelist.js — ArkTube 목록/재생 오케스트레이터 완성본
// - index, list, watch 모든 동선을 단일 규약으로 연결
// - Firestore 공개 읽기 + 클라이언트 필터/검색 + 정렬(desc/asc/random seeded)
// - (추가) 개인자료(personal_*) 로컬 저장소 기반 큐 생성 지원
// - 추가 로드 40개 / watch에서 남은 ≤10 자동 확장(개인자료는 추가 로드 없음)
// - 시리즈 단일 서브키면 resume 시작점 보정
// - 세션 키: LIST_STATE, LIST_SNAPSHOT, playQueue, playIndex, playMeta

import { db } from './firebase-init.js';
import { CATEGORY_MODEL } from './categories.js';
import {
  collection, query, where, orderBy, limit, startAfter, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';

/* =========================
 * 세션/로컬 키
 * ========================= */
const K = {
  LIST_STATE:   'LIST_STATE',      // { cats, type, sort, seed?, search? }
  LIST_SNAPSHOT:'LIST_SNAPSHOT',   // { items:QueueItem[] }  (list 렌더용 스냅샷)
  PLAY_QUEUE:   'playQueue',       // QueueItem[]
  PLAY_INDEX:   'playIndex',       // number
  PLAY_META:    'playMeta',        // { cats,type,sort,seed?,returnTo }
};

/* =========================
 * 내부 상태
 * ========================= */
let state = {
  cats: 'ALL',             // 'ALL' | string[]
  type: 'both',            // 'both'|'shorts'|'video'
  sort: 'desc',            // 'desc'|'asc'|'random'
  seed: 1,                 // random 전용
  search: '',              // list 전용(제목/ownerName)
  returnTo: 'index',       // watch 복귀처

  // 페이지네이션 커서/종료
  _lastDoc: null,
  _exhausted: false,

  // 큐
  queue: [],               // QueueItem[]
  startIndex: 0,           // watch 시작 인덱스
};

const isSeries   = v => typeof v==='string' && v.startsWith('series_');
const isPersonal = v => typeof v==='string' && v.startsWith('personal');

/* =========================
 * 유틸
 * ========================= */
function stashSession(key, val){
  sessionStorage.setItem(key, typeof val==='string' ? val : JSON.stringify(val));
}
function readSession(key, fallback){
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
function seededRng(seed){
  let t = seed>>>0;
  return ()=> {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ t>>>15, 1|t);
    x ^= x + Math.imul(x ^ x>>>7, 61|x);
    return ((x ^ x>>>14)>>>0)/4294967296;
  };
}
function shuffleSeeded(arr, seed=1){
  const rnd = seededRng(seed);
  for (let i=arr.length-1;i>0;i--){
    const j = Math.floor(rnd()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

/* =========================
 * SERIES key 매핑 (value -> {groupKey, subKey})
 * ========================= */
const SERIES_MAP = (()=>{
  const m = new Map();
  CATEGORY_MODEL.forEach(g=>{
    g.children?.forEach(c=>{
      if (isSeries(c.value)) {
        let groupKey='series', subKey=c.value;
        const rest = c.value.replace(/^series_/,'');
        const p = rest.split(':');
        if (p.length>=2){ groupKey=p[0]; subKey=p.slice(1).join(':'); }
        m.set(c.value, { groupKey, subKey });
      }
    });
  });
  return m;
})();

/* =========================
 * 사전 재생 가능성 체크 (경량 oEmbed)
 * ========================= */
async function probePlayable(ytid, timeout=3800){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), timeout);
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(ytid)}&format=json`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    if (!res.ok) return { playable:false, reason:'private_or_deleted' };
    await res.json();
    return { playable:true };
  } catch {
    return { playable:false, reason:'blocked_or_network' };
  }
}

/* =========================
 * YouTube ID 파서 (개인자료용)
 * ========================= */
function parseYouTubeId(url=''){
  try{
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./,'');
    if (h==='youtu.be') return u.pathname.slice(1);
    if (h==='youtube.com' || h==='m.youtube.com' || h==='youtube-nocookie.com' || h==='www.youtube.com'){
      if (u.pathname.startsWith('/watch'))  return u.searchParams.get('v') || '';
      if (u.pathname.startsWith('/shorts/'))return u.pathname.split('/')[2] || '';
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
    }
  } catch {}
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/) || url.match(/\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : '';
}

/* =========================
 * 개인자료 1페이지 로드 (로컬스토리지)
 * 키 규칙: personal_{slot}  예) slot='personal1' → key='personal_personal1'
 * ========================= */
function loadPersonalAll(){
  // 단일 personal만 지원(요구사항)
  if (!Array.isArray(state.cats) || state.cats.length!==1) return [];
  const slot = String(state.cats[0]); // 'personal1', 'personal2' ...
  const key  = `personal_${slot}`;    // 'personal_personal1' 등

  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}
  // [{url,title?,savedAt?}] → QueueItem
  let items = arr.map(it=>{
    const id = parseYouTubeId(it.url||'');
    return {
      id,
      url: it.url,
      type: (String(it.url||'').includes('/shorts/')) ? 'shorts' : 'video',
      title: it.title || '',
      ownerName: '',               // 개인자료는 업로더 없음
      cats: [slot],
      createdAt: Number(it.savedAt||0) || Date.now(),
      playable: !!id
    };
  }).filter(x=> !!x.id);

  // 형식 필터 적용
  if (state.type==='shorts') items = items.filter(it=> it.type==='shorts');
  else if (state.type==='video') items = items.filter(it=> it.type==='video');

  // 검색(제목만)
  if (state.search && state.search.trim()){
    const q = state.search.trim().toLowerCase();
    items = items.filter(it=> String(it.title||'').toLowerCase().includes(q));
  }

  // 정렬
  if (state.sort==='asc') items.sort((a,b)=> a.createdAt - b.createdAt);
  else if (state.sort==='desc') items.sort((a,b)=> b.createdAt - a.createdAt);
  else if (state.sort==='random') items = shuffleSeeded(items, state.seed);

  return items;
}

/* =========================
 * 1페이지 로드 (Firestore, 클라 필터/검색 포함)
 * ========================= */
async function loadPage({ perPage=20 }){
  if (state._exhausted) return [];

  const col = collection(db, 'videos');
  const wheres = [];
  if (state.type==='shorts') wheres.push(where('type','==','shorts'));
  else if (state.type==='video') wheres.push(where('type','==','video'));

  // 정렬: asc/desc만 Firestore에서, random은 클라 측
  const ord = (state.sort==='asc') ? orderBy('createdAt','asc') : orderBy('createdAt','desc');

  const parts = [col, ...wheres, ord, limit(perPage)];
  if (state._lastDoc) parts.push(startAfter(state._lastDoc));

  const snap = await getDocs(query(...parts));
  if (snap.empty) { state._exhausted = true; return []; }
  state._lastDoc = snap.docs[snap.docs.length-1];

  // 데이터 → QueueItem 가공
  let items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  // 카테고리 필터(클라)
  if (Array.isArray(state.cats)) {
    const set = new Set(state.cats);
    items = items.filter(doc=>{
      const cats = doc.cats||[];
      return cats.some(v=> set.has(v));
    });
  }
  // 검색(제목/ownerName, 대소문자 무시)
  if (state.search && state.search.trim()){
    const q = state.search.trim().toLowerCase();
    items = items.filter(doc=>{
      const t = String(doc.title||'').toLowerCase();
      const o = String(doc.ownerName||'').toLowerCase();
      return t.includes(q) || o.includes(q);
    });
  }
  // QueueItem으로 변환
  const now = Date.now();
  return items.map(doc=>({
    id: doc.ytid || doc.id,
    url: doc.url,
    type: doc.type,
    title: doc.title,
    ownerName: doc.ownerName || '',
    cats: doc.cats,
    createdAt: (doc.createdAt?.seconds? doc.createdAt.seconds*1000 : now),
    playable: true
  }));
}

/* =========================
 * 큐 빌드 (초기/재생성)
 * ========================= */
async function buildQueue({ firstPage=20 }){
  state._lastDoc = null;
  state._exhausted = false;
  state.queue = [];

  // 개인자료 단일 선택이면 로컬에서 전부 로드
  const isPersonalSingle = Array.isArray(state.cats) && state.cats.length===1 && isPersonal(state.cats[0]);
  if (isPersonalSingle){
    state.queue = loadPersonalAll(); // 한 번에 모두 (개인자료는 페이징 없음)
  } else {
    // Firestore 1페이지
    const page = await loadPage({ perPage:firstPage });
    state.queue.push(...page);

    // random → seed 셔플(중복 제거 후)
    if (state.sort==='random'){
      const uniq = new Map();
      state.queue.forEach(it=> { if (!uniq.has(it.id)) uniq.set(it.id, it); });
      state.queue = shuffleSeeded([...uniq.values()], state.seed);
    }
  }

  // 경량 사전 판정(선두 30개만, 비동기)
  state.queue.slice(0,30).forEach(async (it)=>{
    try{
      const p = await probePlayable(it.id);
      if (!p.playable){ it.playable=false; it.unplayableReason=p.reason; }
      stashPlayQueue(); // 자주 업데이트해도 가벼움
    }catch{}
  });
}

/* =========================
 * 시리즈 resume 시작점 보정
 * ========================= */
function applyResumeStartIndex(){
  state.startIndex = 0;
  // 단일 시리즈 서브키일 때만
  if (!Array.isArray(state.cats) || state.cats.length!==1) return;
  const keyVal = state.cats[0];
  if (!isSeries(keyVal)) return;

  const map = SERIES_MAP.get(keyVal) || { groupKey:'series', subKey:keyVal };
  const key = `resume:${map.groupKey}:${map.subKey}`;
  const raw = localStorage.getItem(key);
  if (!raw) return; // resume 없으면 첫 영상부터
  try{
    const obj = JSON.parse(raw);
    let i = Number(obj.index||0);
    if (!isFinite(i) || i<0) i=0;
    if (i >= state.queue.length) i = state.queue.length-1;
    state.startIndex = Math.max(0, i);
  } catch {}
}

/* =========================
 * 세션 저장/읽기 헬퍼
 * ========================= */
function stashListState(){
  stashSession(K.LIST_STATE, {
    cats: state.cats, type: state.type,
    sort: state.sort, seed: state.sort==='random'? state.seed: undefined,
    search: state.search || ''
  });
}
function readListState(){
  return readSession(K.LIST_STATE, null);
}
function stashListSnapshot(){
  // list 렌더링은 스냅샷을 사용 (페이지 전환 없이 정렬/검색 시에도 일관)
  stashSession(K.LIST_SNAPSHOT, { items: state.queue });
}
export function readListSnapshot(){
  return readSession(K.LIST_SNAPSHOT, { items: [] });
}
function stashPlayQueue(){
  stashSession(K.PLAY_QUEUE, state.queue);
  stashSession(K.PLAY_INDEX, String(state.startIndex));
  stashSession(K.PLAY_META, {
    cats: state.cats, type: state.type,
    sort: state.sort,
    seed: state.sort==='random'? state.seed: undefined,
    returnTo: state.returnTo
  });
}

/* =========================
 * 외부 공개 API
 * ========================= */

// 1) index → watch (영상보기 버튼 / 시리즈 이어보기 버튼)
export async function makeForWatchFromIndex({ cats, type }){
  state.cats = cats ?? 'ALL';
  state.type = type ?? 'both';

  // 디폴트 정렬: 시리즈 단일 서브키면 asc+resume, 그 외 desc
  const onlySeriesSingle = Array.isArray(state.cats) && state.cats.length===1 && isSeries(state.cats[0]);
  state.sort = onlySeriesSingle ? 'asc' : 'desc';
  state.seed = 1;
  state.search = '';
  state.returnTo = 'index';

  await buildQueue({ firstPage: 20 });
  if (onlySeriesSingle) applyResumeStartIndex();

  stashPlayQueue();
  // 페이지 이동은 호출 측(index.js)이 수행: location.href = './watch.html?from=index'
  return { queue: state.queue, startIndex: state.startIndex };
}

// 2) index → list (드롭다운/스와이프)
export async function makeForListFromIndex({ cats, type }){
  state.cats = cats ?? 'ALL';
  state.type = type ?? 'both';

  // list의 디폴트 정렬: 시리즈 단일이면 asc, 그 외 desc
  const onlySeriesSingle = Array.isArray(state.cats) && state.cats.length===1 && isSeries(state.cats[0]);
  state.sort = onlySeriesSingle ? 'asc' : 'desc';
  state.seed = 1;
  state.search = '';

  await buildQueue({ firstPage: 20 });
  stashListState();
  stashListSnapshot();
  return { items: state.queue };
}

// 3) list → watch (카드 탭)
export function selectAndGoWatch(index){
  // 현재 list 상태 + 현재 순서로 큐를 세팅한 뒤 watch로 이동
  state.startIndex = Math.max(0, Math.min(index|0, state.queue.length-1));
  state.returnTo = 'list';
  stashPlayQueue();
  location.href = './watch.html?from=list';
}

// 4) list 내 정렬 변경
export async function setSort(newSort){
  state.sort = newSort;
  if (state.sort !== 'random') state.seed = 1; // 랜덤 벗어나면 seed 초기화
  await buildQueue({ firstPage: 20 });
  // 정렬 바뀌면 항상 리스트 맨앞에서
  state.startIndex = 0;
  stashListState();
  stashListSnapshot();
  return { items: state.queue };
}

// 5) list 내 검색 변경
export async function setSearch(query){
  state.search = (query||'').trim();
  await buildQueue({ firstPage: 20 });
  state.startIndex = 0;
  stashListState();
  stashListSnapshot();
  return { items: state.queue };
}

// 6) list에서 "랜덤 다시" → seed++
export async function bumpRandomSeed(){
  if (state.sort!=='random') return { items: state.queue, seed: state.seed };
  state.seed = (state.seed|0) + 1;
  await buildQueue({ firstPage: 20 });
  stashListState();
  stashListSnapshot();
  return { items: state.queue, seed: state.seed };
}

// 7) 추가 로드 (list/ watch 공용: list는 스크롤, watch는 남은 ≤10에서 호출)
export async function fetchMore(){
  // 개인자료는 로컬 전량 메모리 → 추가 로드 없음
  const isPersonalSingle = Array.isArray(state.cats) && state.cats.length===1 && isPersonal(state.cats[0]);
  if (isPersonalSingle) return { appended: 0 };

  const more = await loadPage({ perPage: 40 });
  if (!more.length) return { appended: 0 };

  if (state.sort==='random') {
    // 새로 온 묶음만 seed로 셔플 → 뒤에 합침
    const uniq = new Map();
    more.forEach(it=> { if (!uniq.has(it.id)) uniq.set(it.id, it); });
    const shuffled = shuffleSeeded([...uniq.values()], state.seed);
    state.queue.push(...shuffled);
  } else {
    state.queue.push(...more);
  }
  // list/ watch 각각의 스냅샷/큐도 갱신
  stashListSnapshot();
  stashPlayQueue();
  return { appended: more.length };
}

// 8) watch에서 끝나갈 때 자동 확장 헬퍼
export async function fetchMoreForWatchIfNeeded(currentIndex){
  const remain = state.queue.length - (currentIndex+1);
  if (remain <= 10) {
    return await fetchMore();
  }
  return { appended: 0 };
}

// 9) index 스와이프/드롭다운으로 list 이동하기 전, 현재 선택/타입을 상태화하는 헬퍼
export async function prepareListFromCurrentSelections({ cats, type }){
  return await makeForListFromIndex({ cats, type });
}

// 10) list가 초기 진입 시 사용할 상태/스냅샷 리더
export function readListState(){ return readSession(K.LIST_STATE, null); } // 위에서 정의 재노출
export function getCurrentState(){ return { ...state }; }

// 11) (옵션) 현재 큐/메타를 직접 읽을 때
export function readPlayMeta(){
  return readSession(K.PLAY_META, null);
}
export function readPlayQueue(){
  return readSession(K.PLAY_QUEUE, []);
}
export function readPlayIndex(){
  const v = sessionStorage.getItem(K.PLAY_INDEX);
  const n = Number(v||0);
  return isFinite(n)? n : 0;
}
