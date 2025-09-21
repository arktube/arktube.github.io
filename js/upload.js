// /js/upload.js — ArkTube v0.1 Upload (규칙 정합/중복 방지/개인자료/모달 포함)
// - Firestore 문서 ID = YouTube videoId
// - 규칙 필드: uid, url, cats, (title<=200), (ytid==id) 충족
// - 추가 필드: type, ownerName, createdAt, (youtubePublishedAt)
// - 개인자료(personal*) 선택 시 로컬 저장(로그인 불필요)
// - 카테고리: CATEGORY_MODEL or CATEGORY_GROUPS 둘 다 지원
// - 스와이프 데드존 18%

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ---------------- Topbar / Dropdown ---------------- */
const signupLink  = document.getElementById('signupLink');
const signinLink  = document.getElementById('signinLink');
const welcome     = document.getElementById('welcome');
const menuBtn     = document.getElementById('menuBtn');
const dropdown    = document.getElementById('dropdownMenu');

const btnAbout     = document.getElementById('btnAbout');
const btnCatOrder  = document.getElementById('btnCatOrder');
const btnMyUploads = document.getElementById('btnMyUploads');
const btnSignOut   = document.getElementById('btnSignOut');
const btnList      = document.getElementById('btnList');
const btnUrlFind   = document.getElementById('btnUrlFind');

let isMenuOpen = false;
function openDropdown(){ if(!dropdown) return; isMenuOpen = true; dropdown.classList.remove('hidden'); requestAnimationFrame(()=> dropdown.classList.add('show')); }
function closeDropdown(){ if(!dropdown) return; isMenuOpen = false; dropdown.classList.remove('show'); setTimeout(()=> dropdown.classList.add('hidden'), 180); }

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
const urlfindModal = document.getElementById('urlfindModal');
const urlfindBody  = document.getElementById('urlfindBody');
const urlfindClose = document.getElementById('urlfindClose');

function openUrlFindModal(){
  if(!urlfindModal){ location.href='/urlfind.html'; return; }
  urlfindModal.classList.add('show');
  urlfindModal.setAttribute('aria-hidden','false');
  // urlfind.js가 전역 함수 제공 시 초기화 시도 (없으면 그냥 비어있는 시트)
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
const $urls   = document.getElementById('urls');
const $title  = document.getElementById('title');
const $btnPaste  = document.getElementById('btnPaste');
const $btnSubmit = document.getElementById('btnSubmit');
const $msg    = document.getElementById('msg');
const $catHost= document.getElementById('catHost');

function esc(s=''){
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[m]));
}
function setStatus(html){ if($msg) $msg.innerHTML = html || ''; }
function getOrder(){
  const el = document.querySelector('input[name="order"]:checked');
  return el ? el.value : 'top';
}

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
    labels[slot] = String(label||'').slice(0,30);
    localStorage.setItem('personalLabels', JSON.stringify(labels));
  }catch{}
}

function renderCategories(){
  if(!$catHost) return;
  $catHost.innerHTML = ''; // XSS-safe
  CATIDX.groups.forEach(g=>{
    // group sheet
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
      wrap.innerHTML = `
        <input type="checkbox" id="${esc(id)}" value="${esc(c.value)}">
        <span class="txt">${esc(g.isPersonal ? readPersonalLabel(c.value) : (c.label || c.value))}</span>
        ${g.isPersonal ? '<button type="button" class="rename-inline">이름변경</button>' : ''}
      `;
      grid.appendChild(wrap);

      if(g.isPersonal){
        wrap.querySelector('.rename-inline')?.addEventListener('click', ()=>{
          const now = readPersonalLabel(c.value);
          const nv = prompt('개인자료 이름', now);
          if(nv && nv.trim()){
            writePersonalLabel(c.value, nv.trim());
            wrap.querySelector('.txt').textContent = nv.trim();
          }
        });
      }
    });

    field.appendChild(grid);
    $catHost.appendChild(field);
  });

  // change handler: 최대 3개, 개인자료 혼합 금지
  $catHost.addEventListener('change', ()=>{
    const chosen = getChosenCats();
    // 제한 3
    if(chosen.length > 3){
      // 막 선택한 것 해제
      const last = $catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
      alert('카테고리는 최대 3개까지 선택할 수 있습니다.');
      return;
    }
    // 개인자료 혼합 금지
    const hasPersonal = chosen.some(v=> CATIDX.isPersonalVal(v));
    const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));
    if(hasPersonal && hasServer){
      alert('개인자료와 일반/시리즈 카테고리를 함께 선택할 수 없습니다.');
      // 방금 체크한 걸 되돌림
      const last = $catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
    }
  }, { passive:true });
}

function getChosenCats(){
  const boxes = $catHost?.querySelectorAll('input[type="checkbox"]:checked');
  return boxes ? [...boxes].map(b=> b.value) : [];
}

/* ---------------- 개인자료 로컬 저장 ---------------- */
function saveToPersonal(slot, entries){
  const key = `personal_${slot}`;
  let arr = [];
  try{ arr = JSON.parse(localStorage.getItem(key) || '[]'); }catch{ arr=[]; }
  const now = Date.now();
  entries.forEach(en=>{
    arr.push({
      url: en.url,
      title: en.title || '',
      savedAt: now
    });
  });
  try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{}
}

/* ---------------- YouTube PublishedAt (옵션) ---------------- */
// 표준 패턴: 이 전역만 사용
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

/* ---------------- 업로드 실행 ---------------- */
$btnPaste?.addEventListener('click', async ()=>{
  try{
    const t = await navigator.clipboard.readText();
    if(!$urls) return;
    $urls.value = t;
  }catch{
    alert('클립보드에서 읽어오지 못했습니다. 브라우저 권한을 확인해주세요.');
  }
});

$btnSubmit?.addEventListener('click', async ()=>{
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

  const titleCommonRaw = ($title?.value || '').trim();
  const titleCommon = titleCommonRaw ? titleCommonRaw.slice(0, 200) : ''; // 200자 컷

  const entries = [];

  // 1차 파싱/검증
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

  // 개인자료 모드 (로컬)
  if(hasPersonal){
    const slot = cats[0]; // 한 슬롯만 허용
    const good = entries.filter(e=> e.ok).map(e=> ({
      url: e.url,
      title: titleCommon || ''
    }));
    if(!good.length){
      setStatus('<span class="danger">저장할 유효한 URL이 없습니다.</span>');
      return;
    }
    saveToPersonal(slot, good);
    setStatus(`<span class="ok">개인자료(${esc(readPersonalLabel(slot))})에 ${good.length}건 저장 완료</span>`);
    return;
  }

  // 서버 모드 (일반/시리즈) — 로그인 필요
  const user = auth.currentUser;
  if(!user){ setStatus('<span class="danger">로그인이 필요합니다.</span>'); return; }

  // 진행
  let okCount=0, dupCount=0, badCount=0, failCount=0;
  $btnSubmit.disabled = true;

  for(const e of entries){
    if(!e.ok){ badCount++; continue; }

    const ref = doc(db, 'videos', e.id);
    try{
      const exists = await getDoc(ref);
      if(exists.exists()){
        // 이미 등록된 카테고리 안내
        const data = exists.data() || {};
        const existedCats = Array.isArray(data.cats) ? data.cats : [];
        const labels = existedCats.map(v=> esc(CATIDX.labelOf(v))).join(', ');
        dupCount++;
        setStatus(`이미 등록됨: <b>${esc(e.id)}</b> (카테고리: ${labels || '없음'})`);
        continue;
      }

      // optional publishedAt
      const publishedAt = await fetchPublishedAt(e.id);

      // 규칙 필수 필드
      const payload = {
        uid: user.uid,                // 규칙: isSelf(data.uid)
        url: e.url,                   // 규칙: validUrl
        cats: cats.slice(),           // 규칙: validCats (최대 3)
        // optional 규칙 필드
        ...(titleCommon ? { title: titleCommon } : {}),
        ytid: e.id,                   // 규칙: ytid == doc id
        // 추가 필드(규칙에 위배되지 않음)
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

  $btnSubmit.disabled = false;
  setStatus(`<span class="ok">완료</span> · 성공 ${okCount} · 중복 ${dupCount} · 실패 ${failCount} · 무시(비유튜브/파싱실패) ${badCount}`);
});

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
