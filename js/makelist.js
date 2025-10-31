// /js/makelist.js — ArkTube 목록/재생 오케스트레이터 (CopyTube 호환 최종본 + cats 정규화/ALL 확장 + 배치 커서, 2025-10-29)
// - index, list, watch 모든 동선을 단일 규약으로 연결
// - Firestore 공개 읽기 + 클라이언트 다중카테고리 필터/검색 + 정렬(desc/asc/random seeded)
// - 개인자료(personal_*) 로컬 저장소 큐 생성 지원(로그인 불필요)
// - 최초/추가 로드 모두 "최소 20개 확보"를 목표로, 카테고리 청크별 커서로 반복 페치
// - 시리즈 단일 서브키면 asc + resume 시작점 보정(resume.js 사용)
// - 세션 키: LIST_STATE, LIST_SNAPSHOT, playQueue, playIndex, playMeta
// state.cats: string[] (※ 'ALL' 입력 호환: 일반 세부카테고리 전체로 자동 확장)
//   - 'ALL'은 index에서만 넘어오며, makelist가 시리즈/개인 제외 일반 세부카테고리 전체로 확장 처리

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
  LIST_SNAPSHOT:'LIST_SNAPSHOT',   // { items:QueueItem[] }
  PLAY_QUEUE:   'playQueue',       // QueueItem[]
  PLAY_INDEX:   'playIndex',       // number (문자열 저장)
  PLAY_META:    'playMeta',        // { cats,type,sort,seed?,returnTo }
};

/* =========================
 * 내부 상태
 * ========================= */
let state = {
  cats: [],               // string[] (※ 'ALL'은 normalize에서 일반 세부카테고리 전체로 확장)
  type: 'both',           // 'both'|'shorts'|'video'
  sort: 'desc',           // 'desc'|'asc'|'random'
  seed: 1,                // random 전용
  search: '',             // list 전용(제목/ownerName)
  returnTo: 'index',      // watch 복귀처

  // 🔸 카테고리 청크별 커서(배열): [{catsChunk:string[], lastDoc:QueryDocumentSnapshot|null, exhausted:boolean}]
  _cursors: [],

  queue: [],              // QueueItem[] (현재 생성된 큐)
  startIndex: 0,          // watch 시작 인덱스
};

const isSeriesGroupKey = k => typeof k==='string' && k.startsWith('series_'); // 그룹 key 판별
const isSeries   = v => typeof v==='string' && v.startsWith('series_');       // 값이 series_로 시작하는 케이스는 드뭄(그룹key용)
const isPersonal = v => typeof v==='string' && v.startsWith('personal');      // 값(personal1..)

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
  const seen = new Set(targetArr.map(it=>it.id));
  const filtered = [];
  for (const it of newItems){
    if (!seen.has(it.id)) { seen.add(it.id); filtered.push(it); }
  }
  targetArr.push(...filtered);
  return filtered.length;
}
function toMillis(ts, fallbackMs = Date.now()) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (ts instanceof Date) return ts.getTime();
  if (ts && typeof ts.seconds === 'number') return ts.seconds * 1000;
  return fallbackMs;
}

// 🔹 전체 큐를 seed 기반으로 다시 셔플 (랜덤 토글/seed 변경 시 사용)
function shuffleQueueGlobally() {
  const uniq = new Map();
  state.queue.forEach(it => { if (!uniq.has(it.id)) uniq.set(it.id, it); });
  state.queue = shuffleSeeded([...uniq.values()], state.seed);
}

/* =========================
 * 카테고리 모델 접근/시리즈 맵
 * ========================= */
function getGroups(){
  if (Array.isArray(CATEGORY_MODEL?.groups)) return CATEGORY_MODEL.groups;
  if (Array.isArray(CATEGORY_GROUPS))        return CATEGORY_GROUPS;
  return [];
}

// SERIES value -> { groupKey, subKey } (시리즈 resume용)
const SERIES_MAP = (()=>{
  const m = new Map();
  const groups = getGroups();
  groups.forEach(g=>{
    const isSeriesGroup = g?.isSeries===true || isSeriesGroupKey(g?.key||'');
    if (!isSeriesGroup) return;
    (g.children||[]).forEach(c=>{
      m.set(c.value, { groupKey: g.key, subKey: c.value });
    });
  });
  return m;
})();

/* =========================
 * 'ALL' 확장: 일반(시리즈/개인 제외) 세부 카테고리 전부 반환
 * ========================= */
function expandAllToLeafCats(){
  const groups = getGroups();
  const out = [];
  for (const g of groups){
    const gkey = String(g?.key||'');
    const isSeriesG = g?.isSeries===true || isSeriesGroupKey(gkey);
    if (isSeriesG) continue; // 시리즈 제외
    const children = Array.isArray(g?.children) ? g.children : [];
    for (const c of children){
      const v = String(c?.value||'').trim();
      if (!v) continue;
      if (isPersonal(v)) continue; // personal 값 제외
      out.push(v);
    }
  }
  return [...new Set(out)];
}

/* =========================
 * 카테고리 정규화: 결과는 항상 string[]
 *  - 'ALL' → 일반 세부카테고리 전체로 확장
 *  - personal 혼합 시 personal은 제외(단일 personal만 로컬 로드)
 * ========================= */
function normalizeCats(input){
  if (input == null) return [];

  // 문자열
  if (typeof input === 'string'){
    const v = input.trim();
    if (!v) return [];
    if (v.toUpperCase() === 'ALL') {
      return expandAllToLeafCats();
    }
    return [v];
  }

  // 배열
  if (Array.isArray(input)){
    let arr = input.map(v => typeof v === 'string' ? v.trim() : '').filter(Boolean);

    // ['ALL'] → 일반 전체 확장
    if (arr.length === 1 && arr[0].toUpperCase() === 'ALL') {
      return expandAllToLeafCats();
    }

    // personal 혼합 방지: personal이 섞여 있으면 personal은 제외
    const hasPersonal = arr.some(isPersonal);
    if (hasPersonal && arr.length > 1){
      arr = arr.filter(v => !isPersonal(v));
    }

    // 중복 제거
    arr = [...new Set(arr)];
    return arr;
  }

  return [];
}

/* =========================
 * 사전 재생 가능성 체크 (경량 oEmbed)
 * ========================= */
async function probePlayable(ytid, timeout=3800){
  const ctrl = new AbortController();
  const id = setTimeout(()=>ctrl.abort(), timeout);
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(ytid)}&format=json`;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return { playable:false, reason:'private_or_deleted' };
    await res.json();
    return { playable:true };
  } catch {
    return { playable:false, reason:'blocked_or_network' };
  } finally {
    clearTimeout(id);
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
 * ========================= */
function loadPersonalAll(){
  if (!Array.isArray(state.cats) || state.cats.length!==1) return [];
  const slot = String(state.cats[0]);               // 'personal1', 'personal2' ...
  const key  = `personal_${slot}`;                  // 'personal_personal1'

  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch {}

  let items = arr.map(it=>{
    const id = String(it.id || '').trim() || parseYouTubeId(it.url||'');
    const type = it.type ? String(it.type) : (String(it.url||'').includes('/shorts/')) ? 'shorts' : 'video';
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

  if (state.type==='shorts') items = items.filter(it=> it.type==='shorts');
  else if (state.type==='video') items = items.filter(it=> it.type==='video');

  if (state.search && state.search.trim()){
    const q = state.search.trim().toLowerCase();
    items = items.filter(it=> String(it.title||'').toLowerCase().includes(q));
  }

  if (state.sort==='asc') items.sort((a,b)=> a.createdAt - b.createdAt);
  else if (state.sort==='desc') items.sort((a,b)=> b.createdAt - a.createdAt);
  else if (state.sort==='random') items = shuffleSeeded(items, state.seed);

  return items;
}

/* =========================
 * Firestore 다중 카테고리 배치 커서
 * ========================= */
function makeCategoryChunks(cats, chunkSize=10){
  const out = [];
  for (let i=0;i<cats.length;i+=chunkSize){
    out.push(cats.slice(i, i+chunkSize));
  }
  return out;
}
function initCursors(){
  const serverCats = Array.isArray(state.cats)
    ? state.cats.filter(c => typeof c === 'string' && !isPersonal(c))
    : [];
  const chunks = makeCategoryChunks(serverCats, 10);
  state._cursors = chunks.map(ck => ({ catsChunk: ck, lastDoc: null, exhausted: false }));
}
function allExhausted(){
  return state._cursors.length>0 && state._cursors.every(c => c.exhausted);
}

/* =========================
 * Firestore 한 청크 로드
 * ========================= */
async function loadPageForChunk({ chunkIndex, perPage }){
  const cur = state._cursors[chunkIndex];
  if (!cur || cur.exhausted) return [];

  const col = collection(db, 'videos');
  const wheres = [];

  if (state.type === 'shorts') wheres.push(where('type', '==', 'shorts'));
  else if (state.type === 'video') wheres.push(where('type', '==', 'video'));

  if (cur.catsChunk.length === 1){
    wheres.push(where('cats', 'array-contains', cur.catsChunk[0]));
  } else if (cur.catsChunk.length >= 2){
    wheres.push(where('cats', 'array-contains-any', cur.catsChunk));
  }

  const ord = state.sort === 'asc' ? orderBy('createdAt', 'asc') : orderBy('createdAt', 'desc');
  const parts = [col, ...wheres, ord, limit(perPage)];
  if (cur.lastDoc) parts.push(startAfter(cur.lastDoc));

  const snap = await getDocs(query(...parts));
  if (snap.empty){
    cur.exhausted = true;
    return [];
  }
  cur.lastDoc = snap.docs[snap.docs.length - 1];

  const now = Date.now();
  return snap.docs.map(d => {
    const data = d.data();
    const yid = data.ytid || d.id;
    const cats = Array.isArray(data.cats) ? data.cats : [];
    // 시리즈 자식 값 추출 (cats 안에 series_* 값이 있으면 그걸 사용)
    let seriesSubKey = '';
    for (const c of cats) {
      if (typeof c === 'string' && SERIES_MAP.has(c)) { seriesSubKey = c; break; }
    }
    return {
      id: yid,
      ytid: yid,
      url: data.url || `https://www.youtube.com/watch?v=${yid}`, // ★ ytid로 URL 보강
      title: data.title || '',
      type: data.type || 'video',
      cats,
      seriesSubKey, // ★ watch의 resume 저장에 필요
      ownerName: data.ownerName || '',
      createdAt: toMillis(data.createdAt, now),
      playable: true,
    };
  });
}

/* =========================
 * 공통: 검색/카테고리 후처리 + dedup + (랜덤시 부분 셔플)
 * ========================= */
function postFilterAndMerge(batchItems, { shuffleWhenRandom=false } = {}){
  const setCats = new Set(state.cats);
  let items = batchItems.filter(doc => {
    const cats = doc.cats || [];
    return cats.some(v => setCats.has(v));
  });

  if (state.search && state.search.trim()){
    const q = state.search.trim().toLowerCase();
    items = items.filter(doc => {
      const t = String(doc.title || '').toLowerCase();
      const o = String(doc.ownerName || '').toLowerCase();
      return t.includes(q) || o.includes(q);
    });
  }

  if (state.sort === 'random' && shuffleWhenRandom){
    items = shuffleSeeded(items, state.seed);
  }

  return dedupAppend(state.queue, items);
}

/* =========================
 * 큐 빌드 (초기/재생성) — 최소 firstPage(기본 20) 확보까지 루프
 * ========================= */
async function buildQueue({ firstPage=20 }){
  state.queue = [];

  // personal 단일 선택 로컬 처리
  const isPersonalSingle = Array.isArray(state.cats) && state.cats.length===1 && isPersonal(state.cats[0]);
  if (isPersonalSingle){
    state._cursors = []; // 서버 커서 불필요
    state.queue = loadPersonalAll();
  } else {
    // 서버 커서 초기화
    initCursors();

    let hops = 0;
    const MAX_HOPS = 40; // 다중 카테고리/검색 대비
    const TARGET = firstPage;

    while (state.queue.length < TARGET && !allExhausted() && hops < MAX_HOPS){
      // 동적 perPage: 검색 중이면 조금 더, desc/asc면 40, random이면 50
      let per = 40;
      if (state.sort === 'random') per = 50;
      if (state.search) per = Math.max(per, 50);

      // 소진되지 않은 모든 청크에서 한 라운드씩 가져오기
      let roundAdded = 0;
      for (let i=0;i<state._cursors.length;i++){
        if (state._cursors[i].exhausted) continue;
        const page = await loadPageForChunk({ chunkIndex: i, perPage: per });
        if (page.length){
          const added = postFilterAndMerge(page, { shuffleWhenRandom: state.sort==='random' });
          if (added>0) roundAdded += added;
        } else {
          // loadPageForChunk 내부에서 exhausted 플래그 갱신
        }
      }

      if (roundAdded === 0){
        hops++; // 진척 없으면 루프 안전 탈출 보조
      }
    }

    // random 전체 재셔플(마지막에 한 번 더 결정화)
    if (state.sort==='random'){
      shuffleQueueGlobally();
    }
  }

  // playable 사전 판정(선두 30개만, 비동기)
  state.queue.slice(0,30).forEach(async (it)=>{
    try{
      const p = await probePlayable(it.id);
      if (!p.playable){ it.playable=false; it.unplayableReason=p.reason; }
      stashPlayQueue();
    }catch{}
  });
}

/* =========================
 * 시리즈 resume 시작점 보정 (단일 시리즈 서브키 선택시에만)
 * ========================= */
function applyResumeStartIndex(){
  state.startIndex = 0;
  if (!Array.isArray(state.cats) || state.cats.length!==1) return;
  const subVal = state.cats[0];
  const map = SERIES_MAP.get(subVal);
  if (!map) return;

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
  const hasMore = Array.isArray(state._cursors) && state._cursors.length>0
    ? !allExhausted()
    : false;
  stashSession(K.LIST_SNAPSHOT, {
    items: state.queue,
    sort: state.sort,
    hasMore
  });
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
 * 외부 공개 API (시그니처 유지)
 * ========================= */

// 1) index → watch
export async function makeForWatchFromIndex({ cats, type }){
  state.cats = normalizeCats(cats);
  state.type = type ?? 'both';

  // 디폴트 정렬: 시리즈 단일 서브키면 asc+resume, 그 외 desc
  const onlySeriesSingle = Array.isArray(state.cats) && state.cats.length===1 && !!SERIES_MAP.get(state.cats[0]);
  state.sort = onlySeriesSingle ? 'asc' : 'desc';
  state.seed = 1;
  state.search = '';
  state.returnTo = 'index';

  await buildQueue({ firstPage: 20 });
  if (onlySeriesSingle) applyResumeStartIndex();

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

// 2) index → list
export async function makeForListFromIndex({ cats, type }){
  state.cats = normalizeCats(cats);
  state.type = type ?? 'both';

  const onlySeriesSingle = Array.isArray(state.cats) && state.cats.length===1 && !!SERIES_MAP.get(state.cats[0]);
  state.sort = onlySeriesSingle ? 'asc' : 'desc';
  state.seed = 1;
  state.search = '';

  await buildQueue({ firstPage: 20 });
  stashListState();
  stashListSnapshot();
  return { items: state.queue };
}

// 3) list → watch
export function selectAndGoWatch(index){
  state.startIndex = Math.max(0, Math.min(index|0, state.queue.length-1));
  state.returnTo = 'list';
  stashPlayQueue();
  location.href = './watch.html?from=list';
}

// 4) list 내 정렬 변경
export async function setSort(newSort){
  const wasRandom = (state.sort === 'random');
  state.sort = newSort;

  if (state.sort !== 'random') {
    state.seed = 1;
    await buildQueue({ firstPage: 20 });
    state.startIndex = 0;
    stashListState();
    stashListSnapshot();
    return { items: state.queue };
  }

  // 랜덤 ON
  await buildQueue({ firstPage: 20 });
  if (!wasRandom) {
    await fetchMore(); // 초기 섞임 보강
  }
  shuffleQueueGlobally();

  state.startIndex = 0;
  stashListState();
  stashListSnapshot();
  return { items: state.queue, seed: state.seed };
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

// 6) 랜덤 다시(Seed++)
export async function bumpRandomSeed(){
  if (state.sort !== 'random') return { items: state.queue, seed: state.seed };
  if (!Array.isArray(state.queue) || state.queue.length === 0) {
    await buildQueue({ firstPage: 20 });
  }

  state.seed = (state.seed|0) + 1;
  await fetchMore();      // 새 영상 포함 기회
  shuffleQueueGlobally();

  state.startIndex = 0;
  stashListState();
  stashListSnapshot();
  return { items: state.queue, seed: state.seed };
}

// 7) 추가 로드(최소 20 확보까지)
export async function fetchMore(){
  // personal 단일은 추가 로드 없음
  const isPersonalSingle = Array.isArray(state.cats) && state.cats.length===1 && isPersonal(state.cats[0]);
  if (isPersonalSingle) return { appended: 0 };

  // 커서 초기화가 안돼있다면 준비
  if (!Array.isArray(state._cursors) || state._cursors.length===0){
    initCursors();
  }

  let appended = 0;
  let hops = 0;
  const MAX_HOPS = 40;
  const TARGET_ADD = 20;

  while (appended < TARGET_ADD && !allExhausted() && hops < MAX_HOPS){
    let per = 40;
    if (state.sort === 'random') per = 50;
    if (state.search) per = Math.max(per, 50);

    let roundAdded = 0;
    for (let i=0;i<state._cursors.length;i++){
      if (state._cursors[i].exhausted) continue;
      const more = await loadPageForChunk({ chunkIndex: i, perPage: per });
      if (more.length){
        const added = postFilterAndMerge(more, { shuffleWhenRandom: state.sort==='random' });
        if (added>0){ roundAdded += added; appended += added; }
      }
    }

    if (roundAdded === 0){
      hops++;
    }
  }

  if (state.sort==='random' && appended>0){
    shuffleQueueGlobally();
  }

  if (appended > 0) {
    stashListSnapshot();
    stashPlayQueue();
  }
  return { appended };
}

// 8) watch에서 끝나갈 때 자동 확장
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
export function getSort(){ return state.sort; }

// 10) 현재 큐/메타 직접 읽기
export function readPlayMeta(){ return readSession(K.PLAY_META, null); }
export function readPlayQueue(){ return readSession(K.PLAY_QUEUE, []); }
export function readPlayIndex(){
  const v = sessionStorage.getItem(K.PLAY_INDEX);
  const n = Number(v||0);
  return Number.isFinite(n)? n : 0;
}
