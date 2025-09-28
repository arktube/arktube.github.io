// /js/index.js  (ArkTube Index — CATEGORY_MODEL only, series resume, 15% deadzone)
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
const nickWrap     = document.getElementById('nickWrap');
const btnSignOut   = document.getElementById('btnSignOut');
const btnGoUpload  = document.getElementById('btnGoUpload');
const btnMyUploads = document.getElementById('btnMyUploads');
const btnAbout     = document.getElementById('btnAbout');
const btnOrder     = document.getElementById('btnOrder');
const btnList      = document.getElementById('btnList');
const brandHome    = document.getElementById('brandHome');

let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown.classList.remove('hidden'); requestAnimationFrame(()=> dropdown.classList.add('show')); }
function closeDropdown(){ isMenuOpen=false; dropdown.classList.remove('show'); setTimeout(()=> dropdown.classList.add('hidden'),180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  nickWrap?.classList.toggle('hidden', !loggedIn);
});

document.addEventListener('click', (e)=>{
  const t = e.target;
  if (t.closest('#btnDropdown')) {
    if (isMenuOpen) closeDropdown(); else openDropdown();
  } else if (!t.closest('#dropdownMenu')) {
    if (isMenuOpen) closeDropdown();
  }
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
btnList?.addEventListener('click', ()=> {
  // index → list 이동 시 현재 선택/형식/연속재생 상태 스냅샷 저장
  const cats = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const type = document.querySelector('#typeToggle input:checked')?.value || 'all';
  const auto = document.getElementById('cbAutoNext')?.checked ? 1 : 0;
  try{
    sessionStorage.setItem(LIST_SNAPSHOT_KEY, JSON.stringify({ cats, type, auto }));
  }catch{}
  location.href='/list.html';
});

/* ========= CTA/토글/렌더 ========= */
const catsBox      = document.getElementById('cats');
const cbToggleAll  = document.getElementById('cbToggleAll');
const btnWatch     = document.getElementById('btnWatch');
const btnOpenOrder = document.getElementById('btnOpenOrder');
const cbAutoNext   = document.getElementById('cbAutoNext');

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
      // resume 키 포맷: resume:{groupKey}:{subKey}  → resume.js는 내부 prefix를 더해 저장
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
    const isSeries = isSeriesGroup(groupKey);
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
  const typeWrap = document.getElementById('typeToggle');
  if (typeWrap){
    const savedType = localStorage.getItem(VIEW_TYPE_KEY) || 'all';
    const r = typeWrap.querySelector(`input[value="${savedType}"]`) || typeWrap.querySelector('input[value="all"]');
    if (r) r.checked = true;
  }

  // 연속재생 복원
  const vv = (localStorage.getItem(AUTONEXT_KEY) || '').toLowerCase();
  if (cbAutoNext) cbAutoNext.checked = (vv==='1' || vv==='true' || vv==='on');
}

cbToggleAll?.addEventListener('change', ()=> selectAll(cbToggleAll.checked));
btnOpenOrder?.addEventListener('click', ()=> location.href='/category-order.html');

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

/* ========= 스와이프 내비 (중앙 15% 데드존) ========= */
/* ========= 스와이프 내비 (고급형, 중앙 18% 데드존) ========= */
window.__swipeNavigating = window.__swipeNavigating || false;

function initSwipeNavAdvanced({
  goLeftHref = null,   // 좌로 미는 제스처(→) 결과: 왼쪽으로 슬라이드 아웃 후 이동
  goRightHref = null,  // 우로 미는 제스처(←) 결과
  animateMs = 260,
  deadZoneCenterRatio = 0.18,   // 중앙 데드존 18%
  intentDx = 12,                // 가로 의도 임계값
  cancelDy = 10,                // 세로 의도 취소 임계값(의도 확정 전)
  maxDy = 90,                   // 전체 세로 허용치
  maxMs = 700,                  // 최대 제스처 시간
  minDx = 70,                   // 최소 거리 트리거
  minVx = 0.6                   // 최소 속도(px/ms) 트리거
} = {}) {
  let sx=0, sy=0, t0=0, tracking=false, horizontalIntent=false, multiTouch=false;
  let lastX=0, lastT=0;

  const getPt = (e) => e.touches?.[0] || e.changedTouches?.[0] || e;

  function isInteractiveEl(el){
    return !!el.closest('button, a, [role="button"], input, select, textarea, label, .no-swipe');
  }

  function onStart(e){
    if (window.__swipeNavigating) return;
    multiTouch = (e.touches && e.touches.length > 1);
    if (multiTouch) return;

    const p = getPt(e); if(!p) return;
    if (isInteractiveEl(p.target)) return;

    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
    const L  = vw * (0.5 - dz/2);
    const R  = vw * (0.5 + dz/2);
    if (p.clientX >= L && p.clientX <= R) return; // 중앙 데드존

    sx = lastX = p.clientX; sy = p.clientY; t0 = lastT = performance.now();
    tracking = true; horizontalIntent = false;
  }

  function onMove(e){
    if (!tracking || multiTouch) return;
    const p = getPt(e); if(!p) return;

    const dx = p.clientX - sx;
    const dy = p.clientY - sy;
    const dt = performance.now() - t0;

    // 의도 확정 전: 세로가 먼저 커지면 스크롤 의도로 보고 취소
    if (!horizontalIntent){
      if (Math.abs(dy) > cancelDy) { tracking=false; return; }
      if (Math.abs(dx) >= intentDx) horizontalIntent = true;
    } else {
      // 의도 확정 후: 과도한 세로 흔들림이면 취소
      if (Math.abs(dy) > maxDy) { tracking=false; return; }
    }

    // 핀치/멀티 방지
    if (e.touches && e.touches.length > 1){ tracking=false; return; }

    lastX = p.clientX; lastT = performance.now();
  }

  function onEnd(e){
    if (!tracking || multiTouch) return;
    tracking = false;

    const p = getPt(e); if(!p) return;
    const dx = p.clientX - sx;
    const dy = p.clientY - sy;
    const t1 = performance.now();
    const dt = t1 - t0;

    if (!horizontalIntent) return;
    if (Math.abs(dy) > maxDy) return;
    if (dt > maxMs) return;

    const vx = Math.abs(dx) / Math.max(1, dt); // px/ms

    const passDistance = Math.abs(dx) >= minDx;
    const passVelocity = vx >= minVx;

    if (!(passDistance || passVelocity)) return;
    if (window.__swipeNavigating) return;

    // 방향 판정
    if (dx <= -minDx || (dx < 0 && vx >= minVx)) {
      // 왼쪽으로 밀기(→) = goLeftHref
      if (!goLeftHref) return;
      window.__swipeNavigating = true;
      document.documentElement.classList.add('slide-out-left');
      setTimeout(()=> location.href = goLeftHref, animateMs);
    } else if (dx >= minDx || (dx > 0 && vx >= minVx)) {
      // 오른쪽으로 밀기(←) = goRightHref
      if (!goRightHref) return;
      window.__swipeNavigating = true;
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href = goRightHref, animateMs);
    }
  }

  // 수동 스크롤과 충돌 최소화: passive=true
  document.addEventListener('touchstart', onStart, { passive:true });
  document.addEventListener('touchmove',  onMove,  { passive:true });
  document.addEventListener('touchend',   onEnd,   { passive:true });

  // 애니메이션 스타일 주입
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
initSwipeNavAdvanced({
  goLeftHref: '/upload.html',
  goRightHref: '/list.html',
  deadZoneCenterRatio: 0.18
});

