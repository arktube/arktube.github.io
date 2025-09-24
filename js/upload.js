// /js/upload.js — CopyTube v1.5 UI + ArkTube 기능
// - setDoc(docId=videoId), cats/type/ytid, ownerName/createdAt/(youtubePublishedAt)
// - 개인자료 personal1..personal4 (로컬), 라벨 rename(최대 12자)
// - UrlFind 모달 mount/unmount 지원
// - 상/하 등록 버튼 & 붙여넣기 버튼 동기화, 메시지 동기화
// - 시리즈/개인자료 판정: series_ prefix or g.isSeries===true/g.personal===true → CATIDX로 값단위 판정
// - 단일 change 이벤트로 3개 초과/혼합 제약(마지막 클릭 항목 해제)
// - API 키: window.YT_DATA_API_KEY || window.YT_API_KEY
// - 스와이프: 단순/고급 모두, 데드존 18%

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/* ---------- Helpers ---------- */
const $ = (s)=>document.querySelector(s);
const esc = (s='')=> String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ---------- Topbar / Dropdown ---------- */
const signupLink = $('#signupLink');
const signinLink = $('#signinLink');
const welcome    = $('#welcome');
const menuBtn    = $('#menuBtn');
const dropdown   = $('#dropdownMenu');

const btnAbout     = $('#btnAbout');
const btnMyUploads = $('#btnMyUploads');
const btnGoUpload  = $('#btnGoUpload');
const btnSignOut   = $('#btnSignOut');
const btnList      = $('#btnList');
const btnCatOrder  = $('#btnCatOrder');
const btnUrlFind   = $('#btnUrlFind');

function openDropdown(){ dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) welcome.textContent = loggedIn ? `Welcome! ${user.displayName || '회원'}` : '';
  closeDropdown();
});

menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown', (e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

btnAbout   ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnList    ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });
btnGoUpload?.addEventListener('click', ()=>{ location.href='/upload.html'; closeDropdown(); });
btnCatOrder?.addEventListener('click', ()=>{ location.href='/category-order.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{
  if(auth.currentUser){ location.href='/manage-uploads.html'; }
  else { location.href='/signin.html'; }
  closeDropdown();
});
btnSignOut ?.addEventListener('click', async ()=>{
  if(!auth.currentUser){ location.href='/signin.html'; return; }
  try{ await fbSignOut(auth); } finally{ closeDropdown(); }
});

/* ---------- UrlFind Modal ---------- */
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
  urlfindModal?.classList.remove('show');
  urlfindModal?.setAttribute('aria-hidden','true');
  try{
    if(window.UrlFind && typeof window.UrlFind.unmount === 'function'){
      window.UrlFind.unmount(urlfindBody);
    }
  }catch{}
}
btnUrlFind   ?.addEventListener('click', ()=>{ openUrlFindModal(); closeDropdown(); });
urlfindClose ?.addEventListener('click', closeUrlFindModal);
urlfindModal ?.addEventListener('pointerdown', (e)=>{ if(e.target === urlfindModal) closeUrlFindModal(); }, true);

/* ---------- DOM ---------- */
const urls           = $('#urls');
const btnPasteTop    = $('#btnPasteTop');
const btnPaste       = $('#btnPaste');
const btnSubmitTop   = $('#btnSubmitTop');
const btnSubmit      = $('#btnSubmit');
const msgTop         = $('#msgTop');
const msg            = $('#msg');
const catHost        = $('#catHost');

function setStatus(html){
  if(msgTop) msgTop.innerHTML = html || '';
  if(msg)    msg.innerHTML    = html || '';
}
function lockButtons(v){
  [btnPasteTop, btnPaste, btnSubmitTop, btnSubmit].forEach(b=>{ if(b) b.disabled = !!v; });
}

/* ---------- URL textarea autosize ---------- */
function autosize(){ if(!urls) return; urls.style.height='auto'; urls.style.height = Math.min(urls.scrollHeight, 420)+'px'; }
urls?.addEventListener('input', autosize);
window.addEventListener('load', autosize);

/* ---------- Category Model → Index ---------- */
function buildCategoryIndex(){
  const groupsSrc = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const groups = [];
  const labelOf = {};
  const seriesVals = new Set();
  const personalVals = new Set();

  for(const g of groupsSrc){
    const isSeries   = (g?.isSeries===true) || String(g?.key||'').startsWith('series_');
    const isPersonal = (g?.personal===true)  || String(g?.key||'')==='personal';
    const children = (g?.children||[]).map(c => ({ value:c.value, label:c.label }));
    for(const c of children){
      labelOf[c.value] = c.label || c.value;
      if(isSeries)   seriesVals.add(c.value);
      if(isPersonal) personalVals.add(c.value);
    }
    groups.push({ key:g.key, label:g.label, isSeries, isPersonal, children });
  }

  return {
    groups,
    labelOf: (v)=> labelOf[v] || v,
    isSeriesVal:   (v)=> seriesVals.has(v),
    isPersonalVal: (v)=> personalVals.has(v),
  };
}
const CATIDX = buildCategoryIndex();

/* ---------- Personal label (<=12자) ---------- */
function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem('personalLabels')||'{}'); }catch{ return {}; } }
function setPersonalLabel(slot, label){
  let s = String(label||'').trim().slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
  const map = getPersonalLabels(); map[slot] = s; localStorage.setItem('personalLabels', JSON.stringify(map));
}
function readPersonalLabel(slot){
  const map = getPersonalLabels();
  if(map[slot]) return map[slot];
  const m = String(slot||'').match(/^personal(\d)$/);
  return m ? `자료${m[1]}` : '개인자료';
}

/* ---------- Render categories ---------- */
function renderCategories(){
  if(!catHost) return;
  catHost.replaceChildren();

  for(const g of CATIDX.groups){
    const field = document.createElement('fieldset');
    field.className = 'group';

    const legend = document.createElement('legend');
    legend.textContent = g.label || g.key || '';
    field.appendChild(legend);

    const note = document.createElement('div');
    note.className = 'subnote';
    note.textContent = g.isPersonal ? '개인자료 (로컬 저장)' : (g.isSeries ? '시리즈' : '일반');
    field.appendChild(note);

    const grid = document.createElement('div');
    grid.className = 'child-grid';

    for(const c of g.children){
      const wrap = document.createElement('label');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = c.value;

      const span = document.createElement('span');
      span.textContent = g.isPersonal ? readPersonalLabel(c.value) : (c.label || c.value);

      wrap.appendChild(input);
      wrap.appendChild(span);

      if(g.isPersonal){
        const btn = document.createElement('button');
        btn.type='button'; btn.className='rename-inline'; btn.textContent='이름변경';
        btn.addEventListener('click', ()=>{
          const cur = readPersonalLabel(c.value);
          const nv  = prompt('개인자료 이름(최대 12자):', cur);
          if(nv && nv.trim()){ setPersonalLabel(c.value, nv.trim()); span.textContent = readPersonalLabel(c.value); }
        });
        wrap.appendChild(btn);
      }

      grid.appendChild(wrap);
    }

    field.appendChild(grid);
    catHost.appendChild(field);
  }

  // 제약: 단일 change 이벤트에서 집계 → 3개 초과/혼합 시 마지막 클릭 해제(정확도 위해 event.target 사용)
  catHost.addEventListener('change', (e)=>{
    const target = e.target;
    if(!(target instanceof HTMLInputElement) || target.type!=='checkbox') return;

    const chosen = [...catHost.querySelectorAll('input[type="checkbox"]:checked')].map(x=> x.value);
    const hasPersonal = chosen.some(v=> CATIDX.isPersonalVal(v));
    const hasServer   = chosen.some(v=> !CATIDX.isPersonalVal(v));

    // 혼합 금지
    if(hasPersonal && hasServer){
      target.checked = false;
      setStatus('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>');
      return;
    }
    // 3개 제한(서버 카테고리만 계산)
    if(!CATIDX.isPersonalVal(target.value)){
      const serverCount = chosen.filter(v=> !CATIDX.isPersonalVal(v)).length;
      if(serverCount > 3){
        target.checked = false;
        setStatus('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>');
        return;
      }
    }
    setStatus('');
  }, { passive:true });
}

/* ---------- Order ---------- */
function getOrder(){ return document.querySelector('input[name="order"]:checked')?.value || 'bottom'; }

/* ---------- PublishedAt (optional) ---------- */
async function fetchPublishedAt(videoId){
  const API_KEY = (window.YT_DATA_API_KEY || window.YT_API_KEY || null);
  if(!API_KEY) return null;
  try{
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(API_KEY)}`;
    const res = await fetch(url);
    if(!res.ok) return null;
    const data = await res.json();
    return data?.items?.[0]?.snippet?.publishedAt || null;
  }catch{ return null; }
}

/* ---------- Paste (top/bottom 동작 동일) ---------- */
async function doPaste(){
  try{
    const txt = await navigator.clipboard.readText();
    if(!txt){ setStatus('클립보드가 비어있습니다.'); return; }
    const cur = urls.value.trim();
    urls.value = cur ? (cur.replace(/\s*$/,'') + '\n' + txt.trim()) : txt.trim();
    autosize();
    setStatus('<span class="ok">붙여넣기 완료.</span>');
  }catch{
    setStatus('<span class="danger">클립보드 접근이 차단되었습니다. 브라우저 설정에서 허용해 주세요.</span>');
  }
}
btnPasteTop?.addEventListener('click', doPaste);
btnPaste   ?.addEventListener('click', doPaste);

/* ---------- Submit ---------- */
function parseLines(){
  return urls.value.split(/\r?\n/).map(s=> s.trim()).filter(Boolean);
}
function getChosenCats(){
  return [...catHost.querySelectorAll('input[type="checkbox"]:checked')].map(x=> x.value);
}

async function handleSubmit(){
  const linesRaw = parseLines();
  if(!linesRaw.length){ setStatus('<span class="danger">URL을 한 줄에 하나씩 입력해 주세요.</span>'); return; }

  const cats = getChosenCats();
  if(!cats.length){ setStatus('<span class="danger">카테고리를 선택해주세요.</span>'); return; }

  const hasPersonal = cats.some(v=> CATIDX.isPersonalVal(v));
  const hasServer   = cats.some(v=> !CATIDX.isPersonalVal(v));
  if(hasPersonal && hasServer){ setStatus('<span class="danger">개인자료와 일반/시리즈를 함께 선택할 수 없습니다.</span>'); return; }
  if(!hasPersonal && cats.filter(v=> !CATIDX.isPersonalVal(v)).length > 3){ setStatus('<span class="danger">카테고리는 최대 3개까지 선택할 수 있습니다.</span>'); return; }
  if(hasPersonal && cats.length!==1){ setStatus('<span class="danger">개인자료 저장은 하나의 슬롯만 선택할 수 있습니다.</span>'); return; }

  // 정렬
  const order = getOrder();
  const lines = (order==='bottom') ? linesRaw.slice().reverse() : linesRaw.slice();

  // 1차 파싱
  const entries = lines.map(url=>{
    if(!isAllowedYouTube(url)) return { url, ok:false, reason:'유튜브 URL 아님' };
    const info = parseYouTube(url); // {id,url,type}
    if(!info?.id) return { url, ok:false, reason:'ID 파싱 실패' };
    return { url: info.url || url, id: info.id, type: (info.type==='shorts'?'shorts':'video'), ok:true };
  });

  lockButtons(true);
  try{
    // 개인자료(로컬)
    if(hasPersonal){
      const slot = cats[0];
      const key  = `personal_${slot}`;
      const now  = Date.now();
      let arr=[]; try{ arr = JSON.parse(localStorage.getItem(key)||'[]'); }catch{ arr=[]; }

      const good = entries.filter(e=> e.ok);
      good.forEach(e=> arr.push({ url:e.url, title:'', savedAt:now }));

      localStorage.setItem(key, JSON.stringify(arr));
      setStatus(`<span class="ok">개인자료(${esc(readPersonalLabel(slot))})에 ${good.length}건 저장 완료</span> · 무시 ${entries.length - good.length}`);
      urls.value=''; autosize();
      catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(x=> x.checked=false);
      return;
    }

    // 서버(일반/시리즈)
    const user = auth.currentUser;
    if(!user){ setStatus('<span class="danger">로그인이 필요합니다.</span>'); return; }

    let ok=0, dup=0, bad=0, fail=0;

    for(const e of entries){
      if(!e.ok){ bad++; setStatus(`진행중... <span class="ok">성공 ${ok}</span> · <span>중복 ${dup}</span> · <span class="danger">실패 ${fail}</span> · 무시 ${bad}`); continue; }

      const ref = doc(db, 'videos', e.id);
      try{
        const snap = await getDoc(ref);
        if(snap.exists()){
          // 중복 안내 + 기존 cats 라벨
          const data = snap.data() || {};
          const existedCats = Array.isArray(data.cats)? data.cats : [];
          const labels = existedCats.map(v=> esc(CATIDX.labelOf(v))).join(', ');
          dup++;
          setStatus(`이미 등록됨: <b>${esc(e.id)}</b> (카테고리: ${labels||'없음'}) · <span class="ok">성공 ${ok}</span> · <span>중복 ${dup}</span> · <span class="danger">실패 ${fail}</span> · 무시 ${bad}`);
          continue;
        }

        const publishedAt = await fetchPublishedAt(e.id);

        const payload = {
          uid: user.uid,
          url: e.url,
          cats: cats.slice(),
          ytid: e.id,
          type: e.type,                 // 'shorts'|'video'
          ownerName: user.displayName || '',
          createdAt: serverTimestamp(),
          ...(publishedAt ? { youtubePublishedAt: publishedAt } : {})
        };

        await setDoc(ref, payload, { merge:false });
        ok++;
      }catch(err){
        console.error('[upload] setDoc fail', err);
        fail++;
      }
      setStatus(`진행중... <span class="ok">성공 ${ok}</span> · <span>중복 ${dup}</span> · <span class="danger">실패 ${fail}</span> · 무시 ${bad}`);
    }

    setStatus(`<span class="ok">완료</span> · <span class="ok">성공 ${ok}</span> · <span>중복 ${dup}</span> · <span class="danger">실패 ${fail}</span> · 무시 ${bad}`);
    if(ok){ urls.value=''; autosize(); catHost.querySelectorAll('input[type="checkbox"]:checked')?.forEach(x=> x.checked=false); }
  } finally {
    lockButtons(false);
  }
}

btnSubmitTop?.addEventListener('click', handleSubmit);
btnSubmit   ?.addEventListener('click', handleSubmit);

/* ---------- Swipe: simple + advanced, deadzone 18% ---------- */
(function swipe(){
  // 단순: 왼쪽 스와이프 → index
  (function initSimple({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    let sx=0, sy=0, t0=0, tracking=false;
    const TH=70, MAXY=80, TMAX=600;
    const P = (e)=> e.touches?.[0] || e.changedTouches?.[0] || e;
    function start(e){
      const p=P(e); if(!p) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(p.clientX>=L && p.clientX<=R) return;
      sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
    }
    function end(e){
      if(!tracking) return; tracking=false;
      const p=P(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
      if(Math.abs(dy)>MAXY || dt>TMAX) return;
      if(dx<=-TH && goLeftHref){ document.documentElement.classList.add('slide-out-left'); setTimeout(()=> location.href=goLeftHref, 260); }
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchend',  end  ,{passive:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointerup',  end  ,{passive:true});
  })();

  // 고급: 드래그 끌림 모션(왼쪽만 허용)
  (function initDrag({ goLeftHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,cancel=false;
    const TH=60,SLOP=45,TMAX=700;
    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0px)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
    function isInteractive(el){ return !!(el && el.closest('input,textarea,select,button,a,[role="button"],[contenteditable="true"]')); }
    function start(e){
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      if(isInteractive(e.target)) return;
      const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
      const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
      if(t.clientX>=L && t.clientX<=R) return;
      x0=t.clientX; y0=t.clientY; t0=Date.now(); active=true; cancel=false; page.style.transition='none';
    }
    function move(e){
      if(!active) return;
      const t=(e.touches&&e.touches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0;
      if(Math.abs(dy)>SLOP){ cancel=true; active=false; reset(); return; }
      const dxAdj = (dx<0)?dx:0;   // 왼쪽만
      if(dxAdj===0){ page.style.transform='translateX(0px)'; return; }
      e.preventDefault(); page.style.transform='translateX('+dxAdj+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(cancel || Math.abs(dy)>SLOP || dt>TMAX){ reset(); return; }
      if(dx<=-TH){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(-100vw)'; setTimeout(()=>{ location.href=goLeftHref; },150); }
      else reset();
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchmove', move ,{passive:false});
    document.addEventListener('touchend',  end  ,{passive:true,capture:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointermove', move ,{passive:false});
    document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
  })();
})();

/* ---------- Init ---------- */
(function init(){
  renderCategories();
})();
