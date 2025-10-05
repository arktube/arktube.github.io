// /js/watch.js — ArkTube Watch 완전판 (수정판)
// - 상단바: Enjoy + 계정표시. 드롭다운은 #btnMenu(우선) 또는 #btnDropdown(폴백) 트리거.
// - makelist 연동: readPlayQueue/readPlayIndex/readPlayMeta/fetchMoreForWatchIfNeeded/readListSnapshot
// - 시리즈(resumeCtx)만 이어보기 저장·복원(주기 10초, 복원 임계 5초)
// - IFrame API: 첫 생성은 videoId로, 이후 loadVideoById (레이스/충돌 방지)
// - 연속재생(localStorage.autonext === '1'), unplayable 자동 스킵, 남은≤10 자동 확장
// - 키보드: ←/→, Space/K, J/L, F, Esc(뒤로)
// - 삼성인터넷 하단 잘림: visualViewport 기반 동적 핏

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  readPlayQueue, readPlayIndex, readPlayMeta,
  fetchMoreForWatchIfNeeded, readListSnapshot
} from './makelist.js';

/* ===== 상수/DOM ===== */
const GREETING_TEXT       = 'Enjoy';
const RESUME_SAVE_MS      = 10000; // 10s 저장 주기 (시리즈만)
const RESUME_RESTORE_MIN  = 5;     // 5s 이상 저장돼 있으면 복원
const KEY_PLAY_INDEX      = 'playIndex';
const RESUME_ADVANCE_ON_END = true; // ✅ ENDED 시 다음 인덱스로 이어보기 저장(시리즈만)

const welcomeText = document.getElementById('welcomeText');
const nickNameEl  = document.getElementById('nickName');

// 드롭다운: copytube v1.5 스타일(트리거 분리)
// - HTML에 #btnMenu가 있으면 그걸 사용(권장)
// - 없으면 #btnDropdown으로 폴백
const btnMenu     = document.getElementById('btnMenu');
const btnDropdown = document.getElementById('btnDropdown');
const menuTrigger = btnMenu || btnDropdown;
const dropdown    = document.getElementById('dropdownMenu');

const signinLink  = document.getElementById('signinLink');
const signupLink  = document.getElementById('signupLink');
const btnSignOut  = document.getElementById('btnSignOut');
const btnMyUploads= document.getElementById('btnMyUploads');

const playerBox   = document.getElementById('playerBox');

/* ===== 상단바 초기화 (admin-common 미사용) ===== */
onAuthStateChanged(auth, (user)=>{
  const name = user?.displayName || 'Guest';
  if (welcomeText) welcomeText.textContent = `${GREETING_TEXT} ${name}`;
  if (nickNameEl)  nickNameEl.textContent  = name;

  const loggedIn = !!user;
  if (signinLink)   signinLink.style.display = loggedIn ? 'none' : 'block';
  if (signupLink)   signupLink.style.display = loggedIn ? 'none' : 'block';
  if (btnSignOut)   btnSignOut.style.display = loggedIn ? 'block' : 'none';
  if (btnMyUploads) btnMyUploads.onclick = ()=> location.href = loggedIn ? './manage-uploads.html' : './signin.html';
});
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

// 드롭다운 v1.5 (메뉴 트리거 = #btnMenu 우선)
(function initDropdownV15(){
  if (!menuTrigger || !dropdown) return;

  let open=false, offPointer=null, offKey=null;
  function setOpen(v){
    open=!!v;
    menuTrigger.setAttribute('aria-expanded', String(open));
    dropdown.setAttribute('aria-hidden', String(!open));
    if (open){
      dropdown.classList.remove('hidden');
      requestAnimationFrame(()=> dropdown.classList.add('open'));
      const first = dropdown.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : menuTrigger)?.focus?.({preventScroll:true});
      bindDoc();
    } else {
      dropdown.classList.remove('open');
      setTimeout(()=> dropdown.classList.add('hidden'), 150);
      menuTrigger.focus?.({preventScroll:true});
      unbindDoc();
    }
  }
  function toggle(){ setOpen(!open); }
  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = (e)=>{
      if (e.target.closest('#dropdownMenu') || e.target.closest(`#${menuTrigger.id}`)) return;
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
  }
  function unbindDoc(){ if(offPointer){offPointer();offPointer=null;} if(offKey){offKey();offKey=null;} }
  menuTrigger.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  dropdown.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });
})();

/* ===== 삼성 인터넷 하단 잘림 보정 ===== */
function getVisualHeight(){
  if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
    return window.visualViewport.height;
  }
  return window.innerHeight;
}
function debounce(fn, ms=80){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a), ms); }; }
function fitPlayerToViewport(){
  try{
    const el = playerBox;
    if (!el) return;
    const rectTop = el.getBoundingClientRect().top;
    const vh      = getVisualHeight();
    const safeB   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0;
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

/* ===== Resume (시리즈만) ===== */
const resumeCtx = (()=>{ try{ return JSON.parse(sessionStorage.getItem('resumeCtx')||'null'); }catch{ return null; }})();
const isSeriesMode = !!(resumeCtx && resumeCtx.groupKey && resumeCtx.subKey);

async function saveResume(payload){
  try{
    const mod = await import('./resume.js');
    if (typeof mod.saveResume === 'function'){ mod.saveResume(payload); return; }
  }catch{}
  const key = `resume:${payload.type}:${payload.groupKey}:${payload.subKey}`;
  sessionStorage.setItem(key, JSON.stringify({ index: payload.index, t: payload.t||0 }));
}
async function loadResumeValue(){
  try{
    const mod = await import('./resume.js');
    if (typeof mod.loadResume === 'function'){
      return mod.loadResume({ type: resumeCtx.typeForKey||'video', groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
    }
  }catch{}
  const key = `resume:${(resumeCtx?.typeForKey||'video')}:${resumeCtx?.groupKey}:${resumeCtx?.subKey}`;
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
    // ✅ 최초 생성은 videoId로 (loadVideoById 레이스 방지)
    ytPlayer = new YT.Player('player', {
      width:'100%', height:'100%',
      videoId: it.id,
      playerVars: { autoplay:1, playsinline:1, modestbranding:1, rel:0, fs:1, controls:1 },
      events:     { onReady, onStateChange, onError }
    });
  } else if (typeof ytPlayer.loadVideoById === 'function') {
    ytPlayer.loadVideoById({ videoId: it.id });
  } else {
    // 이론상 오지 않지만 방어
    try { ytPlayer.cueVideoById?.({ videoId: it.id }); } catch {}
  }

  // 진행 저장(시리즈만)
  if (saveTicker){ clearInterval(saveTicker); saveTicker=null; }
  if (isSeriesMode){
    saveTicker = setInterval(async ()=>{
      try{
        const t = Math.floor(ytPlayer?.getCurrentTime?.() || 0);
        await saveResume({
          type: resumeCtx.typeForKey || 'video',
          groupKey: resumeCtx.groupKey,
          subKey: resumeCtx.subKey,
          sort: (resumeCtx.sort || 'createdAt-asc'),
          index: idx,
          t
        });
      }catch{}
    }, RESUME_SAVE_MS);
  }

  // 새 영상 로드 후에도 뷰포트 맞춤
  fitPlayerToViewport();
}

async function onReady(){
  // 모바일/삼성인터넷 자동재생 보정
  if (!firstReadyTweak){
    firstReadyTweak = true;
    try{ ytPlayer.mute(); ytPlayer.playVideo(); setTimeout(()=>ytPlayer.unMute(), 800); }catch{}
  }
  // 시리즈만 위치 복원
  if (isSeriesMode){
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
    // ✅ 시리즈 모드라면, autonext와 무관하게 '다음 인덱스'로 이어보기 저장(선호 UX)
    if (RESUME_ADVANCE_ON_END && isSeriesMode) {
      const q = readPlayQueue() || queue;
      const nextIndex = Math.min(idx + 1, Math.max(0, (q?.length || 1) - 1));
      try{
        await saveResume({
          type: resumeCtx.typeForKey || 'video',
          groupKey: resumeCtx.groupKey,
          subKey: resumeCtx.subKey,
          sort: (resumeCtx.sort || 'createdAt-asc'),
          index: nextIndex,
          t: 0
        });
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

  if (isSeriesMode){
    await saveResume({
      type: resumeCtx.typeForKey || 'video',
      groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey,
      index: idx + 1, t: 0
    });
  }
  setPlayIndex(idx + 1);
  await loadCurrent();
}

async function prev(){
  if (idx <= 0) return;
  if (isSeriesMode){
    await saveResume({
      type: resumeCtx.typeForKey || 'video',
      groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey,
      index: idx - 1, t: 0
    });
  }
  setPlayIndex(idx - 1);
  await loadCurrent();
}

function toggleFullscreen(){
  if (document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
  else { playerBox.requestFullscreen?.().catch(()=>{}); }
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

/* ===== 시작 ===== */
await loadCurrent();
