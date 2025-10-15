// /js/watch.js — ArkTube Watch 완전판 v0.1.4
// - 공통 헤더(브랜드/메뉴/Enjoy!) 유지, 배경만 투명
// - Firebase/Auth & makelist 연동
// - ↑/↓ 스와이프, Space/K, ←/→, ',' '.' , F, Esc(히스토리 back)
// - 시리즈 resume: 안전조건(단일 series_ 서브키)일 때만 10초 주기 저장 + 종료 시 다음 인덱스 저장, 5초 이상일 때만 복원
// - resume 저장은 validation 거친 후 localStorage('resume:...') (가능하면 resume.js API 우선 사용)
// - autonext는 localStorage('autonext') 직접 읽기
// - visualViewport 기반 16:9 높이 보정(삼성 브라우저 대응)

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  readPlayQueue, readPlayIndex, readPlayMeta,
  fetchMoreForWatchIfNeeded, readListSnapshot
} from './makelist.js';

/* ===== 상수 ===== */
const RESUME_SAVE_MS        = 10000; // 10s
const RESUME_RESTORE_MIN    = 5;     // 5s 이상일 때만 복원
const RESUME_ADVANCE_ON_END = true;  // 종료 시 다음 인덱스로 저장
const KEY_PLAY_INDEX        = 'playIndex';

/* ===== DOM ===== */
const welcomeEl     = document.getElementById('welcome') || document.getElementById('welcomeText'); // "Enjoy!"
const menuBtn       = document.getElementById('btnMenu') || document.getElementById('menuBtn');
const dropdown      = document.getElementById('dropdownMenu');
const menuBackdrop  = document.getElementById('menuBackdrop');
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

/* ===== 상단바 초기화 ===== */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  const name = loggedIn ? (user.displayName || '') : '';
  if (welcomeEl) welcomeEl.textContent = 'Enjoy!'; // 고정
  if (signinLink)  signinLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (signupLink)  signupLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (btnSignOut)  btnSignOut.style.display  = loggedIn ? 'inline-block' : 'none';
  if (btnMyUploads) btnMyUploads.onclick = ()=>{ location.href = loggedIn ? './manage-uploads.html' : './signin.html'; };
});
if (btnSignOut){
  btnSignOut.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });
}
if (brandHome){
  brandHome.addEventListener('click', (e)=>{ e.preventDefault(); location.href='./index.html'; });
}

/* ===== 드롭다운(공통) ===== */
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
      if (menuBackdrop) menuBackdrop.classList.add('show');
      const first = dropdown.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : menuBtn).focus({preventScroll:true});
      bindDoc();
    }else{
      dropdown.classList.remove('open');
      setTimeout(()=> dropdown.classList.add('hidden'), 120);
      if (menuBackdrop) menuBackdrop.classList.remove('show');
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
    if (menuBackdrop) menuBackdrop.addEventListener('click', ()=> setOpen(false), { once:true });
  }
  function unbindDoc(){ if(offPointer){offPointer(); offPointer=null;} if(offKey){offKey(); offKey=null;} }

  menuBtn.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  dropdown.addEventListener('click', (e)=>{
    if (e.target.closest('a,button,[role="menuitem"],[role="menuitemradio"]')) setOpen(false);
  });

  if (btnAbout)      btnAbout.addEventListener('click', ()=> location.href='./about.html');
  if (btnGoCategory) btnGoCategory.addEventListener('click', ()=> location.href='./category.html');
  if (btnList)       btnList.addEventListener('click', ()=> location.href='./list.html');
  if (btnGoUpload)   btnGoUpload.addEventListener('click', ()=> location.href='./upload.html');
})();

/* ===== 삼성 인터넷 하단 잘림/뷰포트 보정 ===== */
function getVisualHeight(){
  if (window.visualViewport && Number.isFinite(window.visualViewport.height)) return window.visualViewport.height;
  return window.innerHeight;
}
function debounce(fn, ms){ let id; return (...args)=>{ clearTimeout(id); id=setTimeout(()=> fn(...args), ms); }; }
function fitPlayerToViewport(){
  try{
    const el = playerHost; if (!el) return;
    const rectTop = el.getBoundingClientRect().top;
    const vh      = getVisualHeight();
    const safeB   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom')) || 0;
    const available = Math.max(0, vh - rectTop - safeB - 2);

    const vw      = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const idealH  = Math.round(vw * 9 / 16);

    const h = Math.min(idealH, available);
    el.style.height = h > 0 ? (h + 'px') : '';
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

/* ===== 시리즈 모드 안전 판정 & resumeCtx ===== */
function readResumeCtx(){ try{ return JSON.parse(sessionStorage.getItem('resumeCtx')||'null'); }catch{ return null; } }
function isSeriesModeOK(){
  const rc = readResumeCtx(); if (!rc || !rc.groupKey || !rc.subKey) return false;
  if (typeof rc.groupKey !== 'string' || !rc.groupKey.startsWith('series_')) return false;
  const pm = readPlayMeta() || null;
  const ok = !!(pm && Array.isArray(pm.cats) && pm.cats.length===1 && pm.cats[0]===rc.subKey);
  if (!ok){ try{ sessionStorage.removeItem('resumeCtx'); }catch{} }
  return ok;
}
let isSeriesMode = isSeriesModeOK();

/* ===== Resume 저장/복원 (resume.js 우선, 실패시 localStorage 폴백) ===== */
function sanitizeResumePayload(obj){
  if (!obj || typeof obj!=='object') return null;
  const out = {};
  const s = String(obj.sort||'');
  if (!(s==='createdAt-desc' || s==='createdAt-asc' || s.startsWith('random'))) return null;
  out.sort = s;
  const index = Math.max(0, Math.floor(Number(obj.index)||0));
  const t     = Math.max(0, Math.floor(Number(obj.t)||0));
  const savedAt = Number(obj.savedAt)||Date.now();
  out.index=index; out.t=t; out.savedAt=savedAt;
  return out;
}
async function saveResumeSafe(payload){
  const sane = sanitizeResumePayload(payload); if (!sane) return;
  const key = `resume:${payload.type}:${payload.groupKey}:${payload.subKey}`;
  try{
    const mod = await import('./resume.js');
    if (typeof mod.saveResume === 'function'){
      mod.saveResume(payload);
      return;
    }
  }catch{}
  try{ localStorage.setItem(key, JSON.stringify(sane)); }catch{}
}
async function loadResumeSafe(ctx){
  const key = `resume:${ctx.type}:${ctx.groupKey}:${ctx.subKey}`;
  try{
    const mod = await import('./resume.js');
    if (typeof mod.loadResume === 'function'){
      const v = mod.loadResume(ctx);
      return sanitizeResumePayload(v);
    }
  }catch{}
  try{
    const raw = localStorage.getItem(key);
    return sanitizeResumePayload(JSON.parse(raw||'null'));
  }catch{ return null; }
}

/* ===== YouTube IFrame API ===== */
let ytPlayer=null, saveTicker=null, firstReadyTweak=false;
function ensureYT(){
  return new Promise((res)=>{
    if (window.YT && window.YT.Player) return res();
    const it = setInterval(()=>{
      if (window.YT && window.YT.Player){ clearInterval(it); res(); }
    }, 50);
  });
}
window.onYouTubeIframeAPIReady = function(){};

async function loadCurrent(){
  const it = current(); if (!it) return;
  if (it.playable === false){ setTimeout(next, 80); return; }

  await ensureYT();

  if (!ytPlayer){
    ytPlayer = new YT.Player('player', {
      width:'100%', height:'100%',
      videoId: it.id || it.ytid || it.vid,
      playerVars: { autoplay:1, playsinline:1, modestbranding:1, rel:0, fs:1, controls:1 },
      events:     { onReady, onStateChange, onError }
    });
  } else if (typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById({ videoId: it.id || it.ytid || it.vid });
  } else {
    try { ytPlayer.cueVideoById && ytPlayer.cueVideoById({ videoId: it.id || it.ytid || it.vid }); } catch{}
  }

  // 진행 저장(시리즈만)
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
          sort: (readPlayMeta()?.sort || 'createdAt-asc'),
          index: idx,
          t
        });
      }catch{}
    }, RESUME_SAVE_MS);
  }

  fitPlayerToViewport();
}

async function onReady(){
  if (!firstReadyTweak){
    firstReadyTweak = true;
    try{ ytPlayer.mute(); ytPlayer.playVideo(); setTimeout(()=> ytPlayer.unMute(), 800); }catch{}
  }
  // 시리즈만 위치 복원(5초 이상일 때만)
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
    // ENDED → (시리즈) 다음 인덱스로 저장
    if (RESUME_ADVANCE_ON_END && isSeriesModeOK()) {
      const q = readPlayQueue() || queue;
      const nextIndex = Math.min(idx + 1, Math.max(0, (q && q.length ? q.length : 1) - 1));
      try{
        const rc = readResumeCtx(); if (rc){
          await saveResumeSafe({
            type: rc.typeForKey || 'video',
            groupKey: rc.groupKey,
            subKey: rc.subKey,
            sort: (readPlayMeta()?.sort || 'createdAt-asc'),
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

function onError(){ setTimeout(next, 100); }

/* ===== 이동/내비 ===== */
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
        sort: (readPlayMeta()?.sort || 'createdAt-asc'),
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
        sort: (readPlayMeta()?.sort || 'createdAt-asc'),
        index: idx - 1, t: 0
      });
    }
  }
  setPlayIndex(idx - 1);
  await loadCurrent();
}

function toggleFullscreen(){
  if (document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
  else { if (playerHost && playerHost.requestFullscreen) playerHost.requestFullscreen(); }
}

/* ===== 키보드 ===== */
window.addEventListener('keydown', (e)=>{
  const tag=(e.target && e.target.tagName || '').toLowerCase();
  if (tag==='input' || tag==='textarea') return;

  if (e.key==='ArrowLeft'){ e.preventDefault(); prev(); }
  else if (e.key==='ArrowRight'){ e.preventDefault(); next(); }
  else if (e.key===' ' || (e.key && e.key.toLowerCase()==='k')){
    e.preventDefault();
    try{
      const st = ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : null;
      if (st === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
    }catch{}
  }
  else if (e.key===','){ e.preventDefault(); try{ const t=ytPlayer.getCurrentTime(); ytPlayer.seekTo(Math.max(0,t-10), true); }catch{} }
  else if (e.key=== '.'){ e.preventDefault(); try{ const t=ytPlayer.getCurrentTime(); ytPlayer.seekTo(t+10, true); }catch{} }
  else if (e.key && e.key.toLowerCase()==='f'){ e.preventDefault(); toggleFullscreen(); }
  else if (e.key==='Escape'){ e.preventDefault(); history.back(); } // copytube 방식
});

/* ===== 모바일: 세로 스와이프 (↑ 다음 / ↓ 이전) ===== */
(function verticalSwipe(options){
  options = options || {};
  const areaEl  = options.areaEl || playerHost; // 제스처 유효 영역
  const threshold = Number(options.threshold||60); // 최소 Y 이동(px)
  const slopX     = Number(options.slopX||45);     // 허용 X 이동
  const timeMax   = Number(options.timeMax||700);  // 플릭 최대 지속(ms)
  if (!areaEl) return;

  let x0=0, y0=0, t0=0, active=false, canceled=false, dragging=false;

  function isInteractive(el){
    return !!(el && el.closest && el.closest('input,textarea,select,button,[role="button"],a,[contenteditable="true"]'));
  }
  function inArea(p){
    const r = areaEl.getBoundingClientRect();
    return p.clientX>=r.left && p.clientX<=r.right && p.clientY>=r.top && p.clientY<=r.bottom;
  }
  function getPoint(e){
    return (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
  }

  function start(e){
    const t = getPoint(e); if(!t) return;
    if (!inArea(t) || isInteractive(e.target)) return;
    x0=t.clientX; y0=t.clientY; t0=Date.now();
    active=true; canceled=false; dragging=false;
  }
  function move(e){
    if(!active) return;
    const t=getPoint(e); if(!t) return;
    const dx=t.clientX-x0, dy=t.clientY-y0;
    if (Math.abs(dx)>slopX){ canceled=true; active=false; return; }
    if (Math.abs(dy)>10){ dragging=true; }
    if (dragging) e.preventDefault(); // 수직 스와이프 중엔 스크롤 억제
  }
  function end(e){
    if(!active) return; active=false;
    const t=getPoint(e); if(!t) return;
    const dy=t.clientY-y0, dt=Date.now()-t0;
    const strong = Math.abs(dy)>=threshold;
    const quick  = dt<=timeMax && Math.abs(dy)>=Math.max(30, threshold*0.6);
    if (!(strong || quick)) return;
    if (dy <= -Math.max(threshold, 30)) next();     // ↑ 위로 → 다음
    else if (dy >= Math.max(threshold, 30)) prev(); // ↓ 아래로 → 이전
  }

  document.addEventListener('touchstart', start, {passive:true});
  document.addEventListener('touchmove',  move , {passive:false});
  document.addEventListener('touchend',   end  , {passive:true,capture:true});
  document.addEventListener('pointerdown',start,{passive:true});
  document.addEventListener('pointermove', move ,{passive:false});
  document.addEventListener('pointerup',  end  , {passive:true,capture:true});
})();

/* ===== 시작 ===== */
(async function(){
  // 큐가 비었으면 list 스냅샷 폴백 → 그래도 없으면 index
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
