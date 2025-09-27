// /js/list.js — ArkTube v0.2.1 List (refactor)
// - CATEGORY_MODEL 어댑터(그룹 내 isSeries/key 규칙 반영)
// - Firestore cats 필드로 통일
// - 개인자료 키 personal_${slot} 우선 + copytube_${slot} 폴백
// - 등록자: ownerName만 사용 (preloadDisplayNames는 no-op로 유지)
// - 기존 기능(정렬/랜덤/검색/무한스크롤/스와이프/개인병합) 전부 유지

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import {
  collection, getDocs, getDoc, doc, query, where, orderBy, limit, startAfter
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ========== 상단바/드롭다운 ========== */
const signupLink  = document.getElementById('signupLink');
const signinLink  = document.getElementById('signinLink');
const welcome     = document.getElementById('welcome');
const menuBtn     = document.getElementById('menuBtn');
const dropdown    = document.getElementById('dropdownMenu');

const btnAbout     = document.getElementById('btnAbout');
const btnCatOrder  = document.getElementById('btnCatOrder');
const btnMyUploads = document.getElementById('btnMyUploads');
const btnSignOut   = document.getElementById('btnSignOut');
const btnList      = document.getElementById('btnList');
const btnGoUpload  = document.getElementById('btnGoUpload');

let isMenuOpen = false;
function openDropdown(){ if(!dropdown) return; isMenuOpen = true; dropdown.classList.remove('hidden'); requestAnimationFrame(()=> dropdown.classList.add('show')); }
function closeDropdown(){ if(!dropdown) return; isMenuOpen = false; dropdown.classList.remove('show'); setTimeout(()=> dropdown.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user) => {
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) welcome.textContent = loggedIn ? `Welcome! ${user?.displayName || '회원'}` : '';
  closeDropdown();
});
menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown', (e)=>{ if(!dropdown || dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

btnAbout    ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnCatOrder ?.addEventListener('click', ()=>{ location.href='/category-order.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ auth.currentUser ? (location.href='/manage-uploads.html') : (location.href='/signin.html'); closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{ if(!auth.currentUser){ location.href='/signin.html'; return; } try{ await fbSignOut(auth); } finally{ closeDropdown(); } });
btnList     ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });
btnGoUpload ?.addEventListener('click', ()=>{ auth.currentUser ? (location.href='/upload.html') : (location.href='/signin.html'); closeDropdown(); });

/* ========== DOM & 상태 ========== */
const $cards     = document.getElementById('cards');
const $msg       = document.getElementById('msg');
const $btnMore   = document.getElementById('btnMore');
const $btnSort   = document.getElementById('btnSortToggle');
const $q         = document.getElementById('q');
const $btnSearch = document.getElementById('btnSearch');
const $btnClear  = document.getElementById('btnClear');
const $modeText  = document.getElementById('currentMode');

const PAGE_SIZE = 60;
const RANDOM_PREFETCH_PAGES = 12;
const RAND_SEED_KEY = 'list_rand_seed';
const ORDER_KEY = 'list_sort_dir_v3'; // 'desc'|'asc'|'rand'

let ORDER_MODE = 'desc';
let lastDoc = null, hasMore = true, isLoading = false;
let allDocs = [];                 // 서버 로드 누적(랜덤 제외)
let loadedIds = new Set();        // 중복 방지

// 랜덤 모드
let randSeed = 0;
let randPool = []; // 조건 충족 문서 풀(셔플 전/후 동일 변수 사용)
let randPtr  = 0;

/* ========== 유틸 ========== */
function esc(s=''){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}
function extractYouTubeId(url=''){
  const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([^?&\/]+)/);
  return m ? m[1] : '';
}
function toThumb(url){ const id = extractYouTubeId(url); return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''; }
function setStatus(t){ $msg?.textContent = t || ''; }

/* ========== 선택/개인자료 ========== */
const personalVals = ['personal1','personal2','personal3','personal4'];

function getSelectedCats(){
  try{
    const raw = localStorage.getItem('selectedCats');
    const v = JSON.parse(raw || 'null');
    if (v === "ALL" || v === null) return [];
    return Array.isArray(v) ? v : [];
  }catch{ return []; }
}
function getViewType(){ return localStorage.getItem('arktube:view:type') || 'all'; } // 'all'|'shorts'|'video'

function readPersonalItems(slot){
  // 우선 최신 포맷, 없으면 구버전 호환
  const keyNew = `personal_${slot}`;
  const keyOld = `copytube_${slot}`;
  try{
    let arr = JSON.parse(localStorage.getItem(keyNew) || 'null');
    if(!Array.isArray(arr)) arr = JSON.parse(localStorage.getItem(keyOld) || '[]');
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function getPersonalLabel(slot){
  try{
    const labels = JSON.parse(localStorage.getItem('personalLabels') || '{}');
    const v = labels?.[slot];
    if(v) return v;
    const m = String(slot||'').match(/^personal(\d)$/);
    return m ? `자료${m[1]}` : (slot || '개인자료');
  }catch{ return slot || '개인자료'; }
}

/* ========== 카테고리 어댑터(CATEGORY_MODEL/CATEGORY_GROUPS 지원) ========== */
function buildCategoryIndex(){
  const idx = { labelOf: (v)=>v, isSeriesValue: (value)=>false };
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  try{
    const seriesSet = new Set();
    const labelMap  = {};
    groups.forEach(g=>{
      const seriesLike = (g?.isSeries===true) || (String(g?.key||'').startsWith('series_'));
      (g?.children||[]).forEach(c=>{
        if(c?.value){
          labelMap[c.value] = c.label || c.value;
          if(seriesLike) seriesSet.add(c.value);
        }
      });
    });
    idx.labelOf = (v)=> labelMap[v] || v;
    idx.isSeriesValue = (v)=> seriesSet.has(v);
  }catch{}
  return idx;
}
const CATIDX = buildCategoryIndex();

/* ========== 시리즈 전용 선택 판정(턴 단위) ========== */
function isSeriesOnlySelection(selected){
  if(!Array.isArray(selected) || !selected.length) return false;
  const cats = selected.filter(v => !personalVals.includes(v));
  if(!cats.length) return false;
  return cats.every(v => CATIDX.isSeriesValue(v));
}

/* ========== 제목 oEmbed 7일 캐시 ========== */
const TitleCache = {
  get(id){
    try{
      const j = localStorage.getItem('yt_title_'+id);
      if(!j) return null;
      const { t, exp } = JSON.parse(j);
      if(exp && Date.now() > exp){ localStorage.removeItem('yt_title_'+id); return null; }
      return t || null;
    }catch{ return null; }
  },
  set(id, title){
    try{
      const exp = Date.now() + 7*24*60*60*1000;
      localStorage.setItem('yt_title_'+id, JSON.stringify({ t: String(title||'').slice(0,200), exp }));
    }catch{}
  }
};
const lazyTitleMap = new Map();
async function fetchYouTubeTitleById(id){
  if(!id) return null;
  const c = TitleCache.get(id);
  if(c){ lazyTitleMap.set(id,c); return c; }
  try{
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`, { mode:'cors' });
    if(!res.ok) throw 0;
    const data = await res.json();
    const title = data?.title ? String(data.title) : null;
    if(title){ TitleCache.set(id,title); lazyTitleMap.set(id,title); }
    return title;
  }catch{ return null; }
}
async function hydrateTitleIfNeeded(titleEl, url, existing){
  if(!titleEl) return;
  if(existing && existing!=='(제목 없음)') return;
  const id = extractYouTubeId(url);
  if(!id) return;
  const t = await fetchYouTubeTitleById(id);
  if(t) titleEl.textContent = t;
}

/* ========== (no-op) 등록자 프리로드 ========== */
// 문서에 ownerName이 이미 저장되므로, 구조 유지용 no-op
async function preloadDisplayNames(_batch){ return; }

/* ========== 파생 필터(턴 단위) ========== */
function deriveFilters(){
  const selected = getSelectedCats();
  const selectedNonPersonal = selected.filter(v => !personalVals.includes(v));
  const personalPicked = selected.filter(v => personalVals.includes(v));

  const seriesOnly = isSeriesOnlySelection(selected);
  const viewType = seriesOnly ? 'all' : getViewType();

  const canServerCats = selectedNonPersonal.length > 0 && selectedNonPersonal.length <= 10;
  const needClientCats = selectedNonPersonal.length > 10;

  return {
    selected,
    selectedNonPersonal,
    personalPicked,
    seriesOnly,
    viewType,
    canServerCats,
    needClientCats,
    selectedSet: new Set(selectedNonPersonal)
  };
}

/* ========== 정렬 모드 ========== */
function readOrder(def='desc'){
  try{
    const v = localStorage.getItem(ORDER_KEY) || def;
    return (v==='asc'||v==='desc'||v==='rand') ? v : def;
  }catch{ return def; }
}
function saveOrder(v){ try{ localStorage.setItem(ORDER_KEY, v); }catch{} }
function labelFor(mode){ return mode==='asc' ? '등록순' : (mode==='rand' ? '랜덤' : '최신순'); }
function applySortButtonUI(){
  $btnSort && ($btnSort.textContent = labelFor(ORDER_MODE));
  $btnSort?.setAttribute('aria-pressed', (ORDER_MODE==='asc').toString());
}

/* ========== 상태 리셋/시드 ========== */
function resetState(){
  lastDoc = null; hasMore = true; isLoading = false;
  allDocs = []; loadedIds = new Set();
  randPool = []; randPtr = 0;
}
function readSeed(){
  const n = Number(sessionStorage.getItem(RAND_SEED_KEY)||0)>>>0;
  return n || newSeed();
}
function newSeed(){
  const s = (Date.now() ^ Math.floor(Math.random()*1e9)) >>> 0;
  sessionStorage.setItem(RAND_SEED_KEY, String(s));
  return s;
}
function seededRandom(seed){
  let t = seed>>>0;
  return function(){
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t>>>15), 1 | t);
    r ^= r + Math.imul(r ^ (r>>>7), 61 | r);
    return ((r ^ (r>>>14)) >>> 0) / 4294967296;
  };
}
function shuffleSeeded(arr, seed){
  const rnd = seededRandom(seed);
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(rnd()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* ========== 개인자료 렌더(다중 병합) ========== */
function renderPersonalMerged(personalPicked){
  const slots = (personalPicked && personalPicked.length) ? personalPicked : ['personal1'];
  const bucket = [];
  slots.forEach(slot=>{
    const arr = readPersonalItems(slot);
    arr.forEach(x=> bucket.push({ slot, item:x }));
  });
  if(!bucket.length){
    $cards && ($cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">개인자료에 저장된 영상이 없습니다.</div>`);
    $btnMore?.style.setProperty('display','none');
    setStatus('0개');
    return;
  }
  bucket.sort((a,b)=> (b.item?.savedAt||0) - (a.item?.savedAt||0));

  $cards && ($cards.innerHTML='');
  const frag = document.createDocumentFragment();
  bucket.forEach(({slot,item}, idx)=>{
    const title = item.title || '(제목 없음)';
    const url   = item.url || '';
    const thumb = toThumb(url);
    const label = getPersonalLabel(slot);

    const card = document.createElement('article');
    card.className='card';
    card.innerHTML = `
      <div class="left">
        <div class="title" title="${esc(title)}">${esc(title)}</div>
        <div class="chips"><span class="chip">${esc(label)}</span></div>
        <div class="meta">등록: 나</div>
      </div>
      <div class="right">
        <div class="thumb-wrap"><img class="thumb" src="${esc(thumb)}" alt="썸네일" loading="lazy"></div>
      </div>`;
     // Firestore 제목이 비어 있을 때만 oEmbed(7일 캐시)로 보강
    if (title === '(제목 없음)') {
      hydrateTitleIfNeeded(card.querySelector('.title'), url, title);
    }

    const open = ()=> openInWatchPersonal(bucket.map(b=>b.item), idx, 'merged', '개인자료');
    card.querySelector('.left') ?.addEventListener('click', open);
    card.querySelector('.thumb')?.addEventListener('click', open);
    frag.appendChild(card);
  });
  $cards?.appendChild(frag);
  $btnMore?.style.setProperty('display','none');
  setStatus(`총 ${bucket.length}개`);
}
function openInWatchPersonal(items, index, slot, label){
  const queue = items.map((it,i)=>({
    id: `local-${slot}-${i}`,
    url: it.url || '',
    title: it.title || lazyTitleMap.get(extractYouTubeId(it.url||'')) || '',
    cats: [label]
  }));
  sessionStorage.setItem('playQueue', JSON.stringify(queue));
  sessionStorage.setItem('playIndex', String(index));
  location.href = `/watch.html?idx=${index}&cats=${encodeURIComponent(slot)}&src=list`;
}

/* ========== 서버 로드(asc/desc) — 턴 파생값 인자 사용 ========== */
async function loadPageAscDesc(derived, initial=false){
  if(isLoading || !hasMore) return false;
  isLoading = true;
  setStatus(allDocs.length ? `총 ${allDocs.length}개 불러옴 · 더 불러오는 중…` : '불러오는 중…');

  try{
    const base = collection(db,'videos');
    const orderPair = (ORDER_MODE==='asc') ? ['createdAt','asc'] : ['createdAt','desc'];
    const parts = [];

    // 서버 카테고리 필터(≤10만)
    if(derived.canServerCats){
      parts.push(where('cats','array-contains-any', derived.selectedNonPersonal)); // ★ cats
    }
    // 형식(시리즈 전용이 아니면 적용)
    if(derived.viewType !== 'all'){
      parts.push(where('type','==', derived.viewType));
    }
    parts.push(orderBy(...orderPair));
    if(lastDoc) parts.push(startAfter(lastDoc));
    parts.push(limit(PAGE_SIZE));

    const snap = await getDocs(query(base, ...parts));
    if(snap.empty){
      hasMore = false;
      if(initial && !allDocs.length){
        $cards && ($cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">해당 조건의 영상이 없습니다.</div>`);
      }
      $btnMore?.style.setProperty('display','none');
      setStatus(`총 ${allDocs.length}개`);
      isLoading=false; return false;
    }

    const batch = [];
    for(const d of snap.docs){
      if(loadedIds.has(d.id)) continue;
      const data = d.data();
      // 서버에서 못거른 경우(>10 카테고리 선택) — 클라 필터 보조
      if(derived.needClientCats){
        const cats = Array.isArray(data?.cats) ? data.cats : []; // ★ cats
        if(!cats.some(v => derived.selectedSet.has(v))) continue;
      }
      allDocs.push({ id:d.id, data });
      loadedIds.add(d.id);
      batch.push({ id:d.id, data });
    }

    lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
    if(snap.size < PAGE_SIZE) hasMore = false;

    await preloadDisplayNames(batch);
    render(derived);
    $btnMore?.style.setProperty('display', hasMore ? '' : 'none');
    setStatus(`총 ${allDocs.length}개`);
  }catch(e){
    console.error('[list] load fail:', e);
    if(initial && !allDocs.length){
      $cards && ($cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">목록을 불러오지 못했습니다.</div>`);
    }
    $btnMore?.style.setProperty('display','none');
  }finally{
    isLoading=false;
  }
  return true;
}

/* ========== 랜덤 — 턴 파생값 인자 사용 ========== */
async function buildRandomPool(derived){
  randPool = []; randPtr = 0;
  lastDoc = null; hasMore = true; isLoading = false;
  allDocs = []; loadedIds = new Set();

  const base = collection(db,'videos');
  const orderPair = ['createdAt','desc'];

  let pages = 0;
  while(pages < RANDOM_PREFETCH_PAGES && hasMore){
    if(isLoading) break;
    isLoading = true;

    const parts = [];
    if(derived.canServerCats){
      parts.push(where('cats','array-contains-any', derived.selectedNonPersonal)); // ★ cats
    }
    if(derived.viewType !== 'all'){
      parts.push(where('type','==', derived.viewType));
    }
    parts.push(orderBy(...orderPair));
    if(lastDoc) parts.push(startAfter(lastDoc));
    parts.push(limit(PAGE_SIZE));

    try{
      const snap = await getDocs(query(base, ...parts));
      if(snap.empty){ hasMore=false; isLoading=false; break; }
      for(const d of snap.docs){
        if(loadedIds.has(d.id)) continue;
        const data = d.data();
        if(derived.needClientCats){
          const cats = Array.isArray(data?.cats) ? data.cats : []; // ★ cats
          if(!cats.some(v => derived.selectedSet.has(v))) continue;
        }
        allDocs.push({ id:d.id, data });
        loadedIds.add(d.id);
      }
      lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
      if(snap.size < PAGE_SIZE) hasMore = false;
    }catch(e){
      console.warn('[list:rand] preload fail:', e?.message||e);
      break;
    }finally{
      isLoading=false; pages++;
    }
  }

  await preloadDisplayNames(allDocs);
  randSeed = readSeed(); // 새로고침에도 유지
  randPool = shuffleSeeded(allDocs, randSeed);
  randPtr  = 0;
}
function takeFromRandom(n){
  const end = Math.min(randPtr + n, randPool.length);
  const slice = randPool.slice(randPtr, end);
  randPtr = end;
  return slice;
}

/* ========== 검색/클라 필터/렌더 ========== */
function filterBySearch(list){
  const q = ($q?.value || '').trim().toLowerCase();
  if(!q) return list;
  return list.filter(x=>{
    const url = String(x.data?.url || '').toLowerCase();
    const id  = extractYouTubeId(x.data?.url || '');
    const title = String((x.data?.title && x.data.title.trim()) ? x.data.title : (lazyTitleMap.get(id) || '')).toLowerCase();
    return title.includes(q) || url.includes(q);
  });
}
function renderFrom(list){
  if(!$cards) return;
  $cards.innerHTML='';
  if(!list.length){
    $cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">결과가 없습니다.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  list.forEach((x, idx)=>{
    const d     = x.data || {};
    const title = (typeof d.title === 'string' && d.title.trim().length)
      ? d.title
      : '(제목 없음)'; // 빈 제목만 보강 대상    
    const url   = d.url || '';
    const catsV = Array.isArray(d.cats) ? d.cats : [];            // ★ cats
    const thumb = d.thumbnail || toThumb(url);
    const name  = d?.ownerName || '회원';

    const chips = catsV.map(v=> `<span class="chip" title="${esc(CATIDX.labelOf(v))}">${esc(CATIDX.labelOf(v))}</span>`).join('');

    const card = document.createElement('article');
    card.className='card';
    card.innerHTML = `
      <div class="left">
        <div class="title" title="${esc(title)}">${esc(title)}</div>
        <div class="chips">${chips}</div>
        <div class="meta">등록: ${esc(name)}</div>
      </div>
      <div class="right">
        <div class="thumb-wrap"><img class="thumb" src="${esc(thumb)}" alt="썸네일" loading="lazy"></div>
      </div>`;
// Firestore 제목이 비어 있을 때만 oEmbed(7일 캐시)로 보강
    if (title === '(제목 없음)') {
      hydrateTitleIfNeeded(card.querySelector('.title'), url, title);
    }    
    const open = ()=> openInWatch(list, idx);
    card.querySelector('.left') ?.addEventListener('click', open);
    card.querySelector('.thumb')?.addEventListener('click', open);
    frag.appendChild(card);
  });
  $cards.appendChild(frag);
}
function render(derived){
  if(derived.personalPicked.length){
    renderPersonalMerged(derived.personalPicked);
    return;
  }
  const list = filterBySearch(allDocs);
  renderFrom(list);
}

/* ========== watch로 이동 ========== */
function openInWatch(list, index){
  const queue = list.map(x=>{
    const id = extractYouTubeId(x.data?.url || '');
    return {
      id: x.id,
      url: x.data?.url || '',
      title: (x.data?.title && x.data.title.trim())
          ? x.data.title
          : (lazyTitleMap.get(id) || ''),
      cats: Array.isArray(x.data?.cats) ? x.data.cats : []       // ★ cats
    };
  });
  sessionStorage.setItem('playQueue', JSON.stringify(queue));
  sessionStorage.setItem('playIndex', String(index));

  let catsParam = '';
  try{
    const sel = getSelectedCats();
    if(sel.length) catsParam = `&cats=${encodeURIComponent(sel.join(','))}`;
  }catch{}

  const docId = encodeURIComponent(list[index].id);
  location.href = `/watch.html?doc=${docId}&idx=${index}${catsParam}&src=list`;
}

/* ========== 정렬 토글 ========== */
function setInitialOrder(derived){
  const def = derived.seriesOnly ? 'asc' : 'desc';
  ORDER_MODE = readOrder(def);
  applySortButtonUI();
  $modeText?.textContent = (ORDER_MODE==='asc' ? '등록순' : (ORDER_MODE==='rand' ? '랜덤' : (derived.seriesOnly?'시리즈(기본:등록순)':'최신(기본)')));
}
$btnSort?.addEventListener('click', async ()=>{
  ORDER_MODE = (ORDER_MODE==='desc') ? 'asc' : (ORDER_MODE==='asc' ? 'rand' : 'desc');
  saveOrder(ORDER_MODE);
  applySortButtonUI();
  $modeText?.textContent = (ORDER_MODE==='asc' ? '등록순' : (ORDER_MODE==='rand' ? '랜덤' : '최신순'));

  const derived = deriveFilters();
  resetState();
  $cards && ($cards.innerHTML='');
  setStatus('불러오는 중…');

  if(derived.personalPicked.length){
    renderPersonalMerged(derived.personalPicked);
    return;
  }

  if(ORDER_MODE==='rand'){
    await buildRandomPool(derived);
    allDocs = takeFromRandom(PAGE_SIZE);
    render(derived);
    $btnMore?.style.setProperty('display', (randPtr < randPool.length) ? '' : 'none');
    setStatus(`총 ${allDocs.length}개 (랜덤 준비 ${randPool.length}개)`);
  }else{
    await loadPageAscDesc(derived, true);
  }
});

/* ========== 검색 ========== */
$btnSearch?.addEventListener('click', ()=>{
  const derived = deriveFilters();
  if(derived.personalPicked.length){ renderPersonalMerged(derived.personalPicked); return; }
  render(derived);
});
$q?.addEventListener('keydown', (e)=>{
  if(e.key!=='Enter') return;
  e.preventDefault();
  const derived = deriveFilters();
  if(derived.personalPicked.length){ renderPersonalMerged(derived.personalPicked); return; }
  render(derived);
});
$btnClear?.addEventListener('click', ()=>{
  if(!$q) return;
  $q.value=''; const derived = deriveFilters();
  if(derived.personalPicked.length){ renderPersonalMerged(derived.personalPicked); return; }
  render(derived);
});

/* ========== 더 보기 / 무한 스크롤 ========== */
$btnMore?.addEventListener('click', async ()=>{
  const derived = deriveFilters();
  if(derived.personalPicked.length){ return; }
  if(ORDER_MODE==='rand'){
    const more = takeFromRandom(PAGE_SIZE);
    if(!more.length){ $btnMore.style.display='none'; return; }
    allDocs = allDocs.concat(more);
    render(derived);
    if(randPtr >= randPool.length) $btnMore.style.display='none';
    return;
  }
  await loadPageAscDesc(derived, false);
});
const SCROLL_LOAD_OFFSET = 320;
window.addEventListener('scroll', async ()=>{
  const derived = deriveFilters();
  if(derived.personalPicked.length) return;
  if(ORDER_MODE==='rand'){
    if((window.innerHeight + window.scrollY) >= (document.body.offsetHeight - SCROLL_LOAD_OFFSET)){
      const more = takeFromRandom(PAGE_SIZE);
      if(more.length){
        allDocs = allDocs.concat(more);
        render(derived);
      }
    }
    return;
  }
  if(isLoading || !hasMore) return;
  const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - SCROLL_LOAD_OFFSET);
  if(!nearBottom) return;
  await loadPageAscDesc(derived, false);
}, { passive:true });

/* ========== 초기화 ========== */
(async function init(){
  const derived = deriveFilters();
  setInitialOrder(derived);

  if(derived.personalPicked.length){
    renderPersonalMerged(derived.personalPicked);
    return;
  }

  if(ORDER_MODE==='rand'){
    await buildRandomPool(derived);
    allDocs = takeFromRandom(PAGE_SIZE);
    render(derived);
    $btnMore?.style.setProperty('display', (randPtr < randPool.length) ? '' : 'none');
    setStatus(`총 ${allDocs.length}개 (랜덤 준비 ${randPool.length}개)`);
  }else{
    await loadPageAscDesc(derived, true);
  }
})();

/* ========== 스와이프 네비 (기본형+고급형, 데드존 18%) ========== */
(function initSwipe(){
  function initSimple({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    let sx=0, sy=0, t0=0, tracking=false;
    const THRESH_X=70, MAX_OFF_Y=80, MAX_TIME=600;
    const getPoint = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    function onStart(e){
      const p=getPoint(e); if(!p) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(p.clientX>=L && p.clientX<=R) return;
      sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
    }
    function onEnd(e){
      if(!tracking) return; tracking=false;
      const p=getPoint(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
      if(Math.abs(dy)>MAX_OFF_Y || dt>MAX_TIME) return;
      if(dx<=-THRESH_X && goLeftHref){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
    }
    document.addEventListener('touchstart', onStart, {passive:true});
    document.addEventListener('touchend',   onEnd,   {passive:true});
    document.addEventListener('pointerdown',onStart, {passive:true});
    document.addEventListener('pointerup',  onEnd,   {passive:true});
  }
  function initDrag({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,canceled=false;
    const TH=60, SLOP=45, TMAX=700;
    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
    function isInteractive(el){ return !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')); }
    function start(e){
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      if(isInteractive(e.target)) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(t.clientX>=L && t.clientX<=R) return;
      x0=t.clientX; y0=t.clientY; t0=Date.now(); active=true; canceled=false; page.style.transition='none';
    }
    function move(e){
      if(!active) return;
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0;
      if(Math.abs(dy)>SLOP){ canceled=true; active=false; reset(); return; }
      const dxAdj = (dx<0)?dx:0;
      if(dxAdj===0){ page.style.transform='translateX(0px)'; return; }
      e.preventDefault(); page.style.transform='translateX('+dxAdj+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(canceled || Math.abs(dy)>SLOP || dt>TMAX){ reset(); return; }
      if(dx<=-TH){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(-100vw)'; setTimeout(()=>{ location.href=goLeftHref; },150); }
      else reset();
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchmove', move ,{passive:false});
    document.addEventListener('touchend',  end  ,{passive:true,capture:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointermove', move ,{passive:false});
    document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
  }
  initSimple({ goLeftHref:'/index.html', deadZoneCenterRatio:0.15 });
  initDrag  ({ goLeftHref:'/index.html', deadZoneCenterRatio:0.15 });
})();
