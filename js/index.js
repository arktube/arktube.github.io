// /js/index.js — ArkTube Index (완전판)
// - admin-common 상단바 초기화(Welcome!), 로그인/닉네임 표시
// - CATEGORY_GROUPS/MODEL 기반 카테고리 렌더 + parent/child 동기화 + 전체선택(일반만)
// - 개인자료(personal_*) 단독 선택 강제 + 라벨 로컬 커스텀 표시
// - 시리즈 서브키 옆 '이어보기' 즉시 재생 (등록순+resume 반영)
// - view:type('both'|'shorts'|'video') / autonext('1'|'0') 로컬 저장/복원
// - '영상보기'→ makelist.makeForWatchFromIndex → /watch.html?from=index
// - '영상목록' 버튼/스와이프→ makelist.makeForListFromIndex → /list.html
// - 드롭다운 접근성(ESC/포커스 트랩/외부클릭 닫기), 도움말 오버레이

import { CATEGORY_GROUPS, CATEGORY_MODEL } from './categories.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import * as Makelist from './makelist.js';
import { initHeader } from './admin-common.js';

/* ========= 키 ========= */
const GROUP_ORDER_KEY   = 'groupOrderV1';
const SELECTED_CATS_KEY = 'selectedCats';
const AUTONEXT_KEY      = 'autonext';
const VIEW_TYPE_KEY     = 'view:type';  // both | shorts | video

/* ========= 상단바 초기화 ========= */
try { initHeader?.({ greeting: 'Welcome!' }); } catch {}

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

/* ========= 로그인 표시(로컬 구독 유지) ========= */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  btnSignOut?.classList.toggle('hidden', !loggedIn);
});
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

/* ========= 라우팅 버튼 ========= */
btnGoUpload?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads?.addEventListener('click', ()=> location.href='/manage-uploads.html');
btnAbout?.addEventListener('click', ()=> location.href='/about.html');
btnOrder?.addEventListener('click', ()=> location.href='/category-order.html');
brandHome?.addEventListener('click', (e)=>{ e.preventDefault(); location.href='/index.html'; });

/* ========= 드롭다운 ========= */
(function initDropdown(){
  const menu = dropdown; let open=false;
  function setOpen(v){
    open=!!v; btnDropdown?.setAttribute('aria-expanded', String(open));
    if (!menu) return;
    if (open){
      menu.classList.remove('hidden'); requestAnimationFrame(()=> menu.classList.add('open'));
      const first = menu.querySelector('button,[href],[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : btnDropdown)?.focus();
      bindDoc();
    } else {
      menu.classList.remove('open'); setTimeout(()=> menu.classList.add('hidden'), 120);
      unbindDoc();
    }
  }
  const toggle=()=> setOpen(!open);
  btnDropdown?.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('button,[role="menuitem"],a')) setOpen(false); });

  let off1=null, off2=null;
  function bindDoc(){
    if (off1 || off2) return;
    const onP=(e)=>{ if(e.target.closest('#dropdownMenu,#btnDropdown')) return; setOpen(false); };
    const onK=(e)=>{ if(e.key==='Escape') setOpen(false); };
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
  // CATEGORY_MODEL 또는 CATEGORY_GROUPS 호환
  const g = Array.isArray(CATEGORY_GROUPS) ? CATEGORY_GROUPS
        : (Array.isArray(CATEGORY_MODEL?.groups) ? CATEGORY_MODEL.groups : CATEGORY_MODEL);
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
      // 개인/시리즈와 상충 정리
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
    // personal 단독성
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
  // 연속재생/타입 저장
  localStorage.setItem(AUTONEXT_KEY, cbAutoNext.checked ? '1' : '0');
  localStorage.setItem(VIEW_TYPE_KEY, type);
  // 선택 저장(일반=ALL 처리)
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

  // 개인자료 단일 → 그 슬롯만, 그 외 → ALL 또는 normals 배열
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

/* ========= 스와이프 내비 (좌=업로드 / 우=목록) ========= */
(function initSwipeNavHybrid({
  goLeftHref='/upload.html',
  deadZoneCenterRatio=0.18,
  animateMs=260, intentDx=12, cancelDy=10, maxDy=90, maxMs=700, minDx=70, minVx=0.6
}={}){
  let sx=0, sy=0, t0=0, tracking=false, horizontalIntent=false, pointerId=null;

  function isInteractiveEl(el){ return !!el.closest('button,a,[role="button"],input,select,textarea,label,.no-swipe,#dropdownMenu'); }
  function inDeadZone(x){
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
    const L  = vw*(0.5-dz/2), R = vw*(0.5+dz/2);
    return x>=L && x<=R;
  }
  function startCommon(x,y,target){
    if (isInteractiveEl(target) || inDeadZone(x)) return false;
    sx=x; sy=y; t0=performance.now(); tracking=true; horizontalIntent=false; return true;
  }
  function moveCommon(x,y){
    if (!tracking) return false;
    const dx=x-sx, dy=y-sy;
    if (!horizontalIntent){
      if (Math.abs(dy)>cancelDy){ tracking=false; return false; }
      if (Math.abs(dx)>=intentDx) horizontalIntent=true;
    } else { if (Math.abs(dy)>maxDy){ tracking=false; return false; } }
    return true;
  }
  async function endCommon(x,y){
    if (!tracking) return; tracking=false;
    const dx=x-sx, dy=y-sy, dt=performance.now()-t0;
    if (!horizontalIntent || Math.abs(dy)>maxDy || dt>maxMs) return;

    const vx=Math.abs(dx)/Math.max(1,dt); const passDist=Math.abs(dx)>=minDx; const passVel=vx>=minVx;
    if (!(passDist||passVel)) return;

    async function goRightToList(){
      const { cats, type } = collectCurrentFilters();
      localStorage.setItem(VIEW_TYPE_KEY, type);
      localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(catsForSave(cats)));
      try{ await Makelist.makeForListFromIndex({ cats, type }); }catch(e){ console.error('[swipe→list] make list failed', e); }
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href='/list.html', animateMs);
    }

    if (dx >= minDx || (dx>0 && passVel)){
      await goRightToList();
    } else if (dx <= -minDx || (dx<0 && passVel)){
      document.documentElement.classList.add('slide-out-left');
      setTimeout(()=> location.href=goLeftHref, animateMs);
    }
  }

  const point = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
  document.addEventListener('pointerdown', e=>{ pointerId=e.pointerId??'p'; startCommon(e.clientX,e.clientY,e.target); }, {passive:true});
  document.addEventListener('pointermove',  e=>{ if(pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return; moveCommon(e.clientX,e.clientY); }, {passive:true});
  document.addEventListener('pointerup',    e=>{ if(pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return; endCommon(e.clientX,e.clientY); pointerId=null; }, {passive:true});
  document.addEventListener('touchstart',   e=>{ const t=point(e); t&&startCommon(t.clientX,t.clientY,e.target); }, {passive:true});
  document.addEventListener('touchmove',    e=>{ const t=point(e); t&&moveCommon(t.clientX,t.clientY); }, {passive:true});
  document.addEventListener('touchend',     e=>{ const t=point(e); t&&endCommon(t.clientX,t.clientY); }, {passive:true});

  if (!document.getElementById('swipe-anim-advanced')){
    const style=document.createElement('style'); style.id='swipe-anim-advanced';
    style.textContent=`
@keyframes pageSlideLeft { from { transform: translateX(0); opacity:1; } to { transform: translateX(-22%); opacity:.92; } }
@keyframes pageSlideRight{ from { transform: translateX(0); opacity:1; } to { transform: translateX(22%);  opacity:.92; } }
:root.slide-out-left  body { animation: pageSlideLeft 0.26s ease forwards; }
:root.slide-out-right body { animation: pageSlideRight 0.26s ease forwards; }
@media (prefers-reduced-motion: reduce){ :root.slide-out-left body, :root.slide-out-right body { animation:none; } }`;
    document.head.appendChild(style);
  }
})();
