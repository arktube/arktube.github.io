/* watch.js — ArkTube 플레이어(확장판)
 * - 선택된 카테고리/타입에 맞춰 Firestore 페이지네이션 로드
 * - YouTube Iframe API로 재생 제어(음소거/반복/상태)
 * - 스크롤 스냅 기반 슬라이드(Shorts/일반 공용)
 * - 오프스크린 플레이어 일시정지, 근접 프리페치
 * - 셔플/블랙리스트/시청기록/마지막 위치 복구
 * - 키보드/터치 내비게이션, 토스트/상태 표시
 * - 개인자료(?personal=personal1~4) 로컬 재생 지원
 */
import './firebase-init.js';
import { db, auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  collection, query, where, orderBy, limit, getDocs, startAfter
} from 'https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js';
import { CATEGORY_MODEL, labelOf } from './categories.js';

// ====== 상단바 공통(로그인유지/드롭다운) ======
const $ = (s)=>document.querySelector(s);
const signupLink   = $("#signupLink");
const signinLink   = $("#signinLink");
const welcome      = $("#welcome");
const menuBtn      = $("#menuBtn");
const dropdown     = $("#dropdownMenu");
const btnSignOut   = $("#btnSignOut");
const btnGoUpload  = $("#btnGoUpload");
const btnMyUploads = $("#btnMyUploads");
const btnAbout     = $("#btnAbout");
const btnList      = $("#btnList");

function openDropdown(){ dropdown?.classList.remove("hidden"); requestAnimationFrame(()=> dropdown?.classList.add("show")); }
function closeDropdown(){ dropdown?.classList.remove("show"); setTimeout(()=> dropdown?.classList.add("hidden"),180); }
onAuthStateChanged(auth,(user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle("hidden", loggedIn);
  signinLink?.classList.toggle("hidden", loggedIn);
  welcome.textContent = loggedIn ? `Welcome! ${user.displayName || '회원'}` : "";
  closeDropdown();
});
menuBtn?.addEventListener("click",(e)=>{ e.stopPropagation(); dropdown.classList.contains("hidden") ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu, #menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener("click",(e)=> e.stopPropagation());
btnMyUploads ?.addEventListener("click", ()=>{ location.href = "manage-uploads.html"; closeDropdown(); });
btnGoUpload  ?.addEventListener("click", ()=>{ location.href = "upload.html"; closeDropdown(); });
btnAbout     ?.addEventListener("click", ()=>{ location.href = "about.html"; closeDropdown(); });
btnSignOut   ?.addEventListener("click", async ()=>{ await fbSignOut(); closeDropdown(); });
btnList      ?.addEventListener("click", ()=>{ location.href = "list.html"; closeDropdown(); });

// ====== 상수/스토리지 키 ======
const SELECTED_CATS_KEY = 'selectedCats';   // "ALL" | string[] | "personalX"
const AUTONEXT_KEY      = 'autonext';       // '1' | '0'
const MEDIA_KEY         = 'selectedMedia';  // 'both' | 'shorts' | 'video'
const LAST_POS_KEY      = 'watch.lastIndex';// 마지막 본 인덱스
const HISTORY_KEY       = 'watch.history';  // { id: timestamp }
const BLACK_KEY         = 'watch.blacklist';// { [id]:1 }
const SHUFFLE_KEY       = 'watch.shuffle';  // '1' | '0'
const REPEAT_KEY        = 'watch.repeat';   // 'none'|'one'|'all'
const MUTE_KEY          = 'watch.muted';    // '1'|'0'

// ====== 엘리먼트 ======
const container = document.getElementById('videoContainer');
const statusEl  = document.getElementById('status');
const toastEl   = document.getElementById('toast');
const btnPrev   = document.getElementById('btnPrev');
const btnNext   = document.getElementById('btnNext');
const btnMute   = document.getElementById('btnMute');
const btnShuffle= document.getElementById('btnShuffle');
const btnRepeat = document.getElementById('btnRepeat');
const btnBlacklist = document.getElementById('btnBlacklist');

// ====== 유틸 ======
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));

function showToast(msg, ms=1400){
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(()=> toastEl.classList.remove('show'), ms);
}
function setStatus(msg){ statusEl.textContent = msg; }

// Storage helpers
function getObj(key, fallback={}){ try{ return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{ return fallback; } }
function setObj(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
const getBool = (k,def=false)=>{ const v=(localStorage.getItem(k)||'').toLowerCase(); if(v==='1'||v==='true') return true; if(v==='0'||v==='false') return false; return def; };

// ====== 선택 옵션 ======
const urlParams = new URLSearchParams(location.search);
const personal = urlParams.get('personal'); // personal1~4
const mediaPref = localStorage.getItem(MEDIA_KEY) || 'both';
const autoNext  = getBool(AUTONEXT_KEY,false);
let muted = getBool(MUTE_KEY,true);
let shuffleOn = getBool(SHUFFLE_KEY,false);
let repeatMode = localStorage.getItem(REPEAT_KEY) || 'none'; // none|one|all

// 버튼 상태 반영
function refreshButtons(){
  btnMute.textContent = muted ? '🔇 Mute' : '🔊 Unmute';
  btnShuffle.textContent = shuffleOn ? '셔플 켜짐' : '셔플';
  btnRepeat.textContent = repeatMode==='none' ? '반복 꺼짐' : (repeatMode==='one'?'1곡 반복':'전체 반복');
}
refreshButtons();

// ====== 플레이 큐/상태 ======
let items = [];     // {id, url, type, cats[], title?}
let page = 0;
let cursor = null;  // Firestore 페이지네이션
let index = 0;      // 현재 인덱스
let players = [];   // YouTube Player 인스턴스(슬라이드별)
let observers = null; // IntersectionObserver
let fetching = false;
let destroyed = false;

const historyMap = getObj(HISTORY_KEY, {});
const blacklist  = getObj(BLACK_KEY, {});

// ====== YouTube Iframe API 준비 ======
let YT_READY = false;
window.onYouTubeIframeAPIReady = function(){ YT_READY = true; };

// ====== URL/ID 유틸 ======
function ytIdFromUrl(u){
  try{
    const url = new URL(u);
    if (url.hostname==='youtu.be') return url.pathname.slice(1);
    const v = url.searchParams.get('v'); if (v) return v;
    const m = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  }catch{}
  return '';
}

// ====== DOM 생성 ======
function makeSkeleton(){
  const sk = document.createElement('div'); sk.className='skeleton';
  sk.textContent = '불러오는 중…';
  return sk;
}
function makeSlide(it, i, autoplay=false){
  const wrap = document.createElement('section'); wrap.className='video'; wrap.dataset.idx=String(i);
  const sk = makeSkeleton();
  const id = ytIdFromUrl(it.url);
  const div = document.createElement('div'); div.id = `yt_${i}_${id||'unknown'}`; div.className='yt';
  wrap.appendChild(div);
  wrap.appendChild(sk);
  // 힌트
  const hint = document.createElement('div'); hint.className='hint';
  hint.textContent = (it.title || '') ? it.title : (it.type==='shorts'?'쇼츠 영상':'일반 영상');
  wrap.appendChild(hint);

  // YouTube Player 준비(나중에 attach)
  queuePlayerAttach(div.id, id, autoplay);
  return wrap;
}

// attach 큐(Intersection 발생 시 생성하도록)
const attachQueue = new Map();
function queuePlayerAttach(domId, videoId, autoplay){
  attachQueue.set(domId, { videoId, autoplay });
}
function attachPlayer(domId, videoId, autoplay){
  if (!YT_READY) return false;
  const container = document.getElementById(domId);
  if (!container) return false;

  const i = Number(container.parentElement?.dataset.idx||'0');
  // 이미 있으면 스킵
  if (players[i]) return true;

  players[i] = new YT.Player(domId, {
    videoId,
    width:'100%', height:'100%',
    playerVars:{
      autoplay: autoplay ? 1 : 0,
      rel:0, playsinline:1,
      mute: muted ? 1 : 0,
      controls:1, modestbranding:1
    },
    events:{
      onReady: (ev)=> {
        // 스켈레톤 제거
        container.parentElement?.querySelector('.skeleton')?.remove();
        if (autoplay){ safePlay(i); }
      },
      onStateChange: (ev)=> {
        // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
        if (ev.data === 0){ // ended
          markWatched(items[i]?.id);
          if (repeatMode==='one'){ safePlay(i); return; }
          if (autoNext || repeatMode==='all'){ gotoIndex(i+1); }
        }
        updateStatus();
      },
      onError: ()=> {
        showToast('재생 오류: 다음 영상으로 이동합니다.');
        gotoIndex(i+1);
      }
    }
  });
  return true;
}

// IntersectionObserver: 근접 슬라이드 attach/오프스크린 pause
function setupObserver(){
  if (observers) return;
  observers = new IntersectionObserver((entries)=>{
    for(const e of entries){
      const el = e.target;
      const i = Number(el.dataset.idx||'0');
      const idDiv = el.querySelector('.yt')?.id;
      if (e.isIntersecting){
        // 가시화: attach 시도
        const info = attachQueue.get(idDiv);
        if (info){ attachPlayer(idDiv, info.videoId, info.autoplay); attachQueue.delete(idDiv); }
        // 주변 프리페치(±2)
        prefetchNeighbors(i);
      }else{
        // 완전히 벗어나면 일시정지(자원 절약)
        if (players[i]) { try{ players[i].pauseVideo?.(); }catch{} }
      }
    }
  }, { root:container, threshold:0.35 });
}

// ====== 데이터 로드 ======
async function loadPersonal(){
  if (page>0) return; // 한 번만
  const key = `personal_${personal}`;
  const arr = getObj(key, []); // [{url,type?,cats?,title?}]
  const rows = arr
    .map(x=>({ id: x.url, url:x.url, type:x.type||guessType(x.url), cats:x.cats||[], title:x.title||'' }))
    .filter(x=>!blacklist[x.id]);
  items = shuffleOn ? shuffle(rows.slice()) : rows;
  renderInitial();
  page++;
}
function guessType(u){
  try{
    const url = new URL(u);
    if (/\/shorts\/[A-Za-z0-9_-]+/.test(url.pathname)) return 'shorts';
    if (url.hostname==='youtu.be') return 'video';
    if (url.pathname==='/watch' && url.searchParams.get('v')) return 'video';
  }catch{}
  return 'video';
}

async function loadMore(){
  if (fetching) return; fetching=true;
  if (personal){ fetching=false; return; }

  const qBase = [ orderBy('createdAt','desc') ];
  const selected = (()=>{ try{ return JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{ return null; } })();
  if (Array.isArray(selected) && selected.length){
    qBase.push(where('cats','array-contains-any', selected.slice(0,10)));
  }
  if (mediaPref==='shorts') qBase.push(where('type','==','shorts'));
  if (mediaPref==='video')  qBase.push(where('type','==','video'));
  if (cursor) qBase.push(startAfter(cursor));

  const snap = await getDocs(query(collection(db,'videos'), ...qBase, limit(24)));
  if (!snap.empty) cursor = snap.docs[snap.docs.length-1];

  const rows = snap.docs.map(d=>({ id:d.id, ...(d.data()) }))
    .filter(x=>!blacklist[x.id]);

  if (page===0){
    items = rows;
    if (shuffleOn) items = shuffle(items);
    renderInitial();
  }else{
    const start = items.length;
    items.push(...rows);
    appendSlides(start, rows);
  }
  page++;
  fetching=false;
}

// ====== 렌더링 ======
function renderInitial(){
  container.replaceChildren();
  setupObserver();
  if (!items.length){
    container.appendChild(empty('재생할 영상이 없습니다. 카테고리 또는 업로드를 확인해 주세요.'));
    setStatus('목록 비어있음');
    return;
  }
  appendSlides(0, items);
  // 마지막 위치 복구
  const last = Number(localStorage.getItem(LAST_POS_KEY)||'0');
  index = clamp(last, 0, items.length-1);
  container.scrollTo({ top: index*container.clientHeight, behavior:'instant' });
  // 첫 프레임 자동재생
  setTimeout(()=> autoAttachAndPlay(index), 50);
  updateStatus();
}
function empty(msg){
  const d = document.createElement('div'); d.className='video';
  const p = document.createElement('div'); p.className='hint'; p.textContent = msg;
  d.appendChild(p); return d;
}
function appendSlides(startIndex, arr){
  const frag = document.createDocumentFragment();
  for (let i=0; i<arr.length; i++){
    const it = arr[i];
    const slide = makeSlide(it, startIndex+i, false);
    frag.appendChild(slide);
    observers?.observe(slide);
  }
  container.appendChild(frag);
  // 근접 프리페치
  prefetchNeighbors(index);
}
function autoAttachAndPlay(i){
  const idDiv = container.querySelector(`section.video[data-idx="${i}"] .yt`)?.id;
  const vid = ytIdFromUrl(items[i]?.url||'');
  if (!idDiv || !vid) return;
  if (!attachPlayer(idDiv, vid, true)){
    // 아직 API 준비 전이면 조금 뒤 재시도
    setTimeout(()=> attachPlayer(idDiv, vid, true), 250);
  }
}

// ====== 이동/프리페치 ======
function prefetchNeighbors(i){
  for(const k of [i-2, i-1, i, i+1, i+2]){
    if (k<0 || k>=items.length) continue;
    const idDiv = container.querySelector(`section.video[data-idx="${k}"] .yt`)?.id;
    const info = attachQueue.get(idDiv);
    if (info){ attachPlayer(idDiv, info.videoId, false); attachQueue.delete(idDiv); }
  }
}
function gotoIndex(i, opts={smooth:true}){
  if (!items.length) return;
  // 반복 all: 범위 넘어가면 순환
  if (repeatMode==='all'){
    if (i<0) i = items.length-1;
    if (i>=items.length) i = 0;
  }
  if (i<0) i=0;
  if (i>=items.length){
    // 더 로드 요청
    loadMore().then(()=> {
      const t = Math.min(i, items.length-1);
      container.scrollTo({ top: t*container.clientHeight, behavior:opts.smooth?'smooth':'instant' });
    });
    return;
  }
  index = i;
  localStorage.setItem(LAST_POS_KEY, String(index));
  container.scrollTo({ top: i*container.clientHeight, behavior: opts.smooth?'smooth':'instant' });
  // 현재 프레임 자동재생 시도
  setTimeout(()=> autoAttachAndPlay(i), 60);
  prefetchNeighbors(i);
  updateStatus();
}
function safePlay(i){
  try{ players[i]?.playVideo?.(); }catch{}
}
function safePause(i){
  try{ players[i]?.pauseVideo?.(); }catch{}
}

// ====== 기록/블랙리스트 ======
function markWatched(id){
  if (!id) return;
  historyMap[id] = Date.now();
  setObj(HISTORY_KEY, historyMap);
}
function toggleBlacklistCurrent(){
  const it = items[index];
  if (!it) return;
  blacklist[it.id] = 1;
  setObj(BLACK_KEY, blacklist);
  showToast('이 영상을 숨겼습니다.');
  // 즉시 다음으로
  gotoIndex(index+1);
}

// ====== 키보드/터치 조작 ======
let touchStartY = 0;
container.addEventListener('touchstart', (e)=>{ touchStartY = e.touches[0].clientY; }, {passive:true});
container.addEventListener('touchend', (e)=>{
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dy) < 40) return;
  if (dy>0) gotoIndex(index-1); else gotoIndex(index+1);
}, {passive:true});

document.addEventListener('keydown', (e)=>{
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  switch(e.key.toLowerCase()){
    case 'arrowdown': case 'pagedown': case 'j': gotoIndex(index+1); break;
    case 'arrowup': case 'pageup': case 'k': gotoIndex(index-1); break;
    case 't': toggleMute(); break;
    case 's': toggleShuffle(); break;
    case 'r': toggleRepeat(); break;
    case 'b': toggleBlacklistCurrent(); break;
    case ' ': // space: play/pause
      e.preventDefault();
      const p = players[index];
      if (!p) { autoAttachAndPlay(index); break; }
      try{
        const st = p.getPlayerState?.();
        if (st===1) p.pauseVideo(); else p.playVideo();
      }catch{}
      break;
  }
});

// 버튼
btnPrev.addEventListener('click', ()=> gotoIndex(index-1));
btnNext.addEventListener('click', ()=> gotoIndex(index+1));
btnMute.addEventListener('click', ()=> toggleMute());
btnShuffle.addEventListener('click', ()=> toggleShuffle());
btnRepeat.addEventListener('click', ()=> toggleRepeat());
btnBlacklist.addEventListener('click', ()=> toggleBlacklistCurrent());

function toggleMute(){
  muted = !muted; localStorage.setItem(MUTE_KEY, muted?'1':'0');
  refreshButtons();
  const p = players[index]; try{ muted ? p.mute() : p.unMute(); }catch{}
  showToast(muted?'음소거':'음소거 해제');
}
function toggleShuffle(){
  shuffleOn = !shuffleOn; localStorage.setItem(SHUFFLE_KEY, shuffleOn?'1':'0'); refreshButtons();
  // 현재 아이템 고정, 나머지 섞기
  if (items.length>2){
    const cur = items[index];
    const rest = items.slice(0,index).concat(items.slice(index+1));
    items = [cur, ...shuffle(rest)];
    // DOM 재구성
    renderAfterShuffle();
  }
}
function renderAfterShuffle(){
  // 현재 index=0으로 맞추고 다시 렌더
  index = 0; localStorage.setItem(LAST_POS_KEY, '0');
  renderInitial();
}
function toggleRepeat(){
  repeatMode = repeatMode==='none' ? 'one' : (repeatMode==='one'?'all':'none');
  localStorage.setItem(REPEAT_KEY, repeatMode);
  refreshButtons();
  showToast(repeatMode==='none'?'반복 꺼짐': (repeatMode==='one'?'한 영상 반복':'전체 반복'));
}

// ====== 상태 표시 ======
function updateStatus(){
  const it = items[index];
  const pos = `${index+1}/${items.length||'?'}`;
  const mode = (repeatMode==='none'?'반복X':(repeatMode==='one'?'1반복':'전체반복')) + (shuffleOn?'·셔플':'');
  setStatus(`${pos}  ·  ${it ? (it.type==='shorts'?'쇼츠':'일반') : '-'}  ·  ${mode}`);
}

// ====== 배열 셔플 ======
function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

// ====== 스크롤 동기화 ======
container.addEventListener('scroll', ()=>{
  const h = container.clientHeight;
  const pos = container.scrollTop;
  const i = Math.round(pos / h);
  if (i !== index){
    // 이전은 일시정지
    safePause(index);
    index = clamp(i, 0, items.length-1);
    localStorage.setItem(LAST_POS_KEY, String(index));
    // 근접 프리페치
    if (index >= items.length - 6) loadMore();
    // 현재 자동재생
    autoAttachAndPlay(index);
    updateStatus();
  }
}, {passive:true});

// ====== 초기 로드 ======
(async function init(){
  // 네트워크 힌트
  setStatus('목록 불러오는 중…');

  if (personal) await loadPersonal();
  else await loadMore();

  // 가시성 변경 시 일시정지/재개
  document.addEventListener('visibilitychange', ()=>{
    if (document.hidden) safePause(index);
  });
})();

// ====== 정리 ======
window.addEventListener('beforeunload', ()=>{
  destroyed = true;
  try{ observers?.disconnect(); }catch{}
  players.forEach(p=> { try{ p.destroy?.(); }catch{} });
});
