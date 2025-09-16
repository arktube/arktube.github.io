// js/watch.js (v1.0.7-ak)
// XSS 방어(카드 createElement), YouTube 화이트리스트, 교차 페이지 큐/단건/피드 모드, auto-next, 대규모 카테고리 스캔(MAX 12)
// 삼성 브라우저 스냅 보정, 상단바 자동 숨김, 개인자료 1~8 슬롯 호환
import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { collection, getDocs, query, where, orderBy, limit, startAfter, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- viewport fix ---------- */
function updateVh(){
  document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`);
}
updateVh();
addEventListener('resize', updateVh, {passive:true});
addEventListener('orientationchange', updateVh, {passive:true});

/* ---------- Samsung Internet 보정 ---------- */
const isSamsungInternet = /SamsungBrowser/i.test(navigator.userAgent);
if (isSamsungInternet) {
  document.documentElement.classList.add('ua-sbrowser');
}
function updateSnapHeightForSamsung(){
  if (!isSamsungInternet) return;
  const vc = document.getElementById('videoContainer');
  if (!vc) return;
  const h = vc.clientHeight;
  document.documentElement.style.setProperty('--snap-h', h + 'px');
}
updateSnapHeightForSamsung();
addEventListener('resize', updateSnapHeightForSamsung, {passive:true});
addEventListener('orientationchange', updateSnapHeightForSamsung, {passive:true});
if (window.visualViewport) {
  visualViewport.addEventListener('resize', updateSnapHeightForSamsung, {passive:true});
}

/* ---------- DOM ---------- */
const topbar         = document.getElementById("topbar");
const signupLink     = document.getElementById("signupLink");
const signinLink     = document.getElementById("signinLink");
const welcome        = document.getElementById("welcome");
const menuBtn        = document.getElementById("menuBtn");
const dropdown       = document.getElementById("dropdownMenu");
const menuBackdrop   = document.getElementById("menuBackdrop");
const btnSignOut     = document.getElementById("btnSignOut");
const btnGoUpload    = document.getElementById("btnGoUpload");
const btnGoCategory  = document.getElementById("btnGoCategory");
const btnMyUploads   = document.getElementById("btnMyUploads");
const btnAbout       = document.getElementById("btnAbout");
const brandHome      = document.getElementById("brandHome");
const videoContainer = document.getElementById("videoContainer");
const btnList        = document.getElementById('btnList');

/* ---------- dropdown ---------- */
let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown?.classList.remove("hidden"); requestAnimationFrame(()=> dropdown?.classList.add("show")); menuBackdrop?.classList.add('show'); }
function closeDropdown(){ isMenuOpen=false; dropdown?.classList.remove("show"); setTimeout(()=> dropdown?.classList.add("hidden"),180); menuBackdrop?.classList.remove('show'); }
onAuthStateChanged(auth,(user)=>{ const loggedIn=!!user; signupLink?.classList.toggle("hidden", loggedIn); signinLink?.classList.toggle("hidden", loggedIn); if(welcome) welcome.textContent = loggedIn ? `Hi! ${user.displayName || '회원'}님` : ""; closeDropdown(); });
menuBtn?.addEventListener("click",(e)=>{ e.stopPropagation(); dropdown?.classList.contains("hidden") ? openDropdown() : closeDropdown(); });
dropdown?.addEventListener("click",(e)=> e.stopPropagation());
menuBackdrop?.addEventListener('click', closeDropdown);
addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
["scroll","wheel","keydown","touchmove"].forEach(ev=> addEventListener(ev, ()=>{ if(isMenuOpen) closeDropdown(); }, {passive:true}));
function goOrSignIn(path){ auth.currentUser ? (location.href=path) : (location.href='signin.html'); }
btnGoCategory?.addEventListener("click", ()=>{ location.href="index.html"; closeDropdown(); });
btnMyUploads ?.addEventListener("click", ()=>{ goOrSignIn("manage-uploads.html"); closeDropdown(); });
btnAbout     ?.addEventListener("click", ()=>{ location.href="about.html"; closeDropdown(); });
btnList      ?.addEventListener("click", ()=>{ location.href="list.html"; closeDropdown(); });
btnSignOut   ?.addEventListener("click", async ()=>{ if(!auth.currentUser){ location.href='signin.html'; return; } await fbSignOut(auth); closeDropdown(); });
brandHome    ?.addEventListener("click",(e)=>{ e.preventDefault(); location.href="index.html"; });

/* ---------- topbar auto hide ---------- */
const HIDE_DELAY_MS=1000; let hideTimer=null;
function showTopbar(){ topbar?.classList.remove('hide'); if(hideTimer) clearTimeout(hideTimer); if(!isMenuOpen){ hideTimer=setTimeout(()=> topbar?.classList.add('hide'), HIDE_DELAY_MS); } }
['scroll','wheel','mousemove','keydown','pointermove','touchmove'].forEach(ev=>{
  const tgt = ev==='scroll' ? videoContainer : window;
  tgt.addEventListener(ev, ()=>{ if(!isMenuOpen) showTopbar(); }, {passive:true});
});

/* ---------- selection ---------- */
function parseCatsFromQuery(){
  try{
    const p = new URL(location.href).searchParams.get('cats');
    if(!p) return null;
    const arr = p.split(',').map(s=>s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }catch{ return null; }
}
function getSelectedCats(){
  const fromUrl = parseCatsFromQuery();
  if (fromUrl) return fromUrl;
  try{ return JSON.parse(localStorage.getItem('selectedCats')||'null'); }catch{ return "ALL"; }
}
function readAutoNext(){
  const v = (localStorage.getItem('autonext') || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}
let AUTO_NEXT = readAutoNext();
window.addEventListener('storage', (e)=>{ if(e.key === 'autonext'){ AUTO_NEXT = readAutoNext(); } });

const sel = getSelectedCats();
const SEL_SET = Array.isArray(sel) ? new Set(sel) : (sel==="ALL" ? null : null);
const wantsPersonal = (name)=> (SEL_SET?.has?.(name) || parseCatsFromQuery()?.includes(name));
const PERSONAL_MODE = (['personal1','personal2','personal3','personal4','personal5','personal6','personal7','personal8'].some(wantsPersonal))
  && !(SEL_SET && ([...SEL_SET].some(v => !/^personal[1-4]$/.test(v))));

/* ---------- YouTube 검증 ---------- */
const YT_URL_WHITELIST = /^(https:\/\/(www\.)?youtube\.com\/(watch\?v=|shorts\/)|https:\/\/youtu\.be\/)/i;
const YT_ID_SAFE = /^[a-zA-Z0-9_-]{6,20}$/;

/* ---------- YouTube control ---------- */
let userSoundConsent=false;
let currentActive=null;
const winToCard=new Map();
function ytCmd(iframe, func, args=[]){ if(!iframe?.contentWindow) return; iframe.contentWindow.postMessage(JSON.stringify({event:"command", func, args}), "*"); }
function applyAudioPolicy(iframe){ if(!iframe) return; if(userSoundConsent){ ytCmd(iframe,"setVolume",[100]); ytCmd(iframe,"unMute"); } else { ytCmd(iframe,"mute"); } }

/* player events */
addEventListener('message',(e)=>{
  if(typeof e.data!=='string') return; let data; try{ data=JSON.parse(e.data); }catch{ return; }
  if(!data?.event) return;
  if(data.event==='onReady'){
    const card = winToCard.get(e.source); if(!card) return;
    const iframe = card.querySelector('iframe');
    if(card===currentActive){ applyAudioPolicy(iframe); ytCmd(iframe,"playVideo"); }
    else{ ytCmd(iframe,"mute"); }
    return;
  }
  if(data.event==='onStateChange' && data.info===0){
    const card = winToCard.get(e.source); if(!card) return;
    const activeIframe = currentActive?.querySelector('iframe');
    if(activeIframe && e.source===activeIframe.contentWindow && AUTO_NEXT){ goToNextCard(); }
  }
}, false);

/* gesture capture */
function grantSoundFromCard(){
  userSoundConsent=true;
  document.querySelectorAll('.gesture-capture').forEach(el=> el.classList.add('hidden'));
  const ifr = currentActive?.querySelector('iframe');
  if(ifr){ ytCmd(ifr,"setVolume",[100]); ytCmd(ifr,"unMute"); ytCmd(ifr,"playVideo"); }
}

/* ---------- IO: activate current, preload NEXT ---------- */
const activeIO = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    const card = entry.target;
    const iframe = card.querySelector('iframe');
    if(entry.isIntersecting && entry.intersectionRatio>=0.6){
      if(currentActive && currentActive!==card){
        const prev = currentActive.querySelector('iframe');
        if(prev){ ytCmd(prev,"mute"); ytCmd(prev,"pauseVideo"); }
      }
      currentActive = card;
      ensureIframe(card);
      const ifr = card.querySelector('iframe');
      if(ifr){ ytCmd(ifr,"playVideo"); applyAudioPolicy(ifr); }
      const next = card.nextElementSibling;
      if(next && next.classList.contains('video')) ensureIframe(next, true);
      showTopbar();
    }else{
      if(iframe){ ytCmd(iframe,"mute"); ytCmd(iframe,"pauseVideo"); }
    }
  });
},{ root: videoContainer, threshold:[0,0.6,1] });

function safeExtractYouTubeId(url){
  const m = String(url||'').match(/(?:youtu\.be\/|v=|shorts\/)([^?&/]+)/i);
  const cand = m ? m[1] : '';
  return YT_ID_SAFE.test(cand) ? cand : '';
}

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

function makeCard(url, docId){
  if(!YT_URL_WHITELIST.test(String(url||''))) return null;
  const id = safeExtractYouTubeId(url);
  if(!id) return null;

  const card = document.createElement('div');
  card.className = 'video';
  card.dataset.vid = id;
  card.dataset.docId = docId || '';

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
  iframe.allow = "autoplay; encrypted-media; picture-in-picture";
  iframe.allowFullscreen = true;
  Object.assign(iframe.style,{ width:"100%", height:"100%", border:"0" });
  iframe.addEventListener('load',()=>{
    try{
      iframe.contentWindow.postMessage(JSON.stringify({ event:'listening', id: playerId }), '*');
      ytCmd(iframe,"addEventListener",["onReady"]);
      ytCmd(iframe,"addEventListener",["onStateChange"]);
      winToCard.set(iframe.contentWindow, card);
      if(preload) ytCmd(iframe,"mute");
    }catch{}
  });

  const thumb = card.querySelector('.thumb');
  if(thumb) card.replaceChild(iframe, thumb);
  else card.appendChild(iframe);
}

/* ---------- Feed (개인/공용) ---------- */
const PAGE_SIZE=10;
let isLoading=false, hasMore=true, lastDoc=null;
const loadedIds=new Set();

function getSelectedCats(){
  const fromUrl = parseCatsFromQuery();
  if (fromUrl) return fromUrl;
  try{ return JSON.parse(localStorage.getItem('selectedCats')||'null'); }catch{ return "ALL"; }
}
function resolveCatFilter(){
  if(PERSONAL_MODE) return null;
  const sel = getSelectedCats();
  if (sel==="ALL" || !sel) return null;
  if (Array.isArray(sel) && sel.length){
    const filtered = sel.filter(v=> !/^personal[1-4]$/.test(v));
    return filtered.length ? new Set(filtered) : null;
  }
  return null;
}
let CAT_FILTER = resolveCatFilter();

function matchesFilter(data){
  if(!CAT_FILTER) return true;
  const cats = Array.isArray(data?.categories) ? data.categories : [];
  for(const v of cats){ if(CAT_FILTER.has(v)) return true; }
  return false;
}

function resetFeed(){
  document.querySelectorAll('#videoContainer .video').forEach(el=> activeIO.unobserve(el));
  videoContainer.replaceChildren();
  isLoading=false; hasMore=true; lastDoc=null; loadedIds.clear(); currentActive=null;
}

/* ---- 개인모드 ---- */
let personalItems=[], personalOffset=0;
const PERSONAL_PAGE_SIZE = 12;

function loadPersonalInit(){
  const urlCats = parseCatsFromQuery() || [];
  const slot = (['personal1','personal2','personal3','personal4','personal5','personal6','personal7','personal8']
    .find(n=> urlCats.includes(n))) || 'personal1';
  const key  = `copytube_${slot}`;
  try{
    personalItems = JSON.parse(localStorage.getItem(key) || '[]');
    if(!Array.isArray(personalItems)) personalItems=[];
  }catch{ personalItems=[]; }
  personalItems.sort((a,b)=> (b?.savedAt||0) - (a?.savedAt||0));
  personalOffset = 0;
  hasMore = personalItems.length > 0;
}

function loadMorePersonal(initial=false){
  if(isLoading || !hasMore) return;
  isLoading=true;

  if(initial && personalItems.length===0){
    videoContainer.appendChild(makeInfoRow('개인자료가 없습니다. 업로드에서 개인자료에 저장해 보세요.'));
    isLoading=false; hasMore=false; return;
  }

  const end = Math.min(personalOffset + PERSONAL_PAGE_SIZE, personalItems.length);
  for(let i=personalOffset; i<end; i++){
    const u = personalItems[i]?.url;
    if(!u) continue;
    const fakeId = `local-${i}`;
    if(loadedIds.has(fakeId)) continue;
    const card = makeCard(u, fakeId);
    if(!card) continue;
    loadedIds.add(fakeId);
    videoContainer.appendChild(card);
  }
  personalOffset = end;
  if(personalOffset >= personalItems.length) hasMore=false;
  isLoading=false;

  updateSnapHeightForSamsung();
}

/* ---- 공용모드: Firestore ---- */
const MAX_SCAN_PAGES = 12; // 다중 카테고리일 때 스캔 허용 페이지 수

async function loadMoreCommon(initial=false){
  if(isLoading || !hasMore) return;
  isLoading=true;

  try{
    const base = collection(db,"videos");
    const filterSize = CAT_FILTER ? CAT_FILTER.size : 0;

    if(!CAT_FILTER){
      const parts=[ orderBy("createdAt","desc") ];
      if(lastDoc) parts.push(startAfter(lastDoc));
      parts.push(limit(PAGE_SIZE));
      const snap = await getDocs(query(base, ...parts));
      await appendFromSnap(snap, initial);
    }
    else if(filterSize <= 10){
      const whereVals = Array.from(CAT_FILTER);
      const parts=[ where("categories","array-contains-any", whereVals), orderBy("createdAt","desc") ];
      if(lastDoc) parts.push(startAfter(lastDoc));
      parts.push(limit(PAGE_SIZE));
      const snap = await getDocs(query(base, ...parts));
      await appendFromSnap(snap, initial, false);
    }
    else{
      // 다중 카테고리(>10): 최신순 페이지들을 스캔하여 클라이언트 필터
      let appended = 0;
      let scannedPages = 0;
      let localLast = lastDoc;
      let reachedEnd = false;

      while(appended < PAGE_SIZE && !reachedEnd && scannedPages < MAX_SCAN_PAGES){
        const parts=[ orderBy("createdAt","desc") ];
        if(localLast) parts.push(startAfter(localLast));
        parts.push(limit(PAGE_SIZE));
        const snap = await getDocs(query(base, ...parts));

        if(snap.empty){
          reachedEnd = true;
          break;
        }

        for(const d of snap.docs){
          localLast = d;
          if(loadedIds.has(d.id)) continue;
          const data = d.data();
          if(matchesFilter(data)){
            const card = makeCard(data.url, d.id);
            if(!card) continue;
            loadedIds.add(d.id);
            videoContainer.appendChild(card);
            appended++;
            if(appended >= PAGE_SIZE) break;
          }
        }

        scannedPages++;
        lastDoc = localLast || lastDoc;
        if(snap.size < PAGE_SIZE){ reachedEnd = true; }
      }

      hasMore = !reachedEnd;
      if(initial){
        if(appended===0){
          if(hasMore){
            videoContainer.appendChild(makeInfoRow('최근 업로드 상위에서 해당 카테고리를 찾는 중입니다. 아래로 스크롤하면 더 탐색합니다.'));
          }else{
            videoContainer.appendChild(makeInfoRow('해당 카테고리 영상이 없습니다.'));
          }
        }
      }
    }

  }catch(e){
    console.error(e);
    if(initial){
      videoContainer.appendChild(makeInfoRow('목록을 불러오지 못했습니다.'));
    }
  }finally{
    isLoading=false;
    updateSnapHeightForSamsung();
  }
}

async function appendFromSnap(snap, initial, clientFilter=false){
  if(snap.empty){
    if(initial) videoContainer.appendChild(makeInfoRow('해당 카테고리 영상이 없습니다.'));
    hasMore=false; return;
  }
  let appended=0;
  snap.docs.forEach(d=>{
    if(loadedIds.has(d.id)) return;
    const data=d.data();
    if(clientFilter && !matchesFilter(data)) return;
    const card = makeCard(data.url, d.id);
    if(!card) return;
    loadedIds.add(d.id);
    videoContainer.appendChild(card);
    appended++;
  });
  lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
  if(snap.size < PAGE_SIZE) hasMore=false;
  if(initial && appended===0){
    videoContainer.appendChild(makeInfoRow('해당 카테고리 영상이 없습니다.'));
  }
}

/* ---------- scroll 페이징 ---------- */
videoContainer.addEventListener('scroll', ()=>{
  const nearBottom = videoContainer.scrollTop + videoContainer.clientHeight >= videoContainer.scrollHeight - 200;
  if(nearBottom){
    if(QUEUE_MODE) return; // 큐 모드에서는 페이징 안 함
    if(PERSONAL_MODE) loadMorePersonal(false);
    else loadMoreCommon(false);
  }
});

/* ---------- auto-next ---------- */
async function goToNextCard(){
  const next = currentActive?.nextElementSibling;
  if(next && next.classList.contains('video')){
    next.scrollIntoView({behavior:'smooth', block:'start'}); return;
  }
  if(QUEUE_MODE){ showTopbar(); return; }
  if(!hasMore){ showTopbar(); return; }
  const before = videoContainer.querySelectorAll('.video').length;
  if(PERSONAL_MODE) loadMorePersonal(false);
  else await loadMoreCommon(false);
  const after  = videoContainer.querySelectorAll('.video').length;
  if(after>before){
    videoContainer.querySelectorAll('.video')[before]?.scrollIntoView({ behavior:'smooth', block:'start' });
  } else { showTopbar(); }
}

/* ---------- 큐 모드 ---------- */
let QUEUE_MODE = false;
function getParam(name){ try{ return new URL(location.href).searchParams.get(name); }catch{ return null; } }

function tryLoadFromQueue(){
  const hasIdx = getParam('idx') !== null;
  const hasDoc = !!getParam('doc');
  if (!hasIdx && !hasDoc) return false;

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

  resetFeed();
  QUEUE_MODE = true;
  hasMore = false;

  queue.forEach((item, i) => {
    const url = item?.url || '';
    const did = item?.id  || `q-${i}`;
    if(loadedIds.has(did)) return;
    const card = makeCard(url, did);
    if(!card) return;
    loadedIds.add(did);
    videoContainer.appendChild(card);
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

/* ---------- start ---------- */
(async ()=>{
  if (tryLoadFromQueue()) {
    return;
  }

  const docId = getParam('doc');
  if (docId) {
    try{
      const ref = doc(db, 'videos', docId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        resetFeed();
        const d = snap.data();
        const u = d?.url || '';
        const card = makeCard(u, docId);
        if(card){
          loadedIds.add(docId);
          videoContainer.appendChild(card);
          const target = videoContainer.querySelector('.video');
          if (target) { ensureIframe(target); currentActive = target; }
        }else{
          videoContainer.appendChild(makeInfoRow('해당 영상을 재생할 수 없습니다.'));
        }
        updateSnapHeightForSamsung();
        showTopbar();
        return;
      }
    }catch(e){ console.warn('[watch] doc load fail:', e?.message||e); }
  }

  resetFeed();
  if(PERSONAL_MODE){ loadPersonalInit(); loadMorePersonal(true); }
  else{ await loadMoreCommon(true); }
  showTopbar();
  updateSnapHeightForSamsung();
})();
