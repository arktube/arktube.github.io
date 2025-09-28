// /js/index.js — ArkTube Index (v 다시정비)
// - CATEGORY_MODEL 기반 카테고리 동적 렌더
// - 형식 토글(모두/쇼츠만/일반만) + localStorage 저장/복원
// - 카테고리 선택 + 전체선택(카테고리 전용, tri-state) + localStorage 저장/복원
// - 시리즈/일반 혼합 재생 방지
// - '영상보기' → (시리즈면 등록순, 그 외 최신순)으로 watch 이동
// - '영상목록'(드롭다운) → 동일 기준으로 list 이동
// - 시리즈 세부카테고리(series_*) 라벨 옆에 '이어보기' 항상 노출
// - 상단 인사 "Welcome!"
// - 강건성: DOM 안전 접근, 렌더 가드, 에러 시 경고

import { auth } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';
import { getAutoNext, setAutoNext, loadResume } from './resume.js';

// ---------- DOM 헬퍼 ----------
const $ = (sel) => document.querySelector(sel);

// 안전: 필수 루트 체크
const catsRoot = $('#cats');
const rbAll = $('#type_all');
const rbShorts = $('#type_shorts');
const rbVideo = $('#type_video');
const cbToggleAll = $('#cbToggleAll');
const btnWatch = $('#btnWatch');
const btnList = $('#btnList');
const btnHelp = $('#btnHelp');
const helpOverlay = $('#helpOverlay');
const dropdown = $('#dropdownMenu');
const menuBtn = $('#menuBtn');
const cbAuto = $('#cbAutoNext');
const welcomeEl = $('#welcome');

// ---------- 상단 인사 ----------
if (welcomeEl) welcomeEl.textContent = 'Welcome!';

// ---------- 메뉴 토글 ----------
if (menuBtn && dropdown) {
  menuBtn.addEventListener('click', () => {
    dropdown.classList.toggle('hidden');
    dropdown.classList.toggle('show');
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== menuBtn) {
      dropdown.classList.add('hidden');
      dropdown.classList.remove('show');
    }
  });
}

// ---------- 로컬스토리지 키 ----------
const LS = typeof localStorage !== 'undefined' ? localStorage : null;
const KEY_SELECTED_TYPE = 'selectedType';  // "all" | "shorts" | "video"
const KEY_SELECTED_CATS = 'selectedCats';  // ["group:sub", ...]

// ---------- 형식 토글 저장/복원 ----------
function currentType() {
  if (rbShorts?.checked) return 'shorts';
  if (rbVideo?.checked) return 'video';
  return 'all';
}
function loadSelectedType() {
  try { return LS.getItem(KEY_SELECTED_TYPE) || ''; } catch { return ''; }
}
function saveSelectedType(v) {
  try { LS.setItem(KEY_SELECTED_TYPE, v); } catch {}
}
function applySavedTypeOrDefault() {
  const v = loadSelectedType() || 'all';
  if (rbShorts) rbShorts.checked = (v === 'shorts');
  if (rbVideo)  rbVideo.checked  = (v === 'video');
  if (rbAll)    rbAll.checked    = (v !== 'shorts' && v !== 'video');
}
// 토글 클릭 시 저장
if ($('#typeToggle')) {
  $('#typeToggle').addEventListener('click', () => saveSelectedType(currentType()));
}
applySavedTypeOrDefault();

// ---------- 연속재생 토글 ----------
if (cbAuto) {
  cbAuto.checked = getAutoNext();
  cbAuto.addEventListener('change', () => setAutoNext(cbAuto.checked));
}

// ---------- CATEGORY_MODEL 강건성 검사 ----------
function ensureCategoryModelValid() {
  if (!Array.isArray(CATEGORY_MODEL) || CATEGORY_MODEL.length === 0) {
    console.warn('[Index] CATEGORY_MODEL 비어있음 또는 잘못된 형식');
    if (catsRoot) {
      catsRoot.innerHTML = '<div style="color:#f66; padding:8px;">카테고리 정보를 불러오지 못했습니다. categories.js를 확인해 주세요.</div>';
    }
    return false;
  }
  // group: {key, label, children:[{value, label}]}
  for (const g of CATEGORY_MODEL) {
    if (!g || typeof g !== 'object' || !g.key || !g.label || !Array.isArray(g.children)) {
      console.warn('[Index] CATEGORY_MODEL 그룹 형식 오류:', g);
      if (catsRoot) {
        catsRoot.innerHTML = '<div style="color:#f66; padding:8px;">카테고리 데이터 형식이 올바르지 않습니다.</div>';
      }
      return false;
    }
    for (const c of g.children) {
      if (!c || typeof c !== 'object' || !('value' in c) || !('label' in c)) {
        console.warn('[Index] CATEGORY_MODEL 하위 항목 형식 오류:', c);
        if (catsRoot) {
          catsRoot.innerHTML = '<div style="color:#f66; padding:8px;">카테고리 하위 항목 데이터 형식이 올바르지 않습니다.</div>';
        }
        return false;
      }
    }
  }
  return true;
}

// ---------- 카테고리 렌더 ----------
if (String(group.key).startsWith('series_')) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'resume-mini';
  btn.textContent = '이어보기';
  btn.addEventListener('click', () => handleResumePlay(group.key, child.value));
  label.appendChild(btn);
}

function renderCategories() {
  if (!catsRoot) return;
  catsRoot.innerHTML = '';
  if (!ensureCategoryModelValid()) return;

  for (const group of CATEGORY_MODEL) {
    const fs = document.createElement('fieldset');
    fs.className = 'group';

    const lg = document.createElement('legend');
    lg.textContent = group.label;
    fs.appendChild(lg);

    const grid = document.createElement('div');
    grid.className = 'child-grid';

    for (const child of group.children) {
      const id = `cat_${group.key}_${child.value}`;
      const label = document.createElement('label');
      label.setAttribute('for', id);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.value = child.value;
      cb.dataset.group = group.key;

      const span = document.createElement('span');
      span.textContent = child.label;

      label.prepend(cb, span);

      grid.appendChild(label);
    }

    fs.appendChild(grid);
    catsRoot.appendChild(fs);
  }

  // 저장된 선택 복원 + 전체선택 상태 동기화
  applySavedCatsOrDefault();
  syncToggleAllVisual();

  // 변화 이벤트 연결(중복 연결 방지 위해 위에서 한 번만 attach)
  catsRoot.addEventListener('change', onCatsChanged);
}

function onCatsChanged() {
  saveSelectedCats(getSelectedCatTokens());
  syncToggleAllVisual();
}

// ---------- 카테고리 저장/복원 ----------
function getSelected() {
  if (!catsRoot) return [];
  const checked = [...catsRoot.querySelectorAll('input[type=checkbox]:checked')];
  return checked.map(i => ({ groupKey: i.dataset.group, subKey: i.value }));
}
function getSelectedCatTokens() {
  if (!catsRoot) return [];
  const checked = [...catsRoot.querySelectorAll('input[type=checkbox]:checked')];
  return checked.map(i => `${i.dataset.group}:${i.value}`);
}
function loadSelectedCats() {
  try {
    const raw = LS.getItem(KEY_SELECTED_CATS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveSelectedCats(tokens) {
  try { LS.setItem(KEY_SELECTED_CATS, JSON.stringify(tokens || [])); } catch {}
}
function applySavedCatsOrDefault() {
  const tokens = loadSelectedCats();
  if (!tokens.length) return; // 기본: 모두 해제
  const set = new Set(tokens);
  const inputs = catsRoot.querySelectorAll('input[type=checkbox]');
  inputs.forEach(cb => {
    const token = `${cb.dataset.group}:${cb.value}`;
    cb.checked = set.has(token);
  });
}

// ---------- 전체선택 ----------
function syncToggleAllVisual() {
  if (!catsRoot || !cbToggleAll) return;
  const inputs = [...catsRoot.querySelectorAll('input[type=checkbox]')];
  const all = inputs.length;
  const checked = inputs.filter(i => i.checked).length;
  cbToggleAll.indeterminate = checked > 0 && checked < all;
  cbToggleAll.checked = checked === all;
}
if (cbToggleAll && catsRoot) {
  cbToggleAll.addEventListener('change', () => {
    const inputs = catsRoot.querySelectorAll('input[type=checkbox]');
    inputs.forEach(i => { i.checked = cbToggleAll.checked; });
    saveSelectedCats(getSelectedCatTokens());
    syncToggleAllVisual();
  });
}

// ---------- 혼합 재생 방지 ----------
function containsSeries(cats) { return cats.some(c => isSeriesValue(c.subKey)); }
function containsNonSeries(cats) { return cats.some(c => !isSeriesValue(c.subKey)); }
function validateSelectionForPlay(cats) {
  if (cats.length === 0) { alert('카테고리를 하나 이상 선택해 주세요.'); return false; }
  if (containsSeries(cats) && containsNonSeries(cats)) {
    alert('시리즈와 일반/개인자료는 혼합 재생할 수 없습니다.\n시리즈만 또는 일반/개인만 선택해 주세요.');
    return false;
  }
  return true;
}

// ---------- 이어보기 ----------
function handleResumePlay(groupKey, subKey) {
  const type = currentType();
  const sort = 'createdAt-asc'; // 시리즈 기본
  const r = loadResume({ type, groupKey, subKey });

  const url = new URL('/watch.html', location.origin);
  url.searchParams.set('from', 'index');
  url.searchParams.set('type', type);
  url.searchParams.set('cats', `${groupKey}:${subKey}`);
  url.searchParams.set('sort', r?.sort || sort);
  if (r?.index != null) url.searchParams.set('resumeIndex', String(r.index));
  if (r?.t != null) url.searchParams.set('resumeT', String(Math.floor(r.t)));
  location.href = url.toString();
}

// ---------- 영상보기 ----------
if (btnWatch) {
  btnWatch.addEventListener('click', () => {
    const cats = getSelected();
    if (!validateSelectionForPlay(cats)) return;

    const type = currentType();
    const allSeries = cats.every(c => isSeriesValue(c.subKey));
    const sort = allSeries ? 'createdAt-asc' : 'createdAt-desc';

    // 현재 상태 저장
    saveSelectedType(type);
    saveSelectedCats(getSelectedCatTokens());

    const url = new URL('/watch.html', location.origin);
    url.searchParams.set('from', 'index');
    url.searchParams.set('type', type);
    url.searchParams.set('cats', cats.map(c => `${c.groupKey}:${c.subKey}`).join(','));
    url.searchParams.set('sort', sort);
    location.href = url.toString();
  });
}

// ---------- 영상목록(드롭다운) ----------
if (btnList) {
  btnList.addEventListener('click', () => {
    const cats = getSelected();
    if (cats.length === 0) { alert('목록을 보려면 카테고리를 선택해 주세요.'); return; }

    const type = currentType();
    const allSeries = cats.every(c => isSeriesValue(c.subKey));
    const sort = allSeries ? 'createdAt-asc' : 'createdAt-desc';

    // 현재 상태 저장
    saveSelectedType(type);
    saveSelectedCats(getSelectedCatTokens());

    const url = new URL('/list.html', location.origin);
    url.searchParams.set('type', type);
    url.searchParams.set('cats', cats.map(c => `${c.groupKey}:${c.subKey}`).join(','));
    url.searchParams.set('sort', sort);
    location.href = url.toString();
  });
}

// ---------- 도움말 ----------
if (btnHelp && helpOverlay) {
  btnHelp.addEventListener('click', () => helpOverlay.classList.add('show'));
  helpOverlay.addEventListener('click', (e) => {
    if (e.target.id === 'helpOverlay') helpOverlay.classList.remove('show');
  });
}

// ---------- 최초 렌더 ----------
renderCategories();
