// /js/upload.js — ArkTube Upload (CopyTube v1.5 톤, Ark 규칙 통합)
// - Firestore 문서 ID = YouTube videoId (setDoc)
// - 규칙 필드: uid, url, cats(<=3), (ytid==id) 충족
// - 추가 필드: type('shorts'|'video'), ownerName, createdAt, (youtubePublishedAt)
// - 개인자료(personal1..personal4) 선택 시 로컬 저장(로그인 불필요)
// - 카테고리: CATEGORY_MODEL or CATEGORY_GROUPS 둘 다 지원
// - 상/하단 등록 버튼 동기화, 진행 중 disabled 동기화
// - urlfind 모달(ArkTube 방식) 유지

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ---------------- Topbar / Dropdown ---------------- */
const $ = (s)=>document.querySelector(s);

const signupLink  = $('#signupLink');
const signinLink  = $('#signinLink');
const welcome     = $('#welcome');
const menuBtn     = $('#menuBtn');
const dropdown    = $('#dropdownMenu');

const btnAbout     = $('#btnAbout');
const btnCatOrder  = $('#btnCatOrder');
const btnMyUploads = $('#btnMyUploads');
const btnSignOut   = $('#btnSignOut');
const btnList      = $('#btnList');
const btnUrlFind   = $('#btnUrlFind');

function openDropdown(){ if(!dropdown) return; dropdown.classList.remove('hidden'); requestAnimationFrame(()=> dropdown.classList.add('show')); }
function closeDropdown(){ if(!dropdown) return; dropdown.classList.remove('show'); setTimeout(()=> dropdown.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user) => {
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) welcome.textContent = loggedIn ? `Welcome! ${user?.displayName || '회원'}` : '';
  closeDropdown();
});

menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown', (e)=>{ if(!dropdown || dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

btnAbout    ?.addEventListener('click', ()=>{ location.href = '/about.html'; closeDropdown(); });
btnCatOrder ?.addEventListener('click', ()=>{ location.href = '/category-order.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ auth.currentUser ? (location.href='/manage-uploads.html') : (location.href='/signin.html'); closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{ if(!auth.currentUser){ location.href='/signin.html'; return; } try{ await fbSignOut(auth); } finally{ closeDropdown(); } });
btnList     ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });

/* ---------------- urlfind 모달 ---------------- */
const urlfindModal = $('#urlfindModal');
const urlfindBody  = $('#urlfindBody');
const urlfindClose = $('#urlfindClose');

function openUrlFindModal(){
  if(!urlfindModal){ location.href='/urlfind.html'; return; }
  urlfindModal.classList.add('show');
  urlfindModal.setAttribute('aria-hidden','false');
  try{
    if(window.UrlFind && typeof window.UrlFind.mount === 'function'){
      window.UrlFind.mount(urlfindBody);
    }
  }catch(e){}
}
function closeUrlFindModal(){
  if(!urlfindModal) return;
  urlfindModal.classList.remove('show');
  urlfindModal.setAttribute('aria-hidden','true');
  try{
    if(window.UrlFind && typeof window.UrlFind.unmount === 'function'){
      window.UrlFind.unmount(urlfindBody);
    }
  }catch(e){}
}
btnUrlFind?.addEventListener('click', ()=>{ openUrlFindModal(); closeDropdown(); });
urlfindClose?.addEventListener('click', closeUrlFindModal);
urlfindModal?.addEventListener('pointerdown', (e)=>{ if(e.target === urlfindModal) closeUrlFindModal(); }, true);

/* ---------------- DOM ---------------- */
const $urls         = $('#urls');
const $btnPaste     = $('#btnPaste');
const $btnSubmitTop = $('#btnSubmitTop');
const $btnSubmit    = $('#btnSubmit');
const $msg          = $('#msg');
const $catHost      = $('#catHost');

const setStatus = (html)=>{ if($msg) $msg.innerHTML = html || ''; };
const esc = (s='')=> String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* ---------------- 카테고리 렌더 & 선택 로직 ---------------- */
const personalVals = ['personal1','personal2','personal3','personal4'];

function buildCategoryIndex(){
  const idx = {
    groups: [],
    labelOf: (v)=>v,
    isSeriesVal: (v)=>false,
    isPersonalVal: (v)=> false
  };
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const labelMap = {};
  const seriesSet = new Set();
  const personalSet = new Set();

  groups.forEach(g=>{
    const isSeries = (g?.isSeries===true) || String(g?.key||'').startsWith('series_');
    const isPersonal = !!g?.personal || String(g?.key||'')==='personal';
    const children = (g?.children||[]).map(c=>({ value:c.value, label:c.label }));
    children.forEach(c=>{
      labelMap[c.value] = c.label || c.value;
      if(isSeries)   seriesSet.add(c.value);
      if(isPersonal) personalSet.add(c.value);
    });
    idx.groups.push({ key:g.key, label:g.label, isSeries, isPersonal, children });
  });

  idx.labelOf = (v)=> labelMap[v] || v;
  idx.isSeriesVal   = (v)=> seriesSet.has(v);
  idx.isPersonalVal = (v)=> personalSet.has(v);
  return idx;
}
const CATIDX = buildCategoryIndex();

function readPersonalLabel(slot){
  try{
    const labels = JSON.parse(localStorage.getItem('personalLabels') || '{}');
    if(labels && labels[slot]) return labels[slot];
  }catch{}
  const m = String(slot||'').match(/^personal(\d)$/);
  return m ? `자료${m[1]}` : (slot || '개인자료');
}
function writePersonalLabel(slot, label){
  try{
    const labels = JSON.parse(localStorage.getItem('personalLabels') || '{}');
    labels[slot] = String(label||'').slice(0,30).replace(/[<>"]/g,'');
    localStorage.setItem('personalLabels', JSON.stringify(labels));
  }catch{}
}

function renderCategories(){
  if(!$catHost) return;
  $catHost.innerHTML = ''; // 초기화
  CATIDX.groups.forEach(g=>{
    const field = document.createElement('fieldset');
    field.className='group';

    const legend = document.createElement('legend');
    legend.textContent = g.label || g.key || '';
    field.appendChild(legend);

    const note = document.createElement('div');
    note.className='subnote';
    note.textContent = g.isPersonal ? '개인자료 (로컬 저장)' : (g.isSeries ? '시리즈' : '일반');
    field.appendChild(note);

    const grid = document.createElement('div');
    grid.className='child-grid';

    g.children.forEach((c)=>{
      const id = `cat_${g.key}_${c.value}`;
      const wrap = document.createElement('label');
      wrap.setAttribute('for', id);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.value = c.value;

      const span = document.createElement('span');
      span.className = 'txt';
      span.textContent = g.isPersonal ? readPersonalLabel(c.value) : (c.label || c.value);

      wrap.appendChild(input);
      wrap.appendChild(span);

      if(g.isPersonal){
        const rename = document.createElement('button');
        rename.type='button';
        rename.className='rename-inline';
        rename.textContent='이름변경';
        rename.addEventListener('click', ()=>{
          const now = readPersonalLabel(c.value);
          const nv = prompt('개인자료 이름', now);
          if(nv && nv.trim()){
            writePersonalLabel(c.value, nv.trim());
            span.textContent = nv.trim();
          }
        });
        wrap.appendChild(rename);
      }

      grid.appendChild(wrap);
    });

    field.appendChild(grid);
    $catHost.appendChild(field);
  });

  // 제한: 최대 3개, 개인자료 혼합 금지
  $catHost.addEventListener('change', ()=>{
    const chosen = getChosenCats();
    if(chosen.length > 3){
      // 마지막 체크를 되돌림
      const last = $catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
      alert('카테고리는 최대 3개까지 선택할 수 있습니다.');
      return;
    }
    const hasPersonal = chosen.some(v=> CATIDX.isPersonalVal(v));
    const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));
    if(hasPersonal && hasServer){
      alert('개인자료와 일반/시리즈 카테고리를 함께 선택할 수 없습니다.');
      const last = $catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
    }
  }, { passive:true });
}
function getChosenCats(){
  const boxes = $catHost?.querySelectorAll('input[type="checkbox"]:checked');
  return boxes ? [...boxes].map(b=> b.value) : [];
}

/* ---------------- 유틸 ---------------- */
function getOrder(){
  const el = document.querySelector('input[name="order"]:checked');
  return el ? el.value : 'top';
}

/* ---------------- YouTube PublishedAt (옵션) ---------------- */
async function fetchPublishedAt(videoId){
  const API_KEY = (typeof window !== 'undefined' ? window.YT_DATA_API_KEY : null);
  if(!API_KEY) return null;

  try{
    const url =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet&id=${encodeURIComponent(videoId)}` +
      `&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0];
    const pub  = item?.snippet?.publishedAt || null;
    return pub || null;
  }catch{ return null; }
}

/* ---------------- 붙여넣기 ---------------- */
$('#btnPaste')?.addEventListener('click', async ()=>{
  try{
    const t = await navigator.clipboard.readText();
    if(!$urls) return;
    if(!t){ setStatus('클립보드가 비어있습니다.'); return; }
    $urls.value = ($urls.value.trim()? ($urls.value.replace(/\s*$/,'')+'\n') : '') + t.trim();
    setStatus('붙여넣기 완료.');
  }catch{
    alert('클립보드에서 읽어오지 못했습니다. 브라우저 권한을 확인해주세요.');
  }
});

/* ---------------- 업로드 실행 ---------------- */
async function handleSubmit(){
  const raw = ($urls?.value || '').trim();
  if(!raw){ setStatus('<span class="danger">URL을 입력해주세요.</span>'); return; }

  const cats = getChosenCats();
  if(!cats.length){ setStatus('<span class="danger">카테고리를 선택해주세요.</span>'); return; }
  if(cats.length > 3){ setStatus('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>'); return; }

  const hasPersonal = cats.some(v=> CATIDX.isPersonalVal(v));
  const hasServer   = cats.some(v=> !CATIDX.isPersonalVal(v));
  if(hasPersonal && hasServer){
    setStatus('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>'); return;
  }
  if(hasPersonal && cats.length !== 1){
    setStatus('<span class="danger">개인자료 저장은 하나의 슬롯만 선택할 수 있습니다.</span>'); return;
  }

  // URL 분해 + 정렬
  let lines = raw.split(/\r?\n/).map(s=> s.trim()).filter(Boolean);
  if(!lines.length){ setStatus('<span class="danger">유효한 URL이 없습니다.</span>'); return; }
  const order = getOrder();
  if(order === 'bottom') lines = lines.reverse();

  const entries = [];
  for(const line of lines){
    if(!isAllowedYouTube(line)){
      entries.push({ url: line, ok:false, reason:'유튜브 URL 아님' });
      continue;
    }
    const info = parseYouTube(line); // { id, url, type }
    if(!info?.id){
      entries.push({ url: line, ok:false, reason:'ID 파싱 실패' });
      continue;
    }
    entries.push({
      url: info.url || line,
      id: info.id,
      type: info.type === 'shorts' ? 'shorts' : 'video',
      ok: true
    });
  }

  // 버튼 lock
  const lock = (v)=>{ $btnSubmitTop&&( $btnSubmitTop.disabled=v ); $btnSubmit&&( $btnSubmit.disabled=v ); };
  lock(true);

  try{
    // 개인자료 모드 (로컬)
    if(hasPersonal){
      const slot = cats[0]; // 한 슬롯만 허용
      const good = entries.filter(e=> e.ok).map(e=> ({
        url: e.url,
        title: '' // ArkTube 규칙: 제목 필드 사용 안 함
      }));
      if(!good.length){
        setStatus('<span class="danger">저장할 유효한 URL이 없습니다.</span>');
        return;
      }
      const key = `personal_${slot}`;
      let arr = [];
      try{ arr = JSON.parse(localStorage.getItem(key) || '[]'); }catch{ arr=[]; }
      const now = Date.now();
      good.forEach(en=> arr.push({ url: en.url, title: '', savedAt: now }));
      try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{}
      setStatus(`<span class="ok">개인자료(${esc(readPersonalLabel(slot))})에 ${good.length}건 저장 완료</span>`);
      $urls.value = '';
      $catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(c=> c.checked=false);
      return;
    }

    // 서버 모드 (일반/시리즈) — 로그인 필요
    const user = auth.currentUser;
    if(!user){ setStatus('<span class="danger">로그인이 필요합니다.</span>'); return; }

    // 진행
    let okCount=0, dupCount=0, badCount=0, failCount=0;
    for(const e of entries){
      if(!e.ok){ badCount++; continue; }

      const ref = doc(db, 'videos', e.id);
      try{
        const exists = await getDoc(ref);
        if(exists.exists()){
          const data = exists.data() || {};
          const existedCats = Array.isArray(data.cats) ? data.cats : [];
          const labels = existedCats.map(v=> esc(CATIDX.labelOf(v))).join(', ');
          dupCount++;
          setStatus(`이미 등록됨: <b>${esc(e.id)}</b> (카테고리: ${labels || '없음'})`);
          continue;
        }

        // optional publishedAt (키 있으면 조회)
        const publishedAt = await fetchPublishedAt(e.id);

        // 규칙 필수 필드 + 확장
        const payload = {
          uid: user.uid,                // 규칙: isSelf(data.uid)
          url: e.url,                   // 규칙: validUrl
          cats: cats.slice(),           // 규칙: validCats (최대 3)
          ytid: e.id,                   // 규칙: ytid == doc id
          type: e.type,                 // 'shorts'|'video'
          ownerName: user.displayName || '',
          createdAt: serverTimestamp(),
          ...(publishedAt ? { youtubePublishedAt: publishedAt } : {})
        };

        await setDoc(ref, payload, { merge:false });
        okCount++;
        setStatus(`<span class="ok">${okCount}건 등록 성공</span> · 중복 ${dupCount} · 오류 ${badCount+failCount}`);
      }catch(err){
        console.error('[upload] save fail:', err);
        failCount++;
        setStatus(`<span class="danger">일부 실패: 성공 ${okCount}, 중복 ${dupCount}, 실패 ${failCount}, 무시 ${badCount}</span>`);
      }
    }

    setStatus(`<span class="ok">완료</span> · 성공 ${okCount} · 중복 ${dupCount} · 실패 ${failCount} · 무시(비유튜브/파싱실패) ${badCount}`);
    if(okCount){ $urls.value=''; $catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(c=> c.checked=false); }
  }finally{
    lock(false);
  }
}

// 버튼 이벤트 (상/하 동일 로직 공유)
$btnSubmitTop?.addEventListener('click', handleSubmit);
$btnSubmit    ?.addEventListener('click', handleSubmit);

/* ---------------- 스와이프 네비 (데드존 18%) ---------------- */
(function initSwipe(){
  function initSimple({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    let sx=0, sy=0, t0=0, tracking=false;
    const THRESH_X=70, MAX_OFF_Y=80, MAX_TIME=600;
    const getPoint = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    function onStart(e){
      const p=getPoint(e); if(!p) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(p.clientX>=L && p.clientX<=R) return;
      sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
    }
    function onEnd(e){
      if(!tracking) return; tracking=false;
      const p=getPoint(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
      if(Math.abs(dy)>MAX_OFF_Y || dt>MAX_TIME) return;
      if(dx<=-THRESH_X && goLeftHref){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
    }
    document.addEventListener('touchstart', onStart, {passive:true});
    document.addEventListener('touchend',   onEnd,   {passive:true});
    document.addEventListener('pointerdown',onStart, {passive:true});
    document.addEventListener('pointerup',  onEnd,   {passive:true});
  }
  function initDrag({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,canceled=false;
    const TH=60, SLOP=45, TMAX=700;
    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
    function isInteractive(el){ return !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')); }
    function start(e){
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      if(isInteractive(e.target)) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(t.clientX>=L && t.clientX<=R) return;
      x0=t.clientX; y0=t.clientY; t0=Date.now(); active=true; canceled=false; page.style.transition='none';
    }
    function move(e){
      if(!active) return;
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0;
      if(Math.abs(dy)>SLOP){ canceled=true; active=false; reset(); return; }
      const dxAdj = (dx<0)?dx:0;
      if(dxAdj===0){ page.style.transform='translateX(0px)'; return; }
      e.preventDefault(); page.style.transform='translateX('+dxAdj+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(canceled || Math.abs(dy)>SLOP || dt>TMAX){ reset(); return; }
      if(dx<=-TH){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(-100vw)'; setTimeout(()=>{ location.href=goLeftHref; },150); }
      else reset();
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchmove', move ,{passive:false});
    document.addEventListener('touchend',  end  ,{passive:true,capture:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointermove', move ,{passive:false});
    document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
  }
  initSimple({ goLeftHref:'/index.html', deadZoneCenterRatio:0.18 });
  initDrag  ({ goLeftHref:'/index.html', deadZoneCenterRatio:0.18 });
})();

/* ---------------- 초기화 ---------------- */
(function init(){
  renderCategories();
})();
