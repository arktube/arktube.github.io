// /js/watch.js — ArkTube v1.0 (clean rebuild)
// - Firestore 필드: cats/type/title/url/createdAt 에 맞춰 읽기
// - CATEGORY_MODEL 기반 시리즈 감지 (isSeries=true || key startsWith 'series_')
// - 시리즈 only ⇒ asc, 그 외 ⇒ desc  + view type(all|video|shorts, 시리즈일땐 무시)
// - 개인자료(personal1..4) 로컬 재생 (키: personal_${slot})
// - 완전 전체화면 렌더(흰 줄 제거) + IO로 현재 카드만 재생/음소거 제어
// - list와 연동: sessionStorage playQueue/playIndex 지원
// - 외부 모듈 의존 제거(코드 간 꼬임 방지)

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';
import {
  collection, getDocs, query, where, orderBy, limit, startAfter, doc, getDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ========== Full-bleed 스타일(흰 테두리 제거) ========== */
(function injectFullBleedCSS(){
  if (document.getElementById('watch-fullbleed-css')) return;
  const s = document.createElement('style');
  s.id = 'watch-fullbleed-css';
  s.textContent = `
html, body { margin:0!important; padding:0!important; height:100%; background:#000!important; }
#videoContainer { margin:0!important; padding:0!important; height:var(--app-vh,100vh); overflow:auto; background:#000!important; -webkit-overflow-scrolling:touch; }
.video { width:100vw; height:var(--app-vh,100vh); margin:0 auto; position:relative; background:#000; }
.video .thumb, .video iframe { width:100%; height:100%; display:block; background:#000; border:0; }
.video .thumb img { width:100%; height:100%; object-fit:cover; background:#000; display:block; }
.gesture-capture { position:absolute; inset:0; z-index:3; background:transparent; }
.gesture-capture.hidden { display:none; }
.playhint, .mutetip { position:absolute; left:50%; transform:translateX(-50%); color:#eee; text-shadow:0 1px 2px rgba(0,0,0,.6); z-index:4; }
.playhint { bottom:14px; font-size:14px; opacity:.9; }
.mutetip  { top:12px;   font-size:12px; opacity:.9; }
#topbar.hide { opacity:0; pointer-events:none; transition:opacity .2s ease; }
#topbar     { transition:opacity .2s ease; }
`;
  document.head.appendChild(s);
})();

/* ========== Viewport 보정 ========== */
function updateVh(){ document.documentElement.style.setProperty('--app-vh', `${window.innerHeight}px`); }
updateVh(); addEventListener('resize', updateVh, { passive:true }); addEventListener('orientationchange', updateVh, { passive:true });

/* ========== DOM ========== */
const topbar         = document.getElementById('topbar');
const signupLink     = document.getElementById('signupLink');
const signinLink     = document.getElementById('signinLink');
const welcome        = document.getElementById('welcome');
const menuBtn        = document.getElementById('menuBtn');
const dropdown       = document.getElementById('dropdownMenu');
const btnSignOut     = document.getElementById('btnSignOut');
const btnMyUploads   = document.getElementById('btnMyUploads');
const btnAbout       = document.getElementById('btnAbout');
const brandHome      = document.getElementById('brandHome');
const btnList        = document.getElementById('btnList');
const videoContainer = document.getElementById('videoContainer');

/* ========== 상단바/드롭다운 최소 구현 ========== */
let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ isMenuOpen=false; dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'),180); }
onAuthStateChanged(auth,(user)=>{ const loggedIn=!!user; signupLink?.classList.toggle('hidden',loggedIn); signinLink?.classList.toggle('hidden',loggedIn); if(welcome) welcome.textContent = loggedIn ? `Welcome! ${user.displayName || '회원'}` : ''; closeDropdown(); });
menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
dropdown?.addEventListener('click',(e)=> e.stopPropagation());
addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ location.href = auth.currentUser ? '/manage-uploads.html' : '/signin.html'; closeDropdown(); });
btnAbout    ?.addEventListener('click', ()=>{ location.href = '/about.html'; closeDropdown(); });
btnList     ?.addEventListener('click', ()=>{ location.href = '/list.html?from=watch'; closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{ if(!auth.currentUser){ location.href='/signin.html'; return; } await fbSignOut(auth); closeDropdown(); });
brandHome   ?.addEventListener('click', (e)=>{ e.preventDefault(); const src=new URL(location.href).searchParams.get('src'); location.href = src==='list' ? '/list.html' : '/index.html'; });

/* ========== 상단바 자동 숨김 ========== */
const HIDE_MS=1000; let hideTimer=null;
function showTopbar(){ topbar?.classList.remove('hide'); if(hideTimer) clearTimeout(hideTimer); if(!isMenuOpen){ hideTimer=setTimeout(()=> topbar?.classList.add('hide'), HIDE_MS); } }
['scroll','wheel','mousemove','pointermove','touchmove','keydown'].forEach(ev=>{
  (ev==='scroll'?videoContainer:window).addEventListener(ev, ()=>{ if(!isMenuOpen) showTopbar(); }, { passive:true });
});

/* ========== 선택/모드 파생 ========== */
const personalVals = ['personal1','personal2','personal3','personal4'];
function getParam(name){ try{ return new URL(location.href).searchParams.get(name); }catch{ return null; } }
function parseCatsFromQuery(){ try{ const p=new URL(location.href).searchParams.get('cats'); if(!p) return null; const a=p.split(',').map(s=>s.trim()).filter(Boolean); return a.length?a:null; }catch{ return null; } }
function getSelectedCats(){
  const fromUrl = parseCatsFromQuery(); if(fromUrl) return fromUrl;
  try{ return JSON.parse(localStorage.getItem('selectedCats')||'null'); }catch{ return 'ALL'; }
}
function getViewType(){ return localStorage.getItem('arktube:view:type') || 'all'; } // all | video | shorts
function readAutoNext(){ const v=(localStorage.getItem('autonext')||'').toLowerCase(); return v==='1'||v==='true'||v==='on'; }
let AUTO_NEXT = readAutoNext(); window.addEventListener('storage', (e)=>{ if(e.key==='autonext') AUTO_NEXT = readAutoNext(); });

/* ========== CATEGORY_MODEL 기반 시리즈 판정 ========== */
const SERIES_CHILD_SET = (()=> {
  const set = new Set();
  (CATEGORY_MODEL?.groups||[]).forEach(g=>{
    const isSeries = g?.isSeries===true || String(g?.key||'').startsWith('series_');
    if(!isSeries) return;
    (g?.children||[]).forEach(c=> c?.value && set.add(c.value));
  });
  return set;
})();
function isSeriesOnly(selection){
  const list = Array.isArray(selection) ? selection : (selection==='ALL' ? [] : []);
  if(!list.length) return false;
  return list.every(v => SERIES_CHILD_SET.has(v));
}

/* ========== YouTube IFrame 제어 ========== */
const YT_URL_OK = /^(https:\/\/(www\.)?youtube\.com\/(watch\?v=|shorts\/)|https:\/\/youtu\.be\/)/i;
const YT_ID_SAFE = /^[a-zA-Z0-9_-]{6,20}$/;
function extractId(url=''){ const m=String(url).match(/(?:youtu\.be\/|v=|shorts\/)([^?&/]+)/i); const id=m?m[1]:''; return YT_ID_SAFE.test(id)?id:''; }
function ytCmd(ifr, func, args=[]){ if(!ifr?.contentWindow) return; ifr.contentWindow.postMessage(JSON.stringify({event:'command', func, args}), '*'); }

let userSound=false, currentCard=null;
const winToCard = new Map();
function allowSound(){ userSound=true; document.querySelectorAll('.gesture-capture').forEach(el=> el.classList.add('hidden')); const ifr=currentCard?.querySelector('iframe'); if(ifr){ ytCmd(ifr,'setVolume',[100]); ytCmd(ifr,'unMute'); ytCmd(ifr,'playVideo'); } }
function applyAudio(ifr){ if(!ifr) return; if(userSound){ ytCmd(ifr,'setVolume',[100]); ytCmd(ifr,'unMute'); } else { ytCmd(ifr,'mute'); } }

/* ========== 카드 & IO ========== */
function makeInfoRow(text){
  const wrap = document.createElement('div'); wrap.className='video';
  const p = document.createElement('p'); p.className='playhint'; p.style.position='static'; p.style.margin='0 auto'; p.textContent = text;
  wrap.appendChild(p); return wrap;
}
function makeCard(url, docId){
  if(!YT_URL_OK.test(url||'')) return null;
  const id = extractId(url); if(!id) return null;

  const card = document.createElement('div');
  card.className='video';
  card.dataset.vid=id; card.dataset.docId=docId||''; card.dataset.url=url;

  const thumb = document.createElement('div'); thumb.className='thumb';
  const img = document.createElement('img'); img.src=`https://i.ytimg.com/vi/${id}/hqdefault.jpg`; img.alt='thumbnail'; img.loading='lazy';
  thumb.appendChild(img);

  const hint = document.createElement('div'); hint.className='playhint'; hint.textContent='위로 스와이프 · 탭하여 소리 허용';
  const tip  = document.createElement('div'); tip.className='mutetip';  tip.textContent ='🔇 현재 음소거 • 한 번 허용하면 계속 소리 재생';
  thumb.appendChild(hint); thumb.appendChild(tip);

  card.appendChild(thumb);

  const gesture = document.createElement('div'); gesture.className=`gesture-capture ${userSound?'hidden':''}`; gesture.setAttribute('aria-label','tap-to-unmute');
  gesture.addEventListener('pointerdown', allowSound, { once:false });
  card.appendChild(gesture);

  ACTIVE_IO.observe(card);
  return card;
}
function ensureIframe(card, preload=false){
  if(card.querySelector('iframe')) return;
  const id = card.dataset.vid; if(!YT_ID_SAFE.test(id)) return;
  const origin = encodeURIComponent(location.origin);
  const pid = `yt-${id}-${Math.random().toString(36).slice(2,8)}`;
  const ifr = document.createElement('iframe');
  ifr.id = pid;
  ifr.src = `https://www.youtube.com/embed/${id}?enablejsapi=1&playsinline=1&autoplay=1&rel=0&mute=1&origin=${origin}&widget_referrer=${encodeURIComponent(location.href)}&playerapiid=${encodeURIComponent(pid)}`;
  ifr.allow = 'autoplay; encrypted-media; picture-in-picture';
  ifr.allowFullscreen = true; Object.assign(ifr.style,{ width:'100%', height:'100%', border:'0' });
  ifr.addEventListener('load', ()=>{
    try{
      ifr.contentWindow.postMessage(JSON.stringify({ event:'listening', id: pid }), '*');
      ytCmd(ifr,'addEventListener',['onReady']);
      ytCmd(ifr,'addEventListener',['onStateChange']);
      ytCmd(ifr,'addEventListener',['onPlaybackQualityChange']);
      winToCard.set(ifr.contentWindow, card);
      if(preload) ytCmd(ifr,'mute');
    }catch{}
  });
  const t = card.querySelector('.thumb');
  if(t) card.replaceChild(ifr, t); else card.appendChild(ifr);
}

addEventListener('message', (e)=>{
  if(typeof e.data!=='string') return; let data; try{ data=JSON.parse(e.data); }catch{ return; }
  if(!data) return;

  if(data.event==='onReady'){
    const card = winToCard.get(e.source); if(!card) return;
    const ifr  = card.querySelector('iframe');
    if(card===currentCard){ applyAudio(ifr); ytCmd(ifr,'playVideo'); } else { ytCmd(ifr,'mute'); }
    return;
  }
  if(data.event==='onStateChange' && data.info===0 /*ENDED*/){
    if(currentCard && e.source===currentCard.querySelector('iframe')?.contentWindow && AUTO_NEXT){ goNext(); }
    return;
  }
}, false);

const ACTIVE_IO = new IntersectionObserver((entries)=>{
  entries.forEach(entry=>{
    const card = entry.target;
    const ifr = card.querySelector('iframe');
    if(entry.isIntersecting && entry.intersectionRatio>=0.6){
      if(currentCard && currentCard!==card){
        const prev = currentCard.querySelector('iframe');
        if(prev){ ytCmd(prev,'pauseVideo'); ytCmd(prev,'mute'); }
      }
      currentCard = card;
      ensureIframe(card);
      const cur = card.querySelector('iframe');
      if(cur){ ytCmd(cur,'playVideo'); applyAudio(cur); }
      const next = card.nextElementSibling; if(next?.classList.contains('video')) ensureIframe(next, true);
      showTopbar();
    }else{
      if(ifr){ ytCmd(ifr,'pauseVideo'); ytCmd(ifr,'mute'); }
    }
  });
},{ root: videoContainer, threshold:[0,0.6,1] });

/* ========== 데이터 로딩 ========== */
const PAGE_SIZE = 10;
const MAX_SCAN_PAGES = 12;
let isLoading=false, hasMore=true, lastDocRef=null;
const loadedIds = new Set();

function resolveFilters(){
  const sel = getSelectedCats();
  const seriesOnly = isSeriesOnly(Array.isArray(sel)?sel:[]);
  const viewType = seriesOnly ? 'all' : getViewType();
  const order = seriesOnly ? ['createdAt','asc'] : ['createdAt','desc'];

  // personal 모드
  const personals = (Array.isArray(sel)?sel:[]).filter(v=> personalVals.includes(v));
  const normals   = (Array.isArray(sel)?sel:[]).filter(v=> !personalVals.includes(v));
  const PERSONAL_MODE = personals.length===1 && normals.length===0;

  const CAT_FILTER = (Array.isArray(sel)&&sel.length && !PERSONAL_MODE) ? new Set(normals) : null;
  return { seriesOnly, viewType, order, PERSONAL_MODE, CAT_FILTER };
}

/* 개인자료 로딩 */
let personalItems=[], personalIdx=0;
function loadPersonalInit(){
  const qs = parseCatsFromQuery();
  const slot = (Array.isArray(qs)&&qs.length ? qs[0] : 'personal1');
  const key = `personal_${slot}`;
  try{ personalItems = JSON.parse(localStorage.getItem(key)||'[]'); if(!Array.isArray(personalItems)) personalItems=[]; }catch{ personalItems=[]; }
  personalItems.sort((a,b)=> (b?.savedAt||0) - (a?.savedAt||0));
  personalIdx=0; hasMore = personalItems.length>0;
}
function loadMorePersonal(initial=false){
  if(isLoading||!hasMore) return;
  isLoading=true;
  if(initial && personalItems.length===0){ videoContainer.appendChild(makeInfoRow('개인자료가 없습니다. 업로드에서 저장해 보세요.')); isLoading=false; hasMore=false; return; }
  const end = Math.min(personalIdx + PAGE_SIZE, personalItems.length);
  for(let i=personalIdx;i<end;i++){
    const u = personalItems[i]?.url; if(!u) continue;
    const id = `local-${i}`; if(loadedIds.has(id)) continue;
    const c = makeCard(u, id); if(!c) continue;
    loadedIds.add(id); videoContainer.appendChild(c);
  }
  personalIdx=end; if(personalIdx>=personalItems.length) hasMore=false; isLoading=false;
}

/* 공용 Firestore 로딩 */
async function loadMoreCommon(filters, initial=false){
  if(isLoading||!hasMore) return;
  isLoading=true;
  try{
    const base = collection(db,'videos');
    const parts = [];

    // 형식 필터
    if(filters.viewType!=='all') parts.push(where('type','==', filters.viewType));
    // 정렬
    parts.push(orderBy(...filters.order));
    // 페이징
    if(lastDocRef) parts.push(startAfter(lastDocRef));
    // 서버 카테고리(≤10) — 집합 크기가 클 수 있으니 폴백도 준비
    const filterSize = filters.CAT_FILTER ? filters.CAT_FILTER.size : 0;

    // 1) 필터 없음
    if(!filters.CAT_FILTER){
      parts.push(limit(PAGE_SIZE));
      const snap = await getDocs(query(base, ...parts));
      await appendSnap(snap, initial);
    }
    // 2) array-contains-any (≤10)
    else if(filterSize <= 10){
      const whereVals = Array.from(filters.CAT_FILTER);
      const q1 = query(base, where('cats','array-contains-any', whereVals), ...parts, limit(PAGE_SIZE));
      const snap = await getDocs(q1);
      await appendSnap(snap, initial);
    }
    // 3) 폴백: 페이지 스캔 + 클라 필터
    else{
      let appended=0, scanned=0, localLast=lastDocRef, end=false;
      while(appended<PAGE_SIZE && !end && scanned<MAX_SCAN_PAGES){
        const q2 = query(base, orderBy(...filters.order), ...(localLast?[startAfter(localLast)]:[]), limit(PAGE_SIZE));
        const s2 = await getDocs(q2);
        if(s2.empty){ end=true; break; }
        for(const d of s2.docs){
          localLast=d;
          if(loadedIds.has(d.id)) continue;
          const data=d.data(); const cats=Array.isArray(data?.cats)?data.cats:[];
          if(!cats.some(v=> filters.CAT_FILTER.has(v))) continue;
          const c = makeCard(data.url, d.id); if(!c) continue;
          loadedIds.add(d.id); videoContainer.appendChild(c); appended++;
          if(appended>=PAGE_SIZE) break;
        }
        scanned++; lastDocRef=localLast||lastDocRef;
        if(s2.size<PAGE_SIZE) end=true;
      }
      hasMore = !end;
      if(initial && appended===0){ videoContainer.appendChild(makeInfoRow('해당 카테고리 영상이 없습니다.')); }
    }
  }catch(e){
    console.error('[watch] load fail:', e);
    if(initial) videoContainer.appendChild(makeInfoRow('목록을 불러오지 못했습니다.'));
  }finally{
    isLoading=false;
  }
}
async function appendSnap(snap, initial){
  if(snap.empty){
    hasMore=false;
    if(initial) videoContainer.appendChild(makeInfoRow('해당 영상이 없습니다.'));
    return;
  }
  let appended=0;
  for(const d of snap.docs){
    if(loadedIds.has(d.id)) continue;
    const data=d.data();
    const c = makeCard(data.url, d.id); if(!c) continue;
    loadedIds.add(d.id); videoContainer.appendChild(c); appended++;
  }
  lastDocRef = snap.docs[snap.docs.length-1] || lastDocRef;
  if(snap.size<PAGE_SIZE) hasMore=false;
  if(initial && appended===0) videoContainer.appendChild(makeInfoRow('해당 영상이 없습니다.'));
}

/* ========== 스크롤 페이징 ========== */
videoContainer.addEventListener('scroll', ()=>{
  const near = videoContainer.scrollTop + videoContainer.clientHeight >= videoContainer.scrollHeight - 180;
  if(!near) return;
  if(QUEUE_MODE) return;
  if(PERSONAL_MODE) loadMorePersonal(false);
  else loadMoreCommon(FILTERS,false);
});

/* ========== Auto-next ========== */
async function goNext(){
  const next = currentCard?.nextElementSibling;
  if(next?.classList.contains('video')){ next.scrollIntoView({behavior:'smooth', block:'start'}); return; }
  if(!hasMore) { showTopbar(); return; }
  const before = videoContainer.querySelectorAll('.video').length;
  if(PERSONAL_MODE) loadMorePersonal(false);
  else await loadMoreCommon(FILTERS,false);
  const after  = videoContainer.querySelectorAll('.video').length;
  if(after>before){ videoContainer.querySelectorAll('.video')[before]?.scrollIntoView({behavior:'smooth', block:'start'}); }
  else showTopbar();
}

/* ========== 큐 모드(list 연동) & 단건 재생 ========== */
let QUEUE_MODE=false, PERSONAL_MODE=false, FILTERS=null;
function tryLoadFromQueue(){
  const hasIdx = getParam('idx')!==null;
  const hasDoc = !!getParam('doc');
  if(!hasIdx && !hasDoc) return false;

  let queue=[]; try{ queue=JSON.parse(sessionStorage.getItem('playQueue')||'[]'); }catch{ queue=[]; }
  if(!Array.isArray(queue)||queue.length===0) return false;

  let idx = sessionStorage.getItem('playIndex');
  const urlIdx=getParam('idx'); if(urlIdx!==null) idx=urlIdx;
  const docParam=getParam('doc');
  if(docParam){ const i=queue.findIndex(it=> it.id===docParam); if(i>=0) idx=String(i); }
  const start = Math.max(0, Math.min(queue.length-1, parseInt(idx||'0',10)||0));

  resetFeed(); QUEUE_MODE=true; hasMore=false;
  queue.forEach((it,i)=>{ const id=it?.id||`q-${i}`, u=it?.url||''; if(loadedIds.has(id)) return; const c=makeCard(u,id); if(!c) return; loadedIds.add(id); videoContainer.appendChild(c); });
  const target = videoContainer.querySelectorAll('.video')[start];
  if(target){ target.scrollIntoView({behavior:'instant', block:'start'}); ensureIframe(target); currentCard=target; }
  showTopbar(); return true;
}
async function trySingleDoc(){
  const docId = getParam('doc'); if(!docId) return false;
  try{
    const ref = doc(db,'videos',docId); const snap = await getDoc(ref);
    if(!snap.exists()) return false;
    resetFeed();
    const u = snap.data()?.url || '';
    const c = makeCard(u, docId);
    if(c){ loadedIds.add(docId); videoContainer.appendChild(c); const t=videoContainer.querySelector('.video'); if(t){ ensureIframe(t); currentCard=t; } }
    else { videoContainer.appendChild(makeInfoRow('해당 영상을 재생할 수 없습니다.')); }
    showTopbar(); return true;
  }catch{ return false; }
}

/* ========== 공통 유틸 ========== */
function resetFeed(){
  document.querySelectorAll('#videoContainer .video').forEach(el=> ACTIVE_IO.unobserve(el));
  videoContainer.replaceChildren();
  isLoading=false; hasMore=true; lastDocRef=null; loadedIds.clear(); currentCard=null;
}

/* ========== 시작 ========== */
(async function main(){
  // 큐/단건 최우선
  if(tryLoadFromQueue()) return;
  if(await trySingleDoc()) return;

  // 일반 흐름
  const sel = getSelectedCats();
  FILTERS = resolveFilters();
  PERSONAL_MODE = FILTERS.PERSONAL_MODE;

  resetFeed();
  if(PERSONAL_MODE){
    loadPersonalInit();
    loadMorePersonal(true);
  }else{
    await loadMoreCommon(FILTERS, true);
  }
  showTopbar();
})();

/* ========== 첫 터치 후 소리 허용 처리(신뢰된 제스처) ========== */
addEventListener('click', ()=>{ /* 의도적 no-op: allowSound는 카드 오버레이에 연결됨 */ }, { once:false });
