// /js/index.js — CopyTube 스타일 ArkTube Index (완성본)
// - 상단바 인사: Welcome! {displayName}
// - CATEGORY_MODEL 우선(없으면 CATEGORY_GROUPS) 렌더
// - 그룹 순서 저장/복원, parent↔children 동기화, 전체선택(일반 그룹만)
// - 개인자료(personal*) 단독 선택 강제(로그인 불필요) + 로컬 라벨(personalLabels) 반영
// - 타입 토글 all/shorts/video ↔ makelist(both/shorts/video)
// - '영상보기' / '영상목록' → Makelist 연계
// - 시리즈 그룹(key가 series_로 시작) 자식 옆 '이어보기' 버튼
// - 드롭다운 v1.5(ESC/포커스트랩/외부클릭 닫기, aria/inert 정리)
// - 스와이프: simpleSwipe/dragSwipe (dead zone 18%)  ← 우=목록 / 좌=업로드
// - 저장 키: selectedCats, autonext, view:type

import { CATEGORY_GROUPS, CATEGORY_MODEL } from './categories.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import * as Makelist from './makelist.js';

/* ===== Storage Keys ===== */
const GROUP_ORDER_KEY   = 'groupOrderV1';
const SELECTED_CATS_KEY = 'selectedCats'; // 'ALL' | string[]
const AUTONEXT_KEY      = 'autonext';     // '1' | '0'
const VIEW_TYPE_KEY     = 'view:type';    // 'both' | 'shorts' | 'video'

/* ===== Elements ===== */
const dropdown     = document.getElementById('dropdownMenu');
const signupLink   = document.getElementById('signupLink');
const signinLink   = document.getElementById('signinLink');
const btnSignOut   = document.getElementById('btnSignOut');
const btnGoUpload  = document.getElementById('btnGoUpload');
const btnMyUploads = document.getElementById('btnMyUploads');
const btnAbout     = document.getElementById('btnAbout');
const btnOrder     = document.getElementById('btnOrder');
const btnList      = document.getElementById('btnList');
const brandHome    = document.getElementById('brandHome');
const btnDropdown  = document.getElementById('btnDropdown');

const welcomeEl    = document.getElementById('welcome');

const catsBox      = document.getElementById('cats');
const cbToggleAll  = document.getElementById('cbToggleAll');
const btnWatch     = document.getElementById('btnWatch');
const btnOpenOrder = document.getElementById('btnOpenOrder');
const cbAutoNext   = document.getElementById('cbAutoNext');
const typeWrap     = document.getElementById('typeToggle');
const helpBtn      = document.getElementById('btnHelp');
const helpOverlay  = document.getElementById('helpOverlay');

/* ===== 상단바 인사/닉네임 ===== */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  btnSignOut?.classList.toggle('hidden', !loggedIn);
  if (welcomeEl) {
    const name = loggedIn ? (user.displayName || 'User') : '';
    welcomeEl.textContent = loggedIn ? `Welcome! ${name}` : 'Welcome!';
  }
});
btnSignOut?.addEventListener('click', async ()=>{
  try{ await fbSignOut(); }catch{}
  location.reload();
});

/* ===== 라우팅 ===== */
btnGoUpload ?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads?.addEventListener('click', ()=> location.href='/manage-uploads.html');
btnAbout    ?.addEventListener('click', ()=> location.href='/about.html');
btnOrder    ?.addEventListener('click', ()=> location.href='/category-order.html');
brandHome   ?.addEventListener('click', (e)=>{ e.preventDefault(); location.href='/index.html'; });

/* ===== 드롭다운 v1.5 (접근성 경고 해결 버전) ===== */
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
      // 포커스 회수 후 숨김 속성 적용
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

  // 초기 동기화
  if (menu.classList.contains('hidden')) { menu.setAttribute('aria-hidden','true'); menu.setAttribute('inert',''); }
  else { menu.removeAttribute('aria-hidden'); menu.removeAttribute('inert'); }
})();

/* ===== 카테고리 렌더 ===== */
const isSeriesGroup = (key)=> typeof key==='string' && key.startsWith('series_');
const isPersonalVal = (v)=> typeof v==='string' && v.startsWith('personal');

function modelGroups(){
  if (Array.isArray(CATEGORY_MODEL?.groups)) return CATEGORY_MODEL.groups;
  if (Array.isArray(CATEGORY_GROUPS))        return CATEGORY_GROUPS;
  return [];
}
function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem('personalLabels')||'{}'); }catch{ return {}; } }
function applyGroupOrder(groups){
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(GROUP_ORDER_KEY)||'null'); }catch{}
  const order = Array.isArray(saved)&&saved.length ? saved : groups.map(g=>g.key);
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>(idx.get(a.key)??999)-(idx.get(b.key)??999));
}

function renderGroups(){
  const groups = applyGroupOrder(modelGroups());
  const personalLabels = getPersonalLabels();

  const html = groups.map(g=>{
    const series = isSeriesGroup(g.key);
    const isPersonalGroup = g.key==='personal' || g.personal===true;
    const kids = (g.children||[]).map(c=>{
      const labelText = isPersonalGroup && personalLabels[c.value] ? personalLabels[c.value] : (c.label||c.value);
      const resumeBtn = series ? `<button class="resume-mini" data-group="${g.key}" data-sub="${c.value}" title="이 시리즈 이어보기">이어보기</button>` : '';
      return `<label><input type="checkbox" class="cat" value="${c.value}"> <span>${labelText}</span> ${resumeBtn}</label>`;
    }).join('');
    const legendHTML = isPersonalGroup
      ? `<legend><span style="font-weight:800;">${g.label}</span> <span class="subnote">(로컬저장소)</span></legend>`
      : `<legend><label class="group-toggle"><input type="checkbox" class="group-check" data-group="${g.key}"/><span>${g.label}</span></label></legend>`;
    return `<fieldset class="group" data-key="${g.key}">${legendHTML}<div class="child-grid">${kids}</div></fieldset>`;
  }).join('');

  catsBox.innerHTML = html;
  bindGroupInteractions();
  bindResumeButtons();
}
renderGroups();

/* ===== 체크 동기화 ===== */
function setParentStateByChildren(groupEl){
  const parent = groupEl.querySelector('.group-check'); if(!parent) return;
  const children = Array.from(groupEl.querySelectorAll('input.cat'));
  const total = children.length; const checked = children.filter(c=>c.checked).length;
  if (checked===0){ parent.checked=false; parent.indeterminate=false; }
  else if (checked===total){ parent.checked=true; parent.indeterminate=false; }
  else { parent.checked=false; parent.indeterminate=true; }
}
function setChildrenByParent(groupEl,on){ groupEl.querySelectorAll('input.cat').forEach(c=> c.checked=!!on); }
function refreshAllParentStates(){ catsBox.querySelectorAll('.group').forEach(setParentStateByChildren); }

function computeAllSelected(){
  // 일반 그룹만(개인/시리즈 제외)
  const normals = Array.from(catsBox.querySelectorAll('.group')).filter(g=> !isSeriesGroup(g.dataset.key) && g.dataset.key!=='personal');
  const kids = normals.flatMap(g=> Array.from(g.querySelectorAll('input.cat')));
  return kids.length>0 && kids.every(c=>c.checked);
}

function bindGroupInteractions(){
  catsBox.querySelectorAll('.group-check').forEach(parent=>{
    parent.addEventListener('change', ()=>{
      const groupEl = parent.closest('.group');
      setChildrenByParent(groupEl, parent.checked);
      setParentStateByChildren(groupEl);
      if (groupEl.dataset.key!=='personal'){
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
      }
      refreshAllParentStates();
      cbToggleAll.checked = computeAllSelected();
    });
  });

  catsBox.querySelectorAll('input.cat').forEach(child=>{
    child.addEventListener('change', ()=>{
      const isPersonal = isPersonalVal(child.value);
      if (isPersonal && child.checked){
        // 개인자료 단독 선택 강제
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat').forEach(c=>{ if(c!==child) c.checked=false; });
        catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked').forEach(c=> c.checked=false);
      }
      if (!isPersonal && child.checked){
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
      }
      setParentStateByChildren(child.closest('.group'));
      refreshAllParentStates();
      cbToggleAll.checked = computeAllSelected();
    });
  });
}

function bindResumeButtons(){
  catsBox.querySelectorAll('.resume-mini').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const subKey = btn.getAttribute('data-sub');
      if (!subKey) return;
      const type = getTypeValue();
      try {
        await Makelist.makeForWatchFromIndex({ cats:[subKey], type });
        location.href = '/watch.html?from=index';
      } catch(e){ console.error('[resume] make list failed', e); }
    });
  });
}

function selectAll(on){
  catsBox.querySelectorAll('.group').forEach(g=>{
    const isPersonal = g.dataset.key==='personal';
    const isSeries = isSeriesGroup(g.dataset.key);
    g.querySelectorAll('input.cat').forEach(b=> b.checked = (!isPersonal && !isSeries) ? !!on : false);
    setParentStateByChildren(g);
  });
  cbToggleAll.checked = !!on;
}
cbToggleAll?.addEventListener('change', ()=> selectAll(cbToggleAll.checked));

/* ===== 상태 복원 ===== */
function getTypeValue(){
  const raw = document.querySelector('#typeToggle input:checked')?.value || 'all';
  return (raw==='all') ? 'both' : raw; // makelist 규격
}
function restoreState(){
  // 타입
  const savedType = localStorage.getItem(VIEW_TYPE_KEY) || 'both';
  const uiType = (savedType==='both') ? 'all' : savedType;
  const r = typeWrap.querySelector(`input[value="${uiType}"]`) || typeWrap.querySelector('#type_all');
  r && (r.checked = true);

  // 연속재생 (구키 유지)
  const v = (localStorage.getItem(AUTONEXT_KEY)||'').toLowerCase();
  cbAutoNext.checked = (v==='1' || v==='true' || v==='on');

  // 선택
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{}
  if (!saved || saved==='ALL'){ selectAll(true); }
  else{
    selectAll(false);
    const set=new Set(saved);
    catsBox.querySelectorAll('.cat').forEach(ch=>{ if(set.has(ch.value)) ch.checked=true; });
    // personal 단독성 보정
    const personals = Array.from(catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked'));
    const normals   = Array.from(catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked'));
    if (personals.length>=1 && normals.length>=1) personals.forEach(c=> c.checked=false);
    if (personals.length>=2) personals.slice(1).forEach(c=> c.checked=false);
    refreshAllParentStates();
    cbToggleAll.checked = computeAllSelected();
  }
}
restoreState();

/* ===== 액션: 영상보기 / 목록 ===== */
btnWatch?.addEventListener('click', async ()=>{
  const { cats, type } = collectCurrentFilters();
  // 저장
  localStorage.setItem(AUTONEXT_KEY, cbAutoNext.checked ? '1' : '0');
  localStorage.setItem(VIEW_TYPE_KEY, type);
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(catsForSave(cats)));
  try{
    await Makelist.makeForWatchFromIndex({ cats, type });
    location.href = '/watch.html?from=index';
  }catch(e){ console.error('[index→watch] fail', e); }
});

btnOpenOrder?.addEventListener('click', ()=> location.href='/category-order.html');

btnList?.addEventListener('click', async ()=>{
  const { cats, type } = collectCurrentFilters();
  localStorage.setItem(VIEW_TYPE_KEY, type);
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(catsForSave(cats)));
  try{
    await Makelist.makeForListFromIndex({ cats, type });
    location.href='/list.html';
  }catch(e){ console.error('[index→list] fail', e); }
});

/* ===== 현재 선택 수집 ===== */
function collectCurrentFilters(){
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(isPersonalVal);
  const normals   = selected.filter(v=> !isPersonalVal(v));
  const type = getTypeValue();
  const cats = (personals.length===1 && normals.length===0) ? [personals[0]] : (computeAllSelected() ? 'ALL' : normals);
  return { cats, type };
}
function catsForSave(cats){ return (Array.isArray(cats) && cats.length) ? cats : 'ALL'; }

/* ===== 도움말 ===== */
helpBtn?.addEventListener('click', ()=>{
  helpOverlay?.classList.add('show');
  helpOverlay?.setAttribute('aria-hidden','false');
});
helpOverlay?.addEventListener('click',(e)=>{
  if (e.target===helpOverlay){
    helpOverlay.classList.remove('show');
    helpOverlay?.setAttribute('aria-hidden','true');
  }
});
document.addEventListener('keydown',(e)=>{
  if (e.key==='Escape' && helpOverlay?.classList.contains('show')){
    helpOverlay.classList.remove('show');
    helpOverlay?.setAttribute('aria-hidden','true');
  }
});

/* ===== 스와이프 (CopyTube 그대로: dead zone 18%) ===== */
/* simpleSwipe: 플릭형 — 좌=업로드, 우=목록 (함수명 유지) */
(function simpleSwipe({
  goLeftHref='/upload.html',
  goRightHref='/list.html',
  deadZoneCenterRatio=0.18
} = {}){
  let sx=0, sy=0, t0=0, tracking=false;
  const TH=70, MAX_OFF_Y=80, MAX_T=600;
  const point = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;

  function inDead(x){
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L = vw*(0.5-deadZoneCenterRatio/2), R = vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  }
  function onStart(e){
    const p = point(e); if(!p) return;
    if (inDead(p.clientX)) return;
    sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
  }
  async function onEnd(e){
     if(!tracking) return; tracking=false;
     const p=point(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
     if(Math.abs(dy)>MAX_OFF_Y || dt>MAX_T) return;

     if (dx>=TH && goRightHref){

      // → 목록
      try{
        const { cats, type } = collectCurrentFilters();
        localStorage.setItem(VIEW_TYPE_KEY, type);
        localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(catsForSave(cats)));
        await Makelist.makeForListFromIndex({ cats, type }); // ★ 반드시 대기
      }catch(_) {}
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href=goRightHref, 260);
    } else if (dx<=-TH && goLeftHref){
      // ← 업로드
      document.documentElement.classList.add('slide-out-left');
      setTimeout(()=> location.href=goLeftHref, 260);
    }
  }
  document.addEventListener('touchstart', onStart, {passive:true});
  document.addEventListener('touchend',   onEnd,   {passive:true});
  document.addEventListener('pointerdown',onStart, {passive:true});
  document.addEventListener('pointerup',  onEnd,   {passive:true});
})();

/* dragSwipe: 드래그 미리보기 — 좌=업로드, 우=목록 (함수명 유지) */
(function dragSwipe({
  goLeftHref='/upload.html',
  goRightHref='/list.html',
  threshold=60, slop=45, timeMax=700,
  deadZoneCenterRatio=0.18
} = {}){
  const page = document.querySelector('main')||document.body; if(!page) return;
  let x0=0,y0=0,t0=0,active=false,canceled=false;

  const inDead = (x)=>{
    const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  };
  function reset(){
    page.style.transition='transform 180ms ease';
    requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; });
    setTimeout(()=>{ page.style.transition=''; },200);
  }
  function isInteractive(el){ return !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')); }

  function start(e){
    const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
    if(isInteractive(e.target) || inDead(t.clientX)) return;
    x0=t.clientX; y0=t.clientY; t0=Date.now(); active=true; canceled=false; page.style.transition='none';
  }
  function move(e){
    if(!active) return;
    const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
    const dx=t.clientX-x0, dy=t.clientY-y0;
    if(Math.abs(dy)>slop){ canceled=true; active=false; reset(); return; }
    e.preventDefault();
    page.style.transform='translateX('+(dx)+ 'px)'; // 좌우 모두 미리보이게
  }
async function end(e){
    if(!active) return; active=false;
    const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
    const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
    if(canceled || Math.abs(dy)>slop || dt>timeMax){ reset(); return; }

    if (dx>=threshold && goRightHref){
      try{
        const { cats, type } = collectCurrentFilters();
        localStorage.setItem(VIEW_TYPE_KEY, type);
        localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(catsForSave(cats)));
        await Makelist.makeForListFromIndex({ cats, type }); // ★ 이동 전 세션 고정
      }catch(){}
      page.style.transition='transform 160ms ease'; page.style.transform='translateX(100vw)';
      setTimeout(()=>{ location.href=goRightHref; },150);
    } else if (dx<=-threshold && goLeftHref){
      page.style.transition='transform 160ms ease'; page.style.transform='translateX(-100vw)';
      setTimeout(()=>{ location.href=goLeftHref; },150);
    } else {
      reset();
    }
  }
  document.addEventListener('touchstart',start,{passive:true});
  document.addEventListener('touchmove', move ,{passive:false});
  document.addEventListener('touchend',  end  ,{passive:true,capture:true});
  document.addEventListener('pointerdown',start,{passive:true});
  document.addEventListener('pointermove', move ,{passive:false});
  document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
})();
