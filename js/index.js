// /js/index.js — ArkTube index (카테고리 선택 + Watch/List로 이동 + series 이어보기)
// 요구조건 반영:
// - CATEGORY_MODEL 단일 소스
// - 형식 토글: 모두/쇼츠만/일반만 (기본: 모두)
// - 전체선택 체크는 "카테고리" 전체 선택과만 연동 (type과 분리)
// - 혼합재생 불가(시리즈와 일반/개인 혼합 시 차단)
// - '영상보기' → (시리즈면 등록순, 그 외 최신순) 기본 정렬로 watch 이동
// - 드롭다운 '영상목록' 클릭 시 현재 선택/형식 상태를 들고 list로 이동
// - 시리즈 세부카테고리 라벨 옆에 '이어보기' 항상 표시 (없으면 처음부터)

import { auth } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';
import { getAutoNext, setAutoNext, loadResume } from './resume.js';

// ---------- 상단바 환영 문구 ----------
const welcomeEl = document.querySelector('#welcome');
if (welcomeEl) welcomeEl.textContent = 'Welcome!';

// ---------- 로그인/메뉴(공통 최소) ----------
const menuBtn = document.querySelector('#menuBtn');
const dropdown = document.querySelector('#dropdownMenu');
menuBtn?.addEventListener('click', () => {
  dropdown?.classList.toggle('hidden');
  dropdown?.classList.toggle('show');
});
document.addEventListener('click', (e) => {
  if (!dropdown) return;
  if (!dropdown.contains(e.target) && e.target !== menuBtn) {
    dropdown.classList.add('hidden'); dropdown.classList.remove('show');
  }
});

// ---------- 형식 토글 (기본 모두 ON) ----------
const typeToggle = document.getElementById('typeToggle');
const rbAll = document.getElementById('type_all');
const rbShorts = document.getElementById('type_shorts');
const rbVideo = document.getElementById('type_video');
rbAll.checked = true;

function currentType() {
  if (rbShorts.checked) return 'shorts';
  if (rbVideo.checked) return 'video';
  return 'all';
}

// ---------- 연속재생 토글 (index에만 있음) ----------
const cbAuto = document.getElementById('cbAutoNext');
cbAuto.checked = getAutoNext();
cbAuto.addEventListener('change', () => setAutoNext(cbAuto.checked));

// ---------- 카테고리 렌더 ----------
const catsRoot = document.getElementById('cats');
const cbToggleAll = document.getElementById('cbToggleAll');

function isSeriesValue(v) { return String(v).startsWith('series_'); }

function renderCategories() {
  catsRoot.innerHTML = '';
  CATEGORY_MODEL.forEach(group => {
    const fs = document.createElement('fieldset');
    fs.className = 'group';
    const lg = document.createElement('legend');
    lg.textContent = group.label;
    fs.appendChild(lg);

    const grid = document.createElement('div');
    grid.className = 'child-grid';

    group.children.forEach(child => {
      const id = `cat_${group.key}_${child.value}`;
      const label = document.createElement('label');
      label.setAttribute('for', id);

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.value = child.value;
      cb.dataset.group = group.key;
      cb.checked = false; // 기본 미선택 (유저가 선택해서 진행)

      const span = document.createElement('span');
      span.textContent = child.label;

      label.prepend(cb, span);

      // series 이어보기 버튼 (항상 노출)
      if (isSeriesValue(child.value)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'resume-mini';
        btn.textContent = '이어보기';
        btn.addEventListener('click', () => handleResumePlay(group.key, child.value));
        label.appendChild(btn);
      }

      grid.appendChild(label);
    });

    fs.appendChild(grid);
    catsRoot.appendChild(fs);
  });
}
renderCategories();

// 전체선택: 카테고리 전체 선택/해제 (type과 무관)
cbToggleAll.addEventListener('change', () => {
  const inputs = catsRoot.querySelectorAll('input[type=checkbox]');
  inputs.forEach(i => { i.checked = cbToggleAll.checked; });
});

// 카테고리 변경 시 전체선택 상태 업데이트
catsRoot.addEventListener('change', () => {
  const inputs = [...catsRoot.querySelectorAll('input[type=checkbox]')];
  const all = inputs.length;
  const checked = inputs.filter(i => i.checked).length;
  cbToggleAll.indeterminate = checked > 0 && checked < all;
  cbToggleAll.checked = checked === all;
});

// ---------- 현재 선택 수집 ----------
function getSelected() {
  const checked = [...catsRoot.querySelectorAll('input[type=checkbox]:checked')];
  const cats = checked.map(i => ({ groupKey: i.dataset.group, subKey: i.value }));
  return cats;
}
function containsSeries(cats) { return cats.some(c => isSeriesValue(c.subKey)); }
function containsNonSeries(cats) { return cats.some(c => !isSeriesValue(c.subKey)); }

// ---------- 혼합재생 방지 ----------
function validateSelectionForPlay(cats) {
  if (cats.length === 0) { alert('카테고리를 하나 이상 선택해 주세요.'); return false; }
  if (containsSeries(cats) && containsNonSeries(cats)) {
    alert('시리즈와 일반/개인자료는 혼합 재생할 수 없습니다.\n시리즈만 또는 일반/개인만 선택해 주세요.');
    return false;
  }
  return true;
}

// ---------- 이어보기 처리 ----------
function handleResumePlay(groupKey, subKey) {
  const type = currentType(); // 사용자가 type을 어떤 걸로 두었든 그대로
  // 기본 정렬: 시리즈는 등록순
  const sort = 'createdAt-asc';
  // 로컬에 저장된 위치 확인
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

// ---------- '영상보기' 버튼 ----------
document.getElementById('btnWatch').addEventListener('click', () => {
  const cats = getSelected();
  if (!validateSelectionForPlay(cats)) return;

  const type = currentType();
  // 기본 정렬: 시리즈면 등록순, 그 외 최신순
  const allSeries = cats.every(c => isSeriesValue(c.subKey));
  const sort = allSeries ? 'createdAt-asc' : 'createdAt-desc';

  const url = new URL('/watch.html', location.origin);
  url.searchParams.set('from', 'index');
  url.searchParams.set('type', type);
  url.searchParams.set('cats', cats.map(c => `${c.groupKey}:${c.subKey}`).join(','));
  url.searchParams.set('sort', sort);
  location.href = url.toString();
});

// ---------- 드롭다운 '영상목록'은 현재 선택/형식 들고 list로 ----------
document.getElementById('btnList')?.addEventListener('click', () => {
  const cats = getSelected();
  if (cats.length === 0) { alert('목록을 보려면 카테고리를 선택해 주세요.'); return; }
  // 시리즈/일반 혼합 목록은 허용(시청만 제한) — 명시 없으므로 목록은 허용
  const allSeries = cats.every(c => isSeriesValue(c.subKey));
  const sort = allSeries ? 'createdAt-asc' : 'createdAt-desc';

  const url = new URL('/list.html', location.origin);
  url.searchParams.set('type', currentType());
  url.searchParams.set('cats', cats.map(c => `${c.groupKey}:${c.subKey}`).join(','));
  url.searchParams.set('sort', sort); // list 기본 정렬
  location.href = url.toString();
});

// ---------- 도움말/헤더 홈 ----------
document.getElementById('btnHelp')?.addEventListener('click', () => {
  document.getElementById('helpOverlay')?.classList.add('show');
});
document.getElementById('helpOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'helpOverlay') e.currentTarget.classList.remove('show');
});
document.getElementById('brandHome')?.addEventListener('click', (e) => {
  e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' });
});
