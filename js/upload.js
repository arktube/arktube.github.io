// /js/upload.js — CopyTube v1.5 모양 + ArkTube 규칙/함수
// 요구사항 요약:
// - URL 텍스트박스: 3줄 기본, 자동확장
// - 3열 컨트롤(좌: 순서(디폴트: 아래부터), 중: 붙여넣기, 우: 등록)
// - 상/하 등록버튼 + 붙여넣기 버튼 동기화, 상태메시지 동기화
// - 드롭다운: copytube 항목 + UrlFind + CatOrder
// - UrlFind 모달: 내장 mount/unmount, 닫기 버튼 라벨 "ThankU!"
// - 개인자료: personal1~4, 라벨 rename 12자 제한
// - CATIDX: series/personal 판정(키 prefix series_ 또는 g.isSeries / g.personal)
// - 제약: 3개 초과/혼합 불가 → 마지막 체크 해제
// - Firestore: setDoc(docId=videoId), 필드 uid/url/cats/ytid + type/ownerName/createdAt/(youtubePublishedAt)
// - 타입 판별: parseYouTube → 'shorts' | 'video'
// - API 키: window.YT_DATA_API_KEY || window.YT_API_KEY
// - 비로그인: manage-uploads 이동 X → 로그인 유도
// - 로그인 시 상단 Welcome! {이름}

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = (s)=>document.querySelector(s);

/* ---------- 상단바 / 드롭다운 ---------- */
const signupLink  = $('#signupLink');
const signinLink  = $('#signinLink');
const welcome     = $('#welcome');
const menuBtn     = $('#menuBtn');
const dropdown    = $('#dropdownMenu');

const btnAbout     = $('#btnAbout');
const btnMyUploads = $('#btnMyUploads');
const btnSignOut   = $('#btnSignOut');
const btnList      = $('#btnList');
const btnGoUpload  = $('#btnGoUpload');
const btnUrlFind   = $('#btnUrlFind');
const btnCatOrder  = $('#btnCatOrder');

function openDropdown(){ dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  welcome.textContent = loggedIn ? `Welcome! ${user?.displayName || '회원'}` : '';
  closeDropdown();
});
menuBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

btnAbout   ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnList    ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });
btnGoUpload?.addEventListener('click', ()=>{ location.href='/upload.html'; closeDropdown(); });
btnCatOrder?.addEventListener('click', ()=>{ location.href='/category-order.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{
  if(auth.currentUser){ location.href='/manage-uploads.html'; }
  else { location.href='/signin.html'; } // 비로그인: 로그인 유도
  closeDropdown();
});
btnSignOut ?.addEventListener('click', async ()=>{
  if(!auth.currentUser){ location.href='/signin.html'; return; }
  try{ await fbSignOut(auth); } finally{ closeDropdown(); }
});

/* ---------- UrlFind 모달 ---------- */
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
  }catch{}
}
function closeUrlFindModal(){
  if(!urlfindModal) return;
  urlfindModal.classList.remove('show');
  urlfindModal.setAttribute('aria-hidden','true');
  try{
    if(window.UrlFind && typeof window.UrlFind.unmount === 'function'){
      window.UrlFind.unmount(urlfindBody);
    }
  }catch{}
}
btnUrlFind ?.addEventListener('click', ()=>{ openUrlFindModal(); closeDropdown(); });
urlfindClose?.addEventListener('click', closeUrlFindModal);
urlfindModal?.addEventListener('pointerdown', (e)=>{ if(e.target === urlfindModal) closeUrlFindModal(); }, true);

/* ---------- DOM ---------- */
const $urls         = $('#urls');
const $btnPasteTop  = $('#btnPasteTop');
const $btnPaste     = $('#btnPaste');
const $btnSubmitTop = $('#btnSubmitTop');
const $btnSubmit    = $('#btnSubmit');
const $msgTop       = $('#msgTop');
const $msg          = $('#msg');
const $catHost      = $('#catHost');

const API_KEY = (window.YT_DATA_API_KEY || window.YT_API_KEY || null);

/* ---------- URL 입력 자동확장 (min 3줄) ---------- */
function autosizeTextarea(){
  if(!$urls) return;
  $urls.style.height = 'auto';
  const h = Math.min($urls.scrollHeight, window.innerHeight * 0.4);
  $urls.style.height = Math.max(h, 52) + 'px';
}
$urls?.addEventListener('input', autosizeTextarea);
window.addEventListener('load', autosizeTextarea);

/* ---------- 상태 메시지(상/하 동기화) ---------- */
function setMsgHTML(html){
  if($msgTop) $msgTop.innerHTML = html || '';
  if($msg)    $msg.innerHTML    = html || '';
}
function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

/* ---------- 붙여넣기 (상/하 동기화) ---------- */
async function doPaste(){
  try{
    const txt = await navigator.clipboard.readText();
    if(!txt){ setMsgHTML('클립보드가 비어있습니다.'); return; }
    const base = $urls.value.trim();
    $urls.value = (base ? (base.replace(/\s*$/,'')+'\n') : '') + txt.trim();
    autosizeTextarea();
    setMsgHTML('붙여넣기 완료.');
  }catch{
    setMsgHTML('클립보드 접근 차단됨. 브라우저 권한을 확인해주세요.');
  }
}
$btnPasteTop?.addEventListener('click', doPaste);
$btnPaste   ?.addEventListener('click', doPaste);

/* ---------- 카테고리 렌더/제약 ---------- */
const CATIDX = (()=> {
  const groupsSrc = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const groups = groupsSrc.map(g => ({
    key: g.key,
    label: g.label,
    isSeries: g.isSeries === true || String(g.key||'').startsWith('series_'),
    isPersonal: g.personal === true || g.key === 'personal',
    children: (g.children||[]).map(c=>({ value:c.value, label:c.label }))
  }));
  const labelMap = Object.create(null);
  const seriesVals = new Set();
  const personalVals = new Set();
  groups.forEach(g=>{
    g.children.forEach(c=>{
      labelMap[c.value] = c.label || c.value;
      if(g.isSeries)   seriesVals.add(c.value);
      if(g.isPersonal) personalVals.add(c.value);
    });
  });
  return {
    groups,
    labelOf: (v)=> labelMap[v] || v,
    isSeriesVal:   (v)=> seriesVals.has(v),
    isPersonalVal: (v)=> personalVals.has(v)
  };
})();

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
    let s = String(label||'').replace(/\r\n?/g,'\n').trim();
    s = s.slice(0,12).replace(/[<>"]/g,''); // 12자 제한
    const labels = JSON.parse(localStorage.getItem('personalLabels') || '{}');
    labels[slot] = s;
    localStorage.setItem('personalLabels', JSON.stringify(labels));
  }catch{}
}

function renderCategories(){
  $catHost.replaceChildren();
  CATIDX.groups.forEach(g=>{
    const fs   = document.createElement('fieldset'); fs.className='group';
    const leg  = document.createElement('legend'); leg.textContent = g.label || g.key || '';
    const note = document.createElement('div'); note.className='subnote'; note.textContent = g.isPersonal ? '개인자료 (로컬 저장)' : (g.isSeries ? '시리즈' : '일반');
    const grid = document.createElement('div'); grid.className='child-grid';

    fs.appendChild(leg); fs.appendChild(note); fs.appendChild(grid);

    g.children.forEach(c=>{
      const lab = document.createElement('label');
      const inp = document.createElement('input'); inp.type='checkbox'; inp.value=c.value;
      const txt = document.createElement('span'); txt.textContent = g.isPersonal ? readPersonalLabel(c.value) : (c.label || c.value);

      lab.appendChild(inp); lab.appendChild(txt);

      if(g.isPersonal){
        const btn = document.createElement('button'); btn.type='button'; btn.className='rename-inline'; btn.textContent='이름변경';
        btn.addEventListener('click', ()=>{
          const cur = readPersonalLabel(c.value);
          const nv = prompt('개인자료 이름(최대 12자):', cur);
          if(!nv) return;
          writePersonalLabel(c.value, nv);
          txt.textContent = readPersonalLabel(c.value);
        });
        lab.appendChild(btn);
      }

      grid.appendChild(lab);
    });

    $catHost.appendChild(fs);
  });

  // 제약: change 한 번으로 처리 (3개 초과/혼합 → 마지막 체크 해제)
  $catHost.addEventListener('change', ()=>{
    const checked = [...$catHost.querySelectorAll('input[type="checkbox"]:checked')];
    if(checked.length > 3){
      const last = $catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
      setMsgHTML('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>');
      return;
    }
    const vals = checked.map(i=> i.value);
    const hasPersonal = vals.some(CATIDX.isPersonalVal);
    const hasServer   = vals.some(v=> !CATIDX.isPersonalVal(v));
    if(hasPersonal && hasServer){
      const last = $catHost.querySelector('input[type="checkbox"]:checked:last-of-type');
      last && (last.checked=false);
      setMsgHTML('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>');
      return;
    }
    setMsgHTML('');
  }, { passive:true });
}
renderCategories();

/* ---------- 유틸 ---------- */
function getOrder(){ return document.querySelector('input[name="order"]:checked')?.value || 'bottom'; }
async function fetchPublishedAt(videoId){
  if(!API_KEY) return null;
  try{
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.snippet?.publishedAt || null;
  }catch{ return null; }
}

/* ---------- 업로드 ---------- */
async function handleSubmit(){
  const raw = ($urls?.value || '').trim();
  if(!raw){ setMsgHTML('<span class="danger">URL을 입력해주세요.</span>'); return; }

  // 선택 카테고리
  const chosen = [...$catHost.querySelectorAll('input[type="checkbox"]:checked')].map(i=> i.value);
  if(!chosen.length){ setMsgHTML('<span class="danger">카테고리를 선택해주세요.</span>'); return; }
  if(chosen.length>3){ setMsgHTML('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>'); return; }

  const hasPersonal = chosen.some(CATIDX.isPersonalVal);
  const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));
  if(hasPersonal && hasServer){ setMsgHTML('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>'); return; }
  if(hasPersonal && chosen.length!==1){ setMsgHTML('<span class="danger">개인자료 저장은 하나의 슬롯만 선택하세요.</span>'); return; }

  // URL 라인 정리 + 순서
  let lines = raw.split(/\r?\n/).map(s=> s.trim()).filter(Boolean);
  if(!lines.length){ setMsgHTML('<span class="danger">유효한 URL이 없습니다.</span>'); return; }
  const order = getOrder();
  if(order==='bottom') lines = lines.slice().reverse();

  // 파싱
  const entries = lines.map(url=>{
    if(!isAllowedYouTube(url)) return { url, ok:false, reason:'유튜브 URL 아님' };
    const info = parseYouTube(url);
    if(!info?.id) return { url, ok:false, reason:'ID 파싱 실패' };
    return { url: info.url||url, id: info.id, type: info.type==='shorts'?'shorts':'video', ok:true };
  });

  // 버튼 lock (상/하 동기화)
  const lock = (v)=>{ $btnSubmitTop&&( $btnSubmitTop.disabled=v ); $btnSubmit&&( $btnSubmit.disabled=v ); $btnPasteTop&&( $btnPasteTop.disabled=v ); $btnPaste&&( $btnPaste.disabled=v ); };
  lock(true);
  setMsgHTML('검사 중...');

  try{
    // 개인자료 (로컬)
    if(hasPersonal){
      const slot = chosen[0];
      const good = entries.filter(e=>e.ok);
      if(!good.length){ setMsgHTML('<span class="danger">저장할 유효한 URL이 없습니다.</span>'); return; }

      const key = `personal_${slot}`;
      let arr=[]; try{ arr=JSON.parse(localStorage.getItem(key)||'[]'); }catch{}
      const now=Date.now();
      good.forEach(e=> arr.push({ url:e.url, title:'', savedAt:now }));
      localStorage.setItem(key, JSON.stringify(arr));

      setMsgHTML(`<span class="ok">개인자료(${esc(readPersonalLabel(slot))})에 ${good.length}건 저장 완료</span> · 무시 ${entries.length - good.length}`);
      $urls.value=''; autosizeTextarea();
      $catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(i=> i.checked=false);
      return;
    }

    // 서버(일반/시리즈) — 로그인 필요
    const user = auth.currentUser;
    if(!user){ setMsgHTML('<span class="danger">로그인이 필요합니다.</span>'); return; }

    let ok=0, dup=0, bad=0, fail=0;
    const good = entries.filter(e=> e.ok);
    bad = entries.length - good.length;

    for(let i=0;i<good.length;i++){
      const e = good[i];
      const ref = doc(db, 'videos', e.id);

      try{
        const exists = await getDoc(ref);
        if(exists.exists()){
          // 중복: 기존 cats 라벨 안내
          const data = exists.data()||{};
          const existedCats = Array.isArray(data.cats)? data.cats : [];
          const labels = existedCats.map(v=> esc(CATIDX.labelOf(v))).join(', ');
          dup++;
          setMsgHTML(`중복(${ok+dup+bad+fail}/${good.length+bad}): <b>${esc(e.id)}</b> (카테고리: ${labels || '없음'})`);
          continue;
        }

        const publishedAt = await fetchPublishedAt(e.id);
        const payload = {
          uid: user.uid,
          url: e.url,
          cats: chosen.slice(),
          ytid: e.id,
          type: e.type,
          ownerName: user.displayName || '',
          createdAt: serverTimestamp(),
          ...(publishedAt ? { youtubePublishedAt: publishedAt } : {})
        };
        await setDoc(ref, payload, { merge:false });
        ok++;
        setMsgHTML(`<span class="ok">등록 중...</span> 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
      }catch(err){
        console.error('[upload] setDoc fail:', err);
        fail++;
        setMsgHTML(`<span class="danger">일부 실패</span> 성공 ${ok} · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
      }
    }

    setMsgHTML(`<b>완료</b> · <span class="ok">성공 ${ok}</span> · 중복 ${dup} · 실패 ${fail} · 무시 ${bad}`);
    if(ok){ $urls.value=''; autosizeTextarea(); $catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(i=> i.checked=false); }
  }finally{
    lock(false);
  }
}
$btnSubmitTop?.addEventListener('click', handleSubmit);
$btnSubmit   ?.addEventListener('click', handleSubmit);

/* ---------- 스와이프 (단순 + 고급, 데드존 18%) ---------- */
(function(){
  function simpleSwipe({ goLeftHref='/index.html', goRightHref=null, deadZoneCenterRatio=0.18 }={}){
    let sx=0, sy=0, t0=0, tracking=false;
    const THX=70, MAXY=80, MAXT=600;
    const pt=(e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    function start(e){
      const p=pt(e); if(!p) return;
      const vw = Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(p.clientX>=L && p.clientX<=R) return; // 중앙 데드존
      sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
    }
    function end(e){
      if(!tracking) return; tracking=false;
      const p=pt(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
      if(Math.abs(dy)>MAXY || dt>MAXT) return;
      if(dx<=-THX && goLeftHref){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
      if(dx>= THX && goRightHref){ document.documentElement.classList.add('slide-out-right'); setTimeout(()=> location.href=goRightHref,260); }
    }
    document.addEventListener('touchstart', start,{passive:true});
    document.addEventListener('touchend',   end  ,{passive:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointerup',  end  ,{passive:true});
  }

  function dragSwipe({ goLeftHref='/index.html', goRightHref=null, threshold=60, slop=45, timeMax=700, feel=1.0, deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,canceled=false;
    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
    function interactive(el){ return !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')); }
    function start(e){
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      if(interactive(e.target)) return;
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
      const dxAdj = dx; // 양방향 지원
      if(dxAdj===0){ page.style.transform='translateX(0px)'; return; }
      e.preventDefault(); page.style.transform='translateX('+(dxAdj*feel)+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(canceled || Math.abs(dy)>slop || dt>timeMax){ reset(); return; }
      if(dx<=-threshold && goLeftHref){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(-100vw)'; setTimeout(()=>{ location.href=goLeftHref; },150); }
      else if(dx>= threshold && goRightHref){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(100vw)'; setTimeout(()=>{ location.href=goRightHref; },150); }
      else reset();
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchmove', move ,{passive:false});
    document.addEventListener('touchend',  end  ,{passive:true,capture:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointermove', move ,{passive:false});
    document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
  }

  simpleSwipe({ goLeftHref:'/index.html', goRightHref:null, deadZoneCenterRatio:0.18 });
  dragSwipe  ({ goLeftHref:'/index.html', goRightHref:null, threshold:60, slop:45, timeMax:700, feel:1.0, deadZoneCenterRatio:0.18 });
})();
