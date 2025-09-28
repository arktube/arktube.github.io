// /js/watch.js — ArkTube 시청 페이지(세로 스냅, 위/아래 스와이프, 연속재생 큐, 에러시 2초 후 다음)
// 요구조건 반영:
// - from=list → 뒤로가기 list, 그 외 index
// - 좌우 스와이프 없음 / 세로 스냅만
// - 연속재생은 index의 토글 상태만 따름
// - 시리즈/일반 모두 "현재 필터/정렬로 만든 큐"를 따라감
// - 시리즈 resume: resume.js 저장 스펙대로 index(몇번째) + t(sec) 10초마다 저장
// - 공유불가/삭제 등 onError/onStateChange 오류 감지 시 2초 안내 후 자동 다음

import { db } from './firebase-init.js';
import { CATEGORY_MODEL } from './categories.js';
import { getAutoNext, saveResume, loadResume } from './resume.js';
import {
  getFirestore, collection, query, where, orderBy, limit, startAfter, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const welcomeEl = document.getElementById('welcome');
if (welcomeEl) welcomeEl.textContent = 'Enjoy!';

const container = document.getElementById('videoContainer');

// 쿼리 파라미터
const qp = new URLSearchParams(location.search);
const from = qp.get('from') || '';
const type = qp.get('type') || 'all';
const catsQ = qp.get('cats') || ''; // group:sub,...
let sort = qp.get('sort') || 'createdAt-desc'; // 기본값은 index/list에서 넘어옴
const startYtid = qp.get('start') || '';
const resumeIndexParam = qp.get('resumeIndex');
const resumeTParam = qp.get('resumeT');

// 뒤로가기 라우팅
document.getElementById('brandHome')?.addEventListener('click', (e) => {
  e.preventDefault();
  if (from === 'list') history.back();
  else location.href = '/index.html';
});

// 큐 빌드(필터+정렬)
// - 정렬: createdAt-desc / createdAt-asc / random:SEED
// - type: all | shorts | video
const selectedCats = parseCats(catsQ);
function parseCats(str) {
  if (!str) return [];
  return str.split(',').map(t => {
    const [g, s] = t.split(':'); return { groupKey: g, subKey: s };
  });
}
function isSeriesValue(v) { return String(v).startsWith('series_'); }

let queue = []; // { ytid, url, title, type, cats, createdAt, ... }
let indexNow = 0;
let playerObjs = []; // YouTube Player refs

// Firestore 로드 전체(최대 몇 페이지까지 준비하고 필요 시 계속 뒤에 이어 붙임)
const state = { loading:false, done:false, cursor:null, pageSize:30, seed: Date.now() & 0xffff };

async function buildInitialQueue() {
  await loadMore(); // 최소 한 페이지
  if (startYtid) {
    const i = queue.findIndex(v => v.ytid === startYtid);
    if (i >= 0) indexNow = i;
  } else if (resumeIndexParam != null) {
    const ri = parseInt(resumeIndexParam, 10);
    if (!Number.isNaN(ri) && ri >= 0 && ri < queue.length) indexNow = ri;
  }
  renderAll();
  if (resumeTParam != null) {
    const t = parseInt(resumeTParam, 10);
    if (!Number.isNaN(t)) trySeekActive(t);
  }
}

async function loadMore() {
  if (state.loading || state.done) return;
  state.loading = true;

  const dbi = getFirestore();
  let qcol = collection(dbi, 'videos');

  // 정렬
  let qBase;
  if (String(sort).startsWith('random')) {
    qBase = query(qcol, orderBy('createdAt', 'desc'), limit(state.pageSize * 3));
  } else if (sort === 'createdAt-asc') {
    qBase = query(qcol, orderBy('createdAt', 'asc'), limit(state.pageSize));
  } else {
    qBase = query(qcol, orderBy('createdAt', 'desc'), limit(state.pageSize));
  }
  if (state.cursor) qBase = query(qBase, startAfter(state.cursor));

  const snap = await getDocs(qBase);
  if (snap.empty) { state.done = true; state.loading=false; return; }
  state.cursor = snap.docs[snap.docs.length - 1];

  let rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));

  // type 필터
  if (type !== 'all') rows = rows.filter(r => r.type === type);

  // cats 필터
  const subKeys = new Set(selectedCats.map(c => c.subKey));
  rows = rows.filter(r => Array.isArray(r.cats) && r.cats.some(c => subKeys.has(c)));

  // 랜덤
  if (String(sort).startsWith('random')) {
    rows = shuffle(rows, state.seed);
    rows = rows.slice(0, state.pageSize);
  }

  // append
  queue.push(...rows);
  state.loading = false;
}

// 세로 스냅 렌더
function renderAll() {
  container.innerHTML = '';
  playerObjs = [];

  queue.forEach((v, i) => {
    const sec = document.createElement('section');
    sec.className = 'video';
    sec.dataset.index = String(i);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    // iframe 준비: enablejsapi=1
    const ytid = v.ytid || extractYTID(v.url);
    const iframe = document.createElement('iframe');
    iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    iframe.src = ytid
      ? `https://www.youtube.com/embed/${ytid}?enablejsapi=1&playsinline=1&autoplay=0&rel=0&modestbranding=1`
      : '';
    iframe.addEventListener('error', () => markAndSkipOnError(i, '재생 에러'));

    // 플레이 힌트/뮤트 안내
    const hint = document.createElement('div');
    hint.className = 'playhint';
    hint.textContent = '탭하여 재생';

    const muteTip = document.createElement('div');
    muteTip.className = 'mute-tip';
    muteTip.textContent = '음소거 해제 후 시청하세요';

    sec.appendChild(thumb);
    sec.appendChild(iframe);
    sec.appendChild(hint);
    sec.appendChild(muteTip);
    container.appendChild(sec);
  });

  // 해당 index로 스크롤
  scrollToIndex(indexNow, { behavior: 'instant' });

  // YouTube API attach
  attachPlayers();
}

// 유튜브 API
let YTReady = false;
function attachPlayers() {
  if (window.YT && window.YT.Player) {
    YTReady = true;
    createAll();
  } else {
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onload = () => {};
    document.head.appendChild(s);
    window.onYouTubeIframeAPIReady = () => { YTReady = true; createAll(); };
  }

  function createAll() {
    const iframes = container.querySelectorAll('iframe');
    iframes.forEach((ifr, i) => {
      if (!ifr.src) return;
      const p = new YT.Player(ifr, {
        events: {
          onReady: (e) => {
            // resume seek?
            if (i === indexNow && resumeTParam != null) {
              const t = parseInt(resumeTParam, 10);
              if (!Number.isNaN(t)) trySeek(i, t);
            }
          },
          onStateChange: (e) => {
            const st = e.data;
            if (st === YT.PlayerState.ENDED) {
              if (getAutoNext()) goNext();
            }
          },
          onError: (e) => {
            markAndSkipOnError(i, errorTextFromCode(e.data));
          }
        }
      });
      playerObjs[i] = p;
    });
  }
}

// 에러 텍스트
function errorTextFromCode(code) {
  // 150/101: 재생 불가(임베드 차단), 100: 삭제/비공개
  if (code === 150 || code === 101) return '공유 불가 영상입니다.';
  if (code === 100) return '삭제되었거나 비공개 영상입니다.';
  return '재생 중 오류가 발생했습니다.';
}

// 에러 시 2초 안내 후 다음
function markAndSkipOnError(i, text) {
  const sec = container.querySelector(`.video[data-index="${i}"]`);
  if (!sec) return;
  const tip = document.createElement('div');
  tip.className = 'playhint';
  tip.textContent = `${text} 2초 후 다음 영상으로 이동합니다…`;
  sec.appendChild(tip);
  setTimeout(() => { if (i === indexNow) goNext(); }, 2000);
}

// 인덱스 스크롤
function scrollToIndex(i, { behavior='smooth' }={}) {
  const sec = container.querySelector(`.video[data-index="${i}"]`);
  if (!sec) return;
  sec.scrollIntoView({ behavior, block:'start' });
  indexNow = i;
}

// 위/아래 스와이프(스크롤)로 다음/이전
container.addEventListener('wheel', async (e) => {
  // 기본 스크롤 동작 유지하되, 하단/상단 근접 시 프리페치
  if (e.deltaY > 0) {
    // 끝 근처면 더 로드
    if (indexNow > queue.length - 5) await loadMoreAppend();
  }
});

container.addEventListener('scroll', async () => {
  // 현재 뷰포지션으로 indexNow 보정
  const boxes = [...container.querySelectorAll('.video')];
  const mid = container.scrollTop + container.clientHeight/2;
  let nearest = indexNow;
  let best = Infinity;
  boxes.forEach((b, i) => {
    const rectTop = b.offsetTop;
    const center = rectTop + b.clientHeight/2;
    const d = Math.abs(center - mid);
    if (d < best) { best = d; nearest = i; }
  });
  if (nearest !== indexNow) {
    indexNow = nearest;
  }
  if (indexNow > queue.length - 5) await loadMoreAppend();
});

async function loadMoreAppend() {
  const prevLen = queue.length;
  await loadMore();
  if (queue.length > prevLen) {
    // 새 섹션만 추가 렌더
    for (let i = prevLen; i < queue.length; i++) {
      const v = queue[i];
      const sec = document.createElement('section');
      sec.className = 'video';
      sec.dataset.index = String(i);
      const thumb = document.createElement('div'); thumb.className='thumb';
      const iframe = document.createElement('iframe');
      const ytid = v.ytid || extractYTID(v.url);
      iframe.src = ytid ? `https://www.youtube.com/embed/${ytid}?enablejsapi=1&playsinline=1&autoplay=0&rel=0&modestbranding=1` : '';
      iframe.addEventListener('error', () => markAndSkipOnError(i, '재생 에러'));
      const hint = document.createElement('div'); hint.className='playhint'; hint.textContent='탭하여 재생';
      const muteTip = document.createElement('div'); muteTip.className='mute-tip'; muteTip.textContent='음소거 해제 후 시청하세요';
      sec.append(thumb, iframe, hint, muteTip);
      container.appendChild(sec);

      if (window.YT && window.YT.Player) {
        const p = new YT.Player(iframe, {
          events: {
            onStateChange: (e) => {
              if (e.data === YT.PlayerState.ENDED && getAutoNext()) goNext();
            },
            onError: (e) => markAndSkipOnError(i, errorTextFromCode(e.data))
          }
        });
        playerObjs[i] = p;
      }
    }
  }
}

// 탐색/다음/이전
function goNext() {
  if (indexNow < queue.length - 1) {
    scrollToIndex(indexNow + 1);
  } else {
    // 끝 → 더 로드 시도 후 이동
    loadMoreAppend().then(() => {
      if (indexNow < queue.length - 1) scrollToIndex(indexNow + 1);
    });
  }
}
function goPrev() {
  if (indexNow > 0) scrollToIndex(indexNow - 1);
}

function trySeekActive(t) { trySeek(indexNow, t); }
function trySeek(i, t) {
  const p = playerObjs[i];
  if (!p || typeof p.seekTo !== 'function') return;
  try { p.seekTo(t, true); } catch {}
}

// 주기적 resume 저장 (10초)
setInterval(() => {
  persistResume();
}, 10000);

function persistResume() {
  const cur = queue[indexNow];
  if (!cur) return;
  const t = getCurrentTime(indexNow);
  // 어떤 시리즈 세부카테고리인지 판단: 필수는 subKey 하나 (현재 큐는 혼합 안 된 상태로 가정)
  const targetSub = (cur.cats || []).find(c => String(c).startsWith('series_')) || (selectedCats[0]?.subKey);
  const groupKey = selectedCats[0]?.groupKey || '';
  if (!targetSub || !groupKey) return;

  const resumeSort = sort; // list에서 넘어온 랜덤/최신/등록 그대로 저장
  saveResume({
    type, groupKey, subKey: targetSub,
    sort: resumeSort,
    index: indexNow,
    t: Math.floor(t || 0)
  });
}

function getCurrentTime(i) {
  const p = playerObjs[i];
  try { return typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : 0; } catch { return 0; }
}

// helpers
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
  let x = seed || 123456789; const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = Math.abs(x) % (i + 1); [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 시작
buildInitialQueue();
