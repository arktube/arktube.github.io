// watch.v15.arktube.js — ArkTube Watch (no overlay UI, vertical swipe next/prev, PC arrows)
import { auth, db } from './firebase-init.js';
import { CATEGORY_GROUPS } from './categories.js';
import { getAutoNext, makeKey, loadResume, saveResume } from './resume.js';
import {
  collection, query, where, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ===================== 공통 상태 & 키 ===================== */
const SELECTED_CATS_KEY = 'selectedCats';            // "ALL" | string[]
const VIEW_TYPE_KEY     = 'arktube:view:type';       // 'all' | 'shorts' | 'video'
const AUTONEXT_KEY_OLD  = 'autonext';                // '1' | '0' (index에서 저장)
const RESUME_SERIES_SS  = 'resumeSeriesKey';         // `${seriesGroupKey}:${subCatValue}`

// 재생 세션(옵션 캐시)
const SS_QUEUE_KEY = 'playQueue';
const SS_INDEX_KEY = 'playIndex';

// 재생 큐: { id, url, title, type, cats[] }[]
let PLAY_QUEUE = [];
let CUR = 0; // index in queue
let PLAYER = null;
let AUTONEXT = false;

// 시리즈 이어보기 컨텍스트(있을 때만 사용)
let resumeCtx = null; // { groupKey, subKey, typeForKey }

/* ===================== 도우미 ===================== */
const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

function parseJSON(s, fallback=null){ try{ return JSON.parse(s); }catch{ return fallback; } }

function seriesCatSet() {
  // series_* 그룹의 자식 value만 모아 집합 생성
  const set = new Set();
  for (const g of CATEGORY_GROUPS || []) {
    const isSeries = g?.isSeries === true || String(g?.key||'').startsWith('series_');
    if (isSeries) {
      for (const c of (g.children || [])) set.add(c.value);
    }
  }
  return set;
}
const SERIES_CATS = seriesCatSet();

function getPersonalSlotFromQS(){
  const p = new URLSearchParams(location.search);
  const cats = p.get('cats') || '';
  return /^personal[1-4]$/.test(cats) ? cats : null;
}

function readAutoNext(){
  const s = (localStorage.getItem(AUTONEXT_KEY_OLD)||'').toLowerCase();
  if (s==='1' || s==='true' || s==='on') return true;
  // resume.js 네임스페이스 값도 fallback
  return !!getAutoNext();
}

function loadQueueFromSession(){
  const q = parseJSON(sessionStorage.getItem(SS_QUEUE_KEY), null);
  const i = Number(sessionStorage.getItem(SS_INDEX_KEY));
  if (Array.isArray(q) && q.length > 0) {
    PLAY_QUEUE = q;
    CUR = Number.isFinite(i) && i >= 0 && i < q.length ? i : 0;
    return true;
  }
  return false;
}
function saveQueueToSession(){
  try {
    sessionStorage.setItem(SS_QUEUE_KEY, JSON.stringify(PLAY_QUEUE));
    sessionStorage.setItem(SS_INDEX_KEY, String(CUR));
  } catch {}
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

/* ===================== 큐 구성 로직 ===================== */
async function buildQueue() {
  // 개인자료 우선 판정
  const personalSlot = getPersonalSlotFromQS();
  const selType = (localStorage.getItem(VIEW_TYPE_KEY) || 'all'); // watch에서 토글 없음
  AUTONEXT = readAutoNext();

  const resumeKey = sessionStorage.getItem(RESUME_SERIES_SS) || '';
  if (resumeKey) {
    // `${groupKey}:${subKey}` → 시리즈 이어보기 모드
    const [groupKey, subKey] = resumeKey.split(':');
    resumeCtx = { groupKey, subKey, typeForKey: 'video' }; // 키 스킴상의 type — 단일로 고정
  }

  // 세션 캐시가 있고, 이어보기/개인자료 요구가 바뀌지 않았다면 그대로 복원
  if (loadQueueFromSession()) return;

  if (personalSlot) {
    // 개인자료 모드 (type 필터 적용 안 함)
    const storeKey = `personal_${personalSlot}`;
    const arr = parseJSON(localStorage.getItem(storeKey), []);
    // URL → id 추출(간단한 정규식)
    const idOf = (u)=>{
      try{
        const m = String(u).match(/[?&]v=([A-Za-z0-9_-]{11})/) || String(u).match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
        return m ? m[1] : null;
      }catch{ return null; }
    };
    PLAY_QUEUE = arr.map(x=>{
      const id = idOf(x.url);
      return id ? { id, url: x.url, title: x.title || '', type: 'video', cats: [personalSlot] } : null;
    }).filter(Boolean);

    CUR = 0;
    saveQueueToSession();
    return;
  }

  // 서버 모드
  // 선택 카테고리
  let sel = parseJSON(localStorage.getItem(SELECTED_CATS_KEY), 'ALL');
  let catFilter = null; // null이면 ALL

  if (Array.isArray(sel) && sel.length) {
    catFilter = sel.slice(0, 10); // array-contains-any 는 최대 10
  }
  // type 필터 (all이면 미적용)
  const typeFilter = (selType==='shorts' || selType==='video') ? selType : null;

  const col = collection(db, 'videos');

  let q;
  if (resumeCtx) {
    // 이어보기: 해당 시리즈 cat만 asc 정렬
    q = query(
      col,
      where('cats', 'array-contains', resumeCtx.subKey),
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','asc'),
      limit(200)
    );
  } else if (catFilter) {
    q = query(
      col,
      where('cats', 'array-contains-any', catFilter),
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','desc'),
      limit(200)
    );
  } else {
    // ALL: 시리즈 카테고리 포함 항목은 클라이언트에서 제외
    q = query(
      col,
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','desc'),
      limit(200)
    );
  }

  const snap = await getDocs(q);
  const rows = [];
  snap.forEach(doc=>{
    const d = doc.data()||{};
    // ALL일 때는 series cats 포함이면 제외
    if (!catFilter && !resumeCtx) {
      const cats = Array.isArray(d.cats) ? d.cats : [];
      const hasSeries = cats.some(c=> SERIES_CATS.has(c));
      if (hasSeries) return;
    }
    rows.push({
      id: d.ytid, url: d.url, title: d.title || '', type: d.type || 'video',
      cats: Array.isArray(d.cats) ? d.cats : []
    });
  });

  PLAY_QUEUE = rows;
  CUR = 0;

  // 이어보기라면 저장된 index/t 반영
  if (resumeCtx) {
    const rk = makeKey({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
    const saved = loadResume({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
    if (saved && Number.isFinite(saved.index)) {
      CUR = clamp(saved.index, 0, Math.max(0, PLAY_QUEUE.length-1));
      // t는 onPlayerReady에서 적용
    }
  }

  saveQueueToSession();
}

/* ===================== YouTube Player ===================== */
function loadYTAPI(){
  return new Promise((resolve)=>{
    if (window.YT && YT.Player) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onload = ()=>{};
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = ()=> resolve();
  });
}

function currentVideoId(){
  return (PLAY_QUEUE[CUR] && PLAY_QUEUE[CUR].id) || null;
}

function playAt(index, seekSeconds=null){
  CUR = clamp(index, 0, Math.max(0, PLAY_QUEUE.length-1));
  saveQueueToSession();
  const v = currentVideoId();
  if (!v) return;

  if (PLAYER) {
    PLAYER.loadVideoById(v);
    if (seekSeconds!=null) {
      const s = Math.max(0, Math.min(6*60*60, seekSeconds|0)); // 최대 6시간 가드
      if (s >= 3) setTimeout(()=> { try{ PLAYER.seekTo(s, true); }catch{} }, 400);
    }
  }
}

function next(){ if (CUR < PLAY_QUEUE.length-1) playAt(CUR+1, 0); }
function prev(){ if (CUR > 0)                 playAt(CUR-1, 0); }

async function initPlayer(){
  await loadYTAPI();
  const firstId = currentVideoId();
  const playerVars = {
    autoplay: 1,
    controls: 1,
    rel: 0,
    modestbranding: 1,
    playsinline: 1
  };
  PLAYER = new YT.Player('player', {
    width: '100%', height: '100%',
    videoId: firstId,
    playerVars,
    events: {
      onReady: onReady,
      onStateChange: onStateChange,
      onError: onError
    }
  });

  function onReady(){
    // 이어보기 t 적용
    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      const t = Number(saved?.t||0);
      if (Number.isFinite(t) && t >= 3) {
        try { PLAYER.seekTo(t, true); } catch {}
      }
    }
    try { PLAYER.playVideo(); } catch {}
  }

  let saveTicker = 0;
  function onStateChange(e){
    const st = e?.data;
    // 1 = playing, 0 = ended
    if (st === 1) {
      // 5초마다 진행 상황 저장(시리즈일 때만)
      if (resumeCtx) {
        clearInterval(saveTicker);
        saveTicker = setInterval(()=>{
          try {
            const t = Math.floor(PLAYER.getCurrentTime?.() || 0);
            saveResume({
              type: resumeCtx.typeForKey,
              groupKey: resumeCtx.groupKey,
              subKey: resumeCtx.subKey,
              sort: 'createdAt-asc',
              index: CUR,
              t
            });
          } catch {}
        }, 5000);
      }
    } else if (st === 0) {
      // 종료: 오토넥스트면 다음
      if (resumeCtx) {
        try {
          const t = 0;
          saveResume({
            type: resumeCtx.typeForKey,
            groupKey: resumeCtx.groupKey,
            subKey: resumeCtx.subKey,
            sort: 'createdAt-asc',
            index: Math.min(CUR+1, PLAY_QUEUE.length-1),
            t
          });
        } catch {}
      }
      if (AUTONEXT) next();
    } else {
      if (resumeCtx) clearInterval(saveTicker);
    }
  }

  function onError(err){
    // 재생불가 → 다음으로 스킵
    console.warn('[watch] player error', err);
    next();
  }
}

/* ===================== 제스처 & 키보드 ===================== */
// 요구: 모바일은 "위/아래 스와이프"로 이전/다음, PC는 화살표(←/→)
(function initGestures({
  deadZoneCenterRatio = 0.18,
  intentDy = 14,    // 세로 의도 확정 임계
  cancelDx = 12,    // 의도 확정 전 가로 취소
  maxDx = 90,       // 전체 가로 허용치
  maxMs = 700,
  minDy = 70,
  minVy = 0.6       // px/ms
} = {}) {
  let sy=0, sx=0, t0=0, tracking=false, verticalIntent=false;
  let pointerId = null;

  const inDeadZone = (x)=>{
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L = vw*(0.5-deadZoneCenterRatio/2), R = vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  };
  const isInteractive = (el)=> !!el.closest('button,a,input,textarea,select,label');

  function startCommon(x,y,target){
    if (isInteractive(target)) return false;
    if (inDeadZone(x)) return false;
    sx=x; sy=y; t0=performance.now(); tracking=true; verticalIntent=false;
    return true;
  }
  function moveCommon(x,y){
    if (!tracking) return;
    const dx = x-sx, dy=y-sy;
    if (!verticalIntent){
      if (Math.abs(dx)>cancelDx){ tracking=false; return; }
      if (Math.abs(dy)>=intentDy) verticalIntent = true;
    } else {
      if (Math.abs(dx)>maxDx){ tracking=false; return; }
    }
  }
  function endCommon(x,y){
    if (!tracking) return;
    tracking=false;
    const dy = y-sy;
    const dt = performance.now()-t0;
    if (!verticalIntent) return;
    if (dt>maxMs) return;

    const vy = Math.abs(dy)/Math.max(1, dt);
    const passDist = Math.abs(dy)>=minDy;
    const passVel  = vy>=minVy;
    if (!(passDist || passVel)) return;

    // 위로 스와이프 → 다음, 아래로 스와이프 → 이전
    if (dy <= -minDy || (dy<0 && passVel)) {
      document.body.classList.remove('nudge-down');
      document.body.classList.add('nudge-up');
      setTimeout(()=> document.body.classList.remove('nudge-up'), 220);
      next();
    } else if (dy >= minDy || (dy>0 && passVel)) {
      document.body.classList.remove('nudge-up');
      document.body.classList.add('nudge-down');
      setTimeout(()=> document.body.classList.remove('nudge-down'), 220);
      prev();
    }
  }

  // Pointer 우선
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', (e)=>{
      if (e.pointerType==='mouse' && e.button!==0) return;
      pointerId = e.pointerId ?? 'p';
      startCommon(e.clientX, e.clientY, e.target);
    }, { passive:true });
    document.addEventListener('pointermove', (e)=>{
      if (pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return;
      moveCommon(e.clientX, e.clientY);
    }, { passive:true });
    document.addEventListener('pointerup', (e)=>{
      if (pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return;
      endCommon(e.clientX, e.clientY);
      pointerId = null;
    }, { passive:true });
    document.addEventListener('pointercancel', ()=>{ tracking=false; pointerId=null; }, { passive:true });
  } else {
    // Touch fallback
    const pt = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    document.addEventListener('touchstart', (e)=>{ const p=pt(e); if(!p) return; startCommon(p.clientX,p.clientY,e.target); }, { passive:true });
    document.addEventListener('touchmove',  (e)=>{ const p=pt(e); if(!p) return; moveCommon(p.clientX,p.clientY); }, { passive:true });
    document.addEventListener('touchend',   (e)=>{ const p=pt(e); if(!p) return; endCommon(p.clientX,p.clientY); }, { passive:true });
  }

  // 키보드: ← 이전 / → 다음
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  });
})();

/* ===================== 부트스트랩 ===================== */
(async function main(){
  try {
    await buildQueue();

    if (!PLAY_QUEUE.length) {
      // 빈 큐 처리 (간단한 리다이렉트 정책)
      const personalSlot = getPersonalSlotFromQS();
      if (personalSlot) {
        alert('개인자료가 비어있습니다. 먼저 업로드/저장을 해주세요.');
        location.href = '/index.html';
      } else {
        alert('조건에 맞는 동영상이 없습니다.');
        location.href = '/list.html';
      }
      return;
    }

    await initPlayer();

    // 첫 영상/이어보기 반영
    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      const t = Number(saved?.t||0);
      playAt(CUR, Number.isFinite(t) && t>=3 ? t : 0);
    } else {
      playAt(CUR, 0);
    }
  } catch (e) {
    console.error('[watch] fatal init error', e);
    alert('재생을 시작할 수 없습니다. 네트워크 상태를 확인해주세요.');
    location.href = '/index.html';
  }
})();
