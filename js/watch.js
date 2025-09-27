// /js/watch.js — ArkTube v0.1.1
// - CopyTube watch 기반(뷰포트·IO·유튜브 postMessage 제어·XSS 방어) + ArkTube 요구 반영
// - series-only 등록순 asc / 혼합은 최신순 desc + 형식토글 적용
// - 개인자료 personal1..personal4 로컬 지원 (키: personal_${slot})
// - 이어보기: /js/resume.js 사용 (10초 스로틀 저장)
// - FIX: Firestore 필드명 cats로 통일, 개인자료 키 통일
// - FIX: 완전 전체화면(흰줄 제거)용 스타일 주입

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';
import * as resume from './resume.js';
import {
  collection, getDocs, query, where, orderBy, limit, startAfter, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Full-bleed 스타일 주입 (흰색 테두리 제거) ---------- */
(function injectWatchStyles(){
  if (document.getElementById('watch-fullbleed-css')) return;
  const s = document.createElement('style');
  s.id = 'watch-fullbleed-css';
  s.textContent = `
html, body { background:#000 !important; margin:0 !important; height:100%; }
#videoContainer { background:#000 !important; margin:0 !important; padding:0 !important; }
.video { width:100vw; height:var(--app-vh, 100vh); margin:0 auto; background:#000; position:relative; }
.video .thumb, .video iframe { width:100%; height:100%; display:block; background:#000; }
.video .thumb img { width:100%; height:100%; object-fit:cover; background:#000; display:block; }
.playhint, .mute-tip { position:absolute; left:50%; transform:translateX(-50%); z-index:3;
  color:#eee; text-shadow:0 1px 2px rgba(0,0,0,.6); }
.playhint { bottom:14px; font-size:14px; opacity:.9; }
.mute-tip { top:12px; font-size:12px; opacity:.9; }
.gesture-capture { position:absolute; inset:0; z-index:4; background:transparent; }
.gesture-capture.hidden { display:none; }
#topbar.hide { opacity:0; pointer-events:none; transition:opacity .25s ease; }
#topbar { transition:opacity .2s ease; }
`;
  document.head.appendChild(s);
})();

/* ---------- viewport fix ---------- */
function updateVh(){ document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`); }
updateVh(); addEventListener('resize', updateVh, {passive:true}); addEventListener('orientationchange', updateVh, {passive:true});

/* ---------- Samsung Internet 보정 ---------- */
const isSamsungInternet = /SamsungBrowser/i.test(navigator.userAgent);
function updateSnapHeightForSamsung(){
  if (!isSamsungInternet) return;
  const vc = document.getElementById('videoContainer'); if (!vc) return;
  const h = vc.clientHeight; document.documentElement.style.setProperty('--snap-h', h + 'px');
}
updateSnapHeightForSamsung();
addEventListener('resize', updateSnapHeightForSamsung, {passive:true});
addEventListener('orientationchange', updateSnapHeightForSamsung, {passive:true});
if (window.visualViewport) visualViewport.addEventListener('resize', updateSnapHeightForSamsung, {passive:true});

/* ---------- DOM ---------- */
const topbar         = document.getElementById("topbar");
const signupLink     = document.getElementById("signupLink");
const signinLink     = document.getElementById("signinLink");
const welcome        = document.getElementById("welcome");
const menuBtn        = document.getElementById("menuBtn");
const dropdown       = document.getElementById("dropdownMenu");
const btnSignOut     = document.getElementById("btnSignOut");
const btnGoUpload    = document.getElementById("btnGoUpload");
const btnMyUploads   = document.getElementById("btnMyUploads");
const btnAbout       = document.getElementById("btnAbout");
const brandHome      = document.getElementById("brandHome");
const videoContainer = document.getElementById("videoContainer");
const btnList        = document.getElementById("btnList");

/* ---------- dropdown ---------- */
let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown?.classList.remove("hidden"); requestAnimationFrame(()=> dropdown?.classList.add("show")); }
function closeDropdown(){ isMenuOpen=false; dropdown?.classList.remove("show"); setTimeout(()=> dropdown?.classList.add("hidden"),180); }
onAuthStateChanged(auth,(user)=>{ const loggedIn=!!user; signupLink?.classList.toggle("hidden", loggedIn); signinLink?.classList.toggle("hidden", loggedIn); if(welcome) welcome.textContent = loggedIn ? `Welcome! ${user.displayName || '회원'}` : ""; closeDropdown(); });
menuBtn?.addEventListener("click",(e)=>{ e.stopPropagation(); dropdown?.classList.contains("hidden") ? openDropdown() : closeDropdown(); });
dropdown?.addEventListener("click",(e)=> e.stopPropagation());
addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
["scroll","wheel","keydown","touchmove"].forEach(ev=> addEventListener(ev, ()=>{ if(isMenuOpen) closeDropdown(); }, {passive:true}));

function goOrSignIn(path){ auth.currentUser ? (location.href=path) : (location.href='/signin.html'); }
btnMyUploads ?.addEventListener("click", ()=>{ goOrSignIn("/manage-uploads.html"); closeDropdown(); });
btnAbout     ?.addEventListener("click", ()=>{ location.href="/about.html"; closeDropdown(); });
btnList      ?.addEventListener("click", ()=>{ location.href="/list.html?from=watch"; closeDropdown(); });
btnSignOut   ?.addEventListener("click", async ()=>{ if(!auth.currentUser){ location.href='/signin.html'; return; } await fbSignOut(auth); closeDropdown(); });
brandHome    ?.addEventListener("click",(e)=>{ e.preventDefault(); const src = new URL(location.href).searchParams.get('src'); location.href = src==='list' ? '/list.html' : '/index.html'; });

/* ---------- topbar auto-hide ---------- */
const HIDE_DELAY_MS=1000; let hideTimer=null;
function showTopbar(){ topbar?.classList.remove('hide'); if(hideTimer) clearTimeout(hideTimer); if(!isMenuOpen){ hideTimer=setTimeout(()=> topbar?.classList.add('hide'), HIDE_DELAY_MS); } }
['scroll','wheel','mousemove','keydown','pointermove','touchmove'].forEach(ev=>{
  const tgt = ev==='scroll' ? videoContainer : window;
  tgt.addEventListener(ev, ()=>{ if(!isMenuOpen) showTopbar(); }, {passive:true});
});

/* ---------- 선택/모드 판별 ---------- */
function getParam(name){ try{ return new URL(location.href).searchParams.get(name); }catch{ return null; } }
function parseCatsFromQuery(){ try{ const p=new URL(location.href).searchParams.get('cats'); if(!p) return null; const a=p.split(',').map(s=>s.trim()).filter(Boolean); return a.length?a:null; }catch{ return null; } }
function getSelectedCats(){
  const fromUrl = parseCatsFromQuery(); if(fromUrl) return fromUrl;
  try{ return JSON.parse(localStorage.getItem('selectedCats')||'null'); }catch{ return "ALL"; }
}
function readAutoNext(){ const v=(localStorage.getItem('autonext')||'').toLowerCase(); return (v==='1'||v==='true'||v==='on'); }
let AUTO_NEXT = readAutoNext(); window.addEventListener('storage', (e)=>{ if(e.key==='autonext') AUTO_NEXT = readAutoNext(); });

const sel = getSelectedCats();
const SEL_SET = Array.isArray(sel) ? new Set(sel) : (sel==="ALL" ? null : null);

// 개인자료 1~4 지원
const personalVals = ['personal1','personal2','personal3','personal4'];
const wantsPersonal = personalVals.some(v => SEL_SET?.has?.(v) || parseCatsFromQuery()?.includes(v));
const PERSONAL_MODE = wantsPersonal && !(SEL_SET && ([...SEL_SET].some(v => !personalVals.includes(v))));

/* ---------- 형식 토글(vtype) ---------- */
function getViewType(){ return localStorage.getItem('arktube:view:type') || 'all'; } // all|shorts|video

/* ---------- series-only 판별을 위해 series children 집합 구성 ---------- */
+ const SERIES_CHILD_SET = (()=> {
+   const set = new Set();
+   (CATEGORY_MODEL?.groups || []).forEach(g=>{
+     if(String(g.key).startsWith('series_') || g.isSeries===true){
+       (g.children||[]).forEach(c => set.add(c.value));
+     }
+   });
+   return set;
+ })();

function selectedIsSeriesOnly(){
  const fromUrl = parseCatsFromQuery();
  const list = Array.isArray(fromUrl) ? fromUrl : Array.isArray(sel) ? sel : [];
  if (!list.length) return false; // ALL 이거나 선택없음 → 시리즈 단독 아님
  return list.every(v => SERIES_CHILD_SET.has(v));
}

/* ---------- YouTube 검증/제어 ---------- */
const YT_URL_WHITELIST = /^(https:\/\/(www\.)?youtube\.com\/(watch\?v=|shorts\/)|https:\/\/youtu\.be\/)/i;
const YT_ID_SAFE = /^[a-zA-Z0-9_-]{6,20}$/;
let userSoundConsent=false;
let currentActive=null;
const winToCard=new Map();

function ytCmd(iframe, func, args=[]){ if(!iframe?.contentWindow) return; iframe.contentWindow.postMessage(JSON.stringify({event:"command", func, args}), "*"); }
function applyAudioPolicy(iframe){ if(!iframe) return; if(userSoundConsent){ ytCmd(iframe,"setVolume",[100]); ytCmd(iframe,"unMute"); } else { ytCmd(iframe,"mute"); } }

/* ---------- IFrame API 메시지 ---------- */
addEventListener('message',(e)=>{
  if(typeof e.data!=='string') return; let data; try{ data=JSON.parse(e.data); }catch{ return; }
  if(!data) return;

  if(data.event==='onReady'){
    const card = winToCard.get(e.source); if(!card) return;
    const iframe = card.querySelector('iframe');
    if(card===currentActive){ applyAudioPolicy(iframe); ytCmd(iframe,"playVideo"); } else { ytCmd(iframe,"mute"); }
    return;
  }

  if(data.event==='onStateChange' && data.info===0 /*ENDED*/){
    const card = winToCard.get(e.source); if(!card) return;
    const vid = card.dataset.vid || '';
    const url = card.dataset.url || '';
    resume.updateFromInfo(vid, url, { currentTime: 0, duration: Number(card.dataset.dur||0)||0, playerState: 0 });
    if(currentActive && e.source===currentActive.querySelector('iframe')?.contentWindow && AUTO_NEXT){ goToNextCard(); }
    return;
  }

  if(data.event==='infoDelivery' && data.info){
    const card = winToCard.get(e.source); if(!card) return;
    const vid = card.dataset.vid || '';
    const url = card.dataset.url || '';
    const ct  = Number(data.info.currentTime||0);
    const dur = Number(data.info.duration||0);
    if(vid) resume.updateFromInfo(vid, url, { currentTime: ct, duration: dur, playerState: data.info.playerState });
    if(dur>0) card.dataset.dur = String(Math.floor(dur));
  }
}, false);

/* ---------- 카드 구성 ---------- */
function grantSoundFromCard(){
  userSoundConsent=true;
  document.querySelectorAll('.gesture-capture').forEach(el=> el.classList.add('hidden'));
  const ifr = currentActive?.querySelector('iframe');
  if(ifr){ ytCmd(ifr,"setVolume",[100]); ytCmd(ifr,"unMute"); ytCmd(ifr,"playVideo"); }
}

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
  const wrap = document.createElement('div'); wrap.className = 'video';
  const p = document.createElement('p'); p.className='playhint'; p.style.position='static'; p.style.margin='0 auto'; p.textContent=text;
  wrap.appendChild(p); return wrap;
}

function makeCard(url, docId){
  if(!YT_URL_WHITELIST.test(String(url||''))) return null;
  const id = safeExtractYouTubeId(url); if(!id) return null;

  const card = document.createElement('div');
  card.className='video';
  card.dataset.vid = id;
  card.dataset.docId = docId || '';
  card.dataset.url = url;

  const thumbDiv = document.createElement('div'); thumbDiv.className='thumb';
  const img = document.createElement('img'); img.src=`https://i.ytimg.com/vi/${id}/hqdefault.jpg`; img.alt='thumbnail'; img.loading='lazy';
  thumbDiv.appendChild(img);

  const hint = document.createElement('div'); hint.className='playhint'; hint.textContent='위로 스와이프 · 탭하여 소리 허용';
  thumbDiv.appendChild(hint);
  if(!userSoundConsent){
    const muteTip = document.createElement('div'); muteTip.className='mute-tip'; muteTip.textContent='🔇 현재 음소거 • 한 번만 허용하면 계속 소리 재생';
    thumbDiv.appendChild(muteTip);
  }
  card.appendChild(thumbDiv);

  const gesture = document.createElement('div'); gesture.className=`gesture-capture ${userSoundConsent ? 'hidden' : ''}`; gesture.setAttribute('aria-label','tap to enable sound');
  gesture.addEventListener('pointerdown', grantSoundFromCard, { once:false });
  card.appendChild(gesture);

  activeIO.observe(card);
  return card;
}

function ensureIframe(card, preload=false){
  if(card.querySelector('iframe')) return;
  const id = card.dataset.vid; if(!YT_ID_SAFE.test(id)) return;

  const origin = encodeURIComponent(location.origin);
  const playerId = `yt-${id}-${Math.random().toString(36).slice(2,8)}`;
  const iframe = document.createElement('iframe');
  iframe.id = playerId;
  iframe.src =
    `https://www.youtube.com/embed/${id}` +
    `?enablejsapi=1&playsinline=1&autoplay=1&rel=0&mute=1` +
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
      ytCmd(iframe,"addEventListener",["onPlaybackQualityChange"]); // infoDelivery를 유도
      winToCard.set(iframe.contentWindow, card);
      if(preload) ytCmd(iframe,"mute");
    }catch{}
  });

  const thumb = card.querySelector('.thumb');
  if(thumb) card.replaceChild(iframe, thumb); else card.appendChild(iframe);
}

/* ---------- 피드 로딩 ---------- */
const PAGE_SIZE=10;
let isLoading=false, hasMore=true, lastDoc=null;
const loadedIds=new Set();

function resolveCatFilter(){
  if(PERSONAL_MODE) return null;
  const sel = getSelectedCats();
  if (sel==="ALL" || !sel) return null;
  if (Array.isArray(sel) && sel.length){
    const filtered = sel.filter(v=> !personalVals.includes(v));
    return filtered.length ? new Set(filtered) : null;
  }
  return null;
}
let CAT_FILTER = resolveCatFilter();
const SERIES_ONLY = selectedIsSeriesOnly(); // 시리즈 단독 모드?
const VIEW_TYPE = SERIES_ONLY ? 'all' : getViewType(); // 시리즈 단독이면 무시

function matchesFilter(data){
  // 카테고리 (★ cats로 통일)
  if(CAT_FILTER){
    const cats = Array.isArray(data?.cats) ? data.cats : [];
    let hit=false; for(const v of cats){ if(CAT_FILTER.has(v)){ hit=true; break; } }
    if(!hit) return false;
  }
  // 형식(클라이언트 필터 폴백)
  if(VIEW_TYPE!=='all'){
    if(String(data?.type)!==String(VIEW_TYPE)) return false;
  }
  return true;
}

function resetFeed(){
  document.querySelectorAll('#videoContainer .video').forEach(el=> activeIO.unobserve(el));
  videoContainer.replaceChildren();
  isLoading=false; hasMore=true; lastDoc=null; loadedIds.clear(); currentActive=null;
}

/* ---- 개인모드: 로컬 저장 불러오기(1~4) ---- */
let personalItems=[], personalOffset=0;
const PERSONAL_PAGE_SIZE = 12;
function loadPersonalInit(){
  const pArr = parseCatsFromQuery() || Array.from(SEL_SET||[]);
  const slot = pArr.find(v=> personalVals.includes(v)) || 'personal1';
  const key  = `personal_${slot}`; // ★ 업로드와 동일한 키
  try{ personalItems = JSON.parse(localStorage.getItem(key) || '[]'); if(!Array.isArray(personalItems)) personalItems=[]; }catch{ personalItems=[]; }
  personalItems.sort((a,b)=> (b?.savedAt||0) - (a?.savedAt||0));
  personalOffset = 0; hasMore = personalItems.length > 0;
}
function loadMorePersonal(initial=false){
  if(isLoading || !hasMore) return; isLoading=true;
  if(initial && personalItems.length===0){ videoContainer.appendChild(makeInfoRow('개인자료가 없습니다. 업로드에서 개인자료에 저장해 보세요.')); isLoading=false; hasMore=false; return; }
  const end = Math.min(personalOffset + PERSONAL_PAGE_SIZE, personalItems.length);
  for(let i=personalOffset; i<end; i++){
    const u = personalItems[i]?.url; if(!u) continue;
    const fakeId = `local-${i}`; if(loadedIds.has(fakeId)) continue;
    const card = makeCard(u, fakeId); if(!card) continue;
    loadedIds.add(fakeId); videoContainer.appendChild(card);
  }
  personalOffset = end; if(personalOffset >= personalItems.length) hasMore=false; isLoading=false; updateSnapHeightForSamsung();
}

/* ---- 공용모드: Firestore ---- */
const MAX_SCAN_PAGES = 12;

async function loadMoreCommon(initial=false){
  if(isLoading || !hasMore) return; isLoading=true;
  try{
    const base = collection(db, "videos");
    const filterSize = CAT_FILTER ? CAT_FILTER.size : 0;

    const PRIMARY_ORDER = SERIES_ONLY ? ['createdAt','asc'] : ['createdAt','desc'];

    // 1) 필터 없음
    if(!CAT_FILTER){
      const parts=[ orderBy(...PRIMARY_ORDER) ];
      if(VIEW_TYPE!=='all') parts.unshift(where('type','==', VIEW_TYPE));
      if(lastDoc) parts.push(startAfter(lastDoc));
      parts.push(limit(PAGE_SIZE));
      const snap = await getDocs(query(base, ...parts));
      await appendFromSnap(snap, initial);
    }
    // 2) array-contains-any (≤10)
    else if(filterSize <= 10){
      const whereVals = Array.from(CAT_FILTER);
      const parts=[ where("cats","array-contains-any", whereVals), orderBy(...PRIMARY_ORDER) ]; // ★ cats
      if(VIEW_TYPE!=='all') parts.push(where('type','==', VIEW_TYPE));
      if(lastDoc) parts.push(startAfter(lastDoc));
      parts.push(limit(PAGE_SIZE));
      const snap = await getDocs(query(base, ...parts));
      await appendFromSnap(snap, initial, false);
    }
    // 3) 폴백: 최신/등록 페이지 스캔 + 클라 필터
    else{
      let appended = 0; let scannedPages = 0; let localLast = lastDoc; let reachedEnd = false;
      while(appended < PAGE_SIZE && !reachedEnd && scannedPages < MAX_SCAN_PAGES){
        const parts=[ orderBy(...PRIMARY_ORDER) ];
        if(localLast) parts.push(startAfter(localLast));
        parts.push(limit(PAGE_SIZE));
        const snap = await getDocs(query(base, ...parts));
        if(snap.empty){ reachedEnd = true; break; }

        for(const d of snap.docs){
          localLast = d;
          if(loadedIds.has(d.id)) continue;
          const data = d.data();
          if(matchesFilter(data)){
            const card = makeCard(data.url, d.id);
            if(!card) continue;
            loadedIds.add(d.id); videoContainer.appendChild(card); appended++;
            if(appended >= PAGE_SIZE) break;
          }
        }
        scannedPages++; lastDoc = localLast || lastDoc;
        if(snap.size < PAGE_SIZE){ reachedEnd = true; }
      }
      hasMore = !reachedEnd;
      if(initial && appended===0){
        videoContainer.appendChild(makeInfoRow(SERIES_ONLY ? '해당 시리즈 영상이 없습니다.' : '해당 카테고리 영상이 없습니다.'));
      }
    }
  }catch(e){
    console.error(e);
    if(initial) videoContainer.appendChild(makeInfoRow('목록을 불러오지 못했습니다.'));
  }finally{
    isLoading=false; updateSnapHeightForSamsung();
  }
}

async function appendFromSnap(snap, initial, clientFilter=false){
  if(snap.empty){
    if(initial) videoContainer.appendChild(makeInfoRow(SERIES_ONLY ? '해당 시리즈 영상이 없습니다.' : '해당 카테고리 영상이 없습니다.'));
    hasMore=false; return;
  }
  let appended=0;
  for(const d of snap.docs){
    if(loadedIds.has(d.id)) continue;
    const data=d.data();
    if(clientFilter && !matchesFilter(data)) continue;
    const card = makeCard(data.url, d.id);
    if(!card) continue;
    loadedIds.add(d.id); videoContainer.appendChild(card); appended++;
  }
  lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
  if(snap.size < PAGE_SIZE) hasMore=false;
  if(initial && appended===0){
    videoContainer.appendChild(makeInfoRow(SERIES_ONLY ? '해당 시리즈 영상이 없습니다.' : '해당 카테고리 영상이 없습니다.'));
  }
}

/* ---------- 스크롤 페이징 ---------- */
videoContainer.addEventListener('scroll', ()=>{
  const nearBottom = videoContainer.scrollTop + videoContainer.clientHeight >= videoContainer.scrollHeight - 200;
  if(nearBottom){
    if(QUEUE_MODE) return;
    if(PERSONAL_MODE) loadMorePersonal(false);
    else loadMoreCommon(false);
  }
});

/* ---------- auto-next ---------- */
async function goToNextCard(){
  const next = currentActive?.nextElementSibling;
  if(next && next.classList.contains('video')){ next.scrollIntoView({behavior:'smooth', block:'start'}); return; }
  if(QUEUE_MODE){ showTopbar(); return; }
  if(!hasMore){ showTopbar(); return; }
  const before = videoContainer.querySelectorAll('.video').length;
  if(PERSONAL_MODE) loadMorePersonal(false);
  else await loadMoreCommon(false);
  const after  = videoContainer.querySelectorAll('.video').length;
  if(after>before){ videoContainer.querySelectorAll('.video')[before]?.scrollIntoView({ behavior:'smooth', block:'start' }); }
  else{ showTopbar(); }
}

/* ---------- 큐 모드 (list에서 전달) ---------- */
let QUEUE_MODE = false;
function tryLoadFromQueue(){
  const hasIdx = getParam('idx') !== null;
  const hasDoc = !!getParam('doc');
  if (!hasIdx && !hasDoc) return false;
  let queue = [];
  try { queue = JSON.parse(sessionStorage.getItem('playQueue') || '[]'); } catch { queue = []; }
  if (!Array.isArray(queue) || queue.length === 0) return false;

  let idx = sessionStorage.getItem('playIndex');
  const urlIdx = getParam('idx'); if (urlIdx !== null) idx = urlIdx;
  const docParam = getParam('doc');
  if (docParam) {
    const found = queue.findIndex(it => it.id === docParam);
    if (found >= 0) idx = String(found);
  }
  const startIndex = Math.max(0, Math.min(queue.length - 1, parseInt(idx || '0', 10) || 0));

  resetFeed(); QUEUE_MODE = true; hasMore = false;
  queue.forEach((item, i) => {
    const url = item?.url || ''; const did = item?.id  || `q-${i}`;
    if(loadedIds.has(did)) return;
    const card = makeCard(url, did); if(!card) return;
    loadedIds.add(did); videoContainer.appendChild(card);
  });

  const target = videoContainer.querySelectorAll('.video')[startIndex];
  if (target) { target.scrollIntoView({ behavior:'instant', block:'start' }); ensureIframe(target); currentActive = target; }
  sessionStorage.setItem('playIndex', String(startIndex));
  updateSnapHeightForSamsung(); showTopbar(); return true;
}

/* ---------- 시리즈 이어보기 모드 ---------- */
async function tryResumeSeries(){
  const seriesKey = sessionStorage.getItem('resumeSeriesKey');
  if(!seriesKey) return false;

  // 시리즈 등록순 asc로 문서 로드  (★ cats)
  const base = collection(db, "videos");
  const q = query(base, where('cats','array-contains', seriesKey), orderBy('createdAt','asc'), limit(120));
  const snap = await getDocs(q);
  if(snap.empty){ sessionStorage.removeItem('resumeSeriesKey'); return false; }

  const docsAsc = snap.docs.map(d => ({ id:d.id, url:d.data()?.url || '' }));
  const pick = resume.chooseNextInSeries(seriesKey, docsAsc);
  if(!pick?.targetId){ sessionStorage.removeItem('resumeSeriesKey'); return false; }

  resetFeed(); QUEUE_MODE = true; hasMore = false;
  docsAsc.forEach((it)=>{ if(loadedIds.has(it.id)) return; const card = makeCard(it.url, it.id); if(!card) return; loadedIds.add(it.id); videoContainer.appendChild(card); });

  const idx = Math.max(0, docsAsc.findIndex(x=> x.id===pick.targetId));
  const target = videoContainer.querySelectorAll('.video')[idx];
  if (target) {
    target.scrollIntoView({ behavior:'instant', block:'start' });
    ensureIframe(target); currentActive = target;
    target.dataset.seekHint = String(pick.startPosSec||0);
  }

  resume.setSeriesHint(seriesKey, { lastVideoId: pick.targetId, lastIndex: idx });
  sessionStorage.removeItem('resumeSeriesKey');
  updateSnapHeightForSamsung(); showTopbar(); return true;
}

/* ---------- 시작 ---------- */
(async ()=>{
  if (tryLoadFromQueue()) return;
  if (await tryResumeSeries()) return;

  // URL ?doc=단건 재생
  const docId = getParam('doc');
  if (docId) {
    try{
      const ref = doc(db, 'videos', docId); const snap = await getDoc(ref);
      if (snap.exists()) {
        resetFeed();
        const d = snap.data(); const u = d?.url || '';
        const card = makeCard(u, docId);
        if(card){ loadedIds.add(docId); videoContainer.appendChild(card); const target = videoContainer.querySelector('.video'); if (target) { ensureIframe(target); currentActive = target; } }
        else{ videoContainer.appendChild(makeInfoRow('해당 영상을 재생할 수 없습니다.')); }
        updateSnapHeightForSamsung(); showTopbar(); return;
      }
    }catch(e){ console.warn('[watch] doc load fail:', e?.message||e); }
  }

  resetFeed();
  if(PERSONAL_MODE){ loadPersonalInit(); loadMorePersonal(true); }
  else{ await loadMoreCommon(true); }
  showTopbar(); updateSnapHeightForSamsung();
})();

/* ---------- 최초 탭에서 소리 허용 후, seekHint 처리 ---------- */
addEventListener('click', ()=>{
  const t = currentActive; if(!t) return;
  const hint = Number(t.dataset.seekHint||0)||0;
  if(hint>0){
    const ifr = t.querySelector('iframe');
    if(ifr){ ytCmd(ifr, "seekTo", [hint, true]); ytCmd(ifr,"playVideo"); }
    t.dataset.seekHint = '';
  }
}, { once:false });
