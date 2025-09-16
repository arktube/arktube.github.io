// js/index.js (arktube v1.8.0) — type(video/shorts) 분리, CATEGORY_GROUPS 제거, personal×4
// 유지 기능: 상단바/드롭다운, 그룹 정렬, 개인 라벨(로컬), 부모-자식 동기화, 전체선택,
//           연속재생(autonext) 표준화, index→watch/list 선택 저장,
//           단순형 스와이프(중앙 데드존), 드래그-팔로우 스와이프(중앙 데드존), 페이지 슬라이드 CSS
// 변경 핵심: categories.js의 CATEGORY_MODEL 기반으로 type별 그룹 렌더링, personal 4개, 선택/저장 키 분리

import { CATEGORY_MODEL } from './categories.js?v=arktube-1.0';
import { auth } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js?v=1.5.1';

/* ===== 공통 상수/유틸 ===== */
const GROUP_ORDER_KEY   = 'groupOrderV1';
const TYPE_KEY          = 'selectedType'; // 'video' | 'shorts' | 'personal'(개인자료 단독 재생 시)
const SELECTED_KEY_OF   = (type)=> `selectedCats:${type}`; // type별 선택 저장
const PERSONAL_LABELS_K = 'personalLabels';

const isPersonalVal = (v)=> v==='personal1' || v==='personal2' || v==='personal3' || v==='personal4';

// 전역 내비게이션 가드(단순형/고급형 중복 방지)
window.__swipeNavigating = window.__swipeNavigating || false;

// 현재 활성 타입 읽기/쓰기 (UI 라디오/셀렉트 → localStorage 동기화)
function getActiveType() {
  // 1) 라디오(name="selType")
  const radio = document.querySelector('input[name="selType"]:checked');
  if (radio && (radio.value === 'video' || radio.value === 'shorts')) return radio.value;

  // 2) 셀렉트(#selType)
  const sel = document.getElementById('selType');
  const vv = sel?.value;
  if (vv === 'video' || vv === 'shorts') return vv;

  // 3) 저장값 or 기본 'video'
  const saved = localStorage.getItem(TYPE_KEY);
  return (saved === 'shorts' || saved === 'video') ? saved : 'video';
}
function setActiveType(t){
  const type = (t === 'shorts' ? 'shorts' : 'video');
  localStorage.setItem(TYPE_KEY, type);

  // 라디오/셀렉트가 있으면 동기화
  const radio = document.querySelector(`input[name="selType"][value="${type}"]`);
  if (radio) radio.checked = true;
  const sel = document.getElementById('selType');
  if (sel) sel.value = type;
}

/* ---------- group order ---------- */
function applyGroupOrder(groups){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(GROUP_ORDER_KEY) || 'null'); }catch{}
  const order = Array.isArray(saved) && saved.length ? saved : groups.map(g=>g.key);
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>(idx.get(a.key)??999) - (idx.get(b.key)??999));
}

/* ---------- personal labels (local) ---------- */
function getPersonalLabels(){
  try { return JSON.parse(localStorage.getItem(PERSONAL_LABELS_K) || '{}'); }
  catch { return {}; }
}

/* ---------- topbar ---------- */
const signupLink   = document.getElementById("signupLink");
const signinLink   = document.getElementById("signinLink");
const welcome      = document.getElementById("welcome");
const menuBtn      = document.getElementById("menuBtn");
const dropdown     = document.getElementById("dropdownMenu");
const btnSignOut   = document.getElementById("btnSignOut");
const btnGoUpload  = document.getElementById("btnGoUpload");
const btnMyUploads = document.getElementById("btnMyUploads");
const btnAbout     = document.getElementById("btnAbout");
const btnOrder     = document.getElementById("btnOrder");
const btnList      = document.getElementById("btnList");
const brandHome    = document.getElementById("brandHome");

let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown?.classList.remove("hidden"); requestAnimationFrame(()=> dropdown?.classList.add("show")); }
function closeDropdown(){ isMenuOpen=false; dropdown?.classList.remove("show"); setTimeout(()=> dropdown?.classList.add("hidden"),180); }

onAuthStateChanged(auth,(user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle("hidden", loggedIn);
  signinLink?.classList.toggle("hidden", loggedIn);
  welcome && (welcome.textContent = loggedIn ? `Welcome! ${user.displayName || '회원'}` : "");
  closeDropdown();
});
menuBtn     ?.addEventListener("click",(e)=>{ e.stopPropagation(); dropdown?.classList.contains("hidden") ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(!dropdown || dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu, #menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown    ?.addEventListener("click",(e)=> e.stopPropagation());
btnMyUploads?.addEventListener("click", ()=>{ location.href = "manage-uploads.html"; closeDropdown(); });
btnGoUpload ?.addEventListener("click", ()=>{ location.href = "upload.html"; closeDropdown(); });
btnAbout    ?.addEventListener("click", ()=>{ location.href = "about.html"; closeDropdown(); });
btnOrder    ?.addEventListener("click", ()=>{ location.href = "category-order.html"; closeDropdown(); });
btnSignOut  ?.addEventListener("click", async ()=>{ if(!auth.currentUser){ location.href='signin.html'; return; } await fbSignOut(auth); closeDropdown(); });
btnList     ?.addEventListener("click", ()=>{ location.href = "list.html"; closeDropdown(); });
brandHome   ?.addEventListener("click",(e)=>{ e.preventDefault(); window.scrollTo({top:0,behavior:"smooth"}); });

/* === 연속재생(autonext) 표준 관리: index 전용 === */
(function setupAutoNext(){
  const KEY = 'autonext';
  const $auto = document.getElementById('cbAutoNext');
  if (!$auto) return;

  const read = () => {
    const v = (localStorage.getItem(KEY) || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  };
  const write = (on) => { localStorage.setItem(KEY, on ? '1' : '0'); };

  const hasSaved = localStorage.getItem(KEY) != null;
  if (hasSaved) $auto.checked = read();
  else write($auto.checked);

  $auto.addEventListener('change', () => write($auto.checked));
  window.addEventListener('storage', (e)=>{ if (e.key === KEY) $auto.checked = read(); });
})();

/* ---------- 카테고리 렌더링 (type 분리) ---------- */
const catsBox      = document.getElementById("cats");
const btnWatch     = document.getElementById("btnWatch");
const cbAutoNext   = document.getElementById("cbAutoNext");
const cbToggleAll  = document.getElementById("cbToggleAll");
const catTitleBtn  = document.getElementById("btnOpenOrder");

// type 토글 UI(있으면 연결)
(function bindTypeToggles(){
  // 라디오
  document.querySelectorAll('input[name="selType"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      setActiveType(r.value);
      renderGroups(); // type 바뀌면 그룹 재구성
      applySavedSelection(); // type별 저장값 반영
    });
  });
  // 셀렉트
  const sel = document.getElementById('selType');
  sel?.addEventListener('change', ()=>{
    setActiveType(sel.value);
    renderGroups();
    applySavedSelection();
  });

  // 초기 동기화
  setActiveType(getActiveType());
})();

function groupsForActiveType(){
  const type = getActiveType(); // 'video' | 'shorts'
  const model = CATEGORY_MODEL || {};
  const gType = (model[type]?.groups || []);     // 타입별 일반 그룹들
  const gPers = model.personal ? [model.personal] : []; // 개인그룹(항상 마지막)
  // (시리즈 그룹이 모델에 있다면 여기에 포함되도록 처리)
  const gSeries = model.series ? [model.series] : [];
  return [...gType, ...gSeries, ...gPers];
}

function applyGroupOrderForType(groups){
  // 그룹 정렬은 key 기준 공통 키를 사용
  return applyGroupOrder(groups);
}

function renderGroups(){
  if (!catsBox) return;
  const groups = applyGroupOrderForType(groupsForActiveType());
  const personalLabels = getPersonalLabels();

  const html = groups.map(g=>{
    const isPersonalGroup = g.key==='personal';

    const kids = (g.children || []).map(c=>{
      const labelText = isPersonalGroup && personalLabels[c.value] ? personalLabels[c.value] : c.label;
      // c.value는 categories.js에서 안전한 값만 제공된다고 가정
      const safeValue = String(c.value || '');
      return `<label><input type="checkbox" class="cat" value="${safeValue}"> ${labelText}</label>`;
    }).join('');

    const legendHTML = isPersonalGroup
      ? `<legend><span style="font-weight:800;">${g.label}</span> <span class="muted">(로컬저장소)</span></legend>`
      : `<legend>
           <label class="group-toggle">
             <input type="checkbox" class="group-check" data-group="${g.key}" />
             <span>${g.label}</span>
           </label>
         </legend>`;

    const noteHTML = isPersonalGroup
      ? `<div class="muted" style="margin:6px 4px 2px;">개인자료는 <b>단독 재생만</b> 가능합니다.</div>`
      : '';

    return `
      <fieldset class="group" data-key="${g.key}">
        ${legendHTML}
        <div class="child-grid">${kids}</div>
        ${noteHTML}
      </fieldset>
    `;
  }).join('');

  catsBox.innerHTML = html;
  bindGroupInteractions();
}

/* ---------- parent/child sync ---------- */
function setParentStateByChildren(groupEl){
  const parent   = groupEl.querySelector('.group-check');
  if (!parent) return; // personal: no parent toggle
  const children = Array.from(groupEl.querySelectorAll('input.cat'));
  const total = children.length;
  const checked = children.filter(c => c.checked).length;
  if (checked===0){ parent.checked=false; parent.indeterminate=false; }
  else if (checked===total){ parent.checked=true; parent.indeterminate=false; }
  else { parent.checked=false; parent.indeterminate=true; }
}
function setChildrenByParent(groupEl,on){
  groupEl.querySelectorAll('input.cat').forEach(c=> c.checked = !!on);
}
function refreshAllParentStates(){
  catsBox?.querySelectorAll('.group').forEach(setParentStateByChildren);
}
function computeAllSelected(){
  // 전체선택 비교는 personal/series 제외
  const real = Array.from(catsBox?.querySelectorAll('.group:not([data-key="personal"]):not([data-key="series"]) input.cat') || []);
  return real.length>0 && real.every(c=>c.checked);
}
let allSelected=false;

function bindGroupInteractions(){
  // parent toggles (not for personal)
  catsBox?.querySelectorAll('.group-check').forEach(parent=>{
    const groupKey = parent.getAttribute('data-group');
    if (groupKey === 'personal') return;
    parent.addEventListener('change', ()=>{
      const groupEl = parent.closest('.group');
      setChildrenByParent(groupEl, parent.checked);
      setParentStateByChildren(groupEl);
      allSelected = computeAllSelected();
      if (cbToggleAll) cbToggleAll.checked = allSelected;

      // deselect personals if any were on
      catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
    });
  });

  // child toggles
  catsBox?.querySelectorAll('input.cat').forEach(child=>{
    child.addEventListener('change', ()=>{
      const v = child.value;
      const isPersonal = isPersonalVal(v);

      if (isPersonal && child.checked){
        // personal = single-mode: clear others
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat').forEach(c=>{ if(c!==child) c.checked=false; });
        catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked').forEach(c=> c.checked=false);
      }
      if (!isPersonal && child.checked){
        // selecting normal → clear personals
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
      }

      const groupEl = child.closest('.group');
      setParentStateByChildren(groupEl);
      refreshAllParentStates();

      allSelected = computeAllSelected();
      if (cbToggleAll) cbToggleAll.checked = allSelected;
    });
  });
}

/* ---------- select all & saved selection (type별) ---------- */
function selectAll(on){
  // 일반 카테고리 전체 on/off (personal/series 제외)
  catsBox
    ?.querySelectorAll('.group:not([data-key="personal"]):not([data-key="series"]) input.cat')
    .forEach(b => { b.checked = !!on; });

  // 전체선택 시 personal/series는 항상 해제
  catsBox
    ?.querySelectorAll('.group[data-key="personal"] input.cat:checked, .group[data-key="series"] input.cat:checked')
    .forEach(c => { c.checked = false; });

  refreshAllParentStates();
  allSelected = !!on;
  if (cbToggleAll) cbToggleAll.checked = allSelected;
}
function applySavedSelection(){
  const type = getActiveType(); // video | shorts
  const key  = SELECTED_KEY_OF(type);
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(key) || 'null'); }catch{}

  if (!saved || saved==="ALL"){ selectAll(true); }
  else{
    selectAll(false);
    const set = new Set(saved);
    catsBox?.querySelectorAll('.cat').forEach(ch=>{ if (set.has(ch.value)) ch.checked=true; });
    // guard: personal single-mode
    const personals = Array.from(catsBox?.querySelectorAll('.group[data-key="personal"] input.cat:checked') || []);
    const normals   = Array.from(catsBox?.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked') || []);
    if (personals.length >= 1 && normals.length >= 1){
      personals.forEach(c=> c.checked=false);
    }else if (personals.length >= 2){
      personals.slice(1).forEach(c=> c.checked=false);
    }
    refreshAllParentStates();
  }

  // 연속재생 초기 표시(여러 포맷 허용)
  const vv = (localStorage.getItem('autonext') || '').toLowerCase();
  if (cbAutoNext) cbAutoNext.checked = (vv==='1' || vv==='true' || vv==='on');
}

// 초기 렌더 + 저장 반영
renderGroups();
applySavedSelection();

cbToggleAll?.addEventListener('change', ()=> selectAll(!!cbToggleAll.checked));

/* ---------- go watch ---------- */
btnWatch?.addEventListener('click', ()=>{
  // list→watch 잔여 큐 무시: index→watch는 항상 최신부터 시작
  sessionStorage.removeItem('playQueue'); sessionStorage.removeItem('playIndex');

  const type     = getActiveType(); // 'video' | 'shorts'
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(isPersonalVal);
  const normals   = selected.filter(v=> !isPersonalVal(v));

  // personal-only → 단독 재생
  if (personals.length === 1 && normals.length === 0){
    localStorage.setItem(TYPE_KEY, 'personal'); // 현재 세션의 유형 표시
    localStorage.setItem(SELECTED_KEY_OF('personal') /*가상키*/, JSON.stringify(personals));
    localStorage.setItem('autonext', cbAutoNext?.checked ? '1' : '0'); // 통일
    location.href = `watch.html?cats=${encodeURIComponent(personals[0])}&type=personal`;
    return;
  }

  // normal only (no personals mixed)
  const isAll = computeAllSelected(); // personal/series 제외 기준으로 판정
  const valueToSave = (normals.length===0 || isAll) ? "ALL" : normals;
  localStorage.setItem(TYPE_KEY, type);
  localStorage.setItem(SELECTED_KEY_OF(type), JSON.stringify(valueToSave));
  localStorage.setItem('autonext', cbAutoNext?.checked ? '1' : '0'); // 통일
  location.href = `watch.html?type=${encodeURIComponent(type)}`;
});

catTitleBtn?.addEventListener('click', ()=> location.href='category-order.html');

/* ---------- storage listener: other-tab updates ---------- */
window.addEventListener('storage', (e)=>{
  if (e.key === PERSONAL_LABELS_K || e.key === GROUP_ORDER_KEY || e.key === TYPE_KEY) {
    // type 변동이나 라벨/순서 변동 → 재렌더 + 선택 반영
    renderGroups();
    applySavedSelection();
  }
});

/* ===================== */
/* Slide-out CSS (단순형에서도 사용) */
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

/* ---------- index→list 직전 선택 저장 (type별) ---------- */
function persistSelectedCatsForList(){
  const type     = getActiveType();
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(isPersonalVal);
  const normals   = selected.filter(v=> !isPersonalVal(v));

  if (personals.length === 1 && normals.length === 0) {
    localStorage.setItem(TYPE_KEY, 'personal');
    localStorage.setItem(SELECTED_KEY_OF('personal'), JSON.stringify(personals));
    return;
  }

  const isAll = computeAllSelected() === true;
  const valueToSave = (normals.length===0 || isAll) ? "ALL" : normals;
  localStorage.setItem(TYPE_KEY, type);
  localStorage.setItem(SELECTED_KEY_OF(type), JSON.stringify(valueToSave));
}

/* ===================== */
/* 단순형 스와이프(중앙 데드존) */
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
      persistSelectedCatsForList();
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href = goRightHref, animateMs);
    }
  }
  document.addEventListener('touchstart', onStart, { passive:true });
  document.addEventListener('touchend',   onEnd,   { passive:true });
  document.addEventListener('pointerdown',onStart, { passive:true });
  document.addEventListener('pointerup',  onEnd,   { passive:true });
}
// ✅ index: 우→좌=upload, 좌→우=list (중앙 데드존 30%)
initSwipeNav({ goLeftHref: 'upload.html', goRightHref: 'list.html', deadZoneCenterRatio: 0.30 });

/* ===================== */
/* 고급형 스와이프(끌리는 모션, 중앙 데드존) */
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
      e.preventDefault();
      page.style.transform = 'translateX(' + (dx * feel) + 'px)';
    }

    function end(e){
      if(!active) return; active = false;
      const t = (e.changedTouches && e.changedTouches[0]) || (e.pointerType ? e : null);
      if(!t) return;
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dt = Date.now() - t0;

      if(canceled || Math.abs(dy) > slop || dt > timeMax){
        reset(true);
        return;
      }

      if(dx >= threshold && goRightHref){
        window.__swipeNavigating = true;
        persistSelectedCatsForList();
        page.style.transition = 'transform 160ms ease';
        page.style.transform  = 'translateX(100vw)';
        setTimeout(()=>{ location.href = goRightHref; }, 150);
      } else if(dx <= -threshold && goLeftHref){
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
  // index: 좌→우 = list, 우→좌 = upload
  initDragSwipe({ goLeftHref: 'upload.html', goRightHref: 'list.html', threshold:60, slop:45, timeMax:700, feel:1.0, deadZoneCenterRatio: 0.15 });
})();

// End of js/index.js (arktube v1.8.0)
