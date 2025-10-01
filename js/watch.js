// /js/watch.js — ArkTube Watch (queue from selectedCats or personal, series resume, v1.5 dropdown, Hybrid swipe + prev/next, YT iframe API)
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_GROUPS, CATEGORY_MODEL } from './categories.js';
import {
  getFirestore, collection, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const db = getFirestore();

// ====== DOM ======
const btnDropdown = document.getElementById('btnDropdown');
const dropdown    = document.getElementById('dropdownMenu');
const btnGoUpload = document.getElementById('btnGoUpload');
const btnList     = document.getElementById('btnList');
const btnOrder    = document.getElementById('btnOrder');
const btnMyUploads= document.getElementById('btnMyUploads');
const btnAbout    = document.getElementById('btnAbout');
const btnSignOut  = document.getElementById('btnSignOut');
const titleEl     = document.getElementById('title');
const msgEl       = document.getElementById('msg');
const posEl       = document.getElementById('pos');
const totalEl     = document.getElementById('total');
const typeMarkEl  = document.getElementById('typeMark');
const badgeModeEl = document.getElementById('badgeMode');
const cbAutoNext  = document.getElementById('cbAutoNext');
const btnPrev     = document.getElementById('btnPrev');
const btnNext     = document.getElementById('btnNext');
const btnFull     = document.getElementById('btnFull');
const playerBox   = document.getElementById('playerBox');
const playerMount = document.getElementById('playerMount');

function setMsg(html){ if(msgEl) msgEl.innerHTML = html || ''; }

// ====== Dropdown (v1.5 규격) ======
(function initDropdown(){
  let open=false, offPtr=null, offKey=null;
  function setOpen(v){
    open=!!v;
    btnDropdown?.setAttribute('aria-expanded', String(open));
    dropdown?.setAttribute('aria-hidden', String(!open));
    if(open){
      dropdown?.classList.remove('hidden');
      requestAnimationFrame(()=> dropdown?.classList.add('open'));
      bindDoc();
    }else{
      dropdown?.classList.remove('open');
      setTimeout(()=> dropdown?.classList.add('hidden'),150);
      unbindDoc();
    }
  }
  function bindDoc(){
    if(offPtr||offKey) return;
    const onPtr = (e)=>{
      const t=e.target;
      if (t.closest('#dropdownMenu') || t.closest('#btnDropdown')) return;
      setOpen(false);
    };
    const onKey = (e)=>{
      if(e.key==='Escape') setOpen(false);
      if(e.key==='Tab' && open){
        const nodes = dropdown.querySelectorAll('a,button,[tabindex]:not([tabindex="-1"])');
        if(!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length-1];
        if(e.shiftKey && document.activeElement===first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement===last){ e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('pointerdown', onPtr, {passive:true});
    document.addEventListener('keydown', onKey);
    offPtr = ()=> document.removeEventListener('pointerdown', onPtr, {passive:true});
    offKey = ()=> document.removeEventListener('keydown', onKey);
  }
  function unbindDoc(){ if(offPtr){offPtr();offPtr=null;} if(offKey){offKey();offKey=null;} }
  btnDropdown?.addEventListener('click', (e)=>{ e.preventDefault(); setOpen(!open); });
  dropdown?.addEventListener('click', (e)=>{ if (e.target.closest('a,button,[role="menuitem"]')) setOpen(false); });
})();

// 상단바 이동
btnGoUpload?.addEventListener('click', ()=> location.href='/upload.html');
btnList     ?.addEventListener('click', ()=> location.href='/list.html');
btnOrder    ?.addEventListener('click', ()=> location.href='/category-order.html');
btnMyUploads?.addEventListener('click', ()=> location.href= auth.currentUser ? '/manage-uploads.html' : '/signin.html');
btnAbout    ?.addEventListener('click', ()=> location.href='/about.html');
btnSignOut  ?.addEventListener('click', async ()=>{ try{ await fbSignOut(); }catch{} location.reload(); });

// ====== 로컬 키 ======
const SELECTED_CATS_KEY = 'selectedCats';       // 'ALL' | string[]
const VIEW_TYPE_KEY     = 'arktube:view:type';  // 'all' | 'shorts' | 'video'
const AUTONEXT_KEY      = 'autonext';           // '1'|'0'
const RESUME_SERIES_KEY = 'resumeSeriesKey';    // sessionStorage
const RESUME_IDX_PREFIX = 'resume:index:';      // + seriesKey
const PLAYTIME_PREFIX   = 'playtime:';          // + ytid

// ====== 파서 ======
function getQueryParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}
function isPersonalVal(v){ return v && String(v).startsWith('personal'); }
function isSeriesGroupKey(k){ return typeof k==='string' && k.startsWith('series_'); }

// ====== 모델 도우미 ======
function buildCategoryIndex(){
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const out = { seriesChildren: new Set(), personalChildren: new Set() };
  groups.forEach(g=>{
    const isSeries = g?.isSeries===true || isSeriesGroupKey(g?.key||'');
    const isPersonal = g?.personal===true || (g?.key==='personal');
    (g.children||[]).forEach(c=>{
      if(isSeries) out.seriesChildren.add(c.value);
      if(isPersonal) out.personalChildren.add(c.value);
    });
  });
  return out;
}
const CATIDX = buildCategoryIndex();

// ====== 상태 ======
let queue = [];      // [{ytid,title,url,type,createdAt, cats, youtubePublishedAt}]
let index = 0;       // 현재 재생 위치
let ytPlayer = null; // YT.Player
let currentSeriesKey = null;

// ====== 형식/연속재생 복원 ======
(function restoreToggles(){
  const vv = (localStorage.getItem(AUTONEXT_KEY) || '').toLowerCase();
  if (cbAutoNext) cbAutoNext.checked = (vv==='1' || vv==='true' || vv==='on');
  typeMarkEl.textContent = localStorage.getItem(VIEW_TYPE_KEY) || 'all';
})();
cbAutoNext?.addEventListener('change', ()=>{
  localStorage.setItem(AUTONEXT_KEY, cbAutoNext.checked ? '1' : '0');
});

// ====== 큐 만들기 ======
async function buildQueue(){
  // 1) 개인자료 모드?
  const personalCat = getQueryParam('cats'); // e.g., personal1
  const resumeKey   = sessionStorage.getItem(RESUME_SERIES_KEY); // "series_key:sub"
  const viewType    = (localStorage.getItem(VIEW_TYPE_KEY) || 'all');

  if (personalCat && isPersonalVal(personalCat)) {
    // 개인자료 큐(로컬)
    badgeModeEl.hidden = false; badgeModeEl.textContent = '개인자료';
    const key = `personal_${personalCat}`;
    let arr=[]; try{ arr = JSON.parse(localStorage.getItem(key)||'[]'); }catch{}
    queue = arr.map((x,i)=>({
      ytid: null,
      url: x.url,
      type: 'video',
      title: x.title || `개인자료 ${i+1}`,
      createdAt: 0,
      cats: [personalCat]
    }));
    if (!queue.length) setMsg('개인자료가 비어있습니다.');
    index = 0;
    return;
  }

  // 2) 시리즈 이어보기?
  if (resumeKey) {
    currentSeriesKey = resumeKey; // "series_groupKey:subKey"
    badgeModeEl.hidden = false; badgeModeEl.textContent = '시리즈 이어보기';

    const [, subKey] = resumeKey.split(':'); // groupKey:subKey → subKey만 사용(=child value)
    // Firestore: 해당 child만 포함하는 영상
    queue = await loadFromServer([subKey], /*seriesMode*/true, viewType);
    if (!queue.length){ setMsg('시리즈 큐가 비었습니다.'); return; }

    // 저장된 위치 복원
    const saved = parseInt(localStorage.getItem(RESUME_IDX_PREFIX + resumeKey) || '0', 10);
    index = (Number.isFinite(saved) && saved>=0 && saved<queue.length) ? saved : 0;
    return;
  }

  // 3) 일반 모드
  let catsSaved = null;
  try { catsSaved = JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{}
  let cats = [];
  if (!catsSaved || catsSaved === 'ALL') {
    // ALL: 개인/시리즈 제외 후 전체로 간주 → 서버에서 넉넉히 가져와 클라정렬
    cats = collectAllNormalChildren();
  } else {
    cats = (Array.isArray(catsSaved) ? catsSaved : []).filter(Boolean);
  }
  queue = await loadFromServer(cats, /*seriesMode*/false, viewType);
  if (!queue.length) setMsg('선택된 조건에서 동영상이 없습니다.');
  index = 0;
}

// ALL일 때: 개인/시리즈 제외 모든 child value 목록
function collectAllNormalChildren(){
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const out = [];
  groups.forEach(g=>{
    const isSeries = g?.isSeries===true || isSeriesGroupKey(g?.key||'');
    const isPersonal = g?.personal===true || (g?.key==='personal');
    if (isSeries || isPersonal) return;
    (g.children||[]).forEach(c=> out.push(c.value));
  });
  // array-contains-any 는 최대 30개 제한이 있어, 실제 운영에서 그룹 나눠 호출 필요할 수 있음.
  // 여기서는 카테고리 수가 제한적이라고 가정.
  return out.slice(0,30);
}

async function loadFromServer(childVals, seriesMode, viewType){
  // viewType 필터: 'all' | 'shorts' | 'video'
  const wantType = (viewType==='all') ? null : viewType;

  // array-contains-any 를 사용 (최대 30개). orderBy 미사용 → 클라정렬
  const col = collection(db, 'videos');
  let docs = [];
  try{
    if (childVals && childVals.length){
      const q = query(col, where('cats','array-contains-any', childVals));
      const snap = await getDocs(q);
      snap.forEach(d=> docs.push({ id:d.id, ...d.data() }));
    } else {
      // ALL 이면서 cate 리스트를 못만드는 경우(이론상 없음) 대비: 전체 긁기는 비추천이라 빈 배열 반환
      docs = [];
    }
  }catch(e){
    console.warn('[watch] loadFromServer error', e);
    docs = [];
  }

  // 타입 필터
  if (wantType) docs = docs.filter(x=> (x?.type===wantType));

  // 정렬: 시리즈는 asc, 일반은 desc
  docs.sort((a,b)=>{
    const ta = a?.createdAt?.toMillis?.() ? a.createdAt.toMillis() : 0;
    const tb = b?.createdAt?.toMillis?.() ? b.createdAt.toMillis() : 0;
    return seriesMode ? (ta - tb) : (tb - ta);
  });

  // 変換
  return docs.map(x=>({
    ytid: x.ytid || x.id,
    url: x.url,
    title: x.title || x.ytid || '',
    type: x.type || 'video',
    createdAt: x.createdAt?.toMillis?.() ? x.createdAt.toMillis() : 0,
    cats: Array.isArray(x.cats) ? x.cats : [],
    youtubePublishedAt: x.youtubePublishedAt || null
  }));
}

// ====== 플레이어 ======
let ytReady = false;
window.onYouTubeIframeAPIReady = function(){ ytReady = true; tryMountPlayer(); };

function currentItem(){ return queue[index] || null; }

function tryMountPlayer(){
  const item = currentItem();
  if (!item){ setMsg('재생할 항목이 없습니다.'); return; }

  // 개인자료: url 전체를 embed로 넣을 수 없으므로 YouTube만 대상 (개인자료는 YouTube URL 기준 가정)
  const vid = item.ytid || parseYtId(item.url);
  if (!vid){ setMsg('이 항목은 지원되지 않는 URL입니다.'); return; }

  titleEl.textContent = item.title || '(제목없음)';
  posEl.textContent   = String(index+1);
  totalEl.textContent = String(queue.length);

  const srcOpts = [
    `autoplay=1`,
    `playsinline=1`,
    `enablejsapi=1`,
    `rel=0`,
    `modestbranding=1`,
  ].join('&');

  playerMount.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.id = 'ytplayer';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(vid)}?${srcOpts}`;
  playerMount.appendChild(iframe);

  if (!ytReady) return; // API 아직 준비 전이면 onYouTubeIframeAPIReady 이후에 초기화

  // YT.Player
  setMsg('');
  const p = new YT.Player('ytplayer', {
    events: {
      onReady: (e)=>{
        ytPlayer = e.target;
        // playtime 복원(10초 이내면 복원)
        const key = PLAYTIME_PREFIX + vid;
        const sec = parseFloat(localStorage.getItem(key) || '0');
        if (Number.isFinite(sec) && sec > 0 && sec < 10){
          try{ ytPlayer.seekTo(sec, true); }catch{}
        }
        // 5초 간격 저장
        try{
          setInterval(()=>{
            try {
              const t = ytPlayer.getCurrentTime();
              if (Number.isFinite(t)) localStorage.setItem(key, String(Math.floor(t)));
            }catch{}
          }, 5000);
        }catch{}
      },
      onStateChange: (e)=>{
        // Ended → AutoNext
        // 0:ENDED, 1:PLAYING, 2:PAUSED, 3:BUFFERING, 5:CUE
        if (e.data === YT.PlayerState.ENDED){
          if (cbAutoNext?.checked){
            goNext();
          }
        }
      }
    }
  });

  // 시리즈 진행도 저장
  if (currentSeriesKey){
    localStorage.setItem(RESUME_IDX_PREFIX + currentSeriesKey, String(index));
  }
}

// 간단한 YT ID 파서
function parseYtId(u=''){
  try{
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.replace('/','').trim();
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const m = url.pathname.match(/\/embed\/([A-Za-z0-9_-]{6,})/);
    if (m) return m[1];
  }catch{}
  return null;
}

// ====== 이동 ======
function goPrev(){
  if (index>0){ index--; tryMountPlayer(); }
}
function goNext(){
  if (index<queue.length-1){ index++; tryMountPlayer(); }
}
btnPrev?.addEventListener('click', goPrev);
btnNext?.addEventListener('click', goNext);

// ====== 전체화면 ======
btnFull?.addEventListener('click', ()=>{
  const el = playerBox;
  const fs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (fs) fs.call(el);
});

// ====== 스와이프 (하이브리드: 좌=다음, 우=이전, 가장 왼쪽 10% → Index) ======
(function initSwipeHybrid({
  edgeBackRatio=0.10,
  deadZoneCenterRatio=0.18,
  intentDx=12, cancelDy=10, maxDy=90, maxMs=700, minDx=70, minVx=0.6
} = {}) {
  let sx=0, sy=0, t0=0, tracking=false, horizontalIntent=false, pointerId=null;

  function isInteractive(el){
    return !!el.closest('button,a,[role="button"],input,select,textarea,label,#dropdownMenu');
  }
  function inDeadZone(x){
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const dz = Math.max(0, Math.min(0.9, deadZoneCenterRatio));
    const L  = vw * (0.5 - dz/2);
    const R  = vw * (0.5 + dz/2);
    return x>=L && x<=R;
  }
  function isEdgeLeft(x){
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    return x <= vw*edgeBackRatio;
  }

  function start(x,y,target){
    if (isInteractive(target)) return false;
    if (inDeadZone(x)) return false;
    sx=x; sy=y; t0=performance.now(); tracking=true; horizontalIntent=false; return true;
  }
  function move(x,y){
    if (!tracking) return false;
    const dx=x-sx, dy=y-sy;
    if (!horizontalIntent){
      if (Math.abs(dy)>cancelDy){ tracking=false; return false; }
      if (Math.abs(dx)>=intentDx) horizontalIntent=true;
    } else {
      if (Math.abs(dy)>maxDy){ tracking=false; return false; }
    }
    return true;
  }
  function end(x,y){
    if (!tracking) return;
    tracking=false;
    const dx=x-sx, dy=y-sy, dt=performance.now()-t0;
    if (!horizontalIntent || Math.abs(dy)>maxDy || dt>maxMs) return;
    const vx = Math.abs(dx)/Math.max(1,dt);
    const passDistance = Math.abs(dx)>=minDx;
    const passVelocity = vx>=minVx;
    if (!(passDistance || passVelocity)) return;

    // 방향: 음수=왼쪽으로 이동(→ 다음), 양수=오른쪽(→ 이전)
    if (dx <= -minDx || (dx<0 && passVelocity)) {
      document.documentElement.classList.add('slide-out-left');
      setTimeout(()=>{ goNext(); document.documentElement.classList.remove('slide-out-left'); }, 220);
    } else if (dx >= minDx || (dx>0 && passVelocity)) {
      // 왼쪽 edge에서 시작했으면 index.html로
      if (isEdgeLeft(sx)){
        document.documentElement.classList.add('slide-out-right');
        setTimeout(()=> location.href='/index.html', 220);
        return;
      }
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=>{ goPrev(); document.documentElement.classList.remove('slide-out-right'); }, 220);
    }
  }

  // Pointer 우선
  if (window.PointerEvent){
    document.addEventListener('pointerdown', (e)=>{
      if (e.pointerType==='mouse' && e.button!==0) return;
      pointerId=e.pointerId ?? 'p';
      start(e.clientX, e.clientY, e.target);
    }, {passive:true});
    document.addEventListener('pointermove', (e)=>{
      if (pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return;
      move(e.clientX, e.clientY);
    }, {passive:true});
    document.addEventListener('pointerup', (e)=>{
      if (pointerId!=null && e.pointerId!=null && e.pointerId!==pointerId) return;
      end(e.clientX, e.clientY); pointerId=null;
    }, {passive:true});
    document.addEventListener('pointercancel', ()=>{ tracking=false; pointerId=null; }, {passive:true});
  } else {
    // Touch fallback
    document.addEventListener('touchstart', (e)=>{
      const t=e.touches?.[0]; if(!t) return;
      start(t.clientX, t.clientY, e.target);
    }, {passive:true});
    document.addEventListener('touchmove', (e)=>{
      const t=e.touches?.[0]; if(!t) return;
      move(t.clientX, t.clientY);
    }, {passive:true});
    document.addEventListener('touchend', (e)=>{
      const t=e.changedTouches?.[0]; if(!t) return;
      end(t.clientX, t.clientY);
    }, {passive:true});
  }
})();

// ====== 초기화 ======
(async function init(){
  try{
    await buildQueue();
    totalEl.textContent = String(queue.length);
    tryMountPlayer();
  }catch(e){
    console.warn('[watch] init error', e);
    setMsg('초기화 중 오류가 발생했습니다.');
  }
})();
