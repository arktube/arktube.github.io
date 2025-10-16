// /js/watch.js — ArkTube Watch 완전판 (gesture-layer + series_key check + keys off)
//
// - 상단바: 로고/Enjoy!/구글계정/드롭다운 완비
// - 데이터: playQueue/playIndex/playMeta/resumeCtx (sessionStorage)
// - 연속재생: localStorage('autonext') 직접 확인
// - 스와이프: 상/하 투명 제스처 존으로 ↑다음 / ↓이전
// - 마우스 휠: 아래=다음 / 위=이전 (쿨다운)
// - 키보드: Esc(뒤로), F(전체화면)만 유지 (나머지 비활성)
// - 시리즈 이어보기(안전조건):
//     resumeCtx.groupKey가 'series_'로 시작 &&
//     (playMeta.seriesKey || playMeta.groupKey || 단일 cats 값)가 resumeCtx.subKey와 일치
//     → 10s 주기 저장, 종료시 다음 인덱스 저장, 5s 이상일 때 복원
// - YouTube: playerVars.origin=location.origin
// - 뷰포트: CopyTube식 letterbox fit(가로/세로/삼성인터넷 대응)

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  readPlayQueue, readPlayIndex, readPlayMeta,
  fetchMoreForWatchIfNeeded, readListSnapshot
} from './makelist.js';

/* ===== 상수 ===== */
const RESUME_SAVE_MS        = 10000;
const RESUME_RESTORE_MIN    = 5;
const RESUME_ADVANCE_ON_END = true;
const KEY_PLAY_INDEX        = 'playIndex';

/* ===== DOM ===== */
const welcomeEl     = document.getElementById('welcome') || document.getElementById('welcomeText');
const nickEl        = document.getElementById('nickName');
const menuBtn       = document.getElementById('btnMenu');
const dropdown      = document.getElementById('dropdownMenu');
const brandHome     = document.getElementById('brandHome');

const signinLink    = document.getElementById('signinLink');
const signupLink    = document.getElementById('signupLink');
const btnSignOut    = document.getElementById('btnSignOut');
const btnMyUploads  = document.getElementById('btnMyUploads');
const btnAbout      = document.getElementById('btnAbout');
const btnGoCategory = document.getElementById('btnGoCategory');
const btnList       = document.getElementById('btnList');
const btnGoUpload   = document.getElementById('btnGoUpload');

const playerBox   = document.getElementById('playerBox');
const playerHost  = playerBox || document.body;
const gestureTop  = document.getElementById('gestureTop');
const gestureBottom = document.getElementById('gestureBottom');

/* ===== 헤더 ===== */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  if (welcomeEl) welcomeEl.textContent = 'Enjoy!';
  if (nickEl) {
    nickEl.textContent = loggedIn ? (user.displayName || user.email || '') : '';
    nickEl.style.display = loggedIn ? 'inline' : 'none';
  }
  if (signinLink)  signinLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (signupLink)  signupLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (btnSignOut)  btnSignOut.style.display  = loggedIn ? 'inline-block' : 'none';
  if (btnMyUploads) btnMyUploads.onclick = ()=>{ location.href = loggedIn ? './manage-uploads.html' : './signin.html'; };
});
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });
brandHome?.addEventListener('click', (e)=>{ e.preventDefault(); location.href='./index.html'; });

/* ===== 드롭다운 ===== */
(function initDropdown(){
  if (!menuBtn || !dropdown) return;
  let open=false, offPointer=null, offKey=null;

  function setOpen(v){
    open=!!v;
    menuBtn.setAttribute('aria-expanded', String(open));
    dropdown.setAttribute('aria-hidden', String(!open));
    if (open){
      dropdown.classList.remove('hidden');
      requestAnimationFrame(()=> dropdown.classList.add('open'));
      const first = dropdown.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : menuBtn).focus({preventScroll:true});
      bindDoc();
    }else{
      dropdown.classList.remove('open');
      setTimeout(()=> dropdown.classList.add('hidden'), 120);
      menuBtn.focus({preventScroll:true});
      unbindDoc();
    }
  }
  function toggle(){ setOpen(!open); }
  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = (e)=>{
      if (e.target.closest('#dropdownMenu') || e.target.closest('#'+menuBtn.id)) return;
      setOpen(false);
    };
    const onKey = (e)=>{
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab' && open){
        const nodes = dropdown.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])');
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
  function unbindDoc(){ if(offPointer){offPointer(); offPointer=null;} if(offKey){offKey(); offKey=null;} }

  menuBtn.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  dropdown.addEventListener('click', (e)=>{
    if (e.target.closest('a,button,[role="menuitem"],[role="menuitemradio"]')) setOpen(false);
  });

  btnAbout     ?.addEventListener('click', ()=> location.href='./about.html');
  btnGoCategory?.addEventListener('click', ()=> location.href='./category.html');
  btnList      ?.addEventListener('click', ()=> location.href='./list.html');
  btnGoUpload  ?.addEventListener('click', ()=> location.href='./upload.html');
})();

/* ===== 뷰포트 보정 (CopyTube fit) ===== */
function getVisualHeight(){
  if (window.visualViewport && Number.isFinite(window.visualViewport.height)) return window.visualViewport.height;
  return window.innerHeight;
}
function debounce(fn, ms){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a), ms); }; }

function fitPlayerToViewport(){
  try{
    const el = playerHost; if (!el) return;
    const rectTop = el.getBoundingClientRect().top;
    const availH  = getVisualHeight() - rectTop;
    const safeB   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom')) || 0;
    const available = Math.max(0, availH - safeB - 2);
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);

    // 16:9 최대 치수(레터박스)
    const hByW = Math.round(vw * 9/16);
    const wByH = Math.round(available * 16/9);
    const useH = Math.min(hByW, available);
    const useW = Math.min(vw, wByH);

    el.style.maxWidth = useW + 'px';
    el.style.height   = useH > 0 ? (useH + 'px') : '';
  }catch{}
}
fitPlayerToViewport();
window.addEventListener('resize', debounce(fitPlayerToViewport, 80));
window.addEventListener('orientationchange', ()=> setTimeout(fitPlayerToViewport, 250));
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) setTimeout(fitPlayerToViewport, 120); });
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', debounce(fitPlayerToViewport, 50));
  window.visualViewport.addEventListener('scroll', debounce(fitPlayerToViewport, 50));
}

/* ===== 큐/메타 ===== */
let queue = readPlayQueue();
let idx   = clamp(readPlayIndex(), 0, Math.max(0, (queue && queue.length ? queue.length : 1)-1));
const meta = readPlayMeta() || { returnTo:'index' };

function clamp(n,min,max){ n=Number(n||0); if(!Number.isFinite(n)) n=0; return Math.max(min, Math.min(max, n)); }
function setPlayIndex(i){ idx=clamp(i,0,Math.max(0,queue.length-1)); try{ sessionStorage.setItem(KEY_PLAY_INDEX, String(idx)); }catch{} }
function current(){ queue = readPlayQueue() || queue; idx = clamp(idx,0,Math.max(0,queue.length-1)); return queue[idx]; }

/* ===== 시리즈 안전조건 (group key 기반) & resumeCtx ===== */
function readResumeCtx(){ try{ return JSON.parse(sessionStorage.getItem('resumeCtx')||'null'); }catch{ return null; } }

/* group key 추출(우선순위: playMeta.seriesKey > playMeta.groupKey > 단일 cats 값) */
function getSelectedSeriesKeyFromMeta(){
  const pm = meta || {};
  if (typeof pm.seriesKey === 'string' && pm.seriesKey.startsWith('series_')) return pm.seriesKey;
  if (typeof pm.groupKey === 'string' && pm.groupKey.startsWith('series_')) return pm.groupKey;
  if (Array.isArray(pm.cats) && pm.cats.length === 1 && typeof pm.cats[0] === 'string' && pm.cats[0].startsWith('series_')) {
    return pm.cats[0];
  }
  return null;
}

function isSeriesModeOK(){
  const rc = readResumeCtx(); if (!rc || !rc.groupKey || !rc.subKey) return false;
  if (typeof rc.groupKey !== 'string' || !rc.groupKey.startsWith('series_')) return false;

  const selectedSeriesKey = getSelectedSeriesKeyFromMeta();
  const ok = !!(selectedSeriesKey && selectedSeriesKey === rc.subKey);
  if (!ok){ try{ sessionStorage.removeItem('resumeCtx'); }catch{} }
  return ok;
}
let isSeriesMode = isSeriesModeOK();

/* ===== Resume I/O (resume.js 우선, 폴백은 localStorage) ===== */
function sanitizeResumePayload(obj){
  if (!obj || typeof obj!=='object') return null;
  const out = {};
  const s = String(obj.sort||'');
  if (!(s==='createdAt-desc' || s==='createdAt-asc' || s.startsWith('random'))) return null;
  out.sort = s;
  out.index   = Math.max(0, Math.floor(Number(obj.index)||0));
  out.t       = Math.max(0, Math.floor(Number(obj.t)||0));
  out.savedAt = Number(obj.savedAt)||Date.now();
  return out;
}
async function saveResumeSafe(payload){
  const sane = sanitizeResumePayload(payload); if (!sane) return;
  const key = `resume:${payload.type}:${payload.groupKey}:${payload.subKey}`;
  try{
    const mod = await import('./resume.js');
    if (typeof mod.saveResume === 'function'){ mod.saveResume(payload); return; }
  }catch{}
  try{ localStorage.setItem(key, JSON.stringify(sane)); }catch{}
}
async function loadResumeSafe(ctx){
  const key = `resume:${ctx.type}:${ctx.groupKey}:${ctx.subKey}`;
  try{
    const mod = await import('./resume.js');
    if (typeof mod.loadResume === 'function'){
      return sanitizeResumePayload(mod.loadResume(ctx));
    }
  }catch{}
  try{ return sanitizeResumePayload(JSON.parse(localStorage.getItem(key)||'null')); }catch{ return null; }
}

/* ===== YouTube IFrame API ===== */
let ytPlayer=null, saveTicker=null, firstReady=false;
function ensureYT(){
  return new Promise((res)=>{
    if (window.YT && window.YT.Player) return res();
    const it = setInterval(()=>{ if (window.YT && window.YT.Player){ clearInterval(it); res(); } }, 50);
  });
}
window.onYouTubeIframeAPIReady = function(){};

async function loadCurrent(){
  const it = current(); if (!it) return;
  if (it.playable === false){ setTimeout(next, 80); return; }

  await ensureYT();

  const vid = it.id || it.ytid || it.vid;
  const pv = { autoplay:1, playsinline:1, modestbranding:1, rel:0, fs:1, controls:1, origin: location.origin };

  if (!ytPlayer){
    ytPlayer = new YT.Player('player', {
      width:'100%', height:'100%',
      videoId: vid, playerVars: pv,
      events: { onReady, onStateChange, onError }
    });
  } else if (typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById({ videoId: vid });
  } else {
    try { ytPlayer.cueVideoById && ytPlayer.cueVideoById({ videoId: vid }); } catch{}
  }

  if (saveTicker){ clearInterval(saveTicker); saveTicker=null; }
  isSeriesMode = isSeriesModeOK();
  if (isSeriesMode){
    saveTicker = setInterval(async ()=>{
      try{
        const t = Math.floor((ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0) || 0);
        const rc = readResumeCtx(); if (!rc) return;
        await saveResumeSafe({
          type: rc.typeForKey || 'video',
          groupKey: rc.groupKey,
          subKey: rc.subKey,
          sort: (meta?.sort || 'createdAt-asc'),
          index: idx,
          t
        });
      }catch{}
    }, RESUME_SAVE_MS);
  }

  fitPlayerToViewport();
}

async function onReady(){
  if (!firstReady){
    firstReady = true;
    try{ ytPlayer.mute(); ytPlayer.playVideo(); setTimeout(()=> ytPlayer.unMute(), 800); }catch{}
  }
  if (isSeriesModeOK()){
    try{
      const rc = readResumeCtx();
      const saved = rc ? await loadResumeSafe({ type: rc.typeForKey||'video', groupKey: rc.groupKey, subKey: rc.subKey }) : null;
      const t = Number(saved && saved.t || 0);
      if (Number.isFinite(t) && t >= RESUME_RESTORE_MIN){ try{ ytPlayer.seekTo(t, true); }catch{} }
    }catch{}
  }
  setTimeout(fitPlayerToViewport, 120);
}

async function onStateChange(ev){
  const S = YT.PlayerState;
  if (ev.data === S.ENDED){
    if (RESUME_ADVANCE_ON_END && isSeriesModeOK()) {
      const q = readPlayQueue() || queue;
      const nextIndex = Math.min(idx + 1, Math.max(0, (q && q.length ? q.length : 1) - 1));
      try{
        const rc = readResumeCtx(); if (rc){
          await saveResumeSafe({
            type: rc.typeForKey || 'video',
            groupKey: rc.groupKey,
            subKey: rc.subKey,
            sort: (meta?.sort || 'createdAt-asc'),
            index: nextIndex,
            t: 0
          });
        }
      }catch{}
    }
    try{ await fetchMoreForWatchIfNeeded(idx); }catch{}
    const autonext = (localStorage.getItem('autonext') === '1');
    if (autonext) next();
  } else if (ev.data === S.PLAYING){
    setTimeout(fitPlayerToViewport, 60);
  }
}
function onError(){ setTimeout(next, 120); }

/* ===== 이동 ===== */
async function next(){
  try{ await fetchMoreForWatchIfNeeded(idx); }catch{}
  queue = readPlayQueue() || queue;
  if (idx >= queue.length-1){ setPlayIndex(queue.length-1); return; }
  if (isSeriesModeOK()){
    const rc = readResumeCtx();
    if (rc){
      await saveResumeSafe({
        type: rc.typeForKey || 'video',
        groupKey: rc.groupKey, subKey: rc.subKey,
        sort: (meta?.sort || 'createdAt-asc'),
        index: idx + 1, t: 0
      });
    }
  }
  setPlayIndex(idx + 1);
  await loadCurrent();
}
async function prev(){
  if (idx <= 0) return;
  if (isSeriesModeOK()){
    const rc = readResumeCtx();
    if (rc){
      await saveResumeSafe({
        type: rc.typeForKey || 'video',
        groupKey: rc.groupKey, subKey: rc.subKey,
        sort: (meta?.sort || 'createdAt-asc'),
        index: idx - 1, t: 0
      });
    }
  }
  setPlayIndex(idx - 1);
  await loadCurrent();
}

/* ===== 전체화면 & 뒤로 ===== */
function toggleFullscreen(){
  if (document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
  else { if (playerHost && playerHost.requestFullscreen) playerHost.requestFullscreen(); }
}
document.addEventListener('fullscreenchange', ()=>{
  const fs = !!document.fullscreenElement;
  // 전체화면 시 제스처 존 비활성(브라우저/플레이어 제스처 우선)
  [gestureTop, gestureBottom].forEach(z=>{ if(!z) return; z.style.pointerEvents = fs ? 'none' : 'auto'; });
});

/* ===== 키보드: Esc/F만 유지 ===== */
window.addEventListener('keydown', (e)=>{
  const tag=(e.target && e.target.tagName || '').toLowerCase();
  if (tag==='input' || tag==='textarea') return;

  if (e.key && e.key.toLowerCase()==='f'){ e.preventDefault(); toggleFullscreen(); }
  else if (e.key==='Escape'){ e.preventDefault(); history.back(); }
});

/* ===== 마우스 휠: 아래=다음 / 위=이전 ===== */
let wheelLock = false;
playerHost.addEventListener('wheel', (e)=>{
  if (wheelLock) return;
  if (Math.abs(e.deltaY) < 20) return;
  wheelLock = true;
  if (e.deltaY > 0) next(); else prev();
  setTimeout(()=> wheelLock=false, 400);
},{ passive:true });

/* ===== 스와이프(투명 레이어 상/하 존) ===== */
(function bindSwipeZones(){
  const zones = [gestureTop, gestureBottom].filter(Boolean);
  if (!zones.length) return;

  const THRESH = 50;       // 최소 Y 이동
  const SLOPX  = 45;       // 허용 X 이동
  const MAXMS  = 700;      // 플릭 최대 지속

  zones.forEach(zone=>{
    let x0=0, y0=0, t0=0, active=false, canceled=false, dragging=false;

    const getPoint = (e)=> (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;

    function start(e){
      const t = getPoint(e); if(!t) return;
      x0=t.clientX; y0=t.clientY; t0=Date.now();
      active=true; canceled=false; dragging=false;
    }
    function move(e){
      if(!active) return;
      const t=getPoint(e); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0;
      if (Math.abs(dx)>SLOPX){ canceled=true; active=false; return; }
      if (Math.abs(dy)>10){ dragging=true; }
      if (dragging) e.preventDefault(); // 수직 제스처로 간주 → 스크롤 억제
    }
    function end(e){
      if(!active) return; active=false;
      const t=getPoint(e); if(!t) return;
      const dy=t.clientY-y0, dt=Date.now()-t0;
      if (canceled) return;
      const strong = Math.abs(dy)>=THRESH;
      const quick  = dt<=MAXMS && Math.abs(dy)>=Math.max(30, THRESH*0.6);
      if (!(strong || quick)) return;
      if (dy <= -Math.max(THRESH, 30)) next();     // ↑ 위로 → 다음
      else if (dy >= Math.max(THRESH, 30)) prev(); // ↓ 아래로 → 이전
    }

    zone.addEventListener('touchstart', start, { passive:true });
    zone.addEventListener('touchmove',  move , { passive:false });
    zone.addEventListener('touchend',   end  , { passive:true, capture:true });

    zone.addEventListener('pointerdown', start, { passive:true });
    zone.addEventListener('pointermove', move , { passive:false });
    zone.addEventListener('pointerup',   end  , { passive:true, capture:true });
  });
})();

/* ===== 시작 ===== */
(async function(){
  // 큐 없으면 list 스냅샷 폴백 → 그래도 없으면 index
  if (!Array.isArray(queue) || queue.length===0){
    const snap = readListSnapshot();
    if (snap && Array.isArray(snap.items) && snap.items.length){
      queue = snap.items; idx = 0;
      try{ sessionStorage.setItem('playQueue', JSON.stringify(queue)); }catch{}
      try{ sessionStorage.setItem('playIndex', '0'); }catch{}
    } else {
      location.replace('./index.html');
      return;
    }
  }
  await loadCurrent();
})();
