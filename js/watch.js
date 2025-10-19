// FILE: /js/watch.js — ArkTube (queue-only v0.3.1)
// - 세션 playQueue/playIndex 사용 (makelist.js 생산물)
// - 상단바/드롭다운 v1.5 a11y + greeting "Enjoy!"
// - (3) 끝나갈 때 자동 추가 로드(fetchMoreForWatchIfNeeded)
// - (4) 시리즈 시청 중 10초마다 이어보기 저장(resume.saveResume)
// - 외부 모듈 로딩: <script type="module" src="/js/watch.js?v=0.3.1"></script> 로 사용 (JS 파일 안에 <script> 태그 없음)

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import * as makelist from './makelist.js';
import * as resume   from './resume.js';

/* ---------- viewport fix ---------- */
function updateVh(){ document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`); }
updateVh();
addEventListener('resize', updateVh, {passive:true});
addEventListener('orientationchange', updateVh, {passive:true});

/* ---------- Samsung Internet 전용 보정 ---------- */
const isSamsungInternet = /SamsungBrowser/i.test(navigator.userAgent);
if (isSamsungInternet) { document.documentElement.classList.add('ua-sbrowser'); }
function updateSnapHeightForSamsung(){
  if (!isSamsungInternet) return;
  const vc = document.getElementById('videoContainer');
  if (!vc) return;
  document.documentElement.style.setProperty('--snap-h', vc.clientHeight + 'px');
}
updateSnapHeightForSamsung();
addEventListener('resize', updateSnapHeightForSamsung, {passive:true});
addEventListener('orientationchange', updateSnapHeightForSamsung, {passive:true});
if (window.visualViewport) { visualViewport.addEventListener('resize', updateSnapHeightForSamsung, {passive:true}); }

/* ---------- DOM refs ---------- */
const topbar         = document.getElementById('topbar');
const signupLink     = document.getElementById('signupLink');
const signinLink     = document.getElementById('signinLink');
const welcome        = document.getElementById('welcome');
const menuBtn        = document.getElementById('menuBtn');
const dropdown       = document.getElementById('dropdownMenu');
const menuBackdrop   = document.getElementById('menuBackdrop');
const btnSignOut     = document.getElementById('btnSignOut');
const btnGoUpload    = document.getElementById('btnGoUpload');
const btnGoCategory  = document.getElementById('btnGoCategory');
const btnMyUploads   = document.getElementById('btnMyUploads');
const btnAbout       = document.getElementById('btnAbout');
const brandHome      = document.getElementById('brandHome');
const videoContainer = document.getElementById('videoContainer');
const btnList        = document.getElementById('btnList');

/* ---------- dropdown (CopyTube v1.5 behavior + a11y + inert 토글) ---------- */
let isMenuOpen=false; let lastFocus=null;
function setMenuState(open){
  isMenuOpen=open;
  dropdown?.classList.toggle('hidden', !open);
  dropdown?.classList.toggle('open', open);
  menuBackdrop?.classList.toggle('open', open);
  dropdown?.setAttribute('aria-hidden', String(!open));
  menuBtn?.setAttribute('aria-expanded', String(open));
  menuBackdrop?.setAttribute('aria-hidden', String(!open));
  // inert 토글로 포커스/읽기 고립
  if (open) dropdown?.removeAttribute?.('inert'); else dropdown?.setAttribute?.('inert','');

  if(open){ lastFocus = document.activeElement; (dropdown?.querySelector('button'))?.focus({preventScroll:true}); }
  else{ lastFocus?.focus?.({preventScroll:true}); }
}
function openDropdown(){ setMenuState(true); }
function closeDropdown(){ setMenuState(false); }

onAuthStateChanged(auth,(user)=>{
  const loggedIn=!!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if(welcome) welcome.textContent = 'Enjoy!';
  closeDropdown();
});

menuBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); isMenuOpen ? closeDropdown() : openDropdown(); });
dropdown?.addEventListener('click',(e)=> e.stopPropagation());
menuBackdrop?.addEventListener('pointerdown', closeDropdown);
addEventListener('keydown',(e)=>{
  if(e.key==='Escape') closeDropdown();
  if(isMenuOpen && e.key==='Tab'){
    const focusables = dropdown.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    if(focusables.length){
      const first=focusables[0], last=focusables[focusables.length-1];
      if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
    }
  }
});
['scroll','wheel','keydown','touchmove'].forEach(ev=> addEventListener(ev, ()=>{ if(isMenuOpen) closeDropdown(); }, {passive:true}));
function goOrSignIn(path){ auth.currentUser ? (location.href=path) : (location.href='signin.html'); }
btnGoCategory?.addEventListener('click', ()=>{ location.href='index.html'; closeDropdown(); });
btnMyUploads ?.addEventListener('click', ()=>{ goOrSignIn('manage-uploads.html'); closeDropdown(); });
btnAbout     ?.addEventListener('click', ()=>{ location.href='about.html'; closeDropdown(); });
btnList      ?.addEventListener('click', ()=>{ location.href='list.html'; closeDropdown(); });
btnGoUpload  ?.addEventListener('click', ()=>{ location.href='upload.html'; closeDropdown(); });
btnSignOut   ?.addEventListener('click', async ()=>{ if(!auth.currentUser){ location.href='signin.html'; return; } await fbSignOut(auth); closeDropdown(); });
brandHome    ?.addEventListener('click',(e)=>{ e.preventDefault(); location.href='index.html'; });

/* ---------- topbar auto hide ---------- */
const HIDE_DELAY_MS=1000; let hideTimer=null;
function showTopbar(){ topbar?.classList.remove('hide'); if(hideTimer) clearTimeout(hideTimer); if(!isMenuOpen){ hideTimer=setTimeout(()=> topbar?.classList.add('hide'), HIDE_DELAY_MS); } }
['scroll','wheel','mousemove','keydown','pointermove','touchmove'].forEach(ev=>{
  const tgt = ev==='scroll' ? videoContainer : window;
  tgt.addEventListener(ev, ()=>{ if(!isMenuOpen) showTopbar(); }, {passive:true});
});

/* ---------- YouTube 안전성 ---------- */
const YT_URL_WHITELIST = /^(https:\/\/(www\.)?youtube\.com\/(watch\?v=|shorts\/)\/?|https:\/\/youtu\.be\/)/i;
const YT_ID_SAFE = /^[a-zA-Z0-9_-]{6,20}$/;
function safeExtractYouTubeId(url){
  const m = String(url||'').match(/(?:youtu\.be\/|v=|shorts\/)([^?&\/]+)/i);
  const cand = m ? m[1] : '';
  return YT_ID_SAFE.test(cand) ? cand : '';
}

/* ---------- Player control + infoDelivery(진행도 수집) ---------- */
let userSoundConsent=false;
let currentActive=null;
const winToCard=new Map();
const winInfo  =new Map(); // e.source -> { currentTime, duration }

function ytCmd(iframe, func, args=[]){ if(!iframe?.contentWindow) return; iframe.contentWindow.postMessage(JSON.stringify({event:'command', func, args}), '*'); }
function applyAudioPolicy(iframe){ if(!iframe) return; if(userSoundConsent){ ytCmd(iframe,'setVolume',[100]); ytCmd(iframe,'unMute'); } else { ytCmd(iframe,'mute'); } }

// AUTO_NEXT: 로컬 저장('1')만 허용
function readAutoNext(){ try{ return localStorage.getItem('autonext') === '1'; }catch{ return false; } }
let AUTO_NEXT = readAutoNext();
addEventListener('storage', (e)=>{ if(e.key==='autonext'){ AUTO_NEXT = readAutoNext(); } });

addEventListener('message',(e)=>{
  if(typeof e.data!=='string') return; let data; try{ data=JSON.parse(e.data); }catch{ return; }
  if(!data) return;

  // YouTube IFrame API: ready/state
  if(data.event==='onReady'){
    const card = winToCard.get(e.source); if(!card) return;
    const iframe = card.querySelector('iframe');
    if(card===currentActive){ applyAudioPolicy(iframe); ytCmd(iframe,'playVideo'); }
    else{ ytCmd(iframe,'mute'); }
    return;
  }
  if(data.event==='onStateChange' && data.info===0){ // ended
    // ③ 큐 자동 확장 시도
    tryFetchMoreIfNeeded();

    const card = winToCard.get(e.source); if(!card) return;
    const activeIframe = currentActive?.querySelector('iframe');
    if(activeIframe && e.source===activeIframe.contentWindow && AUTO_NEXT){ goToNextCard(); }
    return;
  }

  // ④ infoDelivery: currentTime/duration 등 수신
  if(data.event === 'infoDelivery' && data.info){
    const info = winInfo.get(e.source) || {};
    if(typeof data.info.currentTime === 'number') info.currentTime = data.info.currentTime;
    if(typeof data.info.duration    === 'number') info.duration    = data.info.duration;
    winInfo.set(e.source, info);
  }
}, false);

function grantSoundFromCard(){
  userSoundConsent=true;
  document.querySelectorAll('.gesture-capture').forEach(el=> el.classList.add('hidden'));
  const ifr = currentActive?.querySelector('iframe');
  if(ifr){ ytCmd(ifr,'setVolume',[100]); ytCmd(ifr,'unMute'); ytCmd(ifr,'playVideo'); }
}

/* ---------- IO: activate current, preload next, auto-extend ---------- */
const activeIO = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    const card = entry.target;
    const iframe = card.querySelector('iframe');
    if(entry.isIntersecting && entry.intersectionRatio>=0.6){
      if(currentActive && currentActive!==card){
        const prev = currentActive.querySelector('iframe');
        if(prev){ ytCmd(prev,'mute'); ytCmd(prev,'pauseVideo'); }
      }
      currentActive = card;

      // 현재 index를 sessionStorage 갱신
      const idx = [...videoContainer.querySelectorAll('.video')].indexOf(card);
      if(idx>=0) sessionStorage.setItem('playIndex', String(idx));

      ensureIframe(card);
      const ifr = card.querySelector('iframe');
      if(ifr){ ytCmd(ifr,'playVideo'); applyAudioPolicy(ifr); }

      const next = card.nextElementSibling;
      if(next && next.classList.contains('video')) ensureIframe(next, true);

      // ③ 끝나가기 전에 자동 확장 시도
      tryFetchMoreIfNeeded();

      // ④ 활성 변경 시 즉시 한 번 resume 저장(시간 정보 없으면 index 기반)
      trySaveResume('activate');

      showTopbar();
    }else{
      if(iframe){ ytCmd(iframe,'mute'); ytCmd(iframe,'pauseVideo'); }
    }
  });
},{ root: videoContainer, threshold:[0,0.6,1] });

/* ---------- resume: 10초 주기 저장 타이머 ---------- */
let resumeTimer = setInterval(()=> trySaveResume('interval'), 10000);

/* ---------- helpers (UI) ---------- */
function makeInfoRow(text){
  const wrap = document.createElement('div');
  wrap.className = 'video';
  const p = document.createElement('p');
  p.className = 'playhint';
  p.style.position = 'static';
  p.style.margin = '0 auto';
  p.textContent = text;
  wrap.appendChild(p);
  return wrap;
}

/* ---------- queue metadata helpers ---------- */
function extractSeriesMeta(item){
  // seriesKey: cats 중 'series_'로 시작하는 첫 값
  let seriesKey = '';
  if (Array.isArray(item?.cats)) {
    const found = item.cats.find(c => typeof c === 'string' && c.startsWith('series_'));
    if (found) seriesKey = found;
  }
  // subKey 추론(있으면 사용)
  const seriesSubKey = item?.seriesSubKey || item?.subKey || item?.series || '';
  return { seriesKey, seriesSubKey };
}

/* ---------- card ---------- */
function makeCard(item, i){
  const url = item?.url || '';
  if(!YT_URL_WHITELIST.test(String(url||''))) return null;
  const id = safeExtractYouTubeId(url);
  if(!id) return null;

  const { seriesKey, seriesSubKey } = extractSeriesMeta(item);

  const card = document.createElement('div');
  card.className = 'video';
  card.dataset.vid = id;
  card.dataset.key = item?.id || `q-${i}`;
  if (seriesKey)    card.dataset.seriesKey    = seriesKey;
  if (seriesSubKey) card.dataset.seriesSubKey = seriesSubKey;
  card.dataset.queueIndex = String(i);

  const thumbDiv = document.createElement('div');
  thumbDiv.className = 'thumb';

  const img = document.createElement('img');
  img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  img.alt = 'thumbnail';
  img.loading = 'lazy';
  thumbDiv.appendChild(img);

  const hint = document.createElement('div');
  hint.className = 'playhint';
  hint.textContent = '위로 스와이프 · 탭하여 소리 허용';
  thumbDiv.appendChild(hint);

  if(!userSoundConsent){
    const muteTip = document.createElement('div');
    muteTip.className = 'mute-tip';
    muteTip.textContent = '🔇 현재 음소거 • 한 번만 허용하면 계속 소리 재생';
    thumbDiv.appendChild(muteTip);
  }

  card.appendChild(thumbDiv);

  const gesture = document.createElement('div');
  gesture.className = `gesture-capture ${userSoundConsent ? 'hidden' : ''}`;
  gesture.setAttribute('aria-label', 'tap to enable sound');
  gesture.addEventListener('pointerdown', ()=>{ grantSoundFromCard(); }, { once:false });
  card.appendChild(gesture);

  activeIO.observe(card);
  return card;
}

function ensureIframe(card, preload=false){
  if(card.querySelector('iframe')) return;
  const id = card.dataset.vid;
  if(!YT_ID_SAFE.test(id)) return;

  const origin = encodeURIComponent(location.origin);
  const playerId = `yt-${id}-${Math.random().toString(36).slice(2,8)}`;
  const iframe = document.createElement('iframe');
  iframe.id = playerId;
  iframe.src =
    `https://www.youtube.com/embed/${id}` +
    `?enablejsapi=1&playsinline=1&autoplay=1&mute=1&rel=0` +
    `&origin=${origin}&widget_referrer=${encodeURIComponent(location.href)}` +
    `&playerapiid=${encodeURIComponent(playerId)}`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.allowFullscreen = true;
  Object.assign(iframe.style,{ width:'100%', height:'100%', border:'0' });
  iframe.addEventListener('load',()=>{
    try{
      iframe.contentWindow.postMessage(JSON.stringify({ event:'listening', id: playerId }), '*');
      // onReady / onStateChange 이벤트 수신
      ytCmd(iframe,'addEventListener',['onReady']);
      ytCmd(iframe,'addEventListener',['onStateChange']);
      // infoDelivery는 listening 이후 주기적으로 옴 (별도 트리거 불필요)
      winToCard.set(iframe.contentWindow, card);
      if(preload) ytCmd(iframe,'mute');
    }catch{}
  });

  const thumb = card.querySelector('.thumb');
  if(thumb) card.replaceChild(iframe, thumb);
  else card.appendChild(iframe);
}

/* ---------- Queue-only ---------- */
function getParam(name){ try{ return new URL(location.href).searchParams.get(name); }catch{ return null; } }

function tryLoadFromQueue(){
  let queue = [];
  try { queue = JSON.parse(sessionStorage.getItem('playQueue') || '[]'); } catch { queue = []; }
  if (!Array.isArray(queue) || queue.length === 0) return false;

  // idx/doc 우선권: URL > sessionStorage
  let idx = sessionStorage.getItem('playIndex');
  const urlIdx = getParam('idx');
  if (urlIdx !== null) idx = urlIdx;
  const docParam = getParam('doc');
  if (docParam) {
    const found = queue.findIndex(it => it.id === docParam);
    if (found >= 0) idx = String(found);
  }
  const startIndex = Math.max(0, Math.min(queue.length - 1, parseInt(idx || '0', 10) || 0));

  // 렌더링
  videoContainer.replaceChildren();
  queue.forEach((item, i) => {
    const card = makeCard(item, i);
    if(card) videoContainer.appendChild(card);
  });

  const target = videoContainer.querySelectorAll('.video')[startIndex];
  if (target) {
    target.scrollIntoView({ behavior:'instant', block:'start' });
    ensureIframe(target);
    currentActive = target;
  }
  sessionStorage.setItem('playIndex', String(startIndex));
  updateSnapHeightForSamsung();
  showTopbar();
  return true;
}

/* ---------- navigation ---------- */
function goToNextCard(){
  const next = currentActive?.nextElementSibling;
  if(next && next.classList.contains('video')){ next.scrollIntoView({behavior:'smooth', block:'start'}); return; }
  showTopbar(); // 큐 끝
}

/* ---------- auto extend hook ---------- */
function tryFetchMoreIfNeeded(){
  try{
    const idx = parseInt(sessionStorage.getItem('playIndex') || '0', 10) || 0;
    if (typeof makelist?.fetchMoreForWatchIfNeeded === 'function') {
      makelist.fetchMoreForWatchIfNeeded(idx);
    }
  }catch{}
}

/* ---------- resume save ---------- */
function getActiveProgress(){
  if(!currentActive) return { t:0, d:0 };
  const ifr = currentActive.querySelector('iframe');
  if(!ifr?.contentWindow) return { t:0, d:0 };
  const info = winInfo.get(ifr.contentWindow) || {};
  return { t: Number(info.currentTime||0), d: Number(info.duration||0) };
}

function trySaveResume(reason){
  try{
    if(typeof resume?.saveResume !== 'function') return; // API 없으면 건너뜀
    if(!currentActive) return;

    const seriesKey    = currentActive.dataset.seriesKey || '';
    const seriesSubKey = currentActive.dataset.seriesSubKey || '';
    if(!seriesKey) return; // 시리즈 항목이 아닐 때는 저장하지 않음

    const idx = parseInt(currentActive.dataset.queueIndex || sessionStorage.getItem('playIndex') || '0', 10) || 0;
    const vid = currentActive.dataset.vid || '';
    const { t, d } = getActiveProgress();

    // 최소 저장 단위(0초만 계속 저장되는 것 방지)
    if (reason === 'interval' && t <= 0) return;

    resume.saveResume(seriesKey, seriesSubKey, {
      index: idx,
      vid,
      t,     // seconds
      d,     // duration
      at: Date.now(),
      reason
    });
  }catch{ /* fail-safe */ }
}

/* ---------- start ---------- */
(function start(){
  if (tryLoadFromQueue()) return;
  videoContainer.appendChild(makeInfoRow('재생 목록이 없습니다. 영상 목록에서 선택해 주세요.'));
  showTopbar();
  updateSnapHeightForSamsung();
})();
