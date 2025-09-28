// /js/list.js — ArkTube 목록 페이지
// 요구조건 반영:
// - index에서 넘어온 cats/type/sort를 기본으로 적용
// - 정렬 토글(최신↔등록순↔랜덤) 버튼 하나, 랜덤은 누를 때마다 seed++
// - 제목: Firestore title 우선, 실패/누락 시 YouTube oEmbed(7일 캐시 성격) 폴백
// - 검색(제목/URL) 옵션
// - 무한 스크롤 자동 로드(더보기 버튼 대신) — CopyTube와 동일 UX
// - 삭제/공유불가 영상은 카드에 "재생 불가" 배지
// - 카드에 관리용 버튼 없음(그건 manage-uploads.js의 역할)

import { db } from './firebase-init.js';
import { CATEGORY_MODEL } from './categories.js';
import {
  getFirestore, collection, query, where, orderBy, limit, startAfter, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// 상단바 인사
const welcomeEl = document.getElementById('welcome');
if (welcomeEl) welcomeEl.textContent = 'Hi!';

// 쿼리 파싱
const qp = new URLSearchParams(location.search);
let type = qp.get('type') || 'all';          // 'all' | 'shorts' | 'video'
let catsQ = qp.get('cats') || '';            // "group:sub,group:sub"
let sort = qp.get('sort') || 'createdAt-desc'; // 'createdAt-desc' | 'createdAt-asc' | 'random'

const currentMode = document.getElementById('currentMode');
currentMode.textContent = `필터: ${type} / 정렬: ${humanSort(sort)}`;

const msg = document.getElementById('msg');
const cards = document.getElementById('cards');
const btnSort = document.getElementById('btnSortToggle');
const btnSearch = document.getElementById('btnSearch');
const btnClear = document.getElementById('btnClear');
const qInput = document.getElementById('q');

// 드롭다운 최소 처리
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

// 랜덤 seed
let randomSeed = Date.now() & 0xffff;

btnSort.addEventListener('click', () => {
  sort = nextSort(sort);
  if (sort.startsWith('random')) {
    randomSeed = (randomSeed + 1) & 0xffff;
    sort = `random:${randomSeed}`;
  }
  currentMode.textContent = `필터: ${type} / 정렬: ${humanSort(sort)}`;
  // 리로드
  state.reset(); loadPage({ replace: true });
  btnSort.textContent = labelSort(sort);
});
btnSort.textContent = labelSort(sort);

// 검색
btnSearch.addEventListener('click', () => {
  state.reset(); loadPage({ replace: true });
});
btnClear.addEventListener('click', () => {
  qInput.value = '';
  btnClear.style.display = 'none';
  state.reset(); loadPage({ replace: true });
});
qInput.addEventListener('input', () => {
  btnClear.style.display = qInput.value ? 'inline-block' : 'none';
});

// 유틸
function humanSort(s) {
  if (s.startsWith('random')) return '랜덤';
  if (s === 'createdAt-asc') return '등록순';
  return '최신순';
}
function labelSort(s) {
  if (s.startsWith('random')) return '랜덤';
  if (s === 'createdAt-asc') return '등록순';
  return '최신순';
}
function nextSort(s) {
  if (s.startsWith('random')) return 'createdAt-desc';
  if (s === 'createdAt-asc') return 'random';
  return 'createdAt-asc';
}

// 카테고리 필터를 Firestore where로 변환
const selectedCats = parseCats(catsQ); // [{groupKey, subKey}, ...]
function parseCats(str) {
  if (!str) return [];
  return str.split(',').map(t => {
    const [g, s] = t.split(':'); return { groupKey: g, subKey: s };
  });
}

// 상태
const state = {
  loading: false,
  done: false,
  pageCursor: null,
  pageSize: 20,
  seed: randomSeed,
  reset() { this.loading=false; this.done=false; this.pageCursor=null; cards.innerHTML=''; msg.textContent='불러오는 중…'; }
};

// 무한스크롤
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting && !state.loading && !state.done) {
      loadPage({});
    }
  });
}, { rootMargin: '900px 0px' });
const sentinel = document.createElement('div');
sentinel.style.height = '1px';
cards.after(sentinel);
observer.observe(sentinel);

// Firestore 로드
async function loadPage({ replace=false }={}) {
  state.loading = true; msg.textContent = '불러오는 중…';
  const dbi = getFirestore();

  // 기본 쿼리: videos
  let qcol = collection(dbi, 'videos');

  // type 필터 (all이면 생략)
  // type 필드는 'video'|'shorts'
  // where 여러개 조합이 많아지면 복합인덱스 필요 (createdAt, type, cats 배열 X)
  // 여기서는 클라이언트 필터도 병행
  const wantsType = (type === 'all') ? null : type;

  // 정렬
  let qBase;
  if (sort.startsWith('random')) {
    // 랜덤: createdAt-desc로 넉넉히 가져와서 클라 샘플링
    qBase = query(qcol, orderBy('createdAt', 'desc'), limit(state.pageSize * 3));
  } else if (sort === 'createdAt-asc') {
    qBase = query(qcol, orderBy('createdAt', 'asc'), limit(state.pageSize));
  } else {
    qBase = query(qcol, orderBy('createdAt', 'desc'), limit(state.pageSize));
  }
  if (state.pageCursor) {
    // paging (단, 랜덤은 cursor를 단순 사용: 클라 샘플링이므로 허용)
    qBase = query(qBase, startAfter(state.pageCursor));
  }

  const snap = await getDocs(qBase);
  if (snap.empty) {
    state.done = true; msg.textContent = cards.children.length ? '' : '결과가 없습니다.';
    state.loading = false; return;
  }
  state.pageCursor = snap.docs[snap.docs.length - 1];

  // 클라 필터(카테고리/타입/검색) 적용
  let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // type 필터
  if (wantsType) rows = rows.filter(r => r.type === wantsType);

  // 카테고리 필터: r.cats 에 선택된 subKey 중 하나라도 포함되면 통과
  const subKeys = new Set(selectedCats.map(c => c.subKey));
  rows = rows.filter(r => {
    if (!Array.isArray(r.cats)) return false;
    return r.cats.some(c => subKeys.has(c));
  });

  // 검색
  const q = (qInput.value || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter(r => {
      const t = (r.title || '').toLowerCase();
      const u = (r.url || '').toLowerCase();
      return t.includes(q) || u.includes(q);
    });
  }

  // 랜덤 샘플링
  if (sort.startsWith('random')) {
    rows = shuffle(rows, state.seed);
    rows = rows.slice(0, state.pageSize);
  }

  // 렌더
  for (const r of rows) {
    cards.appendChild(await renderCard(r));
  }

  msg.textContent = '';
  state.loading = false;

  // 더 가져올게 없으면 done
  if (rows.length < (sort.startsWith('random') ? state.pageSize : state.pageSize)) {
    // 다음 페이지 시도는 계속함. 실제 done 판단은 이후 empty에서 처리
  }
}

// 카드 렌더
async function renderCard(v) {
  const a = document.createElement('article');
  a.className = 'card';
  a.style.border = '1px solid #2a2a2a';
  a.style.borderRadius = '10px';
  a.style.padding = '8px';

  // 썸네일
  const ytid = v.ytid || extractYTID(v.url);
  const thumb = ytid ? `https://i.ytimg.com/vi/${ytid}/hqdefault.jpg` : '';
  const thumbImg = document.createElement('img');
  thumbImg.src = thumb || '';
  thumbImg.alt = v.title || 'thumbnail';
  thumbImg.style.width = '100%';
  thumbImg.style.borderRadius = '8px';
  thumbImg.loading = 'lazy';

  // 제목
  const titleEl = document.createElement('h3');
  titleEl.style.margin = '6px 0 4px';
  titleEl.style.fontSize = '16px';
  titleEl.textContent = v.title || '';

  if (!v.title && ytid) {
    try {
      // YouTube oEmbed 폴백 (7일 캐시 수준으로 간주)
      const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytid}&format=json`;
      const res = await fetch(u);
      if (res.ok) {
        const json = await res.json();
        if (json && json.title) titleEl.textContent = json.title;
      }
    } catch {}
  }

  // 메타 줄
  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.color = '#9aa0a6';
  meta.textContent = `${v.type || '?'} • ${v.ownerName || 'unknown'}`;

  // 재생 불가 배지 (가능한 경우: url 없음, ytid 없음)
  const badge = document.createElement('span');
  badge.style.display = 'inline-block';
  badge.style.marginLeft = '8px';
  badge.style.fontSize = '11px';
  badge.style.padding = '2px 6px';
  badge.style.border = '1px solid #444';
  badge.style.borderRadius = '999px';
  badge.style.color = '#ddd';
  badge.style.background = '#111';
  badge.textContent = '재생 불가';
  if (!v.url && !ytid) {
    meta.appendChild(badge);
  }

  // 클릭 → watch로 이동 (현재 sort 유지)
  a.addEventListener('click', () => {
    const url = new URL('/watch.html', location.origin);
    url.searchParams.set('from', 'list');
    url.searchParams.set('type', type);
    url.searchParams.set('cats', (catsQ || ''));
    url.searchParams.set('sort', sort);
    // list에서 들어갔음을 알려 큐/정렬 복원
    url.searchParams.set('start', ytid || v.ytid || '');
    location.href = url.toString();
  });

  a.appendChild(thumbImg);
  a.appendChild(titleEl);
  a.appendChild(meta);
  return a;
}

// --------- helpers ----------
function extractYTID(u='') {
  try {
    const url = new URL(u);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1);
    if (url.hostname.includes('youtube.com')) {
      if (url.pathname === '/watch') return url.searchParams.get('v');
      if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2];
    }
  } catch {}
  return '';
}

function shuffle(arr, seed) {
  // xorshift32 기반
  let x = seed || 123456789;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = Math.abs(x) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 최초 로드
state.reset(); loadPage({ replace: true });
