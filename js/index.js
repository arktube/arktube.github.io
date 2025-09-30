// /js/index.js  (ArkTube Index — CATEGORY_MODEL only, series resume, v1.5 dropdown, Hybrid Swipe, Snapshot on swipe→List)
import { CATEGORY_GROUPS, CATEGORY_MODEL } from './categories.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';

/* ========= 유틸 ========= */
const isPersonalVal = (v)=> v && v.startsWith('personal');
const isSeriesGroup = (key)=> typeof key === 'string' && key.startsWith('series_');

const GROUP_ORDER_KEY   = 'groupOrderV1';              // 카테고리 순서
const SELECTED_CATS_KEY = 'selectedCats';              // 선택 저장 (ALL | string[])
const AUTONEXT_KEY      = 'autonext';                  // 연속재생 on/off
const VIEW_TYPE_KEY     = 'arktube:view:type';         // all | shorts | video
const LIST_SNAPSHOT_KEY = 'arktube:list:snapshot';     // list 상태 복원용 (index는 저장만)

/* ========= 상단바 ========= */
const topbar       = document.getElementById('topbar');
const dropdown     = document.getElementById('dropdownMenu');
const signupLink   = document.getElementById('signupLink');
const signinLink   = document.getElementById('signinLink');
const nickWrap     = document.getElementById('nickWrap');      // 없으면 무시됨
const btnSignOut   = document.getElementById('btnSignOut');
const btnGoUpload  = document.getElementById('btnGoUpload');
const btnMyUploads = document.getElementById('btnMyUploads');
const btnAbout     = document.getElementById('btnAbout');
const btnOrder     = document.getElementById('btnOrder');
const btnList      = document.getElementById('btnList');
const brandHome    = document.getElementById('brandHome');
const btnDropdown  = document.getElementById('btnDropdown');   // v1.5 드롭다운 토글 버튼
const welcomeEl    = document.getElementById('welcome');
const nickNameEl   = document.getElementById('nickName');      // 선택적 표시용

// 페이지 인사말 규칙: index = "Welcome!"
if (welcomeEl) welcomeEl.textContent = 'Welcome!';

// 로그인 상태 표시 + 닉네임(있을 때만)
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  nickWrap?.classList.toggle('hidden', !loggedIn);
  if (nickNameEl) nickNameEl.textContent = loggedIn ? (user?.displayName || 'User') : '';
});

btnSignOut?.addEventListener('click', async ()=>{
  try{ await fbSignOut(); }catch{}
  location.reload();
});
brandHome?.addEventListener('click', ()=> location.href='/index.html');
btnGoUpload?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads?.addEventListener('click', ()=> location.href='/manage-uploads.html');
btnAbout?.addEventListener('click', ()=> location.href='/about.html');
btnOrder?.addEventListener('click', ()=> location.href='/category-order.html');

/* ========= Dropdown (CopyTube v1.5 스타일로 통일) ========= */
// 규격: hidden+open 클래스, opacity/transform 트랜지션, aria-expanded/aria-hidden 동기화,
// pointerdown 외부클릭 닫기, Escape/Tab 포커스 트랩.
(function initDropdownV15(){
  const menu = dropdown; // id="dropdownMenu"
  let ddOpen = false;
  let offPointer = null, offKey = null;

  function setOpen(open){
    ddOpen = !!open;
    if (!menu || !btnDropdown) return;

    btnDropdown.setAttribute('aria-expanded', String(ddOpen));
    menu.setAttribute('aria-hidden', String(!ddOpen));

    if (ddOpen){
      menu.classList.remove('hidden');
      requestAnimationFrame(()=> menu.classList.add('open'));
      const first = menu.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      if (first) first.focus({ preventScroll:true });
      bindDoc();
    } else {
      menu.classList.remove('open');
      setTimeout(()=> menu.classList.add('hidden'), 150);
      btnDropdown.focus?.({ preventScroll:true });
      unbindDoc();
    }
  }
  function toggle(){ setOpen(!ddOpen); }

  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = (e)=>{
      const t = e.target;
      if (t.closest('#dropdownMenu') || t.closest('#btnDropdown')) return;
      setOpen(false);
    };
    const onKey = (e)=>{
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab' && ddOpen){
        const nodes = menu.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])');
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length-1];
        if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('pointerdown', onPointer, { passive:true });
    document.addEventListener('keydown', onKey);
    offPointer = ()=> document.removeEventListener('pointerdown', onPointer, { passive:true });
    offKey     = ()=> document.removeEventListener('keydown', onKey);
  }
  function unbindDoc(){ if (offPointer){ offPointer(); offPointer=null; } if (offKey){ offKey(); offKey=null; } }

  btnDropdown?.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });
  window.addEventListener('beforeunload', ()=> setOpen(false));

  // 초기 상태 aria 동기화
  if (menu && btnDropdown){
    const initiallyHidden = menu.classList.contains('hidden');
    btnDropdown.setAttribute('aria-expanded', String(!initiallyHidden));
    menu.setAttribute('aria-hidden', String(initiallyHidden));
  }
})();

/* ========= CTA/토글/렌더 ========= */
const catsBox      = document.getElementById('cats');
const cbToggleAll  = document.getElementById('cbToggleAll');
const btnWatch     = document.getElementById('btnWatch');
const btnOpenOrder = document.getElementById('btnOpenOrder');
const cbAutoNext   = document.getElementById('cbAutoNext');
const typeWrap     = document.getElementById('typeToggle');

btnOpenOrder?.addEventListener('click', ()=> location.href='/category-order.html');

function applyGroupOrder(groups){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(GROUP_ORDER_KEY) || 'null'); }catch{}
  const order = Array.isArray(saved) && saved.length ? saved : groups.map(g=>g.key);
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>(idx.get(a.key)??999) - (idx.get(b.key)??999));
}
function getPersonalLabels(){
  try { return JSON.parse(localStorage.getItem('personalLabels') || '{}'); }
  catch { return {}; }
}

function renderGroups(){
  const groups = applyGroupOrder(CATEGORY_GROUPS);
  const personalLabels = getPersonalLabels();

  const html = groups.map(g=>{
    const isPersonalGroup = g.key==='personal';
    const isSeries = isSeriesGroup(g.key);

    // children (개인자료 라벨 덮어쓰기 + 시리즈 '이어보기' 미니버튼)
    const kids = g.children.map(c=>{
      const labelText = isPersonalGroup && personalLabels[c.value]
        ? personalLabels[c.value] : c.label;

      // ⬇︎ 이어보기 버튼: 반드시 groupKey + subKey 전달 (resume:{groupKey}:{subKey})
      const resumeBtn = isSeries
        ? `<button class="resume-mini" data-group="${g.key}" data-sub="${c.value}" title="이 시리즈 이어보기">이어보기</button>`
        : '';

      return `<label>
                <input type="checkbox" class="cat" value="${c.value}"> 
                <span>${labelText}</span>
                ${resumeBtn}
              </label>`;
    }).join('');

    const legendHTML = isPersonalGroup
      ? `<legend><span style="font-weight:800;">${g.label}</span> <span class="subnote">(로컬저장소)</span></legend>`
      : `<legend>
           <label class="group-toggle">
             <input type="checkbox" class="group-check" data-group="${g.key}" />
             <span>${g.label}</span>
           </label>
         </legend>`;

    return `
      <fieldset class="group" data-key="${g.key}">
        ${legendHTML}
        <div class="child-grid">
          ${kids}
        </div>
      </fieldset>
    `;
  }).join('');

  catsBox.innerHTML = html;
  bindGroupInteractions();
  bindResumeButtons(); // 시리즈 이어보기
}
renderGroups();

/* ========= parent/child 동기화 ========= */
function setParentStateByChildren(groupEl){
  const parent   = groupEl.querySelector('.group-check');
  if (!parent) return;
  const children = Array.from(groupEl.querySelectorAll('input.cat'));
  const total = children.length;
  const checked = children.filter(c => c.checked).length;
  if (checked===0){ parent.checked=false; parent.indeterminate=false; }
  else if (checked===total){ parent.checked=true; parent.indeterminate=false; }
  else { parent.checked=false; parent.indeterminate=true; }
}
function setChildrenByParent(groupEl,on){ groupEl.querySelectorAll('input.cat').forEach(c=> c.checked = !!on); }
function refreshAllParentStates(){ catsBox.querySelectorAll('.group').forEach(setParentStateByChildren); }

function computeAllSelected(){
  // '전체선택'은 개인자료 + 모든 시리즈 그룹 제외
  const real = Array.from(catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat'))
    .filter(el => !isSeriesGroup(el.closest('.group')?.dataset?.key));
  return real.length>0 && real.every(c=>c.checked);
}

let allSelected=false;

function bindGroupInteractions(){
  // 전체 그룹 체크박스 → 자식 on/off (개인자료는 부모 없음)
  catsBox.querySelectorAll('.group-check').forEach(parent=>{
    const groupKey = parent.getAttribute('data-group');
    if (groupKey === 'personal') return;
    parent.addEventListener('change', ()=>{
      const groupEl = parent.closest('.group');
      setChildrenByParent(groupEl, parent.checked);
      setParentStateByChildren(groupEl);
      allSelected = computeAllSelected();
      if (cbToggleAll) cbToggleAll.checked = allSelected;

      // 개인자료는 단독 재생: 다른 체크 해제
      catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
    });
  });

  // 각 자식 체크
  catsBox.querySelectorAll('input.cat').forEach(child=>{
    child.addEventListener('change', ()=>{
      const v = child.value;
      const isPersonal = isPersonalVal(v);

      if (isPersonal && child.checked){
        // personal 단독 모드
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat').forEach(c=>{ if(c!==child) c.checked=false; });
        catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked').forEach(c=> c.checked=false);
      }
      if (!isPersonal && child.checked){
        // 일반/시리즈 선택 → personal 해제
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

/* ========= '이어보기' 미니버튼 (시리즈) ========= */
function bindResumeButtons(){
  catsBox.querySelectorAll('.resume-mini').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const groupKey = btn.getAttribute('data-group');
      const subKey   = btn.getAttribute('data-sub');
      if (!groupKey || !subKey) return;

      // 항상 등록순(asc)으로 시리즈 큐를 만들고, 저장된 위치 있으면 거기로 진입
      // resume 키 포맷: resume:{groupKey}:{subKey}
      const seriesKey = `${groupKey}:${subKey}`;

      // watch가 이어보기를 인지할 수 있도록 sessionStorage에 명시
      sessionStorage.setItem('resumeSeriesKey', seriesKey);

      // 시리즈 단일 child로 큐를 만들 수 있게 선택 상태도 저장(혼합 방지)
      localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify([subKey]));

      // 형식/연속재생 상태는 현 UI값을 그대로 전달
      const vt = document.querySelector('#typeToggle input:checked')?.value || 'all';
      localStorage.setItem(VIEW_TYPE_KEY, vt);
      localStorage.setItem(AUTONEXT_KEY, document.getElementById('cbAutoNext')?.checked ? '1' : '0');

      // 뒤로가기=인덱스 규칙: src 파라미터 없이 이동
      location.href = '/watch.html';
    });
  });
}

/* ========= '전체선택' & 기존 선택 복원 ========= */
function selectAll(on){
  // 개인자료 + 모든 시리즈 그룹 제외, 일반만 전체선택
  catsBox.querySelectorAll('.group input.cat').forEach(b=>{
    const groupKey = b.closest('.group')?.dataset?.key || '';
    const isPersonal = groupKey === 'personal';
    const isSeries   = isSeriesGroup(groupKey);
    if (!isPersonal && !isSeries){ b.checked = !!on; } else { b.checked = false; }
  });
  refreshAllParentStates();
  allSelected = !!on;
  if (cbToggleAll) cbToggleAll.checked = allSelected;
}
function applySavedSelection(){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{}
  if (!saved || saved === 'ALL'){ selectAll(true); }
  else{
    selectAll(false);
    const set = new Set(saved);
    catsBox.querySelectorAll('.cat').forEach(ch=>{ if (set.has(ch.value)) ch.checked=true; });

    // personal 단독성 유지
    const personals = Array.from(catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked'));
    const normals   = Array.from(catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked'));
    if (personals.length >= 1 && normals.length >= 1){
      personals.forEach(c=> c.checked=false);
    }else if (personals.length >= 2){
      personals.slice(1).forEach(c=> c.checked=false);
    }
    refreshAllParentStates();
  }

  // 형식 토글 기본값 복원 (기본 all)
  if (typeWrap){
    const savedType = localStorage.getItem(VIEW_TYPE_KEY) || 'all';
    const r = typeWrap.querySelector(`input[value="${savedType}"]`) || typeWrap.querySelector('input[value="all"]');
    if (r) r.checked = true;
  }

  // 연속재생 복원
  const vv = (localStorage.getItem(AUTONEXT_KEY) || '').toLowerCase();
  if (cbAutoNext) cbAutoNext.checked = (vv==='1' || vv==='true' || vv==='on');

  // 전체선택 체크박스 상태 동기화 (누락 보완)
  if (cbToggleAll) cbToggleAll.checked = computeAllSelected();
}
cbToggleAll?.addEventListener('change', ()=> selectAll(cbToggleAll.checked));

/* ========= list 이동 스냅샷 공통 함수 ========= */
function saveListSnapshot(){
  const cats = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const type = document.querySelector('#typeToggle input:checked')?.value || 'all';
  const auto = document.getElementById('cbAutoNext')?.checked ? 1 : 0;
  try{
    sessionStorage.setItem(LIST_SNAPSHOT_KEY, JSON.stringify({ cats, type, auto }));
  }catch{}
}

/* ========= index → list 버튼 ========= */
btnList?.addEventListener('click', ()=>{
  saveListSnapshot();
  location.href='/list.html';
});

/* ========= index → watch ========= */
btnWatch?.addEventListener('click', ()=>{
  // index→watch: 잔여 큐 초기화
  sessionStorage.removeItem('playQueue');
  sessionStorage.removeItem('playIndex');
  sessionStorage.removeItem('resumeSeriesKey');

  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(isPersonalVal);
  const normals   = selected.filter(v=> !isPersonalVal(v));

  // personal-only 선택
  if (personals.length === 1 && normals.length === 0){
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(personals));
    localStorage.setItem(AUTONEXT_KEY, cbAutoNext?.checked ? '1' : '0');
    // personal은 단독 재생 페이지 로직으로 watch가 처리
    location.href = `/watch.html?cats=${encodeURIComponent(personals[0])}`;
    return;
  }

  // 일반/시리즈: 'ALL' 또는 배열 저장
  const isAll = computeAllSelected();
  const valueToSave = (normals.length===0 || isAll) ? 'ALL' : normals;
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(valueToSave));
  localStorage.setItem(AUTONEXT_KEY, cbAutoNext?.checked ? '1' : '0');

  // 형식 토글 저장
  const vt = document.querySelector('#typeToggle input:checked')?.value || 'all';
  localStorage.setItem(VIEW_TYPE_KEY, vt);

  // 뒤로가기=인덱스 규칙: src 파라미터 없이 이동
  location.href = '/watch.html';
});

/* ========= 초기화 ========= */
applySavedSelection();

/* ========= 도움말 플로팅 ========= */
const helpBtn = document.getElementById('btnHelp');
const helpOverlay = document.getElementById('helpOverlay');
helpBtn?.addEventListener('click', ()=>{
  helpOverlay?.classList.add('show');
  helpOverlay?.setAttribute('aria-hidden','false');
});
helpOverlay?.addEventListener('click',(e)=>{
  if (e.target === helpOverlay){ // 바깥 클릭
    helpOverlay.classList.remove('show');
    helpOverlay.setAttribute('aria-hidden','true');
  }
});
document.addEventListener('keydown',(e)=>{
  if (e.key === 'Escape' && helpOverlay?.classList.contains('show')){
    helpOverlay.classList.remove('show');
    helpOverlay.setAttribute('aria-hidden','true');
  }
});

/* ========= 스와이프 내비 (하이브리드: Pointer Events 우선, 미지원 시 Touch fallback) ========= */
window.__swipeNavigating = window.__swipeNavigating || false;

function initSwipeNavHybrid({
  goLeftHref = null,   // 좌로 미는 제스처(→) 결과 URL
  goRightHref = null,  // 우로 미는 제스처(←) 결과 URL
  animateMs = 260,
  deadZoneCenterRatio = 0.18,   // 중앙 데드존 18%
  intentDx = 12,                // 가로 의도 임계값
  cancelDy = 10,                // 세로 의도 취소 임계값(의도 확정 전)
  maxDy = 90,                   // 전체 세로 허용치
  maxMs = 700,                  // 최대 제스처 시간
  minDx = 70,                   // 최소 거리 트리거
  minVx = 0.6                   // 최소 속도(px/ms) 트리거
} = {}) {
  let sx=0, sy=0, t0=0;
  let tracking=false, horizontalIntent=false, multiTouch=false;
  let pointerId = null;

  const getXYPointer = (e)=> ({ x: e.clientX, y: e.clientY, target: e.target });
  const getXYTouch   = (e)=> {
    const t = e.touches?.[0] || e.changedTouches?.[0];
    return t ? { x: t.clientX, y: t.clientY, target: t.target } : null;
  };

  function isInteractiveEl(el){
    return !!el.closest('button, a, [role="button"], input, select, textarea, label, .no-swipe, #dropdownMenu');
  }

  function inDeadZone(x){
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
    const L  = vw * (0.5 - dz/2);
    const R  = vw * (0.5 + dz/2);
    return x >= L && x <= R;
  }

  function startCommon(x, y, target){
    if (window.__swipeNavigating) return false;
    if (isInteractiveEl(target))  return false;
    if (inDeadZone(x))            return false;
    sx = x; sy = y; t0 = performance.now();
    tracking = true; horizontalIntent = false;
    return true;
  }

  function moveCommon(x, y){
    if (!tracking) return false;
    const dx = x - sx;
    const dy = y - sy;

    if (!horizontalIntent){
      if (Math.abs(dy) > cancelDy) { tracking=false; return false; } // 스크롤 의도
      if (Math.abs(dx) >= intentDx) horizontalIntent = true;
    } else {
      if (Math.abs(dy) > maxDy) { tracking=false; return false; }
    }
    return true;
  }

  function endCommon(x, y){
    if (!tracking) return;
    tracking = false;

    const dx = x - sx;
    const dy = y - sy;
    const dt = performance.now() - t0;

    if (!horizontalIntent) return;
    if (Math.abs(dy) > maxDy) return;
    if (dt > maxMs) return;

    const vx = Math.abs(dx) / Math.max(1, dt); // px/ms
    const passDistance = Math.abs(dx) >= minDx;
    const passVelocity = vx >= minVx;

    if (!(passDistance || passVelocity)) return;
    if (window.__swipeNavigating) return;

    const go = (href, dirClass)=>{
      if (!href) return;
      window.__swipeNavigating = true;
      document.documentElement.classList.add(dirClass);
      // ★ list 이동 전 스냅샷 저장(버튼 이동과 동등하게 유지)
      if (href.includes('/list.html')) {
        try { saveListSnapshot(); } catch {}
      }
      setTimeout(()=> location.href = href, animateMs);
    };

    if (dx <= -minDx || (dx < 0 && passVelocity)) {
      // 좌로 밀기: goLeftHref
      go(goLeftHref, 'slide-out-left');
    } else if (dx >= minDx || (dx > 0 && passVelocity)) {
      // 우로 밀기: goRightHref
      go(goRightHref, 'slide-out-right');
    }
  }

  // Pointer Events 우선
  if (window.PointerEvent){
    const onPointerDown = (e)=>{
      // 마우스 오른쪽/중간 버튼 제외
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointerId = e.pointerId ?? 'fallback';
      startCommon(e.clientX, e.clientY, e.target);
    };
    const onPointerMove = (e)=>{
      if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
      moveCommon(e.clientX, e.clientY);
    };
    const onPointerUp = (e)=>{
      if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
      endCommon(e.clientX, e.clientY);
      pointerId = null;
    };
    const onPointerCancel = ()=>{ tracking=false; pointerId=null; };

    document.addEventListener('pointerdown', onPointerDown, { passive:true });
    document.addEventListener('pointermove', onPointerMove,   { passive:true });
    document.addEventListener('pointerup',   onPointerUp,     { passive:true });
    document.addEventListener('pointercancel', onPointerCancel, { passive:true });
  } else {
    // Touch fallback
    const onStart = (e)=>{
      multiTouch = (e.touches && e.touches.length > 1);
      if (multiTouch) return;
      const t = e.touches?.[0]; if (!t) return;
      startCommon(t.clientX, t.clientY, t.target);
    };
    const onMove = (e)=>{
      if (multiTouch) return;
      const t = e.touches?.[0]; if (!t) return;
      moveCommon(t.clientX, t.clientY);
    };
    const onEnd = (e)=>{
      if (multiTouch) { multiTouch=false; return; }
      const t = e.changedTouches?.[0]; if (!t) return;
      endCommon(t.clientX, t.clientY);
    };

    document.addEventListener('touchstart', onStart, { passive:true });
    document.addEventListener('touchmove',  onMove,  { passive:true });
    document.addEventListener('touchend',   onEnd,   { passive:true });
  }

  // 애니메이션 스타일 주입 (한 번만)
  const styleId = 'swipe-anim-advanced';
  if (!document.getElementById(styleId)){
    const style = document.createElement('style');
    style.id = styleId;
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
  }
}

// index: 좌→우 = list, 우→좌 = upload (중앙 18% 데드존)
initSwipeNavHybrid({
  goLeftHref: '/upload.html',
  goRightHref: '/list.html',
  deadZoneCenterRatio: 0.18
});
