// upload.v15.arktube.js — CopyTube v1.5 UI + ArkTube 기능 스펙
// - Firestore setDoc(docId = YouTube videoId)
// - 규칙에 맞춰 필수 필드: uid, url, cats, ytid, title
// - 추가 저장: type('video'|'shorts'), ownerName, createdAt(serverTimestamp), (youtubePublishedAt)
// - series/personal 판별: series_ prefix || g.isSeries===true / g.personal===true
// - 개인자료 personal1~4 로컬 저장(이름 변경, 12자 제한)
// - 상/하단 버튼/메시지/클립보드 동기화
// - UrlFind 내장 모달 mount/unmount
// - 스와이프 내비게이션
// - 풍부한 디버그 로그 (projectId, auth uid, payload 등)

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import {
  doc, getDoc, setDoc, serverTimestamp, setLogLevel
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

try { setLogLevel('debug'); } catch {}

try {
  console.info('[app] projectId(db):',  db.app?.options?.projectId);
  console.info('[app] projectId(auth):', auth.app?.options?.projectId);
} catch {}

/* ---------- 유틸 ---------- */
const $  = (s)=>document.querySelector(s);
const esc = (s='')=> String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function setStatusHTML(html){
  const top = $('#msgTop'), bottom = $('#msg');
  if(top) top.innerHTML = html || '';
  if(bottom) bottom.innerHTML = html || '';
}
function getOrder(){ return document.querySelector('input[name="order"]:checked')?.value || 'bottom'; }
function enableButtons(on=true){
  $('#btnSubmitTop')   && ($('#btnSubmitTop').disabled   = !on);
  $('#btnSubmitBottom')&& ($('#btnSubmitBottom').disabled= !on);
  $('#btnPasteTop')    && ($('#btnPasteTop').disabled    = !on);
  $('#btnPasteBottom') && ($('#btnPasteBottom').disabled = !on);
}

/* ----- 제목/게시일 취득 유틸 ----- */
function cleanTitle(s=''){
  s = String(s).trim().replace(/\s+/g,' ');
  return s.slice(0, 200);
}

// API 키가 있으면 Data API로 title/publishedAt, 없으면 oEmbed로 title만 시도
async function fetchYouTubeMeta(videoId, fullUrl){
  const meta = { title: null, publishedAt: null };
  const API_KEY = (typeof window!=='undefined' ? (window.YT_DATA_API_KEY || window.YT_API_KEY || null) : null);

  if (API_KEY) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(API_KEY)}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const sn = j?.items?.[0]?.snippet;
        if (sn) {
          meta.title = cleanTitle(sn.title || '');
          meta.publishedAt = sn.publishedAt || null;
          return meta;
        }
      }
    } catch {}
  }

  // oEmbed (제목만)
  try {
    const o = `https://www.youtube.com/oembed?url=${encodeURIComponent(fullUrl)}&format=json`;
    const r = await fetch(o);
    if (r.ok) {
      const j = await r.json();
      meta.title = cleanTitle(j?.title || '');
    }
  } catch {}

  return meta;
}

// 규칙과 동일한 사전 점검(로그만)
function preflightCheck(payload, docId, user){
  const errs = [];
  if (!user?.uid) errs.push('no auth');
  if (payload.uid !== user?.uid) errs.push(`uid mismatch (${payload.uid} != ${user?.uid})`);
  if (!/^https:\/\//.test(payload.url||'')) errs.push('url must start with https://');

  if (!Array.isArray(payload.cats) || payload.cats.length < 1 || payload.cats.length > 3)
    errs.push(`cats.length=${payload.cats?.length}`);

  if (!Array.isArray(payload.cats) || !payload.cats.every(c=>/^[a-z0-9_]{1,32}$/.test(c||'')))
    errs.push('cats value invalid (^[a-z0-9_]{1,32}$)');

  if (payload.ytid !== docId) errs.push(`ytid != docId (${payload.ytid} != ${docId})`);

  if (!payload.title || !payload.title.trim()) errs.push('title empty');

  return errs;
}

/* ---------- 상단바/드롭다운 ---------- */
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

function openDropdown(){ dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) {
    welcome.textContent = loggedIn ? `ThankU! ${(user?.displayName||'회원')}님` : '';
  }
  closeDropdown();
});

menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown', (e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

btnAbout    ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnCatOrder ?.addEventListener('click', ()=>{ location.href='/category-order.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ location.href= auth.currentUser ? '/manage-uploads.html' : '/signin.html'; closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{ if(!auth.currentUser){ location.href='/signin.html'; return; } try{ await fbSignOut(auth); } finally{ closeDropdown(); } });
btnList     ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });

/* ---------- UrlFind 모달 ---------- */
const urlfindModal = $('#urlfindModal');
const urlfindBody  = $('#urlfindBody');
const urlfindClose = $('#urlfindClose');
btnUrlFind?.addEventListener('click', ()=>{ openUrlFindModal(); closeDropdown(); });
urlfindClose?.addEventListener('click', closeUrlFindModal);
urlfindModal?.addEventListener('pointerdown', (e)=>{ if(e.target === urlfindModal) closeUrlFindModal(); }, true);

function openUrlFindModal(){
  if(!urlfindModal){ location.href='/urlfind.html'; return; }
  urlfindModal.classList.add('show');
  urlfindModal.setAttribute('aria-hidden','false');
  try{ if(window.UrlFind?.mount) window.UrlFind.mount(urlfindBody); }catch{}
}
function closeUrlFindModal(){
  if(!urlfindModal) return;
  urlfindModal.classList.remove('show');
  urlfindModal.setAttribute('aria-hidden','true');
  try{ if(window.UrlFind?.unmount) window.UrlFind.unmount(urlfindBody); }catch{}
}

/* ---------- URL 텍스트박스 ---------- */
const $urls = $('#urls');
function autoGrowTA(el){
  el.style.height = 'auto';
  el.style.height = Math.max(el.scrollHeight, el.clientHeight) + 'px';
}
$urls?.addEventListener('input', ()=> autoGrowTA($urls));
$urls && setTimeout(()=>autoGrowTA($urls), 0);

/* ---------- 카테고리 렌더/선택 제약 ---------- */
const $cats = $('#cats');
const PERSONAL_SLOTS = ['personal1','personal2','personal3','personal4'];

function buildCategoryIndex(){
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const idx = {
    groups: [],
    labelOf: (v)=>v,
    isSeriesVal: (v)=>false,
    isPersonalVal: (v)=>false
  };
  const label = {};
  const series = new Set();
  const personal = new Set();

  groups.forEach(g=>{
    const isSeries = g?.isSeries===true || String(g?.key||'').startsWith('series_');
    const isPersonal = g?.personal===true || String(g?.key||'')==='personal';
    const children = (g?.children||[]).map(c=>({ value:c.value, label:c.label }));
    children.forEach(c=>{
      label[c.value] = c.label || c.value;
      if(isSeries) series.add(c.value);
      if(isPersonal) personal.add(c.value);
    });
    idx.groups.push({ key:g.key, label:g.label, isSeries, isPersonal, children });
  });

  idx.labelOf = (v)=> label[v] || v;
  idx.isSeriesVal   = (v)=> series.has(v);
  idx.isPersonalVal = (v)=> personal.has(v);
  return idx;
}
const CATIDX = buildCategoryIndex();

/* 개인자료 라벨 저장 12자 제한 */
function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem('personalLabels')||'{}'); }catch{ return {}; } }
function setPersonalLabel(key, name){
  let s = String(name||'').trim().slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
  const map = getPersonalLabels(); map[key] = s;
  localStorage.setItem('personalLabels', JSON.stringify(map));
}
function personalLabel(key){
  const m = getPersonalLabels();
  if(m[key]) return m[key];
  const num = (key.match(/^personal(\d)$/)||[])[1];
  return num ? `자료${num}` : key;
}

function renderCategories(){
  if(!$cats){ return; }
  $cats.replaceChildren();
  const frag = document.createDocumentFragment();

  CATIDX.groups.forEach(g=>{
    const fs = document.createElement('fieldset');
    fs.className = 'group';
    fs.dataset.key = g.key;

    const legend = document.createElement('legend');
    legend.textContent = g.label || g.key || '';
    fs.appendChild(legend);

    const sub = document.createElement('span');
    sub.className='subnote';
    sub.textContent = g.isPersonal ? '개인자료 (로컬 저장)' : (g.isSeries ? '시리즈' : '일반');
    fs.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'child-grid';
    fs.appendChild(grid);

    g.children.forEach(c=>{
      const lab = document.createElement('label');
      const inp = document.createElement('input');
      inp.type='checkbox'; inp.value=c.value;
      const span = document.createElement('span');
      span.textContent = ' ' + (g.isPersonal ? personalLabel(c.value) : (c.label||c.value));
      lab.appendChild(inp); lab.appendChild(span);

      if(g.isPersonal){
        const btn = document.createElement('button');
        btn.type='button'; btn.className='rename-inline';
        btn.textContent='이름변경';
        btn.addEventListener('click', ()=>{
          const now = personalLabel(c.value);
          const nv = prompt('개인자료 이름(최대 12자):', now);
          if(!nv) return;
          setPersonalLabel(c.value, nv);
          renderCategories();
        });
        lab.appendChild(document.createTextNode(' '));
        lab.appendChild(btn);
      }
      grid.appendChild(lab);
    });

    if (g.isPersonal) {
      const note = document.createElement('div');
      note.className = 'muted';
      note.textContent = '개인자료는 단독 등록/재생만 가능합니다.';
      fs.appendChild(note);
    }

    frag.appendChild(fs);
  });

  $cats.appendChild(frag);

  // 선택 제약
  $cats.addEventListener('change', (e)=>{
    const t = e.target;
    if(!(t instanceof HTMLInputElement) || t.type!=='checkbox') return;

    const chosen = Array.from($cats.querySelectorAll('input[type="checkbox"]:checked')).map(i=> i.value);
    const hasPersonal = chosen.some(v=> CATIDX.isPersonalVal(v));
    const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));

    if(chosen.length > 3 && !CATIDX.isPersonalVal(t.value)){
      t.checked = false;
      setStatusHTML('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>');
      return;
    }
    if(hasPersonal && hasServer){
      t.checked = false;
      setStatusHTML('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>');
      return;
    }
    setStatusHTML('');
  }, { passive:true });
}
renderCategories();

//function getChosenCats(){
 // return Array.from($cats?.querySelectorAll('input[type="checkbox"]:checked')||[]).map(b=> b.value);
//}
 function getChosenCats(){
   const raw = Array.from(
     $cats?.querySelectorAll('input[type="checkbox"]:checked') || []
   ).map(el => String(el?.value ?? '').trim());
   // 공백 제거, 빈값 제거, 중복 제거, 3개 제한
   const uniq = Array.from(new Set(raw)).filter(Boolean).slice(0, 3);
   return uniq;
 }

/* ---------- 클립보드 ---------- */
async function pasteFromClipboard(){
  try{
    const txt = await navigator.clipboard.readText();
    if(!txt){ setStatusHTML('클립보드가 비어있습니다.'); return; }
    const val = ($urls.value.trim()? ($urls.value.replace(/\s*$/,'')+'\n') : '') + txt.trim();
    $urls.value = val;
    autoGrowTA($urls);
    setStatusHTML('<span class="ok">붙여넣기 완료</span>');
  }catch{
    setStatusHTML('클립보드 접근이 차단되었습니다. 브라우저 설정에서 허용해 주세요.');
  }
}
$('#btnPasteTop')?.addEventListener('click', pasteFromClipboard);
$('#btnPasteBottom')?.addEventListener('click', pasteFromClipboard);

/* ---------- 등록 ---------- */
async function submitAll(){
  const raw = ($urls?.value || '').trim();
  if(!raw){ setStatusHTML('<span class="danger">URL을 입력해주세요.</span>'); return; }

 // const cats = getChosenCats();
  const catsRaw = getChosenCats();
 // 최후 보루: 항상 "문자열 배열(≤3)" 보장
 const cats = Array.isArray(catsRaw)
   ? Array.from(new Set(catsRaw.map(v => String(v).trim()).filter(Boolean))).slice(0, 3)
   : [];
  if(!cats.length){ setStatusHTML('<span class="danger">카테고리를 선택해주세요.</span>'); return; }
  if(cats.length > 3 && !cats.every(CATIDX.isPersonalVal)){ setStatusHTML('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>'); return; }

  const hasPersonal = cats.some(CATIDX.isPersonalVal);
  const hasServer   = cats.some(v=> !CATIDX.isPersonalVal(v));
  if(hasPersonal && hasServer){ setStatusHTML('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>'); return; }
  if(hasPersonal && cats.length !== 1){ setStatusHTML('<span class="danger">개인자료 저장은 하나의 슬롯만 선택할 수 있습니다.</span>'); return; }

  let lines = raw.split(/\r?\n/).map(s=> s.trim()).filter(Boolean);
  if(!lines.length){ setStatusHTML('<span class="danger">유효한 URL이 없습니다.</span>'); return; }
  if(getOrder()==='bottom') lines = lines.reverse();

  // 파싱
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

  // 개인자료 → 로컬 저장
  if(hasPersonal){
    const slot = cats[0];
    const good = entries.filter(e=> e.ok).map(e=> ({ url:e.url, title:'' }));
    if(!good.length){ setStatusHTML('<span class="danger">저장할 유효한 URL이 없습니다.</span>'); return; }
    const key = `personal_${slot}`;
    let arr=[]; try{ arr=JSON.parse(localStorage.getItem(key)||'[]'); }catch{}
    const now=Date.now();
    good.forEach(g=> arr.push({ url:g.url, title:'', savedAt:now }));
    try{ localStorage.setItem(key, JSON.stringify(arr)); }catch{}
    setStatusHTML(`<span class="ok">개인자료(${esc(personalLabel(slot))})에 ${good.length}건 저장 완료</span>`);
    return;
  }

  // 서버 모드
  const user = auth.currentUser;
  if(!user){ setStatusHTML('<span class="danger">로그인이 필요합니다.</span>'); return; }

  let ok=0, dup=0, bad=0, fail=0;
  enableButtons(false);
  setStatusHTML('등록 시작...');

  for (const e of entries) {
    if (!e.ok) { bad++; continue; }
    const ref = doc(db,'videos', e.id);

    let payload;
    try {
      // 중복 체크
      const exists = await getDoc(ref);
      if(exists.exists()){
        const data = exists.data() || {};
        const existedCats = Array.isArray(data.cats) ? data.cats : [];
        const labels = existedCats.map(v=> esc(CATIDX.labelOf(v))).join(', ');
        dup++;
        setStatusHTML(`이미 등록됨: <b>${esc(e.id)}</b> (카테고리: ${labels||'없음'})  ·  <span class="ok">성공 ${ok}</span> / <span class="danger">중복 ${dup}</span> / 실패 ${fail} / 무시 ${bad}`);
        continue;
      }

      // 메타 취득 (title 필수, publishedAt 선택)
      const meta = await fetchYouTubeMeta(e.id, e.url);
      let title = cleanTitle(meta.title || '');
      if (!title) {
        // 마지막 보루: URL에서 대충 뽑거나 기본값
        title = '제목없음';
      }
      const publishedAt = meta.publishedAt || null;

      payload = {
        uid: user.uid,
        url: e.url,
      //  cats: cats.slice(),
        cats,
        ytid: e.id,
        type: e.type,
        ownerName: user.displayName || '',
        createdAt: serverTimestamp(),
        title,
        ...(publishedAt ? { youtubePublishedAt: publishedAt } : {})
      };

      // 프리플라이트 로그
      (function(){
        console.groupCollapsed('[preflight quick]');
        console.log('auth.uid:', auth.currentUser?.uid);
        console.log('docId:', e.id);
        console.log('payload:', payload);
        const errs = preflightCheck(payload, e.id, user);
        if (errs.length) {
          console.warn('preflight errors:', errs);
        }
        console.groupEnd();
      })();

      await setDoc(ref, payload, { merge:false });
      ok++;
      setStatusHTML(`<span class="ok">${ok}건 등록 성공</span> · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
    } catch (err) {
      console.group('[upload] save fail');
      console.error('error object', err);
      console.error('code:', err?.code, 'message:', err?.message);
      console.log('docId', e.id);
      console.log('payload (last tried)', payload);
      console.groupEnd();
      fail++;
      setStatusHTML(`<span class="danger">일부 실패</span>: 성공 ${ok}, 중복 ${dup}, 실패 ${fail}, 무시 ${bad}`);
    }
  }

  enableButtons(true);
  setStatusHTML(`<span class="ok">완료</span> · 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시(비유튜브/파싱실패) ${bad}`);
}

/* 버튼 이벤트 */
$('#btnSubmitTop')   ?.addEventListener('click', submitAll);
$('#btnSubmitBottom')?.addEventListener('click', submitAll);

/* ---------- 스와이프 내비 ---------- */
// 단순형: 왼쪽으로 스와이프 시 index로
(function simpleSwipe({ goRightHref='/index.html', deadZoneCenterRatio=0.18 }={}){
  let sx=0, sy=0, t0=0, tracking=false;
  const TH=70, MAX_OFF_Y=80, MAX_T=600;
  const point = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;

  function onStart(e){
    const p = point(e); if(!p) return;
    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L = vw*(0.5-deadZoneCenterRatio/2), R = vw*(0.5+deadZoneCenterRatio/2);
    if(p.clientX>=L && p.clientX<=R) return;
    sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
  }
  function onEnd(e){
    if(!tracking) return; tracking=false;
    const p=point(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
    if(Math.abs(dy)>MAX_OFF_Y || dt>MAX_T) return;
    if(dx>=TH && goRightHref){ document.documentElement.classList.add('slide-out-right'); setTimeout(()=> location.href=goRightHref, 260); }
  }
  document.addEventListener('touchstart', onStart, {passive:true});
  document.addEventListener('touchend',   onEnd,   {passive:true});
  document.addEventListener('pointerdown',onStart, {passive:true});
  document.addEventListener('pointerup',  onEnd,   {passive:true});
})();

// 고급형: 끌림 모션
(function dragSwipe({ goRightHref='/index.html', threshold=60, slop=45, timeMax=700, deadZoneCenterRatio=0.18 }={}){
  const page = document.querySelector('main')||document.body; if(!page) return;
  let x0=0,y0=0,t0=0,active=false,canceled=false;
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
    if(Math.abs(dy)>slop){ canceled=true; active=false; reset(); return; }
    const dxAdj = (dx>0)?dx:0;
    if(dxAdj===0){ page.style.transform='translateX(0px)'; return; }
    e.preventDefault(); page.style.transform='translateX('+dxAdj+'px)';
  }
  function end(e){
    if(!active) return; active=false;
    const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
    const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
    if(canceled || Math.abs(dy)>slop || dt>timeMax){ reset(); return; }
    if(dx>=threshold && goRightHref){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(100vw)'; setTimeout(()=>{ location.href=goRightHref; },150); } else reset();
  }
  document.addEventListener('touchstart',start,{passive:true});
  document.addEventListener('touchmove', move ,{passive:false});
  document.addEventListener('touchend',  end  ,{passive:true,capture:true});
  document.addEventListener('pointerdown',start,{passive:true});
  document.addEventListener('pointermove', move ,{passive:false});
  document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
})();
