// /js/makelist.js — ArkTube 목록/재생 오케스트레이터 (CopyTube 호환 최종본)
// - index, list, watch 모든 동선을 단일 규약으로 연결
// - Firestore 공개 읽기 + 클라이언트 필터/검색 + 정렬(desc/asc/random seeded)
// - 개인자료(personal_*) 로컬 저장소 큐 생성 지원(로그인 불필요)
// - 추가 로드 40개 / watch에서 남은 ≤10 자동 확장(개인자료는 추가 로드 없음)
// - 시리즈 단일 서브키면 asc + resume 시작점 보정(resume.js 사용)
// - 세션 키: LIST_STATE, LIST_SNAPSHOT, playQueue, playIndex, playMeta
// state.cats: 'ALL' | string[]
//  - 'ALL' => "일반 전체" (시리즈/개인 제외). 서버는 무필터, 클라이언트에서 제외 처리.
//  - string[] => 지정된 값만 포함.

import { db } from './firebase-init.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { loadResume } from './resume.js';
import {
  collection, query, where, orderBy, limit, startAfter, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* =========================
 * 세션/로컬 키
 * ========================= */
const K = {
  LIST_STATE:   'LIST_STATE',      // { cats, type, sort, seed?, search? }
  LIST_SNAPSHOT:'LIST_SNAPSHOT',   // { items:QueueItem[] }  (list 렌더용 스냅샷)
  PLAY_QUEUE:   'playQueue',       // QueueItem[]
  PLAY_INDEX:   'playIndex',       // number (문자열 저장)
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

  _lastDoc: null,          // Firestore 페이지네이션 커서
  _exhausted: false,       // 더 없음 플래그

  queue: [],               // QueueItem[] (현재 생성된 큐)
  startIndex: 0,           // watch 시작 인덱스
};

const isSeries   = v => typeof v==='string' && v.startsWith('series_'); // 그룹 key 판별용
const isPersonal = v => typeof v==='string' && v.startsWith('personal'); // 값(personal1..)

/* =========================
 * 유틸
 * ========================= */
function stashSession(key, val){
  try { sessionStorage.setItem(key, typeof val==='string' ? val : JSON.stringify(val)); } catch {}
}
function readSession(key, fallback){
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
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
function dedupAppend(targetArr, newItems){
  // id 기준 중복 제거 후 targetArr 뒤에 추가
  const seen = new Set(targetArr.map(it=>it.id));
  const filtered = [];
  for (const it of newItems){
    if (!seen.has(it.id)) { seen.add(it.id); filtered.push(it); }
  }
  targetArr.push(...filtered);
  return filtered.length;
}

/* =========================
 * SERIES value -> { groupKey, subKey } 매핑
 *  - groupKey : 실제 그룹 key (예: 'series_music')
 *  - subKey   : 자식 value (예: 'pick1')
 * ========================= */
function getGroups(){
  if (Array.isArray(CATEGORY_MODEL?.groups)) return CATEGORY_MODEL.groups;
  if (Array.isArray(CATEGORY_GROUPS))        return CATEGORY_GROUPS;
  return [];
}
const SERIES_MAP = (()=>{
  const m = new Map();
  const groups = getGroups();
  groups.forEach(g=>{
    const isSeriesGroup = g?.isSeries===true || String(g?.key||'').startsWith('series_');
    if (!isSeriesGroup) return;
    (g.children||[]).forEach(c=>{
      m.set(c.value, { groupKey: g.key, subKey: c.value });
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
 * YouTube ID 파서 (개인자료용 — watch 재생에 필요)
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
  // 단일 personal만 지원 (요구사항)
  if (!Array.isArray(state.cats) || state.cats.length!==1) return [];
  const slot = String(state.cats[0]); // 'personal1', 'personal2' ...
  const key  = `personal_${slot}`;    // 'personal_personal1' 등

  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}

  // [{url,title?,savedAt?}] → QueueItem
  let items = arr.map(it=>{
    const id = String(it.id || '').trim() || parseYouTubeId(it.url||'');
    const type = it.type ? String(it.type) : (String(it.url||'').includes('/shorts/')) ? 'shorts' : 'video';

    // 저장된 ownerName이 있을 때만 유지 (없으면 생략)
    const item = {
      id,
      url: it.url,
      type,
      title: it.title || '',
      cats: [slot],
      createdAt: Number(it.savedAt||0) || Date.now(),
      playable: !!id
    };
    if (it.ownerName) item.ownerName = it.ownerName;
    return item;
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
 * Firestore 1페이지 로드 (서버 필터 + 클라 후처리/검색)
 * ========================= */
async function loadPage({ perPage = 20 }) {
  if (state._exhausted) return [];

  // ---- base collection / type filter
  const col = collection(db, 'videos');
  const wheres = [];

  // type 서버 필터 ('all' 이면 생략)
  if (state.type === 'shorts') wheres.push(where('type', '==', 'shorts'));
  else if (state.type === 'video') wheres.push(where('type', '==', 'video'));

  // ---- cats 서버 필터 분기
  // 개인자료(personal_*)는 Firestore 대상이 아니므로 서버 필터에서 제외
  // (개인자료 단일 선택은 buildQueue에서 이미 로컬 로드로 분기)
  let serverCats = Array.isArray(state.cats)
    ? state.cats.filter(c => typeof c === 'string' && !isPersonal(c))
    : [];

  // 'ALL' 처리: "일반 전체"이지만 서버 단계에서는 무필터 → 클라 단계에서 시리즈/개인 제외
  if (state.cats === 'ALL') serverCats = [];

  // 서버 필터 정책:
  // - 0개/ALL → 서버 cats 필터 없음
  // - 1개 → where('cats', 'array-contains', cat)
  // - 2~10개 → where('cats', 'array-contains-any', cats[])
  // - 11개 이상 → 서버 cats 필터 건너뜀(클라 필터로 후처리)
  if (serverCats.length === 1) {
    wheres.push(where('cats', 'array-contains', serverCats[0]));
  } else if (serverCats.length >= 2 && serverCats.length <= 10) {
    wheres.push(where('cats', 'array-contains-any', serverCats));
  } // else: 0개 or 11개 이상 → 서버 cats 필터 없음 (아래 클라 필터 유지)

  // ---- order / cursor / limit
  const ord =
    state.sort === 'asc' ? orderBy('createdAt', 'asc') : orderBy('createdAt', 'desc');

  const parts = [col, ...wheres, ord, limit(perPage)];
  if (state._lastDoc) parts.push(startAfter(state._lastDoc));

  // ---- fetch
  const snap = await getDocs(query(...parts));
  if (snap.empty) {
    state._exhausted = true;
    return [];
  }
  state._lastDoc = snap.docs[snap.docs.length - 1]; // 항상 서버 마지막 문서로 갱신

  // ---- doc -> QueueItem 가공
  let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // id 보정(문서 id 대신 ytid 사용)
  items.forEach(it => {
    it.id = it.ytid || it.id;
  });

  // ---- 클라 카테고리 필터 (서버에서 못 거른 케이스 보강)
  if (state.cats === 'ALL') {
    // 'ALL'은 "일반 전체" → 시리즈/개인 포함 문서는 제외
    items = items.filter(doc => {
      const cats = doc.cats || [];
      const hasSeriesOrPersonal = cats.some(v => SERIES_MAP.has(v) || isPersonal(v));
      return !hasSeriesOrPersonal;
    });
  } else if (Array.isArray(state.cats)) {
    const set = new Set(state.cats);
    items = items.filter(doc => {
      const cats = doc.cats || [];
      return cats.some(v => set.has(v));
    });
  }

  // ---- 검색(제목/ownerName, 대소문자 무시)
  if (state.search && state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    items = items.filter(doc => {
      const t = String(doc.title || '').toLowerCase();
      const o = String(doc.ownerName || '').toLowerCase();
      return t.includes(q) || o.includes(q);
    });
  }

  // ---- QueueItem 표준화(기존 형식 유지)
  const now = Date.now();
  return items.map(doc => ({
    id: doc.id,
    ytid: doc.ytid || doc.id,
    url: doc.url,
    title: doc.title || '',
    type: doc.type || 'video',
    cats: Array.isArray(doc.cats) ? doc.cats : [],
    ownerName: doc.ownerName || '',
    createdAt: doc.createdAt?.seconds ? doc.createdAt.seconds * 1000 : now,
    playable: true,
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
    state.queue = loadPersonalAll(); // 개인자료는 페이징 없음
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
      stashPlayQueue(); // 빈번 저장 OK
    }catch{}
  });
}

/* =========================
 * 시리즈 resume 시작점 보정
 *  - 단일 시리즈 서브키 선택시에만 수행
 *  - 키 규격: resume:{type}:{groupKey}:{subKey}
 * ========================= */
function applyResumeStartIndex(){
  state.startIndex = 0;
  if (!Array.isArray(state.cats) || state.cats.length!==1) return;
  const subVal = state.cats[0];
  // subVal이 personal or 일반이면 패스
  const map = SERIES_MAP.get(subVal);
  if (!map) return;

  // watch는 video로 저장/조회하므로 기본 'video'
  const saved = loadResume({ type: 'video', groupKey: map.groupKey, subKey: map.subKey });
  if (!saved || !Number.isFinite(saved.index)) return;

  let i = Number(saved.index);
  if (i < 0) i = 0;
  if (i >= state.queue.length) i = state.queue.length - 1;
  state.startIndex = Math.max(0, i);
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
function stashListSnapshot(){
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
  const onlySeriesSingle = Array.isArray(state.cats) && state.cats.length===1 && !!SERIES_MAP.get(state.cats[0]);
  state.sort = onlySeriesSingle ? 'asc' : 'desc';
  state.seed = 1;
  state.search = '';
  state.returnTo = 'index';

  await buildQueue({ firstPage: 20 });
  if (onlySeriesSingle) applyResumeStartIndex();

  // 이어보기 컨텍스트 세팅 (watch용)
  if (onlySeriesSingle) {
    const { groupKey, subKey } = SERIES_MAP.get(state.cats[0]);
    sessionStorage.setItem('resumeCtx', JSON.stringify({
      typeForKey: 'video',
      groupKey,
      subKey,
      sort: 'createdAt-asc'
    }));
  } else {
    sessionStorage.removeItem('resumeCtx');
  }

  stashPlayQueue();
  return { queue: state.queue, startIndex: state.startIndex };
}

// 2) index → list (드롭다운/스와이프)
export async function makeForListFromIndex({ cats, type }){
  state.cats = cats ?? 'ALL';
  state.type = type ?? 'both';

  // list의 디폴트 정렬: 시리즈 단일이면 asc, 그 외 desc
  const onlySeriesSingle = Array.isArray(state.cats) && state.cats.length===1 && !!SERIES_MAP.get(state.cats[0]);
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
  state.startIndex = Math.max(0, Math.min(index|0, state.queue.length-1));
  state.returnTo = 'list';
  stashPlayQueue();
  location.href = './watch.html?from=list';
}

// 4) list 내 정렬 변경
export async function setSort(newSort){
  state.sort = newSort;
  if (state.sort !== 'random') state.seed = 1;
  await buildQueue({ firstPage: 20 });
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

// 7) 추가 로드 (list/ watch 공용: list는 스크롤, watch는 남은 ≤10 자동 호출)
export async function fetchMore(){
  // 개인자료는 로컬 전량 메모리 → 추가 로드 없음
  const isPersonalSingle = Array.isArray(state.cats) && state.cats.length===1 && isPersonal(state.cats[0]);
  if (isPersonalSingle) return { appended: 0 };

  let appended = 0;
  let hops = 0;
  const MAX_HOPS = 30; // 빈 페이지(필터 후 0개)가 연속 30번이어도 건너뛴다 (시리즈가 대량 연속 등록된 케이스 대비)

  while (appended === 0 && !state._exhausted && hops < MAX_HOPS) {
    const perPage = 40; // 필요 시 'ALL'에서 50으로 조정 가능
    const more = await loadPage({ perPage });

    if (more.length) {
      if (state.sort === 'random') {
        // 새로운 묶음만 중복 제거 후 seed 셔플해서 뒤에 추가
        const uniqMap = new Map();
        more.forEach(it=>{ if (!uniqMap.has(it.id)) uniqMap.set(it.id, it); }); // ← 여기 수정
        const shuffled = shuffleSeeded([...uniqMap.values()], state.seed);
        appended += dedupAppend(state.queue, shuffled);
      } else {
        appended += dedupAppend(state.queue, more);
      }
      break; // 이번 호출에서 뭔가 붙었으면 종료
    } else {
      // 이 서버 페이지는 클라 필터 후 0개 → 다음 페이지로 재시도
      hops++;
      // loadPage 내부에서 state._lastDoc, _exhausted를 이미 갱신
    }
  }

  // 스냅샷/세션 반영
  if (appended > 0) {
    stashListSnapshot();
    stashPlayQueue();
  }
  return { appended };
}


// 8) watch에서 끝나갈 때 자동 확장 헬퍼
export async function fetchMoreForWatchIfNeeded(currentIndex){
  const remain = state.queue.length - (currentIndex+1);
  if (remain <= 10) {
    return await fetchMore();
  }
  return { appended: 0 };
}

// 9) list 초기화용 상태/스냅샷 리더
export function readListState(){ return readSession(K.LIST_STATE, null); }
export function getCurrentState(){ return { ...state }; }

// 10) (옵션) 현재 큐/메타를 직접 읽을 때
export function readPlayMeta(){ return readSession(K.PLAY_META, null); }
export function readPlayQueue(){ return readSession(K.PLAY_QUEUE, []); }
export function readPlayIndex(){
  const v = sessionStorage.getItem(K.PLAY_INDEX);
  const n = Number(v||0);
  return Number.isFinite(n)? n : 0;
}
