// /js/upload.js — CopyTube v1.5 모양 + ArkTube 동작
// - Firestore 문서ID = YouTube videoId (setDoc)
// - 필수: uid,url,cats(<=3),ytid==doc id
// - 추가: type('shorts'|'video'), ownerName, createdAt, (youtubePublishedAt)
// - category 모델: CATEGORY_MODEL or CATEGORY_GROUPS 모두 허용
// - 개인자료 personal1..personal4 (로컬 저장), 라벨 이름변경 최대 12자
// - UrlFind 내장 모달 mount/unmount 지원
// - 상/하 등록·클립보드 버튼 및 상태메시지 동기화
// - 제약: 단일 change 이벤트에서 집계 → 3개 초과·혼합 시 마지막 체크 해제
// - series/개인자료 판정: prefix(series_) + g.isSeries===true / g.personal===true 모두 고려
// - Swipe: 단순 + 고급(끌림) 모두, dead zone 18%

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ----------------- DOM 헬퍼 ----------------- */
const $ = (s)=>document.querySelector(s);

/* ----------------- 상단바/드롭다운 ----------------- */
const signupLink  = $('#signupLink');
const signinLink  = $('#signinLink');
const welcome     = $('#welcome');
const menuBtn     = $('#menuBtn');
const dropdown    = $('#dropdownMenu');

const btnAbout     = $('#btnAbout');
const btnMyUploads = $('#btnMyUploads');
const btnSignOut   = $('#btnSignOut');
const btnGoUpload  = $('#btnGoUpload');
const btnList      = $('#btnList');
const btnUrlFind   = $('#btnUrlFind');
const btnCatOrder  = $('#btnCatOrder');

function openDropdown(){ dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  welcome && (welcome.textContent = loggedIn ? `Welcome! ${user?.displayName || '회원'}` : '');
  closeDropdown();
});
menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown', (e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

btnAbout   ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnGoUpload?.addEventListener('click', ()=>{ location.href='/upload.html'; closeDropdown(); });
btnList    ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });
btnCatOrder?.addEventListener('click', ()=>{ location.href='/category-order.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{
  if(!auth.currentUser){ location.href='/signin.html'; return; } // 비로그인 시 로그인 유도
  location.href='/manage-uploads.html';
  closeDropdown();
});
btnSignOut ?.addEventListener('click', async ()=>{
  if(!auth.currentUser){ location.href='/signin.html'; return; }
  try{ await fbSignOut(auth); } finally{ closeDropdown(); }
});

/* ----------------- UrlFind 모달 ----------------- */
const urlfindModal = $('#urlfindModal');
const urlfindBody  = $('#urlfindBody');
const urlfindClose = $('#urlfindClose');

function openUrlFindModal(){
  if(!urlfindModal){ location.href='/urlfind.html'; return; }
  urlfindModal.classList.add('show');
  urlfindModal.setAttribute('aria-hidden','false');
  try{ if(window.UrlFind && typeof window.UrlFind.mount==='function'){ window.UrlFind.mount(urlfindBody); } }catch{}
}
function closeUrlFindModal(){
  if(!urlfindModal) return;
  urlfindModal.classList.remove('show');
  urlfindModal.setAttribute('aria-hidden','true');
  try{ if(window.UrlFind && typeof window.UrlFind.unmount==='function'){ window.UrlFind.unmount(urlfindBody); } }catch{}
}
btnUrlFind ?.addEventListener('click', ()=>{ openUrlFindModal(); closeDropdown(); });
urlfindClose?.addEventListener('click', closeUrlFindModal);
urlfindModal?.addEventListener('pointerdown', (e)=>{ if(e.target===urlfindModal) closeUrlFindModal(); }, true);

/* ----------------- 입력/버튼/메시지 ----------------- */
const urls           = $('#urls');
const btnPasteTop    = $('#btnPasteTop');
const btnPasteBottom = $('#btnPasteBottom');
const btnSubmitTop   = $('#btnSubmitTop');
const btnSubmitBottom= $('#btnSubmitBottom');
const msgTop         = $('#msgTop');
const msgBottom      = $('#msg');
const catHost        = $('#catHost');

function esc(s=''){ return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function setMsg(html){
  if(msgTop)    msgTop.innerHTML = html || '';
  if(msgBottom) msgBottom.innerHTML = html || '';
}
function getOrder(){ return document.querySelector('input[name="order"]:checked')?.value || 'bottom'; }

/* --- textarea 자동 확장(3줄 기본, 입력 시 증가) --- */
function autoresize(){
  if(!urls) return;
  urls.style.height = 'auto';
  const base = Math.max(3, urls.value.split('\n').length);
  const lineH = 18; // 대략
  urls.style.height = Math.max(3.6*16, base*lineH + 24) + 'px';
}
urls?.addEventListener('input', autoresize);
autoresize();

/* --- 클립보드 붙여넣기(상/하 동기화) --- */
async function pasteFromClipboard(){
  try{
    const t = await navigator.clipboard.readText();
    if(!t){ setMsg('클립보드가 비어있습니다.'); return; }
    urls.value = (urls.value.trim()? urls.value.replace(/\s*$/,'')+'\n' : '') + t.trim();
    autoresize();
    setMsg('<span class="ok">클립보드에서 붙여넣었습니다.</span>');
  }catch{
    setMsg('<span class="danger">클립보드 접근이 차단되었습니다. 브라우저 설정을 확인하세요.</span>');
  }
}
btnPasteTop   ?.addEventListener('click', pasteFromClipboard);
btnPasteBottom?.addEventListener('click', pasteFromClipboard);

/* ----------------- 카테고리 인덱스/렌더 ----------------- */
const personalVals = ['personal1','personal2','personal3','personal4'];

function buildCategoryIndex(){
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const idx = {
    groups: [],
    labelOf: (v)=>v,
    isSeriesVal: (v)=>false,
    isPersonalVal: (v)=>false
  };
  const labelMap = {};
  const seriesSet = new Set();
  const personalSet = new Set();

  groups.forEach(g=>{
    const isSeries   = !!g?.isSeries || String(g?.key||'').startsWith('series_');
    const isPersonal = !!g?.personal || String(g?.key||'')==='personal';
    const children = (g?.children||[]).map(c=>({ value:c.value, label:c.label }));
    children.forEach(c=>{
      labelMap[c.value] = c.label || c.value;
      if(isSeries)   seriesSet.add(c.value);
      if(isPersonal) personalSet.add(c.value);
    });
    idx.groups.push({ key:g.key, label:g.label, isSeries, isPersonal, children });
  });

  idx.labelOf      = (v)=> labelMap[v] || v;
  idx.isSeriesVal  = (v)=> seriesSet.has(v);
  idx.isPersonalVal= (v)=> personalSet.has(v);
  return idx;
}
const CATIDX = buildCategoryIndex();

function readPersonalLabel(slot){
  try{
    const labels = JSON.parse(localStorage.getItem('personalLabels')||'{}');
    if(labels && labels[slot]) return labels[slot];
  }catch{}
  const m = String(slot||'').match(/^personal(\d)$/);
  return m ? `자료${m[1]}` : (slot || '개인자료');
}
function writePersonalLabel(slot, label){
  try{
    let s = String(label||'').trim().slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
    const labels = JSON.parse(localStorage.getItem('personalLabels')||'{}');
    labels[slot] = s;
    localStorage.setItem('personalLabels', JSON.stringify(labels));
  }catch{}
}

function renderCategories(){
  if(!catHost) return;
  catHost.replaceChildren();

  CATIDX.groups.forEach(g=>{
    const fs = document.createElement('fieldset');
    fs.className = 'group';

    const lg = document.createElement('legend');
    lg.textContent = g.label || g.key || '';
    fs.appendChild(lg);

    const sub = document.createElement('div');
    sub.className='subnote';
    sub.textContent = g.isPersonal ? '개인자료 (로컬 저장)' : (g.isSeries ? '시리즈' : '일반');
    fs.appendChild(sub);

    const grid = document.createElement('div'); grid.className='child-grid';

    g.children.forEach(c=>{
      const id = `cat_${g.key}_${c.value}`;
      const wrap = document.createElement('label'); wrap.setAttribute('for', id);

      const input = document.createElement('input'); input.type='checkbox'; input.id=id; input.value=c.value;
      const span  = document.createElement('span'); span.textContent = g.isPersonal ? readPersonalLabel(c.value) : (c.label||c.value);

      wrap.appendChild(input);
      wrap.appendChild(span);

      if(g.isPersonal){
        const rn = document.createElement('button');
        rn.type='button'; rn.className='rename-inline'; rn.textContent='이름변경';
        rn.addEventListener('click', ()=>{
          const now = readPersonalLabel(c.value);
          const nv = prompt('개인자료 이름(최대 12자):', now);
          if(!nv) return;
          writePersonalLabel(c.value, nv);
          span.textContent = readPersonalLabel(c.value);
        });
        wrap.appendChild(rn);
      }

      grid.appendChild(wrap);
    });

    fs.appendChild(grid);
    catHost.appendChild(fs);
  });

  // 제약: 한 곳에서 집계 → 3개 초과/혼합 시 마지막 체크 해제
  catHost.addEventListener('change', ()=>{
    const chosen = [...catHost.querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);
    if(chosen.length>3){
      const last = catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
      setMsg('<span class="danger">카테고리는 최대 3개까지 선택 가능합니다.</span>');
      return;
    }
    const hasPersonal = chosen.some(v=> CATIDX.isPersonalVal(v));
    const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));
    if(hasPersonal && hasServer){
      const last = catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
      setMsg('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>');
      return;
    }
    setMsg('');
  }, { passive:true });
}
renderCategories();

/* ----------------- YouTube PublishedAt(선택) ----------------- */
async function fetchPublishedAt(videoId){
  const API_KEY = (typeof window!=='undefined' ? (window.YT_DATA_API_KEY || window.YT_API_KEY) : null);
  if(!API_KEY) return null;
  try{
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.snippet?.publishedAt || null;
  }catch{ return null; }
}

/* ----------------- 업로드 실행 ----------------- */
function lockUI(v){
  btnSubmitTop   && (btnSubmitTop.disabled   = v);
  btnSubmitBottom&& (btnSubmitBottom.disabled= v);
  btnPasteTop    && (btnPasteTop.disabled    = v);
  btnPasteBottom && (btnPasteBottom.disabled = v);
}

async function handleSubmit(){
  const raw = (urls?.value || '').trim();
  if(!raw){ setMsg('<span class="danger">URL을 입력해주세요.</span>'); return; }

  // 카테고리 검증
  const cats = [...catHost.querySelectorAll('input[type="checkbox"]:checked')].map(i=>i.value);
  if(!cats.length){ setMsg('<span class="danger">카테고리를 선택해주세요.</span>'); return; }
  if(cats.length>3){ setMsg('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>'); return; }
  const hasPersonal = cats.some(v=> CATIDX.isPersonalVal(v));
  const hasServer   = cats.some(v=> !CATIDX.isPersonalVal(v));
  if(hasPersonal && hasServer){ setMsg('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>'); return; }
  if(hasPersonal && cats.length!==1){ setMsg('<span class="danger">개인자료 저장은 하나의 슬롯만 선택할 수 있습니다.</span>'); return; }

  // URL 분해 + 순서
  let lines = raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length){ setMsg('<span class="danger">유효한 URL이 없습니다.</span>'); return; }
  const order = getOrder();
  if(order==='bottom') lines = lines.reverse();

  // 파싱
  const entries=[];
  for(const line of lines){
    if(!isAllowedYouTube(line)){ entries.push({ url:line, ok:false, reason:'유튜브 URL 아님' }); continue; }
    const info = parseYouTube(line); // { id,url,type }
    if(!info?.id){ entries.push({ url:line, ok:false, reason:'ID 파싱 실패' }); continue; }
    entries.push({ url:info.url||line, id:info.id, type:(info.type==='shorts'?'shorts':'video'), ok:true });
  }

  lockUI(true);
  let ok=0, dup=0, bad=entries.filter(e=>!e.ok).length, fail=0;

  try{
    // 개인자료: 로컬 저장
    if(hasPersonal){
      const slot = cats[0];
      const key  = `personal_${slot}`;
      let arr=[]; try{ arr=JSON.parse(localStorage.getItem(key)||'[]'); }catch{ arr=[]; }
      const now = Date.now();
      const good = entries.filter(e=>e.ok);
      for(const e of good){ arr.push({ url:e.url, title:'', savedAt:now }); }
      try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{}
      setMsg(`<span class="ok">개인자료(${esc(readPersonalLabel(slot))})에 ${good.length}건 저장 완료</span> · 무시 ${bad}`);
      urls.value=''; autoresize();
      catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(c=> c.checked=false);
      return;
    }

    // 서버: 로그인 요구
    const user = auth.currentUser;
    if(!user){ setMsg('<span class="danger">로그인이 필요합니다.</span>'); return; }

    // 순차 처리 + 중복 안내 자세히
    for(const e of entries){
      if(!e.ok){ continue; }
      const ref = doc(db, 'videos', e.id);
      try{
        const snap = await getDoc(ref);
        if(snap.exists()){
          const data = snap.data() || {};
          const existedCats = Array.isArray(data.cats) ? data.cats : [];
          const labels = existedCats.map(v=> esc(CATIDX.labelOf(v))).join(', ');
          dup++;
          setMsg(`중복: <b>${esc(e.id)}</b> (기존 카테고리: ${labels || '없음'}) · 진행 ${ok+dup+bad+fail}/${entries.length}`);
          continue;
        }

        const publishedAt = await fetchPublishedAt(e.id);

        const payload = {
          uid: user.uid,
          url: e.url,
          cats: cats.slice(),
          ytid: e.id,
          type: e.type,
          ownerName: user.displayName || '',
          createdAt: serverTimestamp(),
          ...(publishedAt ? { youtubePublishedAt: publishedAt } : {})
        };
        await setDoc(ref, payload, { merge:false });
        ok++;
        setMsg(`<span class="ok">${ok}건 등록 성공</span> · 중복 ${dup} · 실패 ${fail} · 무시 ${bad} · 진행 ${ok+dup+bad+fail}/${entries.length}`);
      }catch(err){
        console.error('[upload] setDoc failed:', err);
        fail++;
        setMsg(`<span class="danger">오류 발생</span> · 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시 ${bad} · 진행 ${ok+dup+bad+fail}/${entries.length}`);
      }
    }

    setMsg(`<span class="ok">완료</span> · 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
    if(ok){ urls.value=''; autoresize(); catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(c=> c.checked=false); }
  }finally{
    lockUI(false);
  }
}

btnSubmitTop   ?.addEventListener('click', handleSubmit);
btnSubmitBottom?.addEventListener('click', handleSubmit);

/* ----------------- Swipe: 단순 + 고급 (dead zone 18%) ----------------- */
(function swipeNav(){
  // 단순형: 왼쪽 스와이프 → index
  function initSimple({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    let sx=0, sy=0, t0=0, tracking=false;
    const TH=70, MAX_OFF_Y=80, TMAX=600;
    const pt = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;

    function start(e){
      const p=pt(e); if(!p) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(p.clientX>=L && p.clientX<=R) return;
      sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
    }
    function end(e){
      if(!tracking) return; tracking=false;
      const p=pt(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
      if(Math.abs(dy)>MAX_OFF_Y || dt>TMAX) return;
      if(dx<=-TH && goLeftHref){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchend',end,{passive:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointerup',end,{passive:true});
  }

  // 고급형: 끌리는 모션(왼쪽으로만), dead zone 동일
  function initDrag({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,canceled=false;
    const TH=60, SLOP=45, TMAX=700;

    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
    const pt=(e)=> (e.touches&&e.touches[0])||(e.pointerType?e:null);
    const inter=(el)=> !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]'));

    function start(e){
      const t=pt(e); if(!t) return;
      if(inter(e.target)) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(t.clientX>=L && t.clientX<=R) return;
      x0=t.clientX; y0=t.clientY; t0=Date.now(); active=true; canceled=false; page.style.transition='none';
    }
    function move(e){
      if(!active) return;
      const t=pt(e); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0;
      if(Math.abs(dy)>SLOP){ canceled=true; active=false; reset(); return; }
      const dxAdj=(dx<0)?dx:0; // 왼쪽만 반응
      if(dxAdj===0){ page.style.transform='translateX(0px)'; return; }
      e.preventDefault(); page.style.transform='translateX('+dxAdj+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=pt(e); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(canceled || Math.abs(dy)>SLOP || dt>TMAX){ reset(); return; }
      if(dx<=-TH && goLeftHref){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(-100vw)'; setTimeout(()=>{ location.href=goLeftHref; },150); }
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
