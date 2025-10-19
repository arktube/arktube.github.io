// FILE: /js/watch.js — ArkTube watch (queue-only v0.3.2)
// - 상단바: index와 동일 드롭다운(a11y + inert), 네이밍(btnDropdown)
// - 인사말: Enjoy! {displayName}
// - 큐: makelist가 만든 sessionStorage playQueue/playIndex 사용
// - 자동 추가 로드: watch→makelist.fetchMoreForWatchIfNeeded(idx) 신호만 보냄
// - 이어보기 저장: 시리즈 항목일 때 10초 주기 + 활성 변경 시 1회 저장
// - YouTube IFrame API 제어(음소거 정책/자동재생/ready/state/infoDelivery)

import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import * as makelist from './makelist.js';
import * as resume   from './resume.js';

/* ===== viewport/svh ===== */
function updateVh(){ document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`); }
updateVh();
addEventListener('resize', updateVh, {passive:true});
addEventListener('orientationchange', updateVh, {passive:true});

/* ===== Samsung Internet 보정 ===== */
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

/* ===== Elements ===== */
const topbar         = document.getElementById('topbar');
const signupLink     = document.getElementById('signupLink');
const signinLink     = document.getElementById('signinLink');
const welcome        = document.getElementById('welcome');
const btnDropdown    = document.getElementById('btnDropdown');
const dropdown       = document.getElementById('dropdownMenu');
const btnSignOut     = document.getElementById('btnSignOut');
const btnGoUpload    = document.getElementById('btnGoUpload');
const btnMyUploads   = document.getElementById('btnMyUploads');
const btnAbout       = document.getElementById('btnAbout');
const btnOrder       = document.getElementById('btnOrder');
const brandHome      = document.getElementById('brandHome');
const videoContainer = document.getElementById('videoContainer');
const btnList        = document.getElementById('btnList');

/* ===== 드롭다운 (index와 동일 패턴) ===== */
(function initDropdown(){
  const menu = dropdown; let open=false; let offP=null, offK=null;

  function setOpen(v){
    open=!!v; btnDropdown?.setAttribute('aria-expanded', String(open));
    if (!menu) return;

    if (open){
      menu.classList.remove('hidden');
      requestAnimationFrame(()=> menu.classList.add('open'));
      menu.removeAttribute('aria-hidden');
      menu.removeAttribute('inert');

      const first = menu.querySelector('button,[href],[tabindex]:not([tabindex="-1"])');
      (first instanceof HTMLElement ? first : btnDropdown)?.focus({preventScroll:true});
      bindDoc();
    } else {
      btnDropdown?.focus({preventScroll:true});
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden','true');
      menu.setAttribute('inert','');
      setTimeout(()=> menu.classList.add('hidden'), 150);
      unbindDoc();
    }
  }

  function bindDoc(){
    if (offP || offK) return;
    const onP=(e)=>{ if (e.target.closest('#dropdownMenu,#btnDropdown')) return; setOpen(false); };
    const onK=(e)=>{
      if (e.key==='Escape') setOpen(false);
      if (e.key==='Tab' && open){
        const nodes=menu.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])');
        if (!nodes.length) return;
        const first=nodes[0], last=nodes[nodes.length-1];
        if (e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('pointerdown', onP, {passive:true});
    document.addEventListener('keydown', onK);
    offP = ()=> document.removeEventListener('pointerdown', onP, {passive:true});
    offK = ()=> document.removeEventListener('keydown', onK);
  }
  function unbindDoc(){ offP?.(); offK?.(); offP=offK=null; }

  btnDropdown?.addEventListener('click', (e)=>{ e.preventDefault(); setOpen(!open); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });

  // 초기 동기화
  if (menu?.classList.contains('hidden')) { menu.setAttribute('aria-hidden','true'); menu.setAttribute('inert',''); }
  else { menu?.removeAttribute('aria-hidden'); menu?.removeAttribute('inert'); }
})();

/* ===== 인사말 / auth ===== */
onAuthStateChanged(auth,(user)=>{
  const loggedIn=!!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if(welcome){
    const name = loggedIn ? (user.displayName || '') : '';
    welcome.textContent = loggedIn ? `Enjoy! ${name}` : 'Enjoy!';
  }
});
btnSignOut   ?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });
btnGoUpload  ?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads ?.addEventListener('click', ()=> location.href='/manage-uploads.html');
btnAbout     ?.addEventListener('click', ()=> location.href='/about.html');
btnOrder     ?.addEventListener('click', ()=> location.href='/category-order.html');
btnList      ?.addEventListener('click', ()=> location.href='/list.html');
brandHome    ?.addEventListener('click',(e)=>{ e.preventDefault(); location.href='/index.html'; });

/* ===== topbar auto hide ===== */
const HIDE_DELAY_MS=1000; let hideTimer=null;
function showTopbar(){ topbar?.classList.remove('hide'); if(hideTimer) clearTimeout(hideTimer); hideTimer=setTimeout(()=> topbar?.classList.add('hide'), HIDE_DELAY_MS); }
['scroll','wheel','mousemove','keydown','pointermove','touchmove'].forEach(ev=>{
  const tgt = ev==='scroll' ? videoContainer : window;
  tgt.addEventListener(ev, showTopbar, {passive:true});
});

/* ===== YouTube 안전성 ===== */
const YT_URL_WHITELIST = /^(https:\/\/(www\.)?youtube\.com\/(watch\?v=|shorts\/)\/?|https:\/\/youtu\.be\/)/i;
const YT_ID_SAFE = /^[a-zA-Z0-9_-]{6,20}$/;
function safeExtractYouTubeId(url){
  const m = String(url||'').match(/(?:youtu\.be\/|v=|shorts\/)([^?&\/]+)/i);
  const cand = m ? m[1] : '';
  return YT_ID_SAFE.test(cand) ? cand : '';
}

/* ===== Player control + infoDelivery ===== */
let userSoundConsent=false;
let currentActive=null;
const winToCard=new Map();
const winInfo  =new Map(); // e.source -> { currentTime, duration }

function ytCmd(iframe, func, args=[]){ if(!iframe?.contentWindow) return; iframe.contentWindow.postMessage(JSON.stringify({event:'command', func, args}), '*'); }
function applyAudioPolicy(iframe){ if(!iframe) return; if(userSoundConsent){ ytCmd(iframe,'setVolume',[100]); ytCmd(iframe,'unMute'); } else { ytCmd(iframe,'mute'); } }

// AutoNext 로컬키
function readAutoNext(){ try{ return localStorage.getItem('autonext') === '1'; }catch{ return false; } }
let AUTO_NEXT = readAutoNext();
addEventListener('storage', (e)=>{ if(e.key==='autonext'){ AUTO_NEXT = readAutoNext(); } });

addEventListener('message',(e)=>{
  if(typeof e.data!=='string') return; let data; try{ data=JSON.parse(e.data); }catch{ return; }
  if(!data) return;

  if(data.event==='onReady'){
    const card = winToCard.get(e.source); if(!card) return;
    const iframe = card.querySelector('iframe');
    if(card===currentActive){ applyAudioPolicy(iframe); ytCmd(iframe,'playVideo'); }
    else{ ytCmd(iframe,'mute'); }
    return;
  }
  if(data.event==='onStateChange' && data.info===0){ // ended
    tryFetchMoreIfNeeded();
    const activeIframe = currentActive?.querySelector('iframe');
    if(activeIframe && e.source===activeIframe.contentWindow && AUTO_NEXT){ goToNextCard(); }
    return;
  }
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

/* ===== IO: activate current, preload next ===== */
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

      // playIndex 갱신
      const idx = [...videoContainer.querySelectorAll('.video')].indexOf(card);
      if(idx>=0) sessionStorage.setItem('playIndex', String(idx));

      ensureIframe(card);
      const ifr = card.querySelector('iframe');
      if(ifr){ ytCmd(ifr,'playVideo'); applyAudioPolicy(ifr); }

      const next = card.nextElementSibling;
      if(next && next.classList.contains('video')) ensureIframe(next, true);

      tryFetchMoreIfNeeded();   // 끝나가기 전 자동 로드 신호
      trySaveResume('activate'); // 활성 변경 시 1회 저장
      showTopbar();
    }else{
      if(iframe){ ytCmd(iframe,'mute'); ytCmd(iframe,'pauseVideo'); }
    }
  });
},{ root: videoContainer, threshold:[0,0.6,1] });

/* ===== resume: 10초 주기 저장 ===== */
setInterval(()=> trySaveResume('interval'), 10000);

/* ===== helpers (UI) ===== */
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

/* ===== queue metadata ===== */
function extractSeriesMeta(item){
  let seriesKey = '';
  if (Array.isArray(item?.cats)) {
    const found = item.cats.find(c => typeof c === 'string' && c.startsWith('series_'));
    if (found) seriesKey = found;
  }
  const seriesSubKey = item?.seriesSubKey || item?.subKey || item?.series || '';
  return { seriesKey, seriesSubKey };
}

/* ===== card ===== */
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
  gesture.addEventListener('pointerdown', grantSoundFromCard, { once:false });
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
      ytCmd(iframe,'addEventListener',['onReady']);
      ytCmd(iframe,'addEventListener',['onStateChange']);
      winToCard.set(iframe.contentWindow, card);
      if(preload) ytCmd(iframe,'mute');
    }catch{}
  });

  const thumb = card.querySelector('.thumb');
  if(thumb) card.replaceChild(iframe, thumb);
  else card.appendChild(iframe);
}

/* ===== Queue-only ===== */
function getParam(name){ try{ return new URL(location.href).searchParams.get(name); }catch{ return null; } }

function tryLoadFromQueue(){
  let queue = [];
  try { queue = JSON.parse(sessionStorage.getItem('playQueue') || '[]'); } catch { queue = []; }
  if (!Array.isArray(queue) || queue.length === 0) return false;

  let idx = sessionStorage.getItem('playIndex');
  const urlIdx = getParam('idx');
  if (urlIdx !== null) idx = urlIdx;
  const docParam = getParam('doc');
  if (docParam) {
    const found = queue.findIndex(it => it.id === docParam);
    if (found >= 0) idx = String(found);
  }
  const startIndex = Math.max(0, Math.min(queue.length - 1, parseInt(idx || '0', 10) || 0));

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

/* ===== navigation ===== */
function goToNextCard(){
  const next = currentActive?.nextElementSibling;
  if(next && next.classList.contains('video')){ next.scrollIntoView({behavior:'smooth', block:'start'}); return; }
  showTopbar(); // 큐 끝
}

/* ===== auto extend hook ===== */
function tryFetchMoreIfNeeded(){
  try{
    const idx = parseInt(sessionStorage.getItem('playIndex') || '0', 10) || 0;
    if (typeof makelist?.fetchMoreForWatchIfNeeded === 'function') {
      makelist.fetchMoreForWatchIfNeeded(idx);
    }
  }catch{}
}

/* ===== resume save ===== */
function getActiveProgress(){
  if(!currentActive) return { t:0, d:0 };
  const ifr = currentActive.querySelector('iframe');
  if(!ifr?.contentWindow) return { t:0, d:0 };
  const info = winInfo.get(ifr.contentWindow) || {};
  return { t: Number(info.currentTime||0), d: Number(info.duration||0) };
}
function trySaveResume(reason){
  try{
    if(typeof resume?.saveResume !== 'function') return;
    if(!currentActive) return;

    const seriesKey    = currentActive.dataset.seriesKey || '';
    const seriesSubKey = currentActive.dataset.seriesSubKey || '';
    if(!seriesKey) return;

    const idx = parseInt(currentActive.dataset.queueIndex || sessionStorage.getItem('playIndex') || '0', 10) || 0;
    const vid = currentActive.dataset.vid || '';
    const { t, d } = getActiveProgress();
    if (reason === 'interval' && t <= 0) return;

    resume.saveResume(seriesKey, seriesSubKey, { index: idx, vid, t, d, at: Date.now(), reason });
  }catch{}
}

/* ===== start ===== */
(function start(){
  if (tryLoadFromQueue()) return;
  videoContainer.appendChild(makeInfoRow('재생 목록이 없습니다. 영상 목록에서 선택해 주세요.'));
  showTopbar();
  updateSnapHeightForSamsung();
})();
