// /js/upload.js — CopyTube v1.5 UI + ArkTube 기능 스펙
// - 문서ID=videoId(setDoc), cats 스키마, ytid==id, type(video|shorts), ownerName, createdAt, youtubePublishedAt(API_KEY 합집합)
// - 개인자료: personal1..4 로컬 저장 & 이름변경(최대 12자)
// - CATIDX: series/personal 판정(키 prefix `series_` or g.isSeries===true / g.personal===true)
// - 제약: 단일 change 이벤트로 집계 → 3개 초과/혼합 시 마지막 체크 해제(:checked:last-of-type)
// - 상/하단 등록 버튼 동기화
// - UrlFind 모달: mount/unmount 지원, 타이틀 "ThankU!"
// - 스와이프: 단순 + 고급(데드존 18%)

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = (s)=>document.querySelector(s);

/* ---------- Topbar/Dropdown ---------- */
const signupLink = $('#signupLink');
const signinLink = $('#signinLink');
const welcome    = $('#welcome');
const menuBtn    = $('#menuBtn');
const dropdown   = $('#dropdownMenu');

const btnAbout     = $('#btnAbout');
const btnMyUploads = $('#btnMyUploads');
const btnSignOut   = $('#btnSignOut');
const btnGoUpload  = $('#btnGoUpload');
const btnList      = $('#btnList');
const btnUrlFind   = $('#btnUrlFind');

function openDropdown(){ dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) welcome.textContent = loggedIn ? `ThankU ${user.displayName||'회원'}!!` : '';
  closeDropdown();
});

menuBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click',(e)=> e.stopPropagation());

btnAbout    ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ location.href='/manage-uploads.html'; closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{ await fbSignOut(auth); closeDropdown(); });
btnGoUpload ?.addEventListener('click', ()=>{ location.href='/upload.html'; closeDropdown(); });
btnList     ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });

/* ---------- UrlFind 모달 (A=지원, mount/unmount, ThankU!) ---------- */
const urlfindModal = $('#urlfindModal');
const urlfindBody  = $('#urlfindBody');
const urlfindClose = $('#urlfindClose');

function openUrlFind(){
  if(!urlfindModal){ location.href='/urlfind.html'; return; }
  urlfindModal.style.display='flex';
  urlfindModal.classList.remove('hidden');
  try{ window.UrlFind?.mount?.(urlfindBody); }catch{}
}
function closeUrlFind(){
  if(!urlfindModal) return;
  try{ window.UrlFind?.unmount?.(urlfindBody); }catch{}
  urlfindModal.classList.add('hidden');
  urlfindModal.style.display='none';
}
btnUrlFind  ?.addEventListener('click', ()=>{ openUrlFind(); closeDropdown(); });
urlfindClose?.addEventListener('click', closeUrlFind);
urlfindModal?.addEventListener('pointerdown', (e)=>{ if(e.target===urlfindModal) closeUrlFind(); }, true);

/* ---------- DOM ---------- */
const urls         = $('#urls');
const msgTop       = $('#msgTop');
const msgBottom    = $('#msg');
const btnPaste     = $('#btnPaste');
const btnSubmitTop = $('#btnSubmitTop');
const btnSubmitBot = $('#btnSubmitBottom');
const catHost      = $('#catHost');

function setMsg(t){
  const s = t || '';
  msgTop && (msgTop.textContent = s);
  msgBottom && (msgBottom.textContent = s);
}

/* ---------- URL textarea 자동 높이 ---------- */
function autoGrowTextarea(el){
  if(!el) return;
  el.style.height = 'auto';
  const max = Math.min(window.innerHeight*0.6, 800);
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}
urls?.addEventListener('input', ()=> autoGrowTextarea(urls));
window.addEventListener('resize', ()=> autoGrowTextarea(urls));
urls && autoGrowTextarea(urls);

/* ---------- 카테고리 모델 인덱스(CATIDX) ---------- */
function buildCategoryIndex(){
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const labelOf = {};
  const seriesSet = new Set();
  const personalSet = new Set();
  const out = [];

  groups.forEach(g=>{
    const isSeries   = !!g?.isSeries || String(g?.key||'').startsWith('series_');
    const isPersonal = !!g?.personal || String(g?.key||'')==='personal';
    const children   = (g?.children||[]).map(c=>({ value:c.value, label:c.label }));
    children.forEach(c=>{
      labelOf[c.value] = c.label || c.value;
      if(isSeries) seriesSet.add(c.value);
      if(isPersonal) personalSet.add(c.value);
    });
    out.push({ key:g.key, label:g.label, isSeries, isPersonal, children });
  });

  return {
    groups: out,
    labelOf: (v)=> labelOf[v] || v,
    isSeriesVal: (v)=> seriesSet.has(v),
    isPersonalVal: (v)=> personalSet.has(v)
  };
}
const CATIDX = buildCategoryIndex();

/* ---------- 개인자료 라벨 저장(최대 12자) ---------- */
function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem('personalLabels')||'{}'); }catch{ return {}; } }
function setPersonalLabel(slot, label){
  let s = String(label||'').trim().slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
  const map = getPersonalLabels(); map[slot]=s;
  localStorage.setItem('personalLabels', JSON.stringify(map));
}
function readPersonalLabel(slot){
  const m = getPersonalLabels(); if(m[slot]) return m[slot];
  const m2 = String(slot||'').match(/^personal(\d)$/); return m2 ? `자료${m2[1]}` : (slot||'개인자료');
}

/* ---------- 카테고리 렌더링 (innerHTML 없이 생성) ---------- */
function renderCats(){
  if(!catHost) return;
  catHost.replaceChildren();

  for(const g of CATIDX.groups){
    const fs = document.createElement('fieldset'); fs.className='group'; fs.dataset.key=g.key;
    const lg = document.createElement('legend'); lg.textContent = g.label; fs.appendChild(lg);
    const sub = document.createElement('div'); sub.className='subnote';
    sub.textContent = g.isPersonal? '개인자료 (로컬저장소)' : (g.isSeries? '시리즈' : '일반');
    fs.appendChild(sub);

    const grid = document.createElement('div'); grid.className='child-grid';

    for(const c of g.children){
      const lab = document.createElement('label');
      const chk = document.createElement('input'); chk.type='checkbox'; chk.className='cat'; chk.value = c.value;
      const span= document.createElement('span'); span.textContent = g.isPersonal ? readPersonalLabel(c.value) : (c.label || c.value);
      lab.appendChild(chk); lab.appendChild(document.createTextNode(' ')); lab.appendChild(span);

      if(g.isPersonal){
        const btn = document.createElement('button'); btn.type='button'; btn.className='rename-inline'; btn.textContent='이름변경';
        btn.addEventListener('click', ()=>{
          const cur = readPersonalLabel(c.value);
          const nv = prompt('개인자료 이름(최대 12자):', cur);
          if(nv && nv.trim()){ setPersonalLabel(c.value, nv.trim()); span.textContent = readPersonalLabel(c.value); }
        });
        lab.appendChild(btn);
      }
      grid.appendChild(lab);
    }
    fs.appendChild(grid);
    catHost.appendChild(fs);
  }

  // 단일 change 이벤트: 3개 초과/혼합 금지 처리 (마지막 체크 해제)
  catHost.addEventListener('change', ()=>{
    const checked = [...catHost.querySelectorAll('input.cat:checked')];
    const chosen = checked.map(x=> x.value);

    if(chosen.length>3){
      const last = catHost.querySelector('input.cat:checked:last-of-type');
      last && (last.checked=false);
      setMsg('카테고리는 최대 3개까지 선택 가능합니다.');
      return;
    }
    const hasPersonal = chosen.some(v=> CATIDX.isPersonalVal(v));
    const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));
    if(hasPersonal && hasServer){
      const last = catHost.querySelector('input.cat:checked:last-of-type');
      last && (last.checked=false);
      setMsg('개인자료와 일반/시리즈는 함께 선택할 수 없습니다.');
      return;
    }
    setMsg('');
  }, { passive:true });
}
renderCats();

/* ---------- URL/순서/파서 ---------- */
const API_KEY = (window.YT_DATA_API_KEY || window.YT_API_KEY || null);
function getOrder(){ return document.querySelector('input[name="order"]:checked')?.value || 'bottom'; }

async function fetchPublishedAt(videoId){
  if(!API_KEY) return null;
  try{
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url); if(!res.ok) return null;
    const data = await res.json(); return data?.items?.[0]?.snippet?.publishedAt || null;
  }catch{ return null; }
}

/* ---------- 붙여넣기 ---------- */
btnPaste?.addEventListener('click', async ()=>{
  try{
    const txt = await navigator.clipboard.readText();
    if(!txt){ setMsg('클립보드가 비어있습니다.'); return; }
    const cur = (urls.value||'').replace(/\s*$/,'');
    urls.value = (cur ? (cur+'\n') : '') + txt.trim();
    autoGrowTextarea(urls);
    setMsg('붙여넣기 완료.');
  }catch{
    setMsg('클립보드 접근이 차단되었습니다. 브라우저 설정에서 허용해 주세요.');
  }
});

/* ---------- 등록 공통 로직 ---------- */
function chosenCats(){
  return [...catHost.querySelectorAll('input.cat:checked')].map(x=>x.value);
}
function lockButtons(v){
  btnSubmitTop && (btnSubmitTop.disabled=v);
  btnSubmitBot && (btnSubmitBot.disabled=v);
}
async function doSubmit(){
  const raw = (urls.value||'').trim();
  if(!raw){ setMsg('URL을 한 줄에 하나씩 입력해 주세요.'); return; }

  const cats = chosenCats();
  if(!cats.length){ setMsg('카테고리를 최소 1개 선택해 주세요.'); return; }
  if(cats.length>3){ setMsg('카테고리는 최대 3개까지 선택 가능합니다.'); return; }

  const hasPersonal = cats.some(v=> CATIDX.isPersonalVal(v));
  const hasServer   = cats.some(v=> !CATIDX.isPersonalVal(v));
  if(hasPersonal && hasServer){ setMsg('개인자료는 다른 카테고리와 함께 선택할 수 없습니다.'); return; }
  if(hasPersonal && cats.length!==1){ setMsg('개인자료 저장은 하나의 슬롯만 선택할 수 있습니다.'); return; }

  let lines = raw.split(/\r?\n/).map(s=> s.trim()).filter(Boolean);
  if(!lines.length){ setMsg('유효한 URL이 없습니다.'); return; }
  const order = getOrder();
  if(order==='bottom') lines = lines.slice().reverse();

  // 파싱
  const entries = lines.map(line=>{
    if(!isAllowedYouTube(line)) return { ok:false, url:line, reason:'YouTube URL 아님' };
    const info = parseYouTube(line); // { id, url, type }
    if(!info?.id) return { ok:false, url:line, reason:'ID 파싱 실패' };
    return { ok:true, id:info.id, url:info.url||line, type: (info.type==='shorts'?'shorts':'video') };
  });

  // 개인자료 → 로컬 저장
  if(hasPersonal){
    const slot = cats[0];
    const good = entries.filter(e=>e.ok);
    if(!good.length){ setMsg('저장할 유효한 URL이 없습니다.'); return; }
    const key = `personal_${slot}`;
    let arr=[]; try{ arr=JSON.parse(localStorage.getItem(key)||'[]'); }catch{ arr=[]; }
    const now = Date.now();
    good.forEach(e=> arr.push({ url:e.url, title:'', savedAt:now }));
    try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{}
    setMsg(`로컬 저장 완료: ${good.length}건 (${readPersonalLabel(slot)})`);
    urls.value=''; autoGrowTextarea(urls);
    catHost.querySelectorAll('input.cat:checked').forEach(x=> x.checked=false);
    return;
  }

  // 서버 모드 → Firestore
  const user = auth.currentUser;
  if(!user){ setMsg('로그인 후 이용하세요.'); return; }

  lockButtons(true);
  let ok=0, dup=0, bad=0, fail=0;

  for(const e of entries){
    if(!e.ok){ bad++; continue; }

    const ref = doc(db,'videos', e.id);
    try{
      const snap = await getDoc(ref);
      if(snap.exists()){
        dup++;
        const existedCats = Array.isArray(snap.data()?.cats) ? snap.data().cats : [];
        const labels = existedCats.map(v=> CATIDX.labelOf(v)).join(', ');
        setMsg(`중복(${dup}) · 이미 등록됨: ${e.id}${labels?` [${labels}]`:''} · 진행: 성공 ${ok}, 실패 ${fail}, 무시 ${bad}`);
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
        ...(publishedAt? { youtubePublishedAt: publishedAt } : {})
      };

      await setDoc(ref, payload, { merge:false });
      ok++;
      setMsg(`등록 중... 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
    }catch(err){
      console.error('[upload] setDoc fail:', err);
      fail++;
      setMsg(`오류 발생: 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
    }
  }

  setMsg(`완료: 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시(비유튜브/파싱실패) ${bad}`);
  lockButtons(false);
  if(ok){ urls.value=''; autoGrowTextarea(urls); catHost.querySelectorAll('input.cat:checked').forEach(x=> x.checked=false); }
}

/* 상/하단 버튼 동기화 */
btnSubmitTop?.addEventListener('click', doSubmit);
btnSubmitBot?.addEventListener('click', doSubmit);

/* ---------- 스와이프 (단순 + 고급, 데드존 18%) ---------- */
(function(){
  // 단순: 왼쪽 스와이프 → index.html
  function simpleSwipe({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    let sx=0, sy=0, t0=0, tracking=false;
    const TH=70, MAXY=80, TMAX=600;
    const getP=(e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    function start(e){
      const p=getP(e); if(!p) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(p.clientX>=L && p.clientX<=R) return;
      sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
    }
    function end(e){
      if(!tracking) return; tracking=false;
      const p=getP(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
      if(Math.abs(dy)>MAXY || dt>TMAX) return;
      if(dx<=-TH && goLeftHref){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
    }
    document.addEventListener('touchstart', start, {passive:true});
    document.addEventListener('touchend',   end,   {passive:true});
    document.addEventListener('pointerdown',start, {passive:true});
    document.addEventListener('pointerup',  end,   {passive:true});
  }

  // 고급: 끌려가는 모션, 오른쪽 스와이프 → index.html
  function dragSwipe({ goRightHref='/index.html', threshold=60, slop=45, timeMax=700, deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,canceled=false;
    const isInteractive=(el)=> !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]'));
    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
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
      if(Math.abs(dy)>slop){ canceled=true; active=false; reset(); return; }
      if(dx<=0){ page.style.transform='translateX(0px)'; return; }
      e.preventDefault(); page.style.transform='translateX('+dx+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(canceled || Math.abs(dy)>slop || dt>timeMax){ reset(); return; }
      if(dx>=threshold && goRightHref){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(100vw)'; setTimeout(()=>{ location.href=goRightHref; },150); }
      else reset();
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchmove', move ,{passive:false});
    document.addEventListener('touchend',  end  ,{passive:true,capture:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointermove', move ,{passive:false});
    document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
  }

  simpleSwipe({ goLeftHref:'/index.html', deadZoneCenterRatio:0.18 });
  dragSwipe  ({ goRightHref:'/index.html', deadZoneCenterRatio:0.18 });
})();
