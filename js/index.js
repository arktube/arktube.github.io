// /js/index.js — ArkTube Index (정리본)
// - 상단바 로그인/닉네임 표시는 auth.js onAuthStateChanged로 처리(별도 initHeader 불필요)
// - CATEGORY_MODEL 기반 렌더 + 부모/자식 동기화 + 전체선택(일반만)
// - 개인자료(personal_*) 단독 선택 강제 + 로컬 라벨 반영
// - 시리즈 서브키 옆 '이어보기' (등록순+resume 보정) → makelist.makeForWatchFromIndex
// - view:type('both'|'shorts'|'video')/autonext('1'|'0') 키 저장/복원
// - '영상보기' → /watch.html?from=index, '영상목록'/스와이프 → /list.html

import { CATEGORY_GROUPS, CATEGORY_MODEL } from './categories.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import * as Makelist from './makelist.js';

/* ========= 키 ========= */
const GROUP_ORDER_KEY   = 'groupOrderV1';
const SELECTED_CATS_KEY = 'selectedCats';
const AUTONEXT_KEY      = 'autonext';
const VIEW_TYPE_KEY     = 'arktube:view:type';  // ★ watch.js와 동일 키로 통일

/* ========= 엘리먼트 ========= */
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

const catsBox      = document.getElementById('cats');
const cbToggleAll  = document.getElementById('cbToggleAll');
const btnWatch     = document.getElementById('btnWatch');
const btnOpenOrder = document.getElementById('btnOpenOrder');
const cbAutoNext   = document.getElementById('cbAutoNext');
const typeWrap     = document.getElementById('typeToggle');
const helpBtn      = document.getElementById('btnHelp');
const helpOverlay  = document.getElementById('helpOverlay');

/* ========= 로그인 표시 ========= */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  btnSignOut?.classList.toggle('hidden', !loggedIn);
});
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

/* ========= 라우팅 ========= */
btnGoUpload ?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads?.addEventListener('click', ()=> location.href='/manage-uploads.html');
btnAbout    ?.addEventListener('click', ()=> location.href='/about.html');
btnOrder    ?.addEventListener('click', ()=> location.href='/category-order.html');
brandHome   ?.addEventListener('click', (e)=>{ e.preventDefault(); location.href='/index.html'; });

/* ========= 드롭다운(v1.5 규격) ========= */
(function initDropdown(){
  const menu = dropdown; let open=false; let off1=null, off2=null;
  function setOpen(v){
    open=!!v; btnDropdown?.setAttribute('aria-expanded', String(open));
    if (!menu) return;
    if (open){
      menu.classList.remove('hidden'); requestAnimationFrame(()=> menu.classList.add('open'));
      const first = menu.querySelector('button,[href],[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : btnDropdown)?.focus();
      bindDoc();
    } else {
      menu.classList.remove('open'); setTimeout(()=> menu.classList.add('hidden'), 150);
      unbindDoc();
    }
  }
  btnDropdown?.addEventListener('click', (e)=>{ e.preventDefault(); setOpen(!open); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('button,[role="menuitem"],a')) setOpen(false); });
  function bindDoc(){
    if (off1 || off2) return;
    const onP=(e)=>{ if(e.target.closest('#dropdownMenu,#btnDropdown')) return; setOpen(false); };
    const onK=(e)=>{ if (e.key==='Escape') setOpen(false); };
    document.addEventListener('pointerdown', onP, {passive:true}); off1=()=>document.removeEventListener('pointerdown', onP, {passive:true});
    document.addEventListener('keydown', onK);                      off2=()=>document.removeEventListener('keydown', onK);
  }
  function unbindDoc(){ off1?.(); off2?.(); off1=off2=null; }
})();

/* ========= 카테고리 렌더 ========= */
const isSeriesGroup = (key)=> typeof key==='string' && key.startsWith('series_');
const isPersonalVal = (v)=> typeof v==='string' && v.startsWith('personal');

function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem('personalLabels')||'{}'); }catch{ return {}; } }
function applyGroupOrder(groups){
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(GROUP_ORDER_KEY)||'null'); }catch{}
  const order = Array.isArray(saved)&&saved.length ? saved : groups.map(g=>g.key);
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>(idx.get(a.key)??999)-(idx.get(b.key)??999));
}
function modelGroups(){
  const g = Array.isArray(CATEGORY_MODEL?.groups) ? CATEGORY_MODEL.groups
        : (Array.isArray(CATEGORY_GROUPS) ? CATEGORY_GROUPS : []);
  return Array.isArray(g) ? g : [];
}

function renderGroups(){
  const groups = applyGroupOrder(modelGroups());
  const personalLabels = getPersonalLabels();

  const html = groups.map(g=>{
    const isSeries = isSeriesGroup(g.key);
    const isPersonalGroup = g.key==='personal';
    const kids = (g.children||[]).map(c=>{
      const labelText = isPersonalGroup && personalLabels[c.value] ? personalLabels[c.value] : (c.label||c.value);
      const resumeBtn = isSeries ? `<button class="resume-mini" data-group="${g.key}" data-sub="${c.value}" title="이 시리즈 이어보기">이어보기</button>` : '';
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

/* ========= 상태 복원 ========= */
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

  // 연속재생
  const v = (localStorage.getItem(AUTONEXT_KEY)||'').toLowerCase();
  cbAutoNext.checked = (v==='1' || v==='true' || v==='on');

  // 선택
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{}
  if (!saved || saved==='ALL'){ selectAll(true); }
  else{
    selectAll(false);
    const set=new Set(saved);
    catsBox.querySelectorAll('.cat').forEach(ch=>{ if(set.has(ch.value)) ch.checked=true; });
    // personal 단독성 유지
    const personals = Array.from(catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked'));
    const normals   = Array.from(catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked'));
    if (personals.length>=1 && normals.length>=1) personals.forEach(c=> c.checked=false);
    if (personals.length>=2) personals.slice(1).forEach(c=> c.checked=false);
    refreshAllParentStates();
    cbToggleAll.checked = computeAllSelected();
  }
}
restoreState();

/* ========= 액션: 영상보기 / 목록 ========= */
btnWatch?.addEventListener('click', async ()=>{
  const { cats, type } = collectCurrentFilters();
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

/* ========= 현재 선택 수집 ========= */
function collectCurrentFilters(){
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(isPersonalVal);
  const normals   = selected.filter(v=> !isPersonalVal(v));
  const type = getTypeValue();

  const cats = (personals.length===1 && normals.length===0)
    ? [personals[0]]
    : (computeAllSelected() ? 'ALL' : normals);

  return { cats, type };
}
function catsForSave(cats){
  return (Array.isArray(cats) && cats.length) ? cats : 'ALL';
}

/* ========= 도움말 ========= */
helpBtn?.addEventListener('click', ()=>{ helpOverlay?.classList.add('show'); helpOverlay?.setAttribute('aria-hidden','false'); });
helpOverlay?.addEventListener('click',(e)=>{ if (e.target===helpOverlay){ helpOverlay.classList.remove('show'); helpOverlay.setAttribute('aria-hidden','true'); } });
document.addEventListener('keydown',(e)=>{ if (e.key==='Escape' && helpOverlay?.classList.contains('show')){ helpOverlay.classList.remove('show'); helpOverlay.setAttribute('aria-hidden','true'); } });

/* ========= 스와이프: 좌=업로드 / 우=목록 ========= */
(function initSwipeNavHybrid({
  goLeftHref='/upload.html',
  deadZoneCenterRatio=0.18,
  animateMs=260, intentDx=12, cancelDy=10, maxDy=90, maxMs=700, minDx=70, minVx=0.6
}={}){
  let sx=0, sy=0, t0=0, tracking=false, horizontalIntent=false, pointerId=null;
  const inDeadZone=(x)=>{ const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2); return x>=L && x<=R; };
  const isInteractive=(el)=> !!el.closest('button,a,[role="button"],input,select,textarea,label,.no-swipe,#dropdownMenu');
  function startCommon(x,y,t){ if (isInteractive(t)||inDeadZone(x)) return false; sx=x; sy=y; t0=performance.now(); tracking=true; horizontalIntent=false; return true; }
  function moveCommon(x,y){ if (!tracking) return false; const dx=x-sx, dy=y-sy;
    if (!horizontalIntent){ if (Math.abs(dy)>10){ tracking=false; return false; } if (Math.abs(dx)>=12) horizontalIntent=true; }
    else if (Math.abs(dy)>90){ tracking=false; return false; } return true; }
  async function endCommon(x,y){
    if (!tracking) return; tracking=false; const dx=x-sx, dy=y-sy, dt=performance.now()-t0;
    if (!horizontalIntent || Math.abs(dy)>90 || dt>700) return;
    const vx=Math.abs(dx)/Math.max(1,dt); const passDist=Math.abs(dx)>=70; const passVel=vx>=0.6;
    async function goRightToList(){
      const { cats, type } = collectCurrentFilters();
      localStorage.setItem(VIEW_TYPE_KEY, type);
      localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(catsForSave(cats)));
      try{ await Makelist.makeForListFromIndex({ cats, type }); }catch(e){ console.error('[swipe→list] make list failed', e); }
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href='/list.html', 260);
    }
    if (dx >= 70 || (dx>0 && passVel)) await goRightToList();
    else if (dx <= -70 || (dx<0 && passVel)){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
  }
  const pt=(e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
  document.addEventListener('pointerdown', e=>{ const ok=startCommon(e.clientX,e.clientY,e.target); }, {passive:true});
  document.addEventListener('pointermove',  e=>{ moveCommon(e.clientX,e.clientY); }, {passive:true});
  document.addEventListener('pointerup',    e=>{ endCommon(e.clientX,e.clientY); }, {passive:true});
  document.addEventListener('touchstart',   e=>{ const t=pt(e); t&&startCommon(t.clientX,t.clientY,e.target); }, {passive:true});
  document.addEventListener('touchmove',    e=>{ const t=pt(e); t&&moveCommon(t.clientX,t.clientY); }, {passive:true});
  document.addEventListener('touchend',     e=>{ const t=pt(e); t&&endCommon(t.clientX,t.clientY); }, {passive:true});
})();
