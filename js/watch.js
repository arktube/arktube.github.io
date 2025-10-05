// /js/watch.js — ArkTube Watch 완전판 (admin-common 미사용)
// - 상단바: Firebase Auth로 displayName/드롭다운(v1.5) 직접 구현
// - 재생: IFrame API (CopyTube v1.5 동일 파라미터), 모바일/삼성인터넷 자동재생 보정(mute→play→unMute)
// - 큐: makelist 세션(readPlayQueue/readPlayIndex/readPlayMeta), 남은≤10 자동 확장(fetchMoreForWatchIfNeeded)
// - 연속재생: localStorage.autonext === '1' 이면 종료 시 자동 다음
// - resume: 시리즈(resumeCtx 존재)일 때만 인덱스/시간 저장·복원, 저장 주기 10초
// - UI: 화면엔 상단바+플레이어만(메타/버튼/오버레이 없음)
// - 키보드: ←/→, Space/K, J/L, F, Esc(뒤로)

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  readPlayQueue, readPlayIndex, readPlayMeta,
  fetchMoreForWatchIfNeeded, readListSnapshot
} from './makelist.js';

/* ───────── 상수 ───────── */
const GREETING_TEXT     = 'Enjoy';
const RESUME_SAVE_MS    = 10000; // 10초 저장 주기
const RESUME_RESTORE_MIN = 5;    // 5초 이상 저장돼 있으면 복원

/* ───────── 상단바 초기화 (admin-common 미사용) ───────── */
const welcomeText = document.getElementById('welcomeText');
const nickNameEl  = document.getElementById('nickName');
const btnDropdown = document.getElementById('btnDropdown');
const dropdown    = document.getElementById('dropdownMenu');
const signinLink  = document.getElementById('signinLink');
const signupLink  = document.getElementById('signupLink');
const btnSignOut  = document.getElementById('btnSignOut');
const btnMyUploads= document.getElementById('btnMyUploads');

onAuthStateChanged(auth, (user)=>{
  const name = user?.displayName || 'Guest';
  if (welcomeText) welcomeText.textContent = `${GREETING_TEXT} ${name}`;
  if (nickNameEl)  nickNameEl.textContent = name;

  const loggedIn = !!user;
  if (signinLink)  signinLink.style.display = loggedIn ? 'none' : 'block';
  if (signupLink)  signupLink.style.display = loggedIn ? 'none' : 'block';
  if (btnSignOut)  btnSignOut.style.display = loggedIn ? 'block' : 'none';
  if (btnMyUploads) btnMyUploads.onclick = ()=> location.href = loggedIn ? './manage-uploads.html' : './signin.html';
});
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

// 드롭다운 v1.5(aria/포커스트랩/외부클릭)
(function initDropdownV15(){
  let open=false, offPointer=null, offKey=null;
  function setOpen(v){
    open=!!v;
    btnDropdown.setAttribute('aria-expanded', String(open));
    dropdown.setAttribute('aria-hidden', String(!open));
    if (open){
      dropdown.classList.remove('hidden');
      requestAnimationFrame(()=> dropdown.classList.add('open'));
      const first = dropdown.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : btnDropdown)?.focus?.({preventScroll:true});
      bindDoc();
    } else {
      dropdown.classList.remove('open');
      setTimeout(()=> dropdown.classList.add('hidden'), 150);
      btnDropdown.focus?.({preventScroll:true});
      unbindDoc();
    }
  }
  function toggle(){ setOpen(!open); }
  function bindDoc(){
    if (offPointer || offKey) return;
    const onPointer = (e)=>{
      if (e.target.closest('#dropdownMenu') || e.target.closest('#btnDropdown')) return;
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
  function unbindDoc(){ if(offPointer){offPointer();offPointer=null;} if(offKey){offKey();offKey=null;} }
  btnDropdown.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  dropdown.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });
})();

/* ───────── 플레이어/큐 ───────── */
const playerBox = document.getElementById('playerBox');
let player=null, saveTicker=null;

let queue = readPlayQueue();
let idx   = clamp(readPlayIndex(), 0, Math.max(0, (queue?.length||1)-1));
const meta = readPlayMeta() || { returnTo:'index' };

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

function clamp(n,min,max){ n=Number(n||0); if(!Number.isFinite(n)) n=0; return Math.max(min, Math.min(max, n)); }
function setPlayIndex(i){ idx = clamp(i, 0, Math.max(0, queue.length-1)); try{ sessionStorage.setItem('playIndex', String(idx)); }catch{} }
function current(){ queue = readPlayQueue() || queue; idx = clamp(idx,0,Math.max(0,queue.length-1)); return queue[idx]; }
function goBack(){
  const from = meta?.returnTo || new URL(location.href).searchParams.get('from') || 'index';
  location.href = (from === 'list') ? './list.html' : './index.html';
}

/* ───────── resume (시리즈만) ───────── */
const resumeCtx = (()=>{ try{ return JSON.parse(sessionStorage.getItem('resumeCtx')||'null'); }catch{ return null; }})();
const isSeriesMode = !!(resumeCtx && resumeCtx.groupKey && resumeCtx.subKey);

async function saveResume(payload){
  try{
    const mod = await import('./resume.js');
    if (typeof mod.saveResume === 'function'){ mod.saveResume(payload); return; }
  }catch{/* 폴백 아래로 */}
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

/* ───────── IFrame API ───────── */
function ensureYT(){ return new Promise(res=>{ if (window.YT?.Player) return res(); const it=setInterval(()=>{ if (window.YT?.Player){ clearInterval(it); res(); } }, 50); }); }
window.onYouTubeIframeAPIReady = function(){};

async function loadCurrent(){
  const it = current(); if (!it) return;

  // unplayable은 조용히 스킵
  if (it.playable === false){ setTimeout(next, 100); return; }

  await ensureYT();

  if (!player){
    player = new YT.Player('player', {
      width:'100%', height:'100%',
      playerVars:{ autoplay:1, playsinline:1, modestbranding:1, rel:0, fs:1, controls:1 },
      events:{ onReady, onStateChange, onError }
    });
  }
  player.loadVideoById({ videoId: it.id });

  // 진행 저장 타이머 (시리즈에서만)
  if (saveTicker){ clearInterval(saveTicker); saveTicker=null; }
  if (isSeriesMode){
    saveTicker = setInterval(async ()=>{
      try{
        const t = Math.floor(player.getCurrentTime?.() || 0);
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
}

let firstReadyTweak=false;
async function onReady(){
  // 자동재생 보정(모바일/삼성인터넷)
  if (!firstReadyTweak){ firstReadyTweak=true; try{ player.mute(); player.playVideo(); setTimeout(()=>player.unMute(), 800); }catch{} }

  // 시리즈만 위치 복원
  if (isSeriesMode){
    try{
      const saved = await loadResumeValue();
      const t = Number(saved?.t||0);
      if (Number.isFinite(t) && t >= RESUME_RESTORE_MIN){ try{ player.seekTo(t, true); }catch{} }
    }catch{}
  }
}
async function onStateChange(ev){
  const S = YT.PlayerState;
  if (ev.data === S.ENDED){
    try{ await fetchMoreForWatchIfNeeded(idx); }catch{}
    const autonext = localStorage.getItem('autonext') === '1';
    if (autonext) next();
  }
}
function onError(){ setTimeout(next, 120); }

/* ───────── 이동 ───────── */
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

/* ───────── 전체화면 ───────── */
function toggleFullscreen(){
  if (document.fullscreenElement){ document.exitFullscreen().catch(()=>{}); }
  else { playerBox.requestFullscreen?.().catch(()=>{}); }
}

/* ───────── 키보드 단축키 ───────── */
window.addEventListener('keydown',(e)=>{
  const tag=(e.target?.tagName||'').toLowerCase();
  if (['input','textarea'].includes(tag)) return;

  if (e.key==='ArrowLeft'){ e.preventDefault(); prev(); }
  else if (e.key==='ArrowRight'){ e.preventDefault(); next(); }
  else if (e.key===' ' || e.key.toLowerCase()==='k'){ e.preventDefault(); try{ const st=player?.getPlayerState?.(); if(st===YT.PlayerState.PLAYING) player.pauseVideo(); else player.playVideo(); }catch{} }
  else if (e.key.toLowerCase()==='j'){ e.preventDefault(); try{ const t=player.getCurrentTime(); player.seekTo(Math.max(0,t-10), true); }catch{} }
  else if (e.key.toLowerCase()==='l'){ e.preventDefault(); try{ const t=player.getCurrentTime(); player.seekTo(t+10, true); }catch{} }
  else if (e.key.toLowerCase()==='f'){ e.preventDefault(); toggleFullscreen(); }
  else if (e.key==='Escape'){ e.preventDefault(); goBack(); }
});

/* ───────── 시작 ───────── */
await loadCurrent();
