// /js/watch.js — ArkTube Watch 완전판 v0.1.3
// - 브랜드 분기 제거(공통 규격)
// - 모바일 세로 스와이프: ↑ 다음 / ↓ 이전
// - 시리즈 resume: "단일 series_ 서브키"일 때만 활성(아니면 자동 비활성/정리)

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  readPlayQueue, readPlayIndex, readPlayMeta,
  fetchMoreForWatchIfNeeded, readListSnapshot
} from './makelist.js';

/* ===== 상수 ===== */
const GREETING_TEXT         = 'Welcome!';
const RESUME_SAVE_MS        = 10000; // 10s
const RESUME_RESTORE_MIN    = 5;     // 5s
const RESUME_ADVANCE_ON_END = true;
const KEY_PLAY_INDEX        = 'playIndex';

/* ===== DOM (공통 id 우선, 없으면 대체 id) ===== */
const welcomeEl   = document.getElementById('welcome') || document.getElementById('welcomeText');
const menuBtn     = document.getElementById('menuBtn') || document.getElementById('btnMenu') || document.getElementById('btnDropdown');
const menuBackdrop= document.getElementById('menuBackdrop'); // 있으면 사용
const dropdown    = document.getElementById('dropdownMenu');
const brandHome   = document.getElementById('brandHome');

const signinLink  = document.getElementById('signinLink');
const signupLink  = document.getElementById('signupLink');
const btnSignOut  = document.getElementById('btnSignOut');
const btnMyUploads= document.getElementById('btnMyUploads');
const btnAbout    = document.getElementById('btnAbout');
const btnGoCategory = document.getElementById('btnGoCategory');
const btnList     = document.getElementById('btnList');
const btnGoUpload = document.getElementById('btnGoUpload');

const playerBox   = document.getElementById('playerBox');
const playerHost  = playerBox || document.getElementById('videoContainer') || document.body;

/* ===== 상단바 초기화 ===== */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  const name = loggedIn ? (user.displayName || 'User') : '';

  if (welcomeEl) welcomeEl.textContent = loggedIn ? `${GREETING_TEXT} ${name}` : GREETING_TEXT;

  if (signinLink)  signinLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (signupLink)  signupLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (btnSignOut)  btnSignOut.style.display  = loggedIn ? 'inline-block' : 'none';
  if (btnMyUploads) btnMyUploads.onclick = function(){ location.href = loggedIn ? './manage-uploads.html' : './signin.html'; };
});
if (btnSignOut){
  btnSignOut.addEventListener('click', async function(){ try{ await fbSignOut(); }catch(e){} location.reload(); });
}
if (brandHome){
  brandHome.addEventListener('click', function(e){ e.preventDefault(); location.href='./index.html'; });
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
      requestAnimationFrame(function(){ dropdown.classList.add('open'); });
      if (menuBackdrop) menuBackdrop.classList.add('show');

      const first = dropdown.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : menuBtn).focus({preventScroll:true});
      bindDoc();
    }else{
      dropdown.classList.remove('open');
      setTimeout(function(){ dropdown.classList.add('hidden'); }, 120);
      if (menuBackdrop) menuBackdrop.classList.remove('show');
      menuBtn.focus({preventScroll:true});
      unbindDoc();
    }
  }
  function toggle(){ setOpen(!open); }

  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = function(e){
      if (e.target.closest('#dropdownMenu') || e.target.closest('#'+menuBtn.id)) return;
      setOpen(false);
    };
    const onKey = function(e){
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
    offPointer = function(){ document.removeEventListener('pointerdown', onPointer, { passive:true }); };
    offKey     = function(){ document.removeEventListener('keydown', onKey); };
    if (menuBackdrop) menuBackdrop.addEventListener('click', function(){ setOpen(false); }, { once:true });
  }
  function unbindDoc(){ if(offPointer){offPointer(); offPointer=null;} if(offKey){offKey(); offKey=null;} }

  menuBtn.addEventListener('click', function(e){ e.preventDefault(); toggle(); });
  dropdown.addEventListener('click', function(e){
    if (e.target.closest('a,button,[role="menuitem"],[role="menuitemradio"]')) setOpen(false);
  });

  if (btnAbout)      btnAbout.addEventListener('click', function(){ location.href='./about.html'; });
  if (btnGoCategory) btnGoCategory.addEventListener('click', function(){ location.href='./category.html'; });
  if (btnList)       btnList.addEventListener('click', function(){ location.href='./list.html'; });
  if (btnGoUpload)   btnGoUpload.addEventListener('click', function(){ location.href='./upload.html'; });
})();

/* ===== 삼성 인터넷 하단 잘림 보정 ===== */
function getVisualHeight(){
  if (window.visualViewport && Number.isFinite(window.visualViewport.height)) return window.visualViewport.height;
  return window.innerHeight;
}
function debounce(fn, ms){ let id; return function(){ const args=arguments; clearTimeout(id); id=setTimeout(function(){ fn.apply(null,args); }, ms); }; }
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
  }catch(e){}
}
fitPlayerToViewport();
window.addEventListener('resize', debounce(fitPlayerToViewport, 80));
window.addEventListener('orientationchange', function(){ setTimeout(fitPlayerToViewport, 250); });
document.addEventListener('visibilitychange', function(){ if (!document.hidden) setTimeout(fitPlayerToViewport, 120); });
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', debounce(fitPlayerToViewport, 50));
  window.visualViewport.addEventListener('scroll', debounce(fitPlayerToViewport, 50));
}

/* ===== 큐/메타 ===== */
let queue = readPlayQueue();
let idx   = clamp(readPlayIndex(), 0, Math.max(0, (queue && queue.length ? queue.length : 1)-1));
const meta = readPlayMeta() || { returnTo:'index' };

function clamp(n,min,max){ n=Number(n||0); if(!Number.isFinite(n)) n=0; return Math.max(min, Math.min(max, n)); }
function setPlayIndex(i){ idx=clamp(i,0,Math.max(0,queue.length-1)); try{ sessionStorage.setItem(KEY_PLAY_INDEX, String(idx)); }catch(e){} }
function current(){ queue = readPlayQueue() || queue; idx = clamp(idx,0,Math.max(0,queue.length-1)); return queue[idx]; }
function goBack(){
  const from = meta && meta.returnTo ? meta.returnTo : (new URL(location.href).searchParams.get('from') || 'index');
  location.href = (from === 'list') ? './list.html' : './index.html';
}

// 큐가 비었으면 리스트 스냅샷으로 보조, 그래도 없으면 index로
if (!Array.isArray(queue) || queue.length===0){
  const snap = readListSnapshot();
  if (snap && Array.isArray(snap.items) && snap.items.length){
    queue = snap.items; idx = 0;
    try{ sessionStorage.setItem('playQueue', JSON.stringify(queue)); }catch(e){}
    try{ sessionStorage.setItem('playIndex', '0'); }catch(e){}
  } else {
    location.replace('./index.html');
  }
}

/* ===== 시리즈 모드 안전 판정 ===== */
// 규칙: resumeCtx가 있고, groupKey가 'series_'로 시작하며,
//       playMeta.cats가 [단일값]이고 그 값 === resumeCtx.subKey 일 때만 시리즈 모드.
function readResumeCtx(){ try{ return JSON.parse(sessionStorage.getItem('resumeCtx')||'null'); }catch(e){ return null; } }
function isSeriesModeOK(){
  const rc = readResumeCtx(); if (!rc || !rc.groupKey || !rc.subKey) return false;
  if (typeof rc.groupKey !== 'string' || rc.groupKey.indexOf('series_') !== 0) return false;

  const pm = readPlayMeta() || null;
  const ok = !!(pm && Array.isArray(pm.cats) && pm.cats.length===1 && pm.cats[0]===rc.subKey);
  if (!ok){ try{ sessionStorage.removeItem('resumeCtx'); }catch(e){} }
  return ok;
}
let isSeriesMode = isSeriesModeOK();

/* ===== Resume I/O (시리즈 전용) ===== */
async function saveResume(payload){
  try{
    const mod = await import('./resume.js');
    if (typeof mod.saveResume === 'function'){ mod.saveResume(payload); return; }
  }catch(e){}
  const key = 'resume:' + payload.type + ':' + payload.groupKey + ':' + payload.subKey;
  sessionStorage.setItem(key, JSON.stringify({ index: payload.index, t: payload.t||0 }));
}
async function loadResumeValue(){
  const rc = readResumeCtx(); if (!rc) return null;
  try{
    const mod = await import('./resume.js');
    if (typeof mod.loadResume === 'function'){
      return mod.loadResume({ type: rc.typeForKey||'video', groupKey: rc.groupKey, subKey: rc.subKey });
    }
  }catch(e){}
  const key = 'resume:' + (rc.typeForKey||'video') + ':' + rc.groupKey + ':' + rc.subKey;
  try{ return JSON.parse(sessionStorage.getItem(key)||'null'); }catch(e){ return null; }
}

/* ===== YouTube IFrame API ===== */
let ytPlayer=null, saveTicker=null, firstReadyTweak=false;
function ensureYT(){
  return new Promise(function(res){
    if (window.YT && window.YT.Player) return res();
    const it = setInterval(function(){
      if (window.YT && window.YT.Player){ clearInterval(it); res(); }
    }, 50);
  });
}
window.onYouTubeIframeAPIReady = function(){};

async function loadCurrent(){
  const it = current(); if (!it) return;

  // unplayable은 조용히 스킵
  if (it.playable === false){ setTimeout(next, 80); return; }

  await ensureYT();

  if (!ytPlayer){
    ytPlayer = new YT.Player('player', {
      width:'100%', height:'100%',
      videoId: it.id,
      playerVars: { autoplay:1, playsinline:1, modestbranding:1, rel:0, fs:1, controls:1 },
      events:     { onReady, onStateChange, onError }
    });
  } else if (typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById({ videoId: it.id });
  } else {
    try { ytPlayer.cueVideoById && ytPlayer.cueVideoById({ videoId: it.id }); } catch(e){}
  }

  // 진행 저장(시리즈만)
  if (saveTicker){ clearInterval(saveTicker); saveTicker=null; }
  isSeriesMode = isSeriesModeOK();
  if (isSeriesMode){
    saveTicker = setInterval(async function(){
      try{
        const t = Math.floor((ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0) || 0);
        const rc = readResumeCtx(); if (!rc) return;
        await saveResume({
          type: rc.typeForKey || 'video',
          groupKey: rc.groupKey,
          subKey: rc.subKey,
          sort: (rc.sort || 'createdAt-asc'),
          index: idx,
          t
        });
      }catch(e){}
    }, RESUME_SAVE_MS);
  }

  fitPlayerToViewport();
}

async function onReady(){
  if (!firstReadyTweak){
    firstReadyTweak = true;
    try{ ytPlayer.mute(); ytPlayer.playVideo(); setTimeout(function(){ ytPlayer.unMute(); }, 800); }catch(e){}
  }
  // 시리즈만 위치 복원
  if (isSeriesModeOK()){
    try{
      const saved = await loadResumeValue();
      const t = Number(saved && saved.t || 0);
      if (Number.isFinite(t) && t >= RESUME_RESTORE_MIN){ try{ ytPlayer.seekTo(t, true); }catch(e){} }
    }catch(e){}
  }
  setTimeout(fitPlayerToViewport, 120);
}

async function onStateChange(ev){
  const S = YT.PlayerState;
  if (ev.data === S.ENDED){
    // ENDED → (시리즈 모드일 때만) 다음 인덱스로 저장
    if (RESUME_ADVANCE_ON_END && isSeriesModeOK()) {
      const q = readPlayQueue() || queue;
      const nextIndex = Math.min(idx + 1, Math.max(0, (q && q.length ? q.length : 1) - 1));
      try{
        const rc = readResumeCtx(); if (rc){
          await saveResume({
            type: rc.typeForKey || 'video',
            groupKey: rc.groupKey,
            subKey: rc.subKey,
            sort: (rc.sort || 'createdAt-asc'),
            index: nextIndex,
            t: 0
          });
        }
      }catch(e){}
    }

    try{ await fetchMoreForWatchIfNeeded(idx); }catch(e){}
    const autonext = localStorage.getItem('autonext') === '1';
    if (autonext) next();
  } else if (ev.data === S.PLAYING){
    setTimeout(fitPlayerToViewport, 60);
  }
}

function onError(){ setTimeout(next, 100); }

/* ===== 이동/내비 ===== */
async function next(){
  try{ await fetchMoreForWatchIfNeeded(idx); }catch(e){}
  queue = readPlayQueue() || queue;
  if (idx >= queue.length-1){ setPlayIndex(queue.length-1); return; }

  if (isSeriesModeOK()){
    const rc = readResumeCtx();
    if (rc){
      await saveResume({
        type: rc.typeForKey || 'video',
        groupKey: rc.groupKey, subKey: rc.subKey,
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
      await saveResume({
        type: rc.typeForKey || 'video',
        groupKey: rc.groupKey, subKey: rc.subKey,
        index: idx - 1, t: 0
      });
    }
  }
  setPlayIndex(idx - 1);
  await loadCurrent();
}

function toggleFullscreen(){
  if (document.fullscreenElement){ document.exitFullscreen().catch(function(){}); }
  else { if (playerHost && playerHost.requestFullscreen) playerHost.requestFullscreen(); }
}

/* ===== 키보드 ===== */
window.addEventListener('keydown', function(e){
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
    }catch(err){}
  }
  else if (e.key && e.key.toLowerCase()==='j'){ e.preventDefault(); try{ const t=ytPlayer.getCurrentTime(); ytPlayer.seekTo(Math.max(0,t-10), true); }catch(err){} }
  else if (e.key && e.key.toLowerCase()==='l'){ e.preventDefault(); try{ const t=ytPlayer.getCurrentTime(); ytPlayer.seekTo(t+10, true); }catch(err){} }
  else if (e.key && e.key.toLowerCase()==='f'){ e.preventDefault(); toggleFullscreen(); }
  else if (e.key==='Escape'){ e.preventDefault(); goBack(); }
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
    const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
    if (canceled) return;

    const strong = Math.abs(dy)>=threshold;
    const quick  = dt<=timeMax && Math.abs(dy)>=Math.max(30, threshold*0.6);
    if (!(strong || quick)) return;

    if (dy <= -Math.max(threshold, 30)) next();   // ↑ 위로 → 다음
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
(async function(){ await loadCurrent(); })();
