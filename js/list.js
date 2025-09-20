// /js/list.js — ArkTube v0.1 List
// - 카테고리/형식 필터 반영
// - 정렬 토글: 최신(desc) ↔ 등록(asc) ↔ 랜덤(rand) 순환
// - 개인자료 personal1..personal4 로컬 전용
// - 무한 스크롤 + "더 보기" + 랜덤 재셔플
// - 닉네임 사전 로딩 + 제목(oEmbed 7일 캐시)
// - 스와이프 네비: 우→좌 = index, 좌→우 없음 (기본형+고급형)

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_GROUPS } from './categories.js';
import {
  collection, getDocs, getDoc, doc, query, where, orderBy, limit, startAfter
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ---------- Topbar 로그인/드롭다운 ---------- */
const signupLink = document.getElementById('signupLink');
const signinLink = document.getElementById('signinLink');
const welcome    = document.getElementById('welcome');
const menuBtn    = document.getElementById('menuBtn');
const dropdown   = document.getElementById('dropdownMenu');
const btnSignOut = document.getElementById('btnSignOut');
const btnGoUpload= document.getElementById('btnGoUpload');
const btnAbout   = document.getElementById('btnAbout');
const btnList    = document.getElementById('btnList');
const btnMyUploads = document.getElementById('btnMyUploads');

let isMenuOpen=false;
function openDropdown(){ if(!dropdown) return; isMenuOpen=true; dropdown.classList.remove('hidden'); requestAnimationFrame(()=> dropdown.classList.add('show')); }
function closeDropdown(){ if(!dropdown) return; isMenuOpen=false; dropdown.classList.remove('show'); setTimeout(()=> dropdown.classList.add('hidden'),180); }

onAuthStateChanged(auth,(user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) welcome.textContent = loggedIn ? `Welcome! ${user?.displayName || '회원'}` : '';
  closeDropdown();
});
menuBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(!dropdown || dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click',(e)=> e.stopPropagation());

btnSignOut?.addEventListener('click', async ()=>{ if(!auth.currentUser){ location.href='/signin.html'; return; } try{ await fbSignOut(auth); }catch{} closeDropdown(); });
btnGoUpload?.addEventListener('click', ()=>{ location.href='/upload.html';  closeDropdown(); });
btnAbout   ?.addEventListener('click', ()=>{ location.href='/about.html';   closeDropdown(); });
btnList    ?.addEventListener('click', ()=>{ location.href='/list.html';    closeDropdown(); });
btnMyUploads?.addEventListener('click',()=>{ auth.currentUser ? (location.href='/manage-uploads.html') : (location.href='/signin.html'); closeDropdown(); });

/* ---------- DOM ---------- */
const $cards     = document.getElementById('cards');
const $msg       = document.getElementById('msg');
const $q         = document.getElementById('q');
const $btnSearch = document.getElementById('btnSearch');
const $btnMore   = document.getElementById('btnMore');
const $btnSort   = document.getElementById('btnSortToggle');

/* ---------- 상태 ---------- */
const PAGE_SIZE = 60;
let allDocs   = [];  // { id, data }
let lastDoc   = null;
let hasMore   = true;
let isLoading = false;
let sortMode  = 'desc'; // 'desc'|'asc'|'rand'
let randomSeed = Math.random(); // 랜덤 시드는 토글 때마다 갱신

/* ---------- 선택/형식 읽기 ---------- */
function getSelectedCats(){
  try {
    const raw = localStorage.getItem('selectedCats');
    const v = JSON.parse(raw || 'null');
    return v || "ALL";
  }catch{ return "ALL"; }
}
function getViewType(){
  // all|shorts|video
  return localStorage.getItem('arktube:view:type') || 'all';
}

/* ---------- 시리즈-only 판별 (형식 토글 무시 용) ---------- */
const SERIES_CHILD_SET = (() => {
  const set = new Set();
  CATEGORY_GROUPS.forEach(g=>{
    if(String(g.key).startsWith('series_')){
      (g.children||[]).forEach(c => set.add(c.value));
    }
  });
  return set;
})();
function selectedIsSeriesOnly(){
  const sel = getSelectedCats();
  const arr = Array.isArray(sel) ? sel : [];
  if(!arr.length) return false;
  return arr.every(v=> SERIES_CHILD_SET.has(v));
}

/* ---------- 개인자료 모드 ---------- */
const personalVals = ['personal1','personal2','personal3','personal4'];
function isPersonalOnlySelection(){
  const sel = getSelectedCats();
  if (!Array.isArray(sel) || sel.length!==1) return false;
  return personalVals.includes(sel[0]);
}
function getPersonalSlot(){
  const sel = getSelectedCats();
  if(Array.isArray(sel) && sel.length===1 && personalVals.includes(sel[0])) return sel[0];
  return 'personal1';
}
function readPersonalItems(slot){
  const key = `copytube_${slot}`; // 기존 포맷 호환
  try{
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function getPersonalLabel(slot){
  try{
    const labels = JSON.parse(localStorage.getItem('personalLabels') || '{}');
    return labels?.[slot] || slot.replace('personal','개인자료');
  }catch{ return slot; }
}

/* ---------- 유틸 ---------- */
function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function extractId(url=''){
  const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([^?&\/]+)/);
  return m ? m[1] : '';
}
function toThumb(url, fallback=''){
  const id = extractId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : fallback;
}
function setStatus(t){ if($msg) $msg.textContent = t || ''; }
function toggleMore(show){ const more = document.getElementById('more'); if(more) more.style.display = show ? '' : 'none'; }

/* ---- 라벨 맵 ---- */
const LABEL_MAP = (() => {
  const m = {};
  try { CATEGORY_GROUPS.forEach(g => g?.children?.forEach(c => { if(c?.value) m[c.value] = c.label || c.value; })); } catch {}
  return m;
})();
const getLabel = (key)=> LABEL_MAP[key] || key;

/* ---------- 제목 캐시(oEmbed 7일) ---------- */
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
    const url = `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`;
    const res = await fetch(url, { mode:'cors' });
    if(!res.ok) throw 0;
    const data = await res.json();
    const title = data?.title ? String(data.title) : null;
    if(title){
      TitleCache.set(id, title);
      lazyTitleMap.set(id, title);
    }
    return title;
  }catch{ return null; }
}
async function hydrateTitleIfNeeded(titleEl, url, existingTitle){
  if(!titleEl) return;
  if(existingTitle && existingTitle !== '(제목 없음)') return;
  const id = extractId(url);
  if(!id) return;
  const t = await fetchYouTubeTitleById(id);
  if(t) titleEl.textContent = t;
}

/* ---------- 닉네임 캐시 ---------- */
const NickCache = { map:new Map(), get(uid){ return this.map.get(uid)||''; }, set(uid,name){ if(uid) this.map.set(uid, String(name||'')); } };
const ownerUidOf = (d={}) => d?.ownerUid || d?.uid || d?.userUid || null;

async function preloadNicknamesFor(docs){
  const uids = new Set();
  docs.forEach(x => { const uid = ownerUidOf(x.data); if(uid && !NickCache.map.has(uid)) uids.add(uid); });
  if(!uids.size) return;
  await Promise.all([...uids].map(async uid=>{
    try{
      const snap = await getDoc(doc(db, 'users', uid));
      const prof = snap.exists() ? snap.data() : null;
      const name = prof?.nickname || prof?.displayName || '';
      NickCache.set(uid, name);
    }catch{ NickCache.set(uid, ''); }
  }));
}

/* ---------- 정렬 토글 ---------- */
const SORT_KEY = 'list_sort_mode';
function readSortMode(){
  try{ const v=(localStorage.getItem(SORT_KEY)||'').toLowerCase(); return (v==='asc'||v==='desc'||v==='rand')?v:'desc'; }catch{ return 'desc'; }
}
function saveSortMode(m){ try{ localStorage.setItem(SORT_KEY, (m==='asc'||m==='rand')?m:'desc'); }catch{} }
function labelFor(m){ return m==='asc' ? '등록순' : (m==='rand' ? '랜덤' : '최신순'); }
function applySortButtonUI(){
  if(!$btnSort) return;
  $btnSort.textContent = labelFor(sortMode);
  $btnSort.setAttribute('aria-pressed', (sortMode!=='desc') ? 'true' : 'false');
  $btnSort.title = (sortMode==='asc' ? '등록된 순서대로 보기' : sortMode==='rand' ? '무작위 순서로 보기' : '최신 등록 먼저 보기');
}
function cycleSort(){
  sortMode = (sortMode==='desc') ? 'asc' : (sortMode==='asc' ? 'rand' : 'desc');
  randomSeed = Math.random();
  saveSortMode(sortMode); applySortButtonUI();
}

/* ---------- 페이징 공통 ---------- */
function resetPaging(){ allDocs=[]; lastDoc=null; hasMore=true; }

/* ---------- 필터링 ---------- */
function activeViewType(){
  const base = getViewType();
  return selectedIsSeriesOnly() ? 'all' : base; // 시리즈-only면 형식 무시
}
function matchesFilter(data){
  // 카테고리
  const sel = getSelectedCats();
  if(Array.isArray(sel) && sel.length){
    const catArr = Array.isArray(data?.categories)?data.categories:[];
    if(!catArr.some(v=> sel.includes(v))) return false;
  }
  // 형식
  const vtype = activeViewType();
  if(vtype!=='all'){
    if(String(data?.type)!==String(vtype)) return false;
  }
  // 검색어
  const q = ($q?.value||'').trim().toLowerCase();
  if(q){
    const id = extractId(data?.url||'');
    const t = String(data?.title || lazyTitleMap.get(id) || '').toLowerCase();
    const u = String(data?.url||'').toLowerCase();
    if(!t.includes(q) && !u.includes(q)) return false;
  }
  return true;
}
function filterDocs(){ return allDocs.filter(x => matchesFilter(x.data||{})); }

/* ---------- 렌더 ---------- */
function chipsHTML(cats){ return (Array.isArray(cats)?cats:[]).map(v=> `<span class="chip" title="${esc(getLabel(v))}">${esc(getLabel(v))}</span>`).join(''); }
function renderPersonalList(){
  const slot  = getPersonalSlot();
  const items = readPersonalItems(slot);
  const label = getPersonalLabel(slot);

  $cards.innerHTML = '';
  if(!items.length){
    $cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">${esc(label)}에 저장된 영상이 없습니다.</div>`;
    toggleMore(false); setStatus('0개'); return;
  }

  const frag = document.createDocumentFragment();
  const sorted = items.slice().sort((a,b)=> (b?.savedAt||0) - (a?.savedAt||0));
  sorted.forEach((it, idx)=>{
    const title = it.title || '(제목 없음)';
    const url   = it.url   || '';
    const id    = extractId(url);
    const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

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
    hydrateTitleIfNeeded(card.querySelector('.title'), url, title);
    card.querySelector('.left') ?.addEventListener('click', ()=> openInWatchPersonal(sorted, idx, slot, label));
    card.querySelector('.thumb')?.addEventListener('click', ()=> openInWatchPersonal(sorted, idx, slot, label));
    frag.appendChild(card);
  });
  $cards.appendChild(frag);
  toggleMore(false); setStatus(`총 ${items.length}개`);
}

function renderCommon(){
  let list = filterDocs();

  // 랜덤 모드면 셔플
  if (sortMode==='rand'){
    // 간단 셔플 + 시드: 매 토글시 randomSeed 갱신되어 결과 변함
    const r = randomSeed;
    list = list.slice().sort((a,b)=> Math.sin((a.id.length + r) * 7.1) - Math.sin((b.id.length + r) * 5.9));
  }

  $cards.innerHTML='';
  if(!list.length){
    $cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">결과가 없습니다.</div>`;
    setStatus('0개'); toggleMore(hasMore && sortMode!=='rand'); return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((x, idx)=>{
    const d = x.data || {};
    const title = d.title || '(제목 없음)';
    const url   = d.url || '';
    const thumb = d.thumbnail || toThumb(url);
    const uid   = ownerUidOf(d);
    const nick  = NickCache.get(uid) || '회원';

    const card = document.createElement('article');
    card.className='card';
    card.innerHTML = `
      <div class="left">
        <div class="title" title="${esc(title)}">${esc(title)}</div>
        <div class="chips">${chipsHTML(d.categories)}</div>
        <div class="meta">등록: ${esc(nick)}</div>
      </div>
      <div class="right">
        <div class="thumb-wrap"><img class="thumb" src="${esc(thumb)}" alt="썸네일" loading="lazy"></div>
      </div>`;
    hydrateTitleIfNeeded(card.querySelector('.title'), url, title);

    card.querySelector('.left') ?.addEventListener('click', ()=> openInWatch(list, idx));
    card.querySelector('.thumb')?.addEventListener('click', ()=> openInWatch(list, idx));
    frag.appendChild(card);
  });
  $cards.appendChild(frag);
  setStatus(`총 ${list.length}개`);
  toggleMore(hasMore && sortMode!=='rand');
}

/* ---------- watch로 이동 ---------- */
function openInWatchCommon(list, index){
  const queue = list.map(x => {
    const id = extractId(x.data?.url || '');
    return { id:x.id, url:x.data?.url||'', title:x.data?.title || lazyTitleMap.get(id) || '', cats:Array.isArray(x.data?.categories)?x.data.categories:[] };
  });
  sessionStorage.setItem('playQueue', JSON.stringify(queue));
  sessionStorage.setItem('playIndex', String(index));

  const docId = encodeURIComponent(list[index].id);

  let catsParam = '';
  try{
    const sel = getSelectedCats();
    const arr = Array.isArray(sel)?sel:[];
    if(arr.length) catsParam = `&cats=${encodeURIComponent(arr.join(','))}`;
  }catch{}

  location.href = `/watch.html?doc=${docId}&idx=${index}&src=list${catsParam}`;
}
function openInWatchPersonal(items, index, slot, label){
  const queue = items.map((it, i)=> ({ id:`local-${slot}-${i}`, url:it.url||'', title:it.title||lazyTitleMap.get(extractId(it.url||''))||'(제목 없음)', cats:[label] }));
  sessionStorage.setItem('playQueue', JSON.stringify(queue));
  sessionStorage.setItem('playIndex', String(index));
  location.href = `/watch.html?idx=${index}&src=list&cats=${encodeURIComponent(slot)}`;
}
const openInWatch = (list, index)=> isPersonalOnlySelection() ? null : openInWatchCommon(list, index);

/* ---------- Firestore 로드 ---------- */
async function loadPage(){
  if(isLoading || !hasMore) return false;
  if(sortMode==='rand'){ // 랜덤 모드는 더 넉넉히 가져와서 섞음
    isLoading=true; setStatus(allDocs.length ? `총 ${allDocs.length}개 불러옴 · 더 불러오는 중…` : '불러오는 중…');
    try{
      const base = collection(db, 'videos');
      const sel = getSelectedCats();
      const hasCatFilter = Array.isArray(sel) && sel.length>0 && !personalVals.includes(sel[0]);
      const vtype = activeViewType();

      let scanned=0, appended=0;
      while(appended < PAGE_SIZE && scanned < 3){ // 3배치 정도 가져와 섞기
        const parts=[ orderBy('createdAt','desc'), limit(PAGE_SIZE) ];
        if(lastDoc) parts.push(startAfter(lastDoc));
        const snap = await getDocs(query(base, ...parts));
        if(snap.empty){ hasMore=false; break; }
        const batch = snap.docs.map(d => ({ id:d.id, data:d.data() }));
        // 간단 필터(성능): 형식/카테고리는 render 전에 최종 필터하므로 여기선 누적만
        allDocs = allDocs.concat(batch);
        lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
        if(snap.size < PAGE_SIZE) hasMore=false;
        appended += batch.length; scanned++;
      }
      // 닉네임 프리패치
      await preloadNicknamesFor(allDocs.slice(-PAGE_SIZE*3));
      renderCommon();
      setStatus(`총 ${filterDocs().length}개`);
      return true;
    }catch(e){
      console.error('[list] rand load fail:', e);
      setStatus('목록을 불러오지 못했습니다.'); return false;
    }finally{ isLoading=false; }
  }

  // asc/desc 정규 로드
  isLoading=true; setStatus(allDocs.length ? `총 ${allDocs.length}개 불러옴 · 더 불러오는 중…` : '불러오는 중…');
  try {
    const base = collection(db, 'videos');
    const sel = getSelectedCats();
    const vtype = activeViewType();

    // 카테고리 where 가능 여부(≤10개일 때 array-contains-any)
    const catArr = Array.isArray(sel) ? sel.filter(v=> !personalVals.includes(v)) : [];
    const canCatWhere = catArr.length>0 && catArr.length <= 10;
    const hasCatFilter = catArr.length>0;

    const parts=[];
    if(hasCatFilter && canCatWhere) parts.push(where('categories','array-contains-any', catArr));
    if(vtype!=='all') parts.push(where('type','==', vtype));
    parts.push(orderBy('createdAt', sortMode==='asc'?'asc':'desc'));
    if(lastDoc) parts.push(startAfter(lastDoc));
    parts.push(limit(PAGE_SIZE));

    const snap = await getDocs(query(base, ...parts));
    if(snap.empty){ hasMore=false; toggleMore(false); setStatus(allDocs.length ? `총 ${filterDocs().length}개` : '등록된 영상이 없습니다.'); isLoading=false; return false; }

    const batch = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    allDocs = allDocs.concat(batch);
    lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
    if(snap.size < PAGE_SIZE) hasMore=false;

    // 닉네임 프리패치
    await preloadNicknamesFor(batch);

    renderCommon();
    toggleMore(hasMore);
    setStatus(`총 ${filterDocs().length}개`);
    return true;
  } catch (e) {
    console.warn('[list] fallback scan:', e?.message || e);
    // 폴백: createdAt desc로 대량 스캔 후 클라 필터
    try{
      const snap = await getDocs(query(collection(db,'videos'), orderBy('createdAt','desc'), limit(PAGE_SIZE*3)));
      const arr  = snap.docs.map(d => ({ id:d.id, data:d.data() }));
      allDocs = allDocs.concat(arr);
      hasMore = false;
      await preloadNicknamesFor(arr);
      renderCommon();
      toggleMore(false);
      setStatus(`총 ${filterDocs().length}개`);
      return true;
    }catch(e2){
      console.error('[list] load failed:', e2);
      setStatus('목록을 불러오지 못했습니다.');
      toggleMore(false);
      return false;
    }
  } finally { isLoading=false; }
}

/* ---------- ensureMinFiltered ---------- */
async function ensureMinFiltered(min = PAGE_SIZE){
  if(isPersonalOnlySelection()) return;
  let filtered = filterDocs();
  let guard=0;
  while(filtered.length < min && hasMore && guard < 5){
    const ok = await loadPage();
    if(!ok) break;
    filtered = filterDocs();
    guard++;
  }
  renderCommon();
  toggleMore(hasMore && sortMode!=='rand');
}

/* ---------- 이벤트 ---------- */
$btnSearch?.addEventListener('click', async ()=>{ if(isPersonalOnlySelection()){ renderPersonalList(); return; } renderCommon(); await ensureMinFiltered(PAGE_SIZE); });
$q?.addEventListener('keydown', async (e)=>{ if(e.key==='Enter'){ e.preventDefault(); if(isPersonalOnlySelection()){ renderPersonalList(); return; } renderCommon(); await ensureMinFiltered(PAGE_SIZE); }});
$btnMore ?.addEventListener('click', async ()=>{
  $btnMore.disabled=true; $btnMore.textContent='불러오는 중…';
  try{
    await loadPage();
    await ensureMinFiltered(PAGE_SIZE);
  }finally{
    $btnMore.disabled=false; $btnMore.textContent='더 보기';
  }
});
$btnSort ?.addEventListener('click', async ()=>{
  cycleSort();
  // 랜덤 → 페이징 의미 약함. asc/desc → 다시 조회
  $cards.innerHTML=''; setStatus('불러오는 중…');
  resetPaging();
  if(isPersonalOnlySelection()){ renderPersonalList(); return; }
  await loadPage();
  await ensureMinFiltered(PAGE_SIZE);
});

/* ---------- 시작 ---------- */
(async function init(){
  try{
    sortMode = readSortMode(); applySortButtonUI();

    if (isPersonalOnlySelection()){
      renderPersonalList(); return;
    }
    await loadPage();
    await ensureMinFiltered(PAGE_SIZE);
  }catch(e){
    console.error(e);
    setStatus('목록을 불러오지 못했습니다.');
  }
})();

/* ---------- 무한 스크롤 ---------- */
const SCROLL_LOAD_OFFSET = 320;
window.addEventListener('scroll', async ()=>{
  if (isLoading || !hasMore) return;
  if (sortMode==='rand') return; // 랜덤은 수동 더보기 위주
  if (isPersonalOnlySelection()) return;

  const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - SCROLL_LOAD_OFFSET);
  if (!nearBottom) return;

  const ok = await loadPage();
  if(!ok) return;

  let guard=0;
  while(filterDocs().length < PAGE_SIZE && hasMore && guard < 2){
    const ok2 = await loadPage();
    if(!ok2) break; guard++;
  }
}, { passive:true });

/* ===================== */
/* Slide-out CSS (백업)  */
/* ===================== */
(function injectSlideCSS(){
  if (document.getElementById('slide-css-152')) return;
  const style = document.createElement('style');
  style.id = 'slide-css-152';
  style.textContent = `
@keyframes pageSlideLeft { from { transform: translateX(0); opacity:1; } to { transform: translateX(-22%); opacity:.92; } }
@keyframes pageSlideRight{ from { transform: translateX(0); opacity:1; } to { transform: translateX(22%);  opacity:.92; } }
:root.slide-out-left  body { animation: pageSlideLeft 0.26s ease forwards; }
:root.slide-out-right body { animation: pageSlideRight 0.26s ease forwards; }
@media (prefers-reduced-motion: reduce){
  :root.slide-out-left  body,
  :root.slide-out-right body { animation:none; }
}`;
  document.head.appendChild(style);
})();

/* ===================== */
/* 스와이프 네비 (기본형) */
/* ===================== */
function initSwipeNav({ goLeftHref=null, goRightHref=null, animateMs=260, deadZoneCenterRatio=0.30 } = {}){
  let sx=0, sy=0, t0=0, tracking=false;
  const THRESH_X=70, MAX_OFF_Y=80, MAX_TIME=600;
  const getPoint = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;

  function onStart(e){
    const p = getPoint(e); if(!p) return;
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
    const L  = vw * (0.5 - dz/2), R = vw * (0.5 + dz/2);
    if (p.clientX >= L && p.clientX <= R) { tracking=false; return; }
    sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
  }
  function onEnd(e){
    if(!tracking) return; tracking=false;
    const p=getPoint(e); const dx=p.clientX - sx; const dy=p.clientY - sy; const dt=Date.now()-t0;
    if (Math.abs(dy) > MAX_OFF_Y || dt > MAX_TIME) return;
    if (dx <= -THRESH_X && goLeftHref){
      document.documentElement.classList.add('slide-out-left');
      setTimeout(()=> location.href=goLeftHref, animateMs);
    }
  }
  document.addEventListener('touchstart', onStart, { passive:true });
  document.addEventListener('touchend',   onEnd,   { passive:true });
  document.addEventListener('pointerdown',onStart, { passive:true });
  document.addEventListener('pointerup',  onEnd,   { passive:true });
}
initSwipeNav({ goLeftHref: '/index.html', goRightHref: null, deadZoneCenterRatio: 0.30 });

/* ===================== */
/* 스와이프 네비 (고급형) */
/* ===================== */
(function(){
  function initDragSwipe({ goLeftHref=null, goRightHref=null, threshold=60, slop=45, timeMax=700, feel=1.0, deadZoneCenterRatio=0.15 }={}){
    const page = document.querySelector('main') || document.body;
    if(!page) return;

    if(!page.style.willChange || !page.style.willChange.includes('transform')){
      page.style.willChange = (page.style.willChange ? page.style.willChange + ', transform' : 'transform');
    }

    let x0=0, y0=0, t0=0, active=false, canceled=false;
    const isInteractive = (el)=> !!(el && (el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')));

    function reset(anim=true){
      if(anim) page.style.transition = 'transform 180ms ease';
      requestAnimationFrame(()=>{ page.style.transform = 'translateX(0px)'; });
      setTimeout(()=>{ if(anim) page.style.transition = ''; }, 200);
    }

    function start(e){
      const t = (e.touches && e.touches[0]) || (e.pointerType ? e : null);
      if(!t) return;
      if(isInteractive(e.target)) return;

      const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
      const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
      const L  = vw * (0.5 - dz/2), R = vw * (0.5 + dz/2);
      if (t.clientX >= L && t.clientX <= R) return;

      x0=t.clientX; y0=t.clientY; t0=Date.now(); active=true; canceled=false; page.style.transition='none';
    }
    function move(e){
      if(!active) return;
      const t = (e.touches && e.touches[0]) || (e.pointerType ? e : null);
      if(!t) return;

      const dx = t.clientX - x0; const dy = t.clientY - y0;
      if(Math.abs(dy) > slop){ canceled=true; active=false; reset(true); return; }

      let dxAdj = dx; if(dx > 0) dxAdj = 0; // 좌→우 없음
      if (dxAdj === 0){ page.style.transform = 'translateX(0px)'; return; }
      e.preventDefault();
      page.style.transform = 'translateX(' + (dxAdj * feel) + 'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t = (e.changedTouches && e.changedTouches[0]) || (e.pointerType ? e : null); if(!t) return;
      const dx = t.clientX - x0; const dy = t.clientY - y0; const dt = Date.now()-t0;

      if(canceled || Math.abs(dy) > slop || dt > timeMax){ reset(true); return; }

      if(dx <= -threshold && goLeftHref){
        page.style.transition = 'transform 160ms ease';
        page.style.transform  = 'translateX(-100vw)';
        setTimeout(()=>{ location.href = goLeftHref; }, 150);
      } else {
        reset(true);
      }
    }

    document.addEventListener('touchstart',  start, { passive:true });
    document.addEventListener('touchmove',   move,  { passive:false });
    document.addEventListener('touchend',    end,   { passive:true, capture:true });
    document.addEventListener('pointerdown', start, { passive:true });
    document.addEventListener('pointermove', move,  { passive:false });
    document.addEventListener('pointerup',   end,   { passive:true, capture:true });
  }

  // list: 우→좌 = index (중앙 데드존 15%)
  initDragSwipe({ goLeftHref: '/index.html', goRightHref: null, threshold:60, slop:45, timeMax:700, feel:1.0, deadZoneCenterRatio: 0.15 });
})();
