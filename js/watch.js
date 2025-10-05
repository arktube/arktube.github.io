// watch.v15.arktube.js — ArkTube Watch (완성본)
// - makelist가 만든 sessionStorage 큐(playQueue) 최우선 사용
// - 개인자료도 id 기반 (레거시: url→id 보강만 남김)
// - resumeCtx(sessionStorage)로 시리즈 이어보기(index/t) 복원
// - 상단바/드롭다운 v1.5, 수직 스와이프(위=다음/아래=이전), PC 화살표
// - autoplay 차단 환경 대비 onReady에서 mute 후 play
// - CATEGORY_MODEL 우선 사용
// - 'view:type' 키만 사용 (과거 'arktube:view:type' 제거)

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { getAutoNext, loadResume, saveResume } from './resume.js';
import {
  collection, query, where, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// ===== 상단바 / 드롭다운 v1.5 =====
const signupLink   = document.getElementById('signupLink');
const signinLink   = document.getElementById('signinLink');
const nickWrap     = document.getElementById('nickWrap');
const nickNameEl   = document.getElementById('nickName');
const btnSignOut   = document.getElementById('btnSignOut');

const btnDropdown  = document.getElementById('btnDropdown');
const dropdown     = document.getElementById('dropdownMenu');

const btnAbout     = document.getElementById('btnAbout');
const btnOrder     = document.getElementById('btnOrder');
const btnList      = document.getElementById('btnList');
const btnGoUpload  = document.getElementById('btnGoUpload');
const btnMyUploads = document.getElementById('btnMyUploads');

// 공통 네비
btnAbout    ?.addEventListener('click', ()=> location.href='/about.html');
btnOrder    ?.addEventListener('click', ()=> location.href='/category-order.html');
btnList     ?.addEventListener('click', ()=> location.href='/list.html');
btnGoUpload ?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads?.addEventListener('click', ()=> location.href= auth.currentUser ? '/manage-uploads.html' : '/signin.html');

btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  nickWrap ?.classList.toggle('hidden', !loggedIn);
  if (nickNameEl) nickNameEl.textContent = loggedIn ? (user?.displayName || 'User') : '';
});

// 드롭다운 v1.5
(function initDropdownV15(){
  const menu = dropdown;
  const trigger = btnDropdown;
  let open = false; let offPointer=null; let offKey=null;

  function setOpen(v){
    open = !!v;
    if (!menu || !trigger) return;
    trigger.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    if (open){
      menu.classList.remove('hidden');
      requestAnimationFrame(()=> menu.classList.add('open'));
      const first = menu.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : trigger)?.focus?.({preventScroll:true});
      bindDoc();
    }else{
      menu.classList.remove('open');
      setTimeout(()=> menu.classList.add('hidden'), 150);
      trigger.focus?.({preventScroll:true});
      unbindDoc();
    }
  }
  function toggle(){ setOpen(!open); }

  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = (e)=>{
      const t = e.target;
      if (t.closest('#dropdownMenu') || t.closest('#btnDropdown')) return;
      setOpen(false);
    };
    const onKey = (e)=>{
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab' && open){
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
  function unbindDoc(){ if(offPointer){ offPointer(); offPointer=null; } if(offKey){ offKey(); offKey=null; } }

  trigger?.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });

  // 초기 aria 동기화
  if (menu && trigger){
    const initiallyHidden = menu.classList.contains('hidden');
    trigger.setAttribute('aria-expanded', String(!initiallyHidden));
    menu.setAttribute('aria-hidden', String(initiallyHidden));
  }
})();

// ===== 재생 컨텍스트/큐 =====
const SS_QUEUE_KEY   = 'playQueue';
const SS_INDEX_KEY   = 'playIndex';
const SS_RESUME_CTX  = 'resumeCtx'; // { typeForKey:'video', groupKey:'series', subKey:'series_foo', sort?:'createdAt-asc' }
const SELECTED_CATS_KEY = 'selectedCats';
const VIEW_TYPE_KEY     = 'view:type'; // 읽기만. watch에서 토글 없음
const AUTONEXT_KEY_OLD  = 'autonext';  // 과거 키 호환

let PLAY_QUEUE = []; // [{ id, url, title, type, cats[] }]
let CUR = 0;
let PLAYER = null;
let AUTONEXT = false;

let resumeCtx = null; // { typeForKey, groupKey, subKey }

// 유틸
const parseJSON = (s, fb=null)=>{ try{ return JSON.parse(s); }catch{ return fb; } };
const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));
const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));

// 시리즈 카테고리 집합 (CATEGORY_MODEL 우선)
function seriesCatSet() {
  const groups = Array.isArray(CATEGORY_MODEL?.groups) ? CATEGORY_MODEL.groups :
                 (Array.isArray(CATEGORY_GROUPS) ? CATEGORY_GROUPS : []);
  const set = new Set();
  groups.forEach(g=>{
    const isSeries = g?.isSeries===true || String(g?.key||'').startsWith('series_');
    if (isSeries) (g.children||[]).forEach(c=> set.add(c.value));
  });
  return set;
}
const SERIES_CATS = seriesCatSet();

function readAutoNext(){
  const s = (localStorage.getItem(AUTONEXT_KEY_OLD)||'').toLowerCase();
  if (s==='1' || s==='true' || s==='on') return true;
  return !!getAutoNext();
}

function currentVideoId(){ return (PLAY_QUEUE[CUR] && PLAY_QUEUE[CUR].id) || null; }

function loadQueueFromSession(){
  const q = parseJSON(sessionStorage.getItem(SS_QUEUE_KEY), null);
  const i = Number(sessionStorage.getItem(SS_INDEX_KEY));
  if (Array.isArray(q) && q.length > 0) {
    // 레거시 방어: id가 없으면 url에서 보강(가능 시)
    PLAY_QUEUE = q.map(x=>{
      if (!x?.id && x?.url) {
        // parseYouTube를 굳이 import하지 않고도 최대한 보강
        try{
          const s = String(x.url);
          const m =
            s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
            s.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?:\?|&|$)/) ||
            s.match(/\/shorts\/([A-Za-z0-9_-]{11})(?:\?|&|$)/) ||
            s.match(/embed\/([A-Za-z0-9_-]{11})(?:\?|&|$)/);
          if (m) x.id = m[1];
        }catch{}
      }
      return (x && x.id) ? x : null;
    }).filter(Boolean);
    CUR = Number.isFinite(i) && i>=0 && i<PLAY_QUEUE.length ? i : 0;
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

async function buildQueue(){
  AUTONEXT = readAutoNext();

  // 이어보기 컨텍스트 (makelist가 세팅)
  resumeCtx = parseJSON(sessionStorage.getItem(SS_RESUME_CTX), null);

  // 1순위: makelist가 만들어 둔 큐
  if (loadQueueFromSession()) {
    // resume 인덱스 보정
    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey || 'video', groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      if (saved && Number.isFinite(saved.index)) {
        CUR = clamp(saved.index, 0, Math.max(0, PLAY_QUEUE.length-1));
      }
    }
    return;
  }

  // 2순위(안전망): Firestore에서 최소 재생목록 구성 (makelist 미사용 진입 등)
  const selType = (localStorage.getItem(VIEW_TYPE_KEY) || 'both');
  let sel = parseJSON(localStorage.getItem(SELECTED_CATS_KEY), 'ALL');
  let catFilter = null;
  if (Array.isArray(sel) && sel.length) catFilter = sel.slice(0,10);
  const typeFilter = (selType==='shorts' || selType==='video') ? selType : null;

  const col = collection(db, 'videos');
  let q;
  if (resumeCtx) {
    q = query(
      col,
      where('cats','array-contains', resumeCtx.subKey),
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','asc'),
      limit(200)
    );
  } else if (catFilter) {
    q = query(
      col,
      where('cats','array-contains-any', catFilter),
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','desc'),
      limit(200)
    );
  } else {
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
    if (!catFilter && !resumeCtx) {
      const cats = Array.isArray(d.cats) ? d.cats : [];
      // ALL일 때 series 제외 (index와 동일 정책)
      if (cats.some(c=> SERIES_CATS.has(c))) return;
    }
    rows.push({
      id: d.ytid, url: d.url, title: d.title||'', type: d.type||'video',
      cats: Array.isArray(d.cats) ? d.cats : []
    });
  });

  PLAY_QUEUE = rows;
  CUR = 0;

  if (resumeCtx) {
    const saved = loadResume({ type: resumeCtx.typeForKey || 'video', groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
    if (saved && Number.isFinite(saved.index)) {
      CUR = clamp(saved.index, 0, Math.max(0, PLAY_QUEUE.length-1));
    }
  }
  saveQueueToSession();
}

// ===== YouTube Player =====
function loadYTAPI(){
  return new Promise((resolve)=>{
    if (window.YT && YT.Player) return resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
    window.onYouTubeIframeAPIReady = ()=> resolve();
  });
}

function playAt(index, seekSeconds=null){
  CUR = clamp(index, 0, Math.max(0, PLAY_QUEUE.length-1));
  saveQueueToSession();
  const v = currentVideoId();
  if (!v) return;
  if (PLAYER) {
    PLAYER.loadVideoById(v);
    if (seekSeconds!=null) {
      const s = Math.max(0, Math.min(6*60*60, seekSeconds|0));
      if (s >= 3) setTimeout(()=> { try{ PLAYER.seekTo(s, true); }catch{} }, 400);
    }
  }
}
function next(){ if (CUR < PLAY_QUEUE.length-1) playAt(CUR+1, 0); }
function prev(){ if (CUR > 0)                 playAt(CUR-1, 0); }

async function initPlayer(){
  await loadYTAPI();
  const firstId = currentVideoId();
  PLAYER = new YT.Player('player', {
    width: '100%', height: '100%',
    videoId: firstId,
    playerVars: { autoplay:1, controls:1, rel:0, modestbranding:1, playsinline:1 },
    events: { onReady, onStateChange, onError }
  });

  function onReady(){
    // 자동재생 차단 회피
    try { PLAYER.mute(); } catch {}
    // 시작 시점 복원
    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey || 'video', groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      const t = Number(saved?.t||0);
      if (Number.isFinite(t) && t >= 3) {
        try { PLAYER.seekTo(t, true); } catch {}
      }
    }
    try { PLAYER.playVideo(); } catch {}
  }

  let ticker = 0;
  function onStateChange(e){
    const st = e?.data;
    if (st === 1) {
      // 5초 주기 진행도 저장
      if (resumeCtx) {
        clearInterval(ticker);
        ticker = setInterval(()=>{
          try{
            const t = Math.floor(PLAYER.getCurrentTime?.() || 0);
            saveResume({
              type:resumeCtx.typeForKey || 'video',
              groupKey:resumeCtx.groupKey,
              subKey:resumeCtx.subKey,
              sort: (resumeCtx.sort || 'createdAt-asc'),
              index:CUR, t
            });
          }catch{}
        }, 5000);
      }
    } else if (st === 0) {
      // 완료 → 다음 인덱스로 진행도 저장
      if (resumeCtx) {
        try{
          saveResume({
            type:resumeCtx.typeForKey || 'video',
            groupKey:resumeCtx.groupKey,
            subKey:resumeCtx.subKey,
            sort: (resumeCtx.sort || 'createdAt-asc'),
            index:Math.min(CUR+1, PLAY_QUEUE.length-1), t:0
          });
        }catch{}
      }
      if (AUTONEXT) next();
    } else {
      if (resumeCtx) clearInterval(ticker);
    }
  }
  function onError(err){
    console.warn('[watch] player error', err);
    next();
  }
}

// ===== 제스처 & 키보드 =====
// 모바일: 수직 스와이프 (위=다음, 아래=이전)
// PC: 화살표키 ←/→
(function initGestures({
  deadZoneCenterRatio = 0.18,
  intentDy = 14, cancelDx = 12, maxDx = 90, maxMs = 700, minDy = 70, minVy = 0.6
} = {}) {
  let sy=0, sx=0, t0=0, tracking=false, verticalIntent=false;
  let pointerId = null;

  const inDead = (x)=>{
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L = vw*(0.5-deadZoneCenterRatio/2), R = vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  };
  const isInteractive = (el)=> !!el.closest('button,a,input,textarea,select,label');

  function startCommon(x,y,target){
    if (isInteractive(target)) return false;
    if (inDead(x)) return false;
    sx=x; sy=y; t0=performance.now(); tracking=true; verticalIntent=false;
    return true;
  }
  function moveCommon(x,y){
    if (!tracking) return;
    const dx=x-sx, dy=y-sy;
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
    const pass = (Math.abs(dy)>=minDy) || (vy>=minVy);
    if (!pass) return;

    if (dy <= -minDy || (dy<0 && vy>=minVy)) next();
    else if (dy >= minDy || (dy>0 && vy>=minVy)) prev();
  }

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
    const pt = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    document.addEventListener('touchstart', (e)=>{ const p=pt(e); if(!p) return; startCommon(p.clientX,p.clientY,e.target); }, { passive:true });
    document.addEventListener('touchmove',  (e)=>{ const p=pt(e); if(!p) return; moveCommon(p.clientX,p.clientY); }, { passive:true });
    document.addEventListener('touchend',   (e)=>{ const p=pt(e); if(!p) return; endCommon(p.clientX,p.clientY); }, { passive:true });
  }

  document.addEventListener('keydown', (e)=>{
    if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  });
})();

// ===== 부트스트랩 =====
(async function main(){
  try{
    await buildQueue();

    if (!PLAY_QUEUE.length) {
      alert('재생할 동영상이 없습니다.');
      location.href = '/index.html';
      return;
    }

    await initPlayer();

    // 시작 재생
    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey || 'video', groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      const t = Number(saved?.t||0);
      playAt(CUR, Number.isFinite(t) && t>=3 ? t : 0);
    } else {
      playAt(CUR, 0);
    }
  }catch(e){
    console.error('[watch] init error', e);
    alert('재생을 시작할 수 없습니다. 네트워크 상태를 확인해주세요.');
    location.href = '/index.html';
  }
})();
