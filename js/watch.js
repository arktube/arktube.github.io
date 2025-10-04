// /js/watch.js — ArkTube Watch (최종 정합본)
// - 상단바/드롭다운 v1.5
// - 개인자료: type 필터 미적용 + shorts/embed 링크 ID 추출 대응
// - 시리즈 이어보기: createdAt asc + index/t 자동 복원
// - 오버레이 없음, 수직 스와이프(위=다음/아래=이전), PC 화살표
// - autoplay 차단 환경 대비 onReady에서 mute 후 play
// - 저장키 통일: selectedCats, view:type, (autonext는 구키('autonext') 우선, 없으면 resume의 getAutoNext())
// - z-index/겹침 이슈 회피

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';
import { getAutoNext, loadResume, saveResume } from './resume.js';
import {
  collection, query, where, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ===================== 상단바 / 드롭다운 (v1.5) ===================== */
const signupLink   = document.getElementById('signupLink');
const signinLink   = document.getElementById('signinLink');
const nickWrap     = document.getElementById('nickWrap');
const nickNameEl   = document.getElementById('nickName');
const btnSignOut   = document.getElementById('btnSignOut');

const btnDropdown  = document.getElementById('btnDropdown');
const dropdown     = document.getElementById('dropdownMenu');

const btnAbout     = document.getElementById('btnAbout');
const btnOrder     = document.getElementById('btnOrder');
const btnList      = document.getElementById('btnList');
const btnGoUpload  = document.getElementById('btnGoUpload');
const btnMyUploads = document.getElementById('btnMyUploads');

// 공통 네비
btnAbout    ?.addEventListener('click', ()=> location.href='/about.html');
btnOrder    ?.addEventListener('click', ()=> location.href='/category-order.html');
btnList     ?.addEventListener('click', ()=> location.href='/list.html');
btnGoUpload ?.addEventListener('click', ()=> location.href='/upload.html');
btnMyUploads?.addEventListener('click', ()=> location.href= auth.currentUser ? '/manage-uploads.html' : '/signin.html');

btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  nickWrap ?.classList.toggle('hidden', !loggedIn);
  if (nickNameEl) nickNameEl.textContent = loggedIn ? (user?.displayName || 'User') : '';
});

// 드롭다운 v1.5
(function initDropdownV15(){
  const menu = dropdown, trigger = btnDropdown;
  let open = false, offPointer=null, offKey=null;

  function setOpen(v){
    open = !!v;
    if (!menu || !trigger) return;
    trigger.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    if (open){
      menu.classList.remove('hidden');
      requestAnimationFrame(()=> menu.classList.add('open'));
      const first = menu.querySelector('a,button,[tabindex]:not([tabindex="-1"])');
      first?.focus?.({preventScroll:true});
      bindDoc();
    }else{
      menu.classList.remove('open');
      setTimeout(()=> menu.classList.add('hidden'), 150);
      trigger.focus?.({preventScroll:true});
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
        const nodes = menu.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])');
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
  function unbindDoc(){ offPointer?.(); offKey?.(); offPointer=offKey=null; }

  trigger?.addEventListener('click', (e)=>{ e.preventDefault(); toggle(); });
  menu?.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });

  // 초기 aria 동기화
  if (menu && trigger){
    const initiallyHidden = menu.classList.contains('hidden');
    trigger.setAttribute('aria-expanded', String(!initiallyHidden));
    menu.setAttribute('aria-hidden', String(initiallyHidden));
  }
})();

/* ===================== 재생 컨텍스트/큐 ===================== */
const SELECTED_CATS_KEY = 'selectedCats'; // "ALL" | string[]
const VIEW_TYPE_KEY     = 'view:type';    // 'both' | 'shorts' | 'video'  ← 통일
const AUTONEXT_KEY_OLD  = 'autonext';     // 구키(인덱스에서 저장)
const RESUME_SERIES_SS  = 'resumeSeriesKey';

const SS_QUEUE_KEY      = 'playQueue';
const SS_INDEX_KEY      = 'playIndex';

let PLAY_QUEUE = []; // { id, url, title, type, cats[] }[]
let CUR = 0;
let PLAYER = null;
let AUTONEXT = false;

let resumeCtx = null; // { groupKey, subKey, typeForKey }

const sleep = (ms)=> new Promise(r=> setTimeout(r, ms));
const parseJSON = (s, fb=null)=>{ try{ return JSON.parse(s); }catch{ return fb; } };
const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));

function seriesCatSet() {
  const set = new Set();
  for (const g of CATEGORY_GROUPS || []) {
    const isSeries = g?.isSeries===true || String(g?.key||'').startsWith('series_');
    if (isSeries) for (const c of (g.children||[])) set.add(c.value);
  }
  return set;
}
const SERIES_CATS = seriesCatSet();

function getPersonalSlotFromQS(){
  const p = new URLSearchParams(location.search);
  const cats = p.get('cats') || '';
  return /^personal[1-4]$/.test(cats) ? cats : null;
}
function readAutoNext(){
  // 인덱스에서 세팅하는 구키('autonext') 우선, 없으면 resume 모듈의 키 사용
  const s = (localStorage.getItem(AUTONEXT_KEY_OLD)||'').toLowerCase();
  if (s==='1' || s==='true' || s==='on') return true;
  return !!getAutoNext();
}

function loadQueueFromSession(){
  const q = parseJSON(sessionStorage.getItem(SS_QUEUE_KEY), null);
  const i = Number(sessionStorage.getItem(SS_INDEX_KEY));
  if (Array.isArray(q) && q.length > 0) {
    PLAY_QUEUE = q;
    CUR = Number.isFinite(i) && i>=0 && i<q.length ? i : 0;
    return true;
  }
  return false;
}
function saveQueueToSession(){
  try {
    sessionStorage.setItem(SS_QUEUE_KEY, JSON.stringify(PLAY_QUEUE));
    sessionStorage.setItem(SS_INDEX_KEY, String(CUR));
  } catch {}
}

async function buildQueue(){
  const personalSlot = getPersonalSlotFromQS();
  const selType = (localStorage.getItem(VIEW_TYPE_KEY) || 'both'); // 통일: 기본 both
  AUTONEXT = readAutoNext();

  const resumeKey = sessionStorage.getItem(RESUME_SERIES_SS) || '';
  if (resumeKey) {
    const [groupKey, subKey] = resumeKey.split(':');
    resumeCtx = { groupKey, subKey, typeForKey: 'video' };
  }

  if (loadQueueFromSession()) return;

  if (personalSlot){
    // 개인자료: type 필터 미적용 + 다형 URL ID 파싱
    const storeKey = `personal_${personalSlot}`;
    const arr = parseJSON(localStorage.getItem(storeKey), []);

    const idOf = (u) => {
      try {
        const s = String(u);
        const m =
          s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||                // watch?v=ID
          s.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?:\?|&|$)/) || // youtu.be/ID
          s.match(/\/shorts\/([A-Za-z0-9_-]{11})(?:\?|&|$)/) ||  // shorts/ID
          s.match(/embed\/([A-Za-z0-9_-]{11})(?:\?|&|$)/);       // embed/ID
        return m ? m[1] : null;
      } catch { return null; }
    };

    PLAY_QUEUE = arr.map(x=>{
      const id = idOf(x.url);
      return id ? { id, url:x.url, title:x.title||'', type:'video', cats:[personalSlot] } : null;
    }).filter(Boolean);
    CUR = 0;
    saveQueueToSession();
    return;
  }

  // 서버 모드
  let sel = parseJSON(localStorage.getItem(SELECTED_CATS_KEY), 'ALL');
  let catFilter = null;
  if (Array.isArray(sel) && sel.length) catFilter = sel.slice(0,10);
  const typeFilter = (selType==='shorts' || selType==='video') ? selType : null;

  const col = collection(db, 'videos');
  let q;
  if (resumeCtx) {
    q = query(
      col,
      where('cats','array-contains', resumeCtx.subKey),
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','asc'),
      limit(200)
    );
  } else if (catFilter) {
    q = query(
      col,
      where('cats','array-contains-any', catFilter),
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','desc'),
      limit(200)
    );
  } else {
    q = query(
      col,
      ...(typeFilter ? [where('type','==',typeFilter)] : []),
      orderBy('createdAt','desc'),
      limit(200)
    );
  }

  const snap = await getDocs(q);
  const rows = [];
  snap.forEach(doc=>{
    const d = doc.data()||{};
    if (!catFilter && !resumeCtx) {
      const cats = Array.isArray(d.cats) ? d.cats : [];
      if (cats.some(c=> SERIES_CATS.has(c))) return; // ALL일 때 series 제외
    }
    rows.push({
      id: d.ytid, url: d.url, title: d.title||'', type: d.type||'video',
      cats: Array.isArray(d.cats) ? d.cats : []
    });
  });

  PLAY_QUEUE = rows;
  CUR = 0;

  if (resumeCtx) {
    const saved = loadResume({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
    if (saved && Number.isFinite(saved.index)) {
      CUR = clamp(saved.index, 0, Math.max(0, PLAY_QUEUE.length-1));
    }
  }
  saveQueueToSession();
}

/* ===================== YouTube Player ===================== */
function loadYTAPI(){
  return new Promise((resolve)=>{
    if (window.YT && YT.Player) return resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
    window.onYouTubeIframeAPIReady = ()=> resolve();
  });
}
const currentVideoId = ()=> (PLAY_QUEUE[CUR] && PLAY_QUEUE[CUR].id) || null;

function playAt(index, seekSeconds=null){
  CUR = clamp(index, 0, Math.max(0, PLAY_QUEUE.length-1));
  saveQueueToSession();
  const v = currentVideoId();
  if (!v) return;
  if (PLAYER) {
    PLAYER.loadVideoById(v);
    if (seekSeconds!=null) {
      const s = Math.max(0, Math.min(6*60*60, seekSeconds|0));
      if (s >= 3) setTimeout(()=> { try{ PLAYER.seekTo(s, true); }catch{} }, 400);
    }
  }
}
const next = ()=> { if (CUR < PLAY_QUEUE.length-1) playAt(CUR+1, 0); };
const prev = ()=> { if (CUR > 0)                 playAt(CUR-1, 0); };

async function initPlayer(){
  await loadYTAPI();
  const firstId = currentVideoId();
  PLAYER = new YT.Player('player', {
    width: '100%', height: '100%',
    videoId: firstId,
    playerVars: { autoplay:1, controls:1, rel:0, modestbranding:1, playsinline:1 },
    events: { onReady, onStateChange, onError }
  });

  function onReady(){
    try { PLAYER.mute(); } catch {}
    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      const t = Number(saved?.t||0);
      if (Number.isFinite(t) && t >= 3) {
        try { PLAYER.seekTo(t, true); } catch {}
      }
    }
    try { PLAYER.playVideo(); } catch {}
  }

  let ticker = 0;
  function onStateChange(e){
    const st = e?.data;
    if (st === 1) {
      if (resumeCtx) {
        clearInterval(ticker);
        ticker = setInterval(()=>{
          try{
            const t = Math.floor(PLAYER.getCurrentTime?.() || 0);
            saveResume({
              type:resumeCtx.typeForKey, groupKey:resumeCtx.groupKey, subKey:resumeCtx.subKey,
              sort:'createdAt-asc', index:CUR, t
            });
          }catch{}
        }, 5000);
      }
    } else if (st === 0) {
      if (resumeCtx) {
        try{
          saveResume({
            type:resumeCtx.typeForKey, groupKey:resumeCtx.groupKey, subKey:resumeCtx.subKey,
            sort:'createdAt-asc', index:Math.min(CUR+1, PLAY_QUEUE.length-1), t:0
          });
        }catch{}
      }
      if (AUTONEXT) next();
    } else {
      if (resumeCtx) clearInterval(ticker);
    }
  }
  function onError(err){
    console.warn('[watch] player error', err);
    next();
  }
}

/* ===================== 제스처 & 키보드 ===================== */
// 모바일: 수직 스와이프 (위=다음, 아래=이전) — CopyTube 합의 유지
// PC: 화살표 ←/→
(function initGestures({
  deadZoneCenterRatio = 0.18,
  intentDy = 14, cancelDx = 12, maxDx = 90, maxMs = 700, minDy = 70, minVy = 0.6
} = {}) {
  let sy=0, sx=0, t0=0, tracking=false, verticalIntent=false;
  let pointerId = null;

  const inDead = (x)=>{
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L = vw*(0.5-deadZoneCenterRatio/2), R = vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  };
  const isInteractive = (el)=> !!el.closest('button,a,input,textarea,select,label');

  function startCommon(x,y,target){
    if (isInteractive(target)) return false;
    if (inDead(x)) return false;
    sx=x; sy=y; t0=performance.now(); tracking=true; verticalIntent=false;
    return true;
  }
  function moveCommon(x,y){
    if (!tracking) return;
    const dx=x-sx, dy=y-sy;
    if (!verticalIntent){
      if (Math.abs(dx)>cancelDx){ tracking=false; return; }
      if (Math.abs(dy)>=intentDy) verticalIntent = true;
    } else {
      if (Math.abs(dx)>maxDx){ tracking=false; return; }
    }
  }
  function endCommon(x,y){
    if (!tracking) return;
    tracking=false;
    const dy = y-sy;
    const dt = performance.now()-t0;
    if (!verticalIntent) return;
    if (dt>maxMs) return;

    const vy = Math.abs(dy)/Math.max(1, dt);
    if (!((Math.abs(dy)>=minDy) || (vy>=minVy))) return;

    if (dy <= -minDy || (dy<0 && vy>=minVy)) {
      document.body.classList.remove('nudge-down');
      document.body.classList.add('nudge-up');
      setTimeout(()=> document.body.classList.remove('nudge-up'), 220);
      next();
    } else if (dy >= minDy || (dy>0 && vy>=minVy)) {
      document.body.classList.remove('nudge-up');
      document.body.classList.add('nudge-down');
      setTimeout(()=> document.body.classList.remove('nudge-down'), 220);
      prev();
    }
  }

  if (window.PointerEvent) {
    document.addEventListener('pointerdown', (e)=>{
      if (e.pointerType==='mouse' && e.button!==0) return;
      pointerId = e.pointerId ?? 'p';
      startCommon(e.clientX, e.clientY, e.target);
    }, { passive:true });
    document.addEventListener('pointermove', (e)=>{
      if (pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return;
      moveCommon(e.clientX, e.clientY);
    }, { passive:true });
    document.addEventListener('pointerup', (e)=>{
      if (pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return;
      endCommon(e.clientX, e.clientY);
      pointerId = null;
    }, { passive:true });
    document.addEventListener('pointercancel', ()=>{ /* cleanup */ }, { passive:true });
  } else {
    const pt = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    document.addEventListener('touchstart', (e)=>{ const p=pt(e); if(!p) return; startCommon(p.clientX,p.clientY,e.target); }, { passive:true });
    document.addEventListener('touchmove',  (e)=>{ const p=pt(e); if(!p) return; moveCommon(p.clientX,p.clientY); }, { passive:true });
    document.addEventListener('touchend',   (e)=>{ const p=pt(e); if(!p) return; endCommon(p.clientX,p.clientY); }, { passive:true });
  }

  document.addEventListener('keydown', (e)=>{
    if (e.key === 'ArrowLeft')  { e.preventDefault(); prev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  });
})();

/* ===================== 부트스트랩 ===================== */
(async function main(){
  try{
    await buildQueue();

    if (!PLAY_QUEUE.length) {
      const personalSlot = getPersonalSlotFromQS();
      if (personalSlot) {
        alert('개인자료가 비어있습니다. 먼저 업로드/저장을 해주세요.');
        location.href = '/index.html';
      } else {
        alert('조건에 맞는 동영상이 없습니다.');
        location.href = '/list.html';
      }
      return;
    }

    await initPlayer();

    if (resumeCtx) {
      const saved = loadResume({ type: resumeCtx.typeForKey, groupKey: resumeCtx.groupKey, subKey: resumeCtx.subKey });
      const t = Number(saved?.t||0);
      playAt(CUR, Number.isFinite(t) && t>=3 ? t : 0);
    } else {
      playAt(CUR, 0);
    }
  }catch(e){
    console.error('[watch] init error', e);
    alert('재생을 시작할 수 없습니다. 네트워크 상태를 확인해주세요.');
    location.href = '/index.html';
  }
})();
