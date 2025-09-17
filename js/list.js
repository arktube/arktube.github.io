// js/list.js (v1.9.0-ascdesc) — 칩=이름 표시 + 닉네임 3행 + oEmbed(7일 캐시) + 무한 스크롤 + 필터 인지형 선로딩 + 스와이프 방향잠금 + 중앙 30% 데드존
// + 정렬 토글: 최신순(desc)↔등록순(asc) — 쿼리 리셋 & 재조회 방식
import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js?v=1.5.1';
import { CATEGORY_GROUPS } from './categories.js?v=1.5.1';
import {
  collection, getDocs, getDoc, doc, query, orderBy, limit, startAfter
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ---------- 전역 내비 중복 방지 플래그 ---------- */
window.__swipeNavigating = window.__swipeNavigating || false;

/* ---------- Topbar 로그인 상태 동기화 & 드롭다운 ---------- */
const signupLink = document.getElementById('signupLink');
const signinLink = document.getElementById('signinLink');
const welcome    = document.getElementById('welcome');
const menuBtn    = document.getElementById('menuBtn');
const dropdown   = document.getElementById('dropdownMenu');
const btnSignOut = document.getElementById('btnSignOut');
const btnGoUpload= document.getElementById('btnGoUpload');
const btnAbout   = document.getElementById('btnAbout');
const btnList    = document.getElementById('btnList');

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

btnSignOut?.addEventListener('click', async ()=>{ if (!auth.currentUser) { location.href = 'signin.html'; return; } try { await fbSignOut(auth); } catch {} closeDropdown(); });
btnGoUpload?.addEventListener('click', ()=>{ location.href = 'upload.html'; closeDropdown(); });
btnAbout   ?.addEventListener('click', ()=>{ location.href = 'about.html';  closeDropdown(); });
btnList    ?.addEventListener('click', ()=>{ location.href = 'list.html';   closeDropdown(); });

/* ---------- DOM ---------- */
const $cards       = document.getElementById('cards');
const $msg         = document.getElementById('msg') || document.getElementById('resultMsg');
const $q           = document.getElementById('q');
const $btnSearch   = document.getElementById('btnSearch');
const $btnClear    = document.getElementById('btnClear'); // optional
const $btnMore     = document.getElementById('btnMore');
const $btnSort     = document.getElementById('btnSortToggle'); // ★ 신규: 정렬 토글

/* ---------- 상태 ---------- */
const PAGE_SIZE = 60;
let allDocs   = [];
let lastDoc   = null;
let hasMore   = true;
let isLoading = false;
let sortDir   = 'desc'; // 'desc'=최신순, 'asc'=등록순

/* ---------- 정렬 토글(상태/표시/재조회) ---------- */
const SORT_KEY = 'list_sort_dir';
function readSortDir(){
  try{
    const v = (localStorage.getItem(SORT_KEY)||'').toLowerCase();
    return (v==='asc' || v==='desc') ? v : 'desc';
  }catch{ return 'desc'; }
}
function saveSortDir(dir){
  try{ localStorage.setItem(SORT_KEY, dir==='asc'?'asc':'desc'); }catch{}
}
function labelFor(dir){
  // 버튼 라벨 = 현재 정렬 상태를 보여줌
  return dir==='asc' ? '등록순' : '최신순';
}
function applySortButtonUI(){
  if(!$btnSort) return;
  $btnSort.textContent = labelFor(sortDir);
  $btnSort.setAttribute('aria-pressed', sortDir==='asc' ? 'true' : 'false');
  $btnSort.title = (sortDir==='asc' ? '등록된 순서대로 보기' : '최신 등록 먼저 보기');
}
function setSortDir(dir){
  sortDir = (dir==='asc') ? 'asc' : 'desc';
  saveSortDir(sortDir);
  applySortButtonUI();
}
function resetPaging(){
  allDocs = [];
  lastDoc = null;
  hasMore = true;
}
async function reloadWithCurrentSort(){
  if(!$btnSort) return;
  $btnSort.disabled = true;
  setStatus('불러오는 중…');
  $cards.innerHTML = '';
  resetPaging();
  try{
    await loadPage();
    await ensureMinFiltered(PAGE_SIZE);
  }finally{
    $btnSort.disabled = false;
  }
}

/* ---------- 유틸 ---------- */
function getSelectedCats(){
  try {
    const raw = localStorage.getItem('selectedCats');
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function extractId(url=''){
  const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([^?&\/]+)/);
  return m ? m[1] : '';
}
function toThumb(url, fallback=''){
  const id = extractId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : fallback;
}

/* ---- 카테고리 라벨: 이름(라벨) 반환 ---- */
 const LABEL_MAP = (() => {
   const m = {};
   try {
     CATEGORY_GROUPS.forEach(g => g?.children?.forEach(c => {
       if (c?.value) m[c.value] = c.label || c.value;
     }));
   } catch {}
   return m;
 })();

 function getLabel(key){ return LABEL_MAP[key] || key; }

function setStatus(t){ if($msg) $msg.textContent = t || ''; }
function toggleMore(show){ if($btnMore) $btnMore.style.display = show ? '' : 'none'; }

/* ---------- 제목 캐시(oEmbed, 7일) + 임시메모리 ---------- */
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
const NickCache = {
  map: new Map(), // uid -> string (nickname/displayName) or ''(미상)
  get(uid){ return this.map.get(uid) || ''; },
  set(uid, name){ if(uid) this.map.set(uid, String(name||'')); }
};

function ownerUidOf(d = {}){
  return d?.ownerUid || d?.uid || d?.userUid || null;
}

async function preloadNicknamesFor(docs){
  // docs: [{id, data}]
  const uids = new Set();
  docs.forEach(x => {
    const uid = ownerUidOf(x.data);
    if (uid && !NickCache.map.has(uid)) uids.add(uid);
  });
  if (!uids.size) return;

  const tasks = [...uids].map(async (uid) => {
    try{
      const snap = await getDoc(doc(db, 'users', uid));
      const prof = snap.exists() ? snap.data() : null;
      const name = prof?.nickname || prof?.displayName || '';
      NickCache.set(uid, name);
    }catch{
      NickCache.set(uid, '');
    }
  });
  await Promise.all(tasks);
}

/* ---------- 개인자료 모드 ---------- */
function isPersonalOnlySelection(){
  try{
    const raw = localStorage.getItem('selectedCats');
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) && v.length === 1 && (v[0] === 'personal1' || v[0] === 'personal2');
  }catch{ return false; }
}
function getPersonalSlot(){
  try{
    const v = JSON.parse(localStorage.getItem('selectedCats') || '[]');
    return Array.isArray(v) ? v[0] : null;
  }catch{ return null; }
}
function readPersonalItems(slot){
  const key = `copytube_${slot}`;
  try{
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr : [];
  }catch{ return []; }
}
function getPersonalLabel(slot){
  try{
    const labels = JSON.parse(localStorage.getItem('personalLabels') || '{}');
    return labels?.[slot] || (slot === 'personal1' ? '개인자료1' : '개인자료2');
  }catch{ return slot; }
}

function renderPersonalList(){
  const slot  = getPersonalSlot();
  const items = readPersonalItems(slot);
  const label = getPersonalLabel(slot);

  $cards.innerHTML = '';
  if (!items.length){
    $cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">${esc(label)}에 저장된 영상이 없습니다.</div>`;
    toggleMore(false);
    setStatus('0개');
    return;
  }

  const frag = document.createDocumentFragment();
  const sorted = items.slice().sort((a,b)=> (b?.savedAt||0) - (a?.savedAt||0));

  sorted.forEach((it, idx)=>{
    const title = it.title || '(제목 없음)';
    const url   = it.url   || '';
    const id    = extractId(url);
    const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="left">
        <div class="title" title="${esc(title)}">${esc(title)}</div>
        <div class="chips"><span class="chip">${esc(label)}</span></div>
        <div class="meta">등록: 나</div>
      </div>
      <div class="right">
        <div class="thumb-wrap"><img class="thumb" src="${esc(thumb)}" alt="썸네일" loading="lazy"></div>
      </div>
    `;
    hydrateTitleIfNeeded(card.querySelector('.title'), url, title);

    card.querySelector('.left') ?.addEventListener('click', ()=> openInWatchPersonal(sorted, idx, slot, label));
    card.querySelector('.thumb')?.addEventListener('click', ()=> openInWatchPersonal(sorted, idx, slot, label));
    frag.appendChild(card);
  });

  $cards.appendChild(frag);
  toggleMore(false);
  setStatus(`총 ${items.length}개`);
}

function openInWatchPersonal(items, index, slot, label){
  const queue = items.map((it, i)=> ({
    id: `local-${slot}-${i}`,
    url: it.url || '',
    title: it.title || lazyTitleMap.get(extractId(it.url||'')) || '(제목 없음)',
    cats: [label]
  }));
  sessionStorage.setItem('playQueue', JSON.stringify(queue));
  sessionStorage.setItem('playIndex', String(index));
  location.href = `watch.html?idx=${index}&cats=${encodeURIComponent(slot)}`;
}

/* ---------- 필터 공통 ---------- */
function filterDocs(){
  const cats = getSelectedCats();
  const q = ($q?.value || '').trim().toLowerCase();

  let list = allDocs.slice();

  if (Array.isArray(cats) && cats.length){
    list = list.filter(x => {
      const arr = Array.isArray(x.data?.categories) ? x.data.categories : [];
      return arr.some(v => cats.includes(v));
    });
  }
  if (q){
    list = list.filter(x => {
      const id = extractId(x.data?.url || '');
      const t = String(x.data?.title || lazyTitleMap.get(id) || '').toLowerCase();
      const u = String(x.data?.url || '').toLowerCase();
      return t.includes(q) || u.includes(q);
    });
  }
  return list;
}

/* ---------- Firestore 로드 ---------- */
async function loadPage(){
  if(isLoading || !hasMore) return false;
  isLoading = true;
  setStatus(allDocs.length ? `총 ${allDocs.length}개 불러옴 · 더 불러오는 중…` : '불러오는 중…');

  let batch = [];
  try {
    const parts = [ orderBy('createdAt', sortDir) ];
    if (lastDoc) parts.push(startAfter(lastDoc));
    parts.push(limit(PAGE_SIZE));

    const snap = await getDocs(query(collection(db,'videos'), ...parts));
    if (snap.empty) { hasMore = false; toggleMore(false); setStatus(allDocs.length ? `총 ${allDocs.length}개` : '등록된 영상이 없습니다.'); isLoading=false; return false; }

    batch = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    allDocs = allDocs.concat(batch);
    lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
    if (snap.size < PAGE_SIZE) hasMore = false;
  } catch (e) {
    console.warn('[list] fallback:', e?.message || e);
    try {
      const snap = await getDocs(query(collection(db,'videos'), limit(PAGE_SIZE*3)));
      const arr = snap.docs.map(d => ({ id:d.id, data:d.data(), _t:(d.data()?.createdAt?.toMillis?.()||0) }));
      arr.sort((a,b)=> sortDir==='asc' ? (a._t - b._t) : (b._t - a._t));
      batch = arr.map(({_t,...rest})=>rest);
      allDocs = allDocs.concat(batch);
      hasMore = false;
    } catch(e2){
      console.error('[list] load failed:', e2);
      setStatus('목록을 불러오지 못했습니다.');
      toggleMore(false);
      isLoading=false;
      return false;
    }
  }

  // 배치 내 uploader 닉네임 미리 불러오기
  await preloadNicknamesFor(batch);

  render();
  toggleMore(hasMore);
  setStatus(`총 ${allDocs.length}개`);
  isLoading = false;
  return true;
}

/* ---------- 필터 인지형 선로딩(최소 PAGE_SIZE 보장 시도) ---------- */
async function ensureMinFiltered(min = PAGE_SIZE){
  if (isPersonalOnlySelection()) return;

  let filtered = filterDocs();
  let guard = 0;
  while (filtered.length < min && hasMore && guard < 5){
    const ok = await loadPage();
    if (!ok) break;
    filtered = filterDocs();
    guard++;
  }
  render();
  toggleMore(hasMore);
}

/* ---------- 렌더 ---------- */
function render(){
  // 개인자료 모드: 정렬 토글 숨김(의미 없음)
  if ($btnSort) {
    $btnSort.style.display = isPersonalOnlySelection() ? 'none' : '';
  }

  if (isPersonalOnlySelection()){
    renderPersonalList();
    return;
  }

  const list = filterDocs();

  $cards.innerHTML = '';
  if (!list.length){
    $cards.innerHTML = `<div style="padding:14px;border:1px dashed var(--border,#333);border-radius:12px;color:#cfcfcf;">결과가 없습니다.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((x, idx) => {
    const d     = x.data || {};
    const title = d.title || '(제목 없음)';
    const url   = d.url || '';
    const catsV = Array.isArray(d.categories) ? d.categories : [];
    const thumb = d.thumbnail || toThumb(url);
    const uid   = ownerUidOf(d);
    const nick  = NickCache.get(uid) || '회원';

    const chipsHTML = catsV.map(v => `<span class="chip" title="${esc(getLabel(v))}">${esc(getLabel(v))}</span>`).join('');

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="left">
        <div class="title" title="${esc(title)}">${esc(title)}</div>
        <div class="chips">${chipsHTML}</div>
        <div class="meta">등록: ${esc(nick)}</div>
      </div>
      <div class="right">
        <div class="thumb-wrap"><img class="thumb" src="${esc(thumb)}" alt="썸네일" loading="lazy"></div>
      </div>
    `;

    hydrateTitleIfNeeded(card.querySelector('.title'), url, title);

    card.querySelector('.left') ?.addEventListener('click', ()=> openInWatch(list, idx));
    card.querySelector('.thumb')?.addEventListener('click', ()=> openInWatch(list, idx));

    frag.appendChild(card);
  });
  $cards.appendChild(frag);
}

/* ---------- watch로 이동(큐 + 인덱스 + doc + cats 파라미터) ---------- */
function openInWatch(list, index){
  const queue = list.map(x => {
    const id = extractId(x.data?.url || '');
    return {
      id: x.id,
      url: x.data?.url || '',
      title: x.data?.title || lazyTitleMap.get(id) || '',
      cats: Array.isArray(x.data?.categories) ? x.data.categories : []
    };
  });
  sessionStorage.setItem('playQueue', JSON.stringify(queue));
  sessionStorage.setItem('playIndex', String(index));

  const docId = encodeURIComponent(list[index].id);

  let catsParam = '';
  try{
    const raw = localStorage.getItem('selectedCats');
    const parsed = JSON.parse(raw || '[]');
    const arr = Array.isArray(parsed) ? parsed : [];
    if (arr.length) catsParam = `&cats=${encodeURIComponent(arr.join(','))}`;
  }catch{}

  location.href = `watch.html?doc=${docId}&idx=${index}${catsParam}`;
}

/* ---------- 검색 이벤트 ---------- */
$q?.addEventListener('keydown', async (e)=>{
  if(e.key==='Enter'){
    e.preventDefault();
    if(isPersonalOnlySelection()){ renderPersonalList(); return; }
    render();
    await ensureMinFiltered(PAGE_SIZE);
  }
});
$btnSearch?.addEventListener('click', async ()=>{
  if(isPersonalOnlySelection()){ renderPersonalList(); return; }
  render();
  await ensureMinFiltered(PAGE_SIZE);
});
$btnClear ?.addEventListener('click', async ()=>{
  if($q) $q.value='';
  if(isPersonalOnlySelection()){ renderPersonalList(); return; }
  render();
  await ensureMinFiltered(PAGE_SIZE);
});
$btnMore  ?.addEventListener('click', async ()=>{
  $btnMore.disabled = true; $btnMore.textContent = '불러오는 중…';
  try {
    await loadPage();
    await ensureMinFiltered(PAGE_SIZE);
  } finally {
    $btnMore.disabled=false; $btnMore.textContent='더 보기';
  }
});

/* ---------- 정렬 토글 바인딩 ---------- */
$btnSort?.addEventListener('click', async ()=>{
  // asc<->desc 토글
  setSortDir(sortDir==='asc' ? 'desc' : 'asc');
  await reloadWithCurrentSort();
});

/* ---------- 시작 ---------- */
(async function init(){
  try{
    // 정렬 초기화: 저장된 값 우선
    setSortDir(readSortDir());
    applySortButtonUI();

    if (isPersonalOnlySelection()){
      renderPersonalList();
      return;
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
  const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - SCROLL_LOAD_OFFSET);
  if (!nearBottom) return;
  if (isPersonalOnlySelection()) return;

  const before = filterDocs().length;
  const ok = await loadPage();
  if (!ok) return;

  let guard=0;
  while (filterDocs().length < PAGE_SIZE && hasMore && guard < 2){
    const ok2 = await loadPage();
    if(!ok2) break;
    guard++;
  }

  const after = filterDocs().length;
  if (after > before) render();
}, { passive:true });

/* ===================== */
/* Slide-out CSS (단순형/백업용) */
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
/* 단순형 스와이프 (중앙 30% 데드존 추가) */
/* ===================== */
function initSwipeNav({ goLeftHref=null, goRightHref=null, animateMs=260, deadZoneCenterRatio=0.30 } = {}){
  let sx=0, sy=0, t0=0, tracking=false;
  const THRESH_X = 70;
  const MAX_OFF_Y = 80;
  const MAX_TIME  = 600;

  const getPoint = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;

  function onStart(e){
    const p = getPoint(e);
    if(!p) return;

    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
    const L  = vw * (0.5 - dz/2);
    const R  = vw * (0.5 + dz/2);
    if (p.clientX >= L && p.clientX <= R) { tracking = false; return; }

    sx = p.clientX; sy = p.clientY; t0 = Date.now(); tracking = true;
  }
  function onEnd(e){
    if(!tracking) return; tracking = false;

    if (window.__swipeNavigating) return;

    const p = getPoint(e);
    const dx = p.clientX - sx;
    const dy = p.clientY - sy;
    const dt = Date.now() - t0;
    if (Math.abs(dy) > MAX_OFF_Y || dt > MAX_TIME) return;

    if (dx <= -THRESH_X && goLeftHref){
      window.__swipeNavigating = true;
      document.documentElement.classList.add('slide-out-left');
      setTimeout(()=> location.href = goLeftHref, animateMs);
    } else if (dx >= THRESH_X && goRightHref){
      window.__swipeNavigating = true;
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href = goRightHref, animateMs);
    }
  }
  document.addEventListener('touchstart', onStart, { passive:true });
  document.addEventListener('touchend',   onEnd,   { passive:true });
  document.addEventListener('pointerdown',onStart, { passive:true });
  document.addEventListener('pointerup',  onEnd,   { passive:true });
}

// ✅ list: 우→좌 = index (단순형 + 중앙 데드존 30%)
initSwipeNav({ goLeftHref: 'index.html', goRightHref: null, deadZoneCenterRatio: 0.30 });

/* ===================== */
/* 고급형 스와이프 — 끌리는 모션 + 방향 잠금 + 중앙 30% 데드존 */
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
      if (window.__swipeNavigating) return;
      const t = (e.touches && e.touches[0]) || (e.pointerType ? e : null);
      if(!t) return;
      if(isInteractive(e.target)) return;

      const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
      const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
      const L  = vw * (0.5 - dz/2);
      const R  = vw * (0.5 + dz/2);
      if (t.clientX >= L && t.clientX <= R) return;

      x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
      active = true; canceled = false;
      page.style.transition = 'none';
    }

    function move(e){
      if(!active) return;
      const t = (e.touches && e.touches[0]) || (e.pointerType ? e : null);
      if(!t) return;

      const dx = t.clientX - x0;
      const dy = t.clientY - y0;

      if(Math.abs(dy) > slop){
        canceled = true; active = false;
        reset(true);
        return;
      }

      const allowLeft  = !!goLeftHref;
      const allowRight = !!goRightHref;

      let dxAdj = dx;
      if (dx < 0 && !allowLeft)  dxAdj = 0;
      if (dx > 0 && !allowRight) dxAdj = 0;

      if (dxAdj === 0){
        page.style.transform = 'translateX(0px)';
        return;
      }

      e.preventDefault();
      page.style.transform = 'translateX(' + (dxAdj * feel) + 'px)';
    }

    function end(e){
      if(!active) return; active = false;
      const t = (e.changedTouches && e.changedTouches[0]) || (e.pointerType ? e : null);
      if(!t) return;
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dt = Date.now() - t0;

      const allowLeft  = !!goLeftHref;
      const allowRight = !!goRightHref;

      if(canceled || Math.abs(dy) > slop || dt > timeMax){
        reset(true);
        return;
      }

      if(dx >= threshold && allowRight){
        window.__swipeNavigating = true;
        page.style.transition = 'transform 160ms ease';
        page.style.transform  = 'translateX(100vw)';
        setTimeout(()=>{ location.href = goRightHref; }, 150);
      } else if(dx <= -threshold && allowLeft){
        window.__swipeNavigating = true;
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

  // list: 우→좌 = index (오른쪽 페이지 없음 → 오른쪽 끌림 완전 차단, 중앙 데드존 15%)
  initDragSwipe({ goLeftHref: 'index.html', goRightHref: null, threshold:60, slop:45, timeMax:700, feel:1.0, deadZoneCenterRatio: 0.15 });
})();
