// /js/watch.js — ArkTube Watch 완전판 v0.1.2 (세로 스와이프 + 시리즈 모드 안전판정)
// - 모바일 세로 스와이프: ↑ 다음 / ↓ 이전 (YouTube 앱 스타일)
// - 시리즈(resume) 동작은 "단일 series_ 서브키"일 때만 활성화, 아니면 자동 비활성화/정리
// - 나머지 기능: 상단바/드롭다운, 큐/메타, IFrame API, 연속재생, 자동 확장, 키보드 단축키 등 기존 유지

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  readPlayQueue, readPlayIndex, readPlayMeta,
  fetchMoreForWatchIfNeeded, readListSnapshot
} from './makelist.js';

/* ===== 브랜드/상수 ===== */
const isCopyTube = !!document.getElementById('welcome') || (document.title||'').toLowerCase().includes('copytube');
const GREETING_TEXT         = isCopyTube ? 'Welcome!' : 'Enjoy!';
const RESUME_SAVE_MS        = 10000; // 10s
const RESUME_RESTORE_MIN    = 5;     // 5s
const RESUME_ADVANCE_ON_END = true;
const KEY_PLAY_INDEX        = 'playIndex';

/* ===== DOM ===== */
const welcomeCT   = document.getElementById('welcome');
const menuBtnCT   = document.getElementById('menuBtn');
const backdropCT  = document.getElementById('menuBackdrop');
const brandHome   = document.getElementById('brandHome');

const welcomeAT   = document.getElementById('welcomeText');
const nickNameEl  = document.getElementById('nickName');
const btnMenuAT   = document.getElementById('btnMenu');
const btnDropdown = document.getElementById('btnDropdown');

const dropdown    = document.getElementById('dropdownMenu');

const signinLink  = document.getElementById('signinLink');
const signupLink  = document.getElementById('signupLink');
const btnSignOut  = document.getElementById('btnSignOut');
const btnMyUploads= document.getElementById('btnMyUploads');
const btnAbout    = document.getElementById('btnAbout');
const btnGoCategory = document.getElementById('btnGoCategory');
const btnList     = document.getElementById('btnList');
const btnGoUpload = document.getElementById('btnGoUpload');

const playerBox   = document.getElementById('playerBox'); // 권장 컨테이너
const playerHost  = playerBox || document.getElementById('videoContainer') || document.body;

/* ===== 상단바 초기화 ===== */
onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  const name = loggedIn ? (user.displayName || 'User') : '';

  if (isCopyTube && welcomeCT) welcomeCT.textContent = loggedIn ? `${GREETING_TEXT} ${name}` : GREETING_TEXT;
  else if (welcomeAT)          welcomeAT.textContent = loggedIn ? `${GREETING_TEXT} ${name}` : GREETING_TEXT;

  if (!isCopyTube && nickNameEl) nickNameEl.textContent = loggedIn ? name : '';

  if (signinLink)  signinLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (signupLink)  signupLink.style.display  = loggedIn ? 'none' : 'inline-block';
  if (btnSignOut)  btnSignOut.style.display  = loggedIn ? 'inline-block' : 'none';
  if (btnMyUploads) btnMyUploads.onclick = ()=> location.href = loggedIn ? './manage-uploads.html' : './signin.html';
});
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

if (brandHome){
  brandHome.addEventListener('click', (e)=>{ e.preventDefault(); location.href='./index.html'; });
}

/* ===== 드롭다운 ===== */
(function initDropdown(){
  const trigger = menuBtnCT || btnMenuAT || btnDropdown;
  if (!trigger || !dropdown) return;

  let open=false, offPointer=null, offKey=null;

  const setOpen = (v)=>{
    open=!!v;
    trigger.setAttribute('aria-expanded', String(open));
    dropdown.setAttribute('aria-hidden', String(!open));
    if (open){
      dropdown.classList.remove('hidden');
      requestAnimationFrame(()=> dropdown.classList.add('open'));
      if (backdropCT) backdropCT.classList.add('show');
      const first = dropdown.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : trigger)?.focus?.({preventScroll:true});
      bindDoc();
    } else {
      dropdown.classList.remove('open');
      setTimeout(()=> dropdown.classList.add('hidden'), 120);
      if (backdropCT) backdropCT.classList.remove('show');
      trigger.focus?.({preventScroll:true});
      unbindDoc();
    }
  };
  const toggle = ()=> setOpen(!open);

  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = (e)=>{
      if (e.target.closest('#dropdownMenu') || e.target.closest(`#${trigger.id}`)) return;
      setOpen(false);
    };
    const onKey = (e)=>{
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab' && open){
        const nodes = dropdown.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])`);
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
    if (backdropCT) backdropCT.addEventListener('click', ()=> setOpen(false), { once:true });
  }
  function unbindDoc(){ if(offPointer){offPointer();offPointer=null;} if(offKey){offKey();offKey=null;} }

  trigger.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  dropdown.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"],[role="menuitemradio"]')) setOpen(false); });

  btnAbout     ?.addEventListener('click', ()=> location.href='./about.html');
  btnGoCategory?.addEventListener('click', ()=> location.href='./category.html');
  btnList      ?.addEventListener('click', ()=> location.href='./list.html');
  btnGoUpload  ?.addEventListener('click', ()=> location.href='./upload.html');
})();

/* ===== 삼성 인터넷 하단 잘림 보정 ===== */
function getVisualHeight(){
  if (window.visualViewport && Number.isFinite(window.visualViewport.height)) return window.visualViewport.height;
  return window.innerHeight;
}
function debounce(fn, ms=80){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a), ms); }; }
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
    el.style.height = h > 0 ? `${h}px` : '';
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
let idx   = clamp(readPlayIndex(), 0, Math.max(0, (queue?.length||1)-1));
const meta = readPlayMeta() || { returnTo:'index' };

function clamp(n,min,max){ n=Number(n||0); if(!Number.isFinite(n)) n=0; return Math.max(min, Math.min(max, n)); }
function setPlayIndex(i){ idx=clamp(i,0,Math.max(0,queue.length-1)); try{ sessionStorage.setItem(KEY_PLAY_INDEX, String(idx)); }catch{} }
function current(){ queue = readPlayQueue() || queue; idx = clamp(idx,0,Math.max(0,queue.length-1)); return queue[idx]; }
function goBack(){
  const from = meta?.returnTo || new URL(location.href).searchParams.get('from') || 'index';
  location.href = (from === 'list') ? './list.html' : './index.html';
}

// 큐 없음 → 리스트 스냅샷 보조 → 그래도 없으면 index로
if (!Array.isArray(queue) || queue.length===0){
  const snap = readListSnapshot();
  if (Array.isArray(snap?.items) && snap.items.length){
    queue = snap.items; idx = 0;
    try{ sessionStorage.setItem('playQueue', JSON.stringify(queue)); }catch{}
    try{ sessionStorage.setItem('playIndex', '0'); }catch{}
  } else {
    location.replace('./index.html');
  }
}

/* ===== 시리즈 모드 안전 판정 ===== */
function readResumeCtx(){ try{ return JSON.parse(sessionStorage.getItem('resumeCtx')||'null'); }catch{ return null; } }
function isSeriesSubKey(v){ return typeof v==='string' && v.startsWith('pick'); } // makelist가 series_*의 children value를 저장
function computeSeriesMode(){
  const rc = readResumeCtx();
  if (!rc || !rc.groupKey || !rc.subKey) return false;
  if (typeof rc.groupKey !== 'string' || !rc.groupKey.startsWith('series_')) return false;

  const pm = readPlayMeta() || null;
  const ok = pm && Array.isArray(pm.cats) && pm.cats.length===1 && pm.cats[0]===rc.subKey && isSeriesSubKey(rc.subKey);
  if (!ok){
    try{ sessionStorage.removeItem('resumeCtx'); }catch{}
    return false;
  }
  return true;
}
let isSeriesMode = computeSeriesMode();

/* ===== Resume I/O ===== */
async function saveResume(payload){
  try{
    const mod = await import('./resume.js');
    if (typeof mod.saveResume === 'function'){ mod.saveResume(payload); return; }
  }catch{}
  const key = `resume:${payload.type}:${payload.groupKey}:${payload.subKey}`;
  sessionStorage.setItem(key, JSON.stringify({ index: payload.index, t: payload.t||0 }));
}
async function loadResumeValue(){
  const rc = readResumeCtx();
  if (!rc) return null;
  try{
    const mod = await import('./resume.js');
    if (typeof mod.loadResume === 'function'){
      return mod.loadResume({ type: rc.typeForKey||'video', groupKey: rc.groupKey, subKey: rc.subKey });
    }
  }catch{}
  const key = `resume:${(rc?.typeForKey||'video')}:${rc?.groupKey}:${rc?.subKey}`;
  try{ return JSON.parse(sessionStorage.getItem(key)||'null'); }catch{ return null; }
}

/* ===== YouTube IFrame API ===== */
let ytPlayer=null, saveTicker=null, firstReadyTweak=false;
function ensureYT(){ return new Promise(res=>{ if (window.YT?.Player) return res(); const it=setInterval(()=>{ if (window.YT?.Player){ clearInterval(it); res(); } },50); }); }
window.onYouTubeIframeAPIReady = function(){};

async function loadCurrent(){
  const it = current(); if (!it) return;

  // unplayable은 조용히 스킵
  if (it.playable === false){ setTimeout(next, 80); return; }

  await ensureYT();

  if (!ytPlayer){
    ytPlayer = new YT.Player('player', {
      width:'100%', height:'100%',
      videoId: it.id, // 최초는 videoId로
      playerVars: { autoplay:1, playsinline:1, modestbranding:1, rel:0, fs:1, controls:1 },
      events:     { onReady, onStateChange, onError }
    });
  } else if (typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById({ videoId: it.id });
  } else {
    try { ytPlayer.cueVideoById?.({ videoId: it.id }); } catch {}
  }

  // 진행 저장(시리즈만)
  if (saveTicker){ clearInterval(saveTicker); saveTicker=null; }
  isSeriesMode = computeSeriesMode();
  if (isSeriesMode){
    saveTicker = setInterval(async ()=>{
      try{
        const t = Math.floor(ytPlayer?.getCurrentTime?.() || 0);
        const rc = readResumeCtx(); if (!rc) return;
        await saveResume({
          type: rc.typeForKey || 'video',
          groupKey: rc.groupKey,
          subKey: rc.subKey,
          sort: (rc.sort || 'createdAt-asc'),
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
    try{ ytPlayer.mute(); ytPlayer.playVideo(); setTimeout(()=>ytPlayer.unMute(), 800); }catch{}
  }
  // 시리즈만 위치 복원
  if (computeSeriesMode()){
    try{
      const saved = await loadResumeValue();
      const t = Number(saved?.t||0);
      if (Number.isFinite(t) && t >= RESUME_RESTORE_MIN){ try{ ytPlayer.seekTo(t, true); }catch{} }
    }catch{}
  }
  setTimeout(fitPlayerToViewport, 120);
}

async function onStateChange(ev){
  const S = YT.PlayerState;
  if (ev.data === S.ENDED){
    // ENDED → (시리즈 모드일 때만) 다음 인덱스로 저장
    if (RESUME_ADVANCE_ON_END && computeSeriesMode()) {
      const q = readPlayQueue() || queue;
      const nextIndex = Math.min(idx + 1, Math.max(0, (q?.length || 1) - 1));
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
      }catch{}
    }

    try{ await fetchMoreForWatchIfNeeded(idx); }catch{}
    const autonext = localStorage.getItem('autonext') === '1';
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

  if (computeSeriesMode()){
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
  if (computeSeriesMode()){
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
  if (document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
  else { playerHost?.requestFullscreen?.(); }
}

/* ===== 키보드 ===== */
window.addEventListener('keydown',(e)=>{
  const tag=(e.target?.tagName||'').toLowerCase();
  if (['input','textarea'].includes(tag)) return;

  if (e.key==='ArrowLeft'){ e.preventDefault(); prev(); }
  else if (e.key==='ArrowRight'){ e.preventDefault(); next(); }
  else if (e.key===' ' || e.key.toLowerCase()==='k'){
    e.preventDefault();
    try{
      const st = ytPlayer?.getPlayerState?.();
      if (st === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
      else ytPlayer.playVideo();
    }catch{}
  }
  else if (e.key.toLowerCase()==='j'){ e.preventDefault(); try{ const t=ytPlayer.getCurrentTime(); ytPlayer.seekTo(Math.max(0,t-10), true); }catch{} }
  else if (e.key.toLowerCase()==='l'){ e.preventDefault(); try{ const t=ytPlayer.getCurrentTime(); ytPlayer.seekTo(t+10, true); }catch{} }
  else if (e.key.toLowerCase()==='f'){ e.preventDefault(); toggleFullscreen(); }
  else if (e.key==='Escape'){ e.preventDefault(); goBack(); }
});

/* ===== 모바일: 세로 스와이프 (↑ 다음 / ↓ 이전) ===== */
(function verticalSwipe({
  areaEl = playerHost,      // 제스처 유효 영역
  threshold = 60,           // 최소 Y 이동(px)
  slopX = 45,               // 허용되는 X 이동
  timeMax = 700             // 최대 지속(ms) — 플릭 감도
} = {}){
  if (!areaEl) return;

  let x0=0, y0=0, t0=0, active=false, canceled=false, dragging=false;

  function isInteractive(el){
    return !!(el && el.closest('input,textarea,select,button,[role="button"],a,[contenteditable="true"]'));
  }
  function inArea(p){
    const r = areaEl.getBoundingClientRect();
    return p.clientX>=r.left && p.clientX<=r.right && p.clientY>=r.top && p.clientY<=r.bottom;
  }
  function start(e){
    const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
    if (!inArea(t) || isInteractive(e.target)) return;
    x0=t.clientX; y0=t.clientY; t0=Date.now();
    active=true; canceled=false; dragging=false;
  }
  function move(e){
    if(!active) return;
    const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
    const dx=t.clientX-x0, dy=t.clientY-y0;
    if (Math.abs(dx)>slopX){ canceled=true; active=false; return; }
    if (Math.abs(dy)>10){ dragging=true; } // 의도 감지
    if (dragging) e.preventDefault(); // 수직 스와이프 중엔 스크롤 억제
  }
  function end(e){
    if(!active) return; active=false;
    const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
    const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
    if (canceled) return;

    // 플릭/드래그 모두 허용: 시간/거리 조건 중 하나 충족
    const strong = Math.abs(dy)>=threshold;
    const quick  = dt<=timeMax && Math.abs(dy)>=Math.max(30, threshold*0.6);
    if (!(strong || quick)) return;

    if (dy <= -Math.max(threshold, 30)){ // ↑ 위로 → 다음
      next();
    } else if (dy >=  Math.max(threshold, 30)){ // ↓ 아래로 → 이전
      prev();
    }
  }

  document.addEventListener('touchstart', start, {passive:true});
  document.addEventListener('touchmove',  move , {passive:false});
  document.addEventListener('touchend',   end  , {passive:true,capture:true});
  document.addEventListener('pointerdown',start,{passive:true});
  document.addEventListener('pointermove', move ,{passive:false});
  document.addEventListener('pointerup',  end  , {passive:true,capture:true});
})();

/* ===== 시작 ===== */
await loadCurrent();
