// /js/list.js — ArkTube 영상목록 로직 (완전판 v0.1, 2025-10-20)
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import * as Makelist from './makelist.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';

/* ===== Elements ===== */
const dropdown      = document.getElementById('dropdownMenu');
const btnDropdown   = document.getElementById('btnDropdown');
const welcomeEl     = document.getElementById('welcome');
const signupLink    = document.getElementById('signupLink');
const signinLink    = document.getElementById('signinLink');
const btnSignOut    = document.getElementById('btnSignOut');
const btnGoIndex    = document.getElementById('btnGoIndex');
const btnGoWatch    = document.getElementById('btnGoWatch');
const brandHome     = document.getElementById('brandHome');

const grid          = document.getElementById('grid');
const countEl       = document.getElementById('count');
const sentinel      = document.getElementById('sentinel');

const qInput        = document.getElementById('q');
const btnSearch     = document.getElementById('btnSearch');

const rbDesc        = document.getElementById('s_desc');
const rbAsc         = document.getElementById('s_asc');
const rbRandom      = document.getElementById('s_random');
const btnRandRef    = document.getElementById('btnRandomRefresh');

/* ===== 상단바 인사/닉네임 (list=Hello!) ===== */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  btnSignOut?.classList.toggle('hidden', !loggedIn);
  const name = loggedIn ? (user.displayName || 'User') : '';
  welcomeEl.textContent = loggedIn ? `Hello! ${name}` : 'Hello!';
});
btnSignOut?.addEventListener('click', async ()=>{
  try{ await fbSignOut(); }catch(_){} location.reload();
});
brandHome?.addEventListener('click', (e)=>{
  e.preventDefault(); location.href = '/index.html';
});

/* ===== 드롭다운 (index와 동일한 동작/접근성) ===== */
(function initDropdown(){
  const menu = dropdown; let open=false; let offPointer=null, offKey=null;
  function setOpen(v){
    open=!!v; btnDropdown?.setAttribute('aria-expanded', String(open));
    if (!menu) return;
    if (open){
      menu.classList.remove('hidden');
      requestAnimationFrame(()=> menu.classList.add('open'));
      menu.removeAttribute('aria-hidden');
      menu.removeAttribute('inert');
      const first = menu.querySelector('button,[href],[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : btnDropdown)?.focus({preventScroll:true});
      bindDoc();
    } else {
      btnDropdown?.focus({preventScroll:true});
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden','true');
      menu.setAttribute('inert','');
      setTimeout(()=> menu.classList.add('hidden'), 150);
      unbindDoc();
    }
  }
  function bindDoc(){
    if (offPointer || offKey) return;
    const onP=(e)=>{ if (e.target.closest('#dropdownMenu,#btnDropdown')) return; setOpen(false); };
    const onK=(e)=>{
      if (e.key==='Escape') setOpen(false);
      if (e.key==='Tab' && open){
        const nodes=menu.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])');
        if (!nodes.length) return;
        const first=nodes[0], last=nodes[nodes.length-1];
        if (e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('pointerdown', onP, {passive:true});
    document.addEventListener('keydown', onK);
    offPointer = ()=> document.removeEventListener('pointerdown', onP, {passive:true});
    offKey     = ()=> document.removeEventListener('keydown', onK);
  }
  function unbindDoc(){ offPointer?.(); offKey?.(); offPointer=offKey=null; }
  btnDropdown?.addEventListener('click', (e)=>{ e.preventDefault(); setOpen(!open); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });
  if (menu.classList.contains('hidden')) { menu.setAttribute('aria-hidden','true'); menu.setAttribute('inert',''); }
  else { menu.removeAttribute('aria-hidden'); menu.removeAttribute('inert'); }
})();

/* ===== 드롭다운 라우팅 ===== */
document.getElementById('btnAbout')   ?.addEventListener('click', ()=> location.href='/about.html');
document.getElementById('btnOrder')   ?.addEventListener('click', ()=> location.href='/category-order.html');
document.getElementById('btnMyUploads')?.addEventListener('click', ()=> location.href='/manage-uploads.html');
btnGoIndex ?.addEventListener('click', ()=> location.href='/index.html');
btnGoWatch ?.addEventListener('click', async ()=>{
  try{ await Makelist.makeForWatchFromIndex(Makelist.readListState?.()||{}); }catch(_){}
  location.href='/watch.html?from=list';
});

/* ===== 라벨/오너/썸네일 유틸 ===== */
function labelOf(cat){
  const groups = Array.isArray(CATEGORY_MODEL?.groups) ? CATEGORY_MODEL.groups : (CATEGORY_GROUPS||[]);
  for (const g of groups){
    const c=(g.children||[]).find(x=> x.value===cat);
    if (c) return c.label||c.value;
  }
  return cat;
}
function ownerLabel(item){
  // ownerName 없으면 개인자료로 간주 → '로컬저장'
  return (item && item.ownerName) ? item.ownerName : '로컬저장';
}
function thumbUrl(item){
  const yid = item?.ytid || item?.id || '';
  return yid ? `https://i.ytimg.com/vi/${yid}/hqdefault.jpg` : '';
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

/* ===== 렌더 ===== */
function render(){
  const snap = Makelist.readListSnapshot?.();
  if (!snap){ grid.innerHTML=''; countEl.textContent='총 0개'; return; }
  const items = Array.isArray(snap.items) ? snap.items : [];
  countEl.textContent = `총 ${items.length}개`;

  const html = items.map((it, idx)=>{
    const chips = (it.cats||[]).map(c=> `<span class="chip">${labelOf(c)}</span>`).join('');
    const owner = ownerLabel(it);
    const thumb = thumbUrl(it);
    const title = it.title || '(제목 없음)';
    return `
    <article class="card" data-index="${idx}" tabindex="0" role="button" aria-label="${escapeHtml(title)}">
      <div class="left" data-index="${idx}">
        <div class="title2">${escapeHtml(title)}</div>
        <div class="owner">${escapeHtml(owner)}</div>
        <div class="chips">${chips}</div>
      </div>
      <img class="thumb" src="${thumb}" alt="썸네일" loading="lazy" data-index="${idx}" />
    </article>`;
  }).join('');

  grid.innerHTML = html;
}

/* ===== 카드 클릭/키보드 → watch ===== */
function goWatchByIndex(idx){
  try{ Makelist.selectAndGoWatch?.(idx); }
  catch(e){ console.error('goWatch failed', e); }
}
grid.addEventListener('click', (e)=>{
  const el = e.target.closest('[data-index]'); if (!el) return;
  const idx = Number(el.getAttribute('data-index')||'-1'); if (idx>=0) goWatchByIndex(idx);
});
grid.addEventListener('keydown', (e)=>{
  if (e.key==='Enter' || e.key===' '){
    const el = document.activeElement.closest('[data-index]'); if (!el) return;
    const idx = Number(el.getAttribute('data-index')||'-1');
    if (idx>=0){ e.preventDefault(); goWatchByIndex(idx); }
  }
});

/* ===== 정렬 토글 ===== */
function syncSortUI(){
  const snap = Makelist.readListSnapshot?.();
  const sort = (snap && snap.sort) || Makelist.getSort?.() || 'desc';
  rbDesc.checked   = (sort==='desc');  rbDesc.nextElementSibling?.setAttribute('aria-selected', String(sort==='desc'));
  rbAsc.checked    = (sort==='asc');   rbAsc .nextElementSibling?.setAttribute('aria-selected', String(sort==='asc'));
  rbRandom.checked = (sort==='random');rbRandom.nextElementSibling?.setAttribute('aria-selected', String(sort==='random'));
  btnRandRef.classList.toggle('hidden', sort!=='random');
}
rbDesc  ?.addEventListener('change', ()=>{ if (!rbDesc.checked) return;   Makelist.setSort?.('desc');   render(); });
rbAsc   ?.addEventListener('change', ()=>{ if (!rbAsc.checked) return;    Makelist.setSort?.('asc');    render(); });
rbRandom?.addEventListener('change', ()=>{ if (!rbRandom.checked) return; Makelist.setSort?.('random'); syncSortUI(); render(); });
btnRandRef?.addEventListener('click', ()=>{ Makelist.bumpRandomSeed?.(); render(); });

/* ===== 검색 ===== */
function doSearch(){ Makelist.setSearch?.(qInput.value||''); render(); }
btnSearch?.addEventListener('click', doSearch);
qInput?.addEventListener('keydown', (e)=>{ if (e.key==='Enter') doSearch(); });

/* ===== 무한 스크롤 ===== */
let fetching=false; let done=false;
const io = new IntersectionObserver(async (entries)=>{
  if (done || fetching) return;
  const ent = entries[0]; if (!ent || !ent.isIntersecting) return;
  fetching=true;
  try{
    await Makelist.fetchMore?.();
    const snap = Makelist.readListSnapshot?.();
    done = !!(snap && (snap.hasMore===false || snap.done===true));
    render();
  }catch(e){
    console.warn('fetchMore failed', e); done=true;
  }finally{
    fetching=false;
    if (done) sentinel.textContent='모두 불러왔습니다';
  }
}, {rootMargin:'600px 0px 600px 0px'});
io.observe(sentinel);

/* ===== 초기화 ===== */
(function init(){
  // index에서 넘어온 상태/스냅샷이 없을 때 안전 가드
  if (!Makelist.readListSnapshot?.()){
    try{ Makelist.makeForListFromIndex?.({ cats:'ALL', type:'both' }); }
    catch(e){ console.error('init make list failed', e); }
  }
  // makelist 쪽에서 디폴트 정렬(일반/개인=desc, 시리즈=asc)을 이미 결정 → UI 동기화
  syncSortUI();
  render();
})();

/* ===== 스와이프 네비게이션 ===== */
/* 요구: list 페이지는 오른쪽→왼쪽(←) 스와이프 시 index로, 왼쪽→오른쪽(→) 스와이프 시 watch로 이동 */
(function swipeNav({
  goLeftHref='/index.html',  // ←
  goRightHref='/watch.html', // →
  threshold=70, slopY=80, timeMax=650, deadZoneCenterRatio=0.18
} = {}){
  let sx=0, sy=0, t0=0, tracking=false;
  const point = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
  const inDead=(x)=>{
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L = vw*(0.5-deadZoneCenterRatio/2), R = vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  };
  function onStart(e){
    const p = point(e); if(!p) return;
    if (inDead(p.clientX)) return; // 중앙 데드존
    if ((e.target.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]'))) return;
    sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
  }
  function onEnd(e){
    if(!tracking) return; tracking=false;
    const p=point(e); if(!p) return;
    const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
    if (Math.abs(dy)>slopY || dt>timeMax) return;
    if (dx<=-threshold && goLeftHref){ document.documentElement.classList.add('slide-out-left');  setTimeout(()=> location.href=goLeftHref, 150); }
    else if (dx>= threshold && goRightHref){ document.documentElement.classList.add('slide-out-right'); setTimeout(()=> location.href=goRightHref,150); }
  }
  document.addEventListener('touchstart', onStart, {passive:true});
  document.addEventListener('touchend',   onEnd,   {passive:true});
  document.addEventListener('pointerdown',onStart, {passive:true});
  document.addEventListener('pointerup',  onEnd,   {passive:true});
})();
