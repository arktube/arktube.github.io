// js/manage-uploads.js (목록1.3, v1.3.3-xss-safe)
// - XSS 방어: 목록 렌더 전부 createElement/textContent 사용(innerHTML 제거)
// - URL 화이트리스트(YT) 적용, href는 화이트리스트 통과 시에만 부여
// - 제목 백필(oEmbed) 동작 유지, 로그인 유지/모달 스크롤 픽스 유지

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  collection, getDocs, query, where, orderBy, limit, startAfter,
  deleteDoc, doc, updateDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { CATEGORY_GROUPS } from './categories.js';

/* ---------- 상단바 ---------- */
const signupLink   = document.getElementById("signupLink");
const signinLink   = document.getElementById("signinLink");
const welcome      = document.getElementById("welcome");
const menuBtn      = document.getElementById("menuBtn");
const dropdown     = document.getElementById("dropdownMenu");
const btnSignOut   = document.getElementById("btnSignOut");
const btnGoUpload  = document.getElementById("btnGoUpload");
const btnAbout     = document.getElementById("btnAbout");

let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown?.classList.remove("hidden"); requestAnimationFrame(()=> dropdown?.classList.add("show")); }
function closeDropdown(){ isMenuOpen=false; dropdown?.classList.remove("show"); setTimeout(()=> dropdown?.classList.add("hidden"),180); }
menuBtn?.addEventListener("click",(e)=>{ e.stopPropagation(); dropdown?.classList.contains("hidden")?openDropdown():closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click',(e)=> e.stopPropagation());
btnAbout?.addEventListener('click', ()=>{ location.href='about.html'; closeDropdown(); });
btnGoUpload?.addEventListener('click', ()=>{ location.href='upload.html'; closeDropdown(); });
btnSignOut?.addEventListener('click', async ()=>{ try{ await fbSignOut(auth); }catch{} closeDropdown(); });

/* ---------- 유틸 ---------- */
const $ = s=>document.querySelector(s);
const list   = $('#list');
const msg    = $('#msg');
const more   = $('#more');
const btnMore= $('#btnMore');
const qbox   = $('#q');
const btnSearch = $('#btnSearch');
const btnDeleteSel = $('#btnDeleteSel');

function setStatus(text){ if(msg) msg.textContent = text || ''; }

// YouTube 전용 화이트리스트 & 안전 ID 추출
const YT_WHITELIST = /^(https:\/\/(www\.)?youtube\.com\/(watch\?v=|shorts\/)|https:\/\/youtu\.be\/)/i;
const YT_ID_SAFE   = /^[a-zA-Z0-9_-]{6,20}$/;
function safeExtractId(url){
  const m=String(url||'').match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([^?&/]+)/i);
  const cand = m? m[1] : '';
  return YT_ID_SAFE.test(cand) ? cand : '';
}

/* 카테고리 라벨 맵 */
const valueToLabel = (()=> {
  const m = new Map();
  CATEGORY_GROUPS.forEach(g => g.children.forEach(c => m.set(c.value, c.label)));
  return m;
})();

/* ---------- 제목 가져오기(oEmbed) + 백필 ---------- */
async function fetchTitle(url){
  try{
    const id = safeExtractId(url);
    const u  = id ? ('https://www.youtube.com/watch?v=' + id) : url;
    const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u));
    if(!res.ok) throw new Error('oEmbed ' + res.status);
    const data = await res.json();
    return (data?.title || '').slice(0, 200);
  }catch(e){ console.warn('[manage-uploads] fetchTitle 실패:', e); return ''; }
}
async function ensureTitle(elRow, docId, v){
  if(v.title) return; // 이미 있으면 스킵
  const t = await fetchTitle(v.url);
  if(!t) return;
  try{
    await updateDoc(doc(db,'videos', docId), { title: t });
    // 캐시/DOM 갱신
    const item = cache.find(x => x.id === docId);
    if(item){ item.data.title = t; }
    const titleEl = elRow.querySelector('.title');
    titleEl?.replaceChildren(document.createTextNode(t));
    titleEl?.setAttribute('title', t);
  }catch(e){ console.warn('[manage-uploads] title 백필 실패:', e); }
}

/* ---------- 목록 상태 ---------- */
const PAGE_SIZE = 20;
let curUser = null;
let lastDoc = null;
let hasMore = true;
let isLoading = false;
let cache = [];        // 화면에 적재된 전체(검색용)
let usingClientFallback = false; // 인덱스 폴백 여부

/* ---------- DOM 생성 헬퍼 ---------- */
function makeEl(tag, props={}, children=[]){
  const el = document.createElement(tag);
  // 속성/스타일/데이터
  for(const [k,v] of Object.entries(props||{})){
    if (k === 'className') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v; // (사용하지 않음: 안전 위해 제공만)
    else if (k === 'attrs' && v){
      for(const [ak,av] of Object.entries(v)) el.setAttribute(ak, av);
    } else if (k === 'style' && v){
      Object.assign(el.style, v);
    } else {
      // href 같은 표준 속성은 직접 할당
      try { el[k] = v; } catch {}
    }
  }
  if(!Array.isArray(children)) children = [children];
  children.forEach(ch=>{
    if (typeof ch === 'string') el.appendChild(document.createTextNode(ch));
    else if (ch) el.appendChild(ch);
  });
  return el;
}

/* ---------- cat chips DOM ---------- */
function catChipsEl(values=[]){
  const wrap = document.createElement('span');
  (values||[]).forEach(v=>{
    const chip = makeEl('span', { className:'chip', text: (valueToLabel.get(v)||v) });
    wrap.appendChild(chip);
  });
  return wrap;
}

/* ---------- 행 렌더 (XSS-safe) ---------- */
function rowEl(docId, v){
  const id = safeExtractId(v.url);
  const row = makeEl('div', { className:'row' });
  row.dataset.id = docId;

  // 선택 체크박스
  const selLabel = makeEl('label', { className:'sel' },
    makeEl('input', { type:'checkbox', className:'selbox' })
  );

  // 제목
  const titleEl = makeEl('div', { className:'title' });
  titleEl.textContent = v.title || '(제목없음)';
  titleEl.title = v.title || '';

  // URL (텍스트로만 표시)
  const urlEl = makeEl('div', { className:'url' });
  urlEl.textContent = v.url || '';
  urlEl.title = v.url || '';

  // 카테고리
  const catsEl = makeEl('div', { className:'cats' }, catChipsEl(v.categories||[]));

  // 썸네일 링크 (화이트리스트 통과 시에만 href 부여)
  const thumbLink = makeEl('a', { className:'thumb', attrs:{ target:'_blank', rel:'noopener' } });
  if (YT_WHITELIST.test(v.url) && id){
    thumbLink.href = v.url;
  } else {
    // 링크 불가: href 미지정 (클릭 금지)
    thumbLink.href = 'javascript:void(0)';
    thumbLink.addEventListener('click', (e)=> e.preventDefault());
  }
  const img = makeEl('img', { attrs:{ alt:'thumb' } });
  if (id) img.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  thumbLink.appendChild(img);

  // 액션 버튼
  const actions = makeEl('div', { className:'actions' }, [
    makeEl('button', { className:'btn btn-cat', attrs:{ 'data-act':'edit' } , text:'카테고리' }),
    makeEl('button', { className:'btn btn-danger', attrs:{ 'data-act':'del' } , text:'삭제' }),
  ]);

  // 조립
  row.appendChild(selLabel);
  row.appendChild(titleEl);
  row.appendChild(urlEl);
  row.appendChild(catsEl);
  row.appendChild(thumbLink);
  row.appendChild(actions);

  // 이벤트
  actions.querySelector('[data-act="del"]')?.addEventListener('click', async ()=>{
    if(!confirm('이 영상을 삭제할까요?')) return;
    try{
      await deleteDoc(doc(db,'videos', docId));
      row.remove();
      cache = cache.filter(x => x.id !== docId);
    }catch(e){ alert('삭제 실패: '+(e.message||e)); }
  });
  actions.querySelector('[data-act="edit"]')?.addEventListener('click', ()=> openEdit(docId, v.categories||[]));

  // 제목 백필 시도
  ensureTitle(row, docId, v);
  return row;
}

qbox?.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); applyFilter(); }});
btnSearch?.addEventListener('click', ()=> applyFilter());

function applyFilter(){
  const q = (qbox?.value||'').trim().toLowerCase();
  list.replaceChildren();
  const rows = !q ? cache : cache.filter(x=>{
    const t = (x.data.title||'').toLowerCase();
    const u = (x.data.url||'').toLowerCase();
    return t.includes(q) || u.includes(q);
  });
  rows.forEach(x => list.appendChild(rowEl(x.id, x.data)));
  more.style.display = hasMore && !q ? '' : 'none';
}

/* ---------- 로딩 ---------- */
async function loadInit(){
  if(!auth.currentUser) return;
  curUser = auth.currentUser;
  cache = []; list.replaceChildren(); lastDoc=null; hasMore=true; usingClientFallback=false;
  setStatus('불러오는 중...');
  try{
    // 선호: uid where + createdAt desc
    const base = collection(db,'videos');
    const parts = [ where('uid','==', curUser.uid), orderBy('createdAt','desc'), limit(PAGE_SIZE) ];
    const snap = await getDocs(query(base, ...parts));
    appendSnap(snap);
  }catch(e){
    console.warn('[manage-uploads] index fallback:', e?.message||e);
    usingClientFallback = true;
    const snap = await getDocs(query(collection(db,'videos'), where('uid','==', curUser.uid)));
    const arr = snap.docs.map(d=>({ id:d.id, data:d.data(), _created:(d.data().createdAt?.toMillis?.()||0) }));
    arr.sort((a,b)=> b._created - a._created);
    cache = arr;
    cache.forEach(x => list.appendChild(rowEl(x.id, x.data)));
    hasMore = false; // 한 번에 다 가져왔으므로
  }finally{
    setStatus(cache.length ? `총 ${cache.length}개 불러옴` : '등록한 영상이 없습니다.');
    applyFilter();
  }
}

function appendSnap(snap){
  if(snap.empty){ hasMore=false; setStatus(cache.length ? `총 ${cache.length}개 불러옴` : '등록한 영상이 없습니다.'); return; }
  snap.docs.forEach(d => cache.push({ id:d.id, data:d.data() }));
  lastDoc = snap.docs[snap.docs.length-1] || lastDoc;
  if(snap.size < PAGE_SIZE) hasMore=false;
  applyFilter();
}

async function loadMore(){
  if(isLoading || !hasMore || usingClientFallback) return;
  isLoading = true;
  try{
    const base = collection(db,'videos');
    const parts = [ where('uid','==', curUser.uid), orderBy('createdAt','desc'), startAfter(lastDoc), limit(PAGE_SIZE) ];
    const snap = await getDocs(query(base, ...parts));
    appendSnap(snap);
  }catch(e){
    console.error(e);
    hasMore=false;
  }finally{
    isLoading=false;
  }
}

/* ---------- 카테고리 편집 (모달 스크롤 픽스 포함) ---------- */
const editBackdrop = document.getElementById('editBackdrop');
const editCatsBox  = document.getElementById('editCats');
const btnEditSave  = document.getElementById('btnEditSave');
const btnEditCancel= document.getElementById('btnEditCancel');

let editTargetId = null;

function applyGroupOrder(groups){
  let saved=null; try{ saved = JSON.parse(localStorage.getItem('groupOrderV1') || 'null'); }catch{}
  const order = Array.isArray(saved)&&saved.length ? saved : groups.map(g=>g.key);
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>(idx.get(a.key)??999)-(idx.get(b.key)??999));
}

function renderEditCats(selected){
  const groups = applyGroupOrder(CATEGORY_GROUPS)
    .filter(g => g.key!=='personal'); // 개인자료 제외(서버 저장 X)

  // DOM API로 안전 렌더
  editCatsBox.replaceChildren();
  for(const g of groups){
    const fs = makeEl('fieldset', { className:'group', style:{ border:'1px solid var(--border)', borderRadius:'10px', background:'#101010', padding:'8px', margin:'6px 0' }});
    const legend = makeEl('legend', { text:g.label, style:{ padding:'0 4px', fontWeight:'800', fontSize:'14px', color:'#eee' }});
    fs.appendChild(legend);

    const grid = makeEl('div', { style:{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'6px', marginTop:'6px' }});
    for(const c of g.children){
      const lab = makeEl('label', { style:{ display:'flex', gap:'6px', alignItems:'center', background:'#0b0b0b', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'6px 8px' }});
      const box = makeEl('input', { type:'checkbox', className:'cat' });
      box.value = c.value;
      box.checked = selected.includes(c.value);
      lab.appendChild(box);
      lab.appendChild(document.createTextNode(c.label));
      grid.appendChild(lab);
    }
    fs.appendChild(grid);
    editCatsBox.appendChild(fs);
  }

  // 최대 3개 제한
  const limit=3;
  const boxes = Array.from(editCatsBox.querySelectorAll('input.cat'));
  boxes.forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const count = boxes.filter(b=> b.checked).length;
      if(count > limit){
        chk.checked = false;
        alert(`카테고리는 최대 ${limit}개까지 선택 가능합니다.`);
      }
    });
  });
}

function openEdit(docId, curCats){
  editTargetId = docId;
  renderEditCats(curCats);
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
  editBackdrop.classList.add('show');
  editBackdrop.setAttribute('aria-hidden','false');
}
function closeEdit(){
  editBackdrop.classList.remove('show');
  editBackdrop.setAttribute('aria-hidden','true');
  document.documentElement.classList.remove('modal-open');
  document.body.classList.remove('modal-open');
  editTargetId = null;
}

btnEditCancel?.addEventListener('click', closeEdit);
editBackdrop?.addEventListener('click', (e)=>{ if(e.target===editBackdrop) closeEdit(); });
// 백드롭에서의 바깥 스크롤 차단(PC/모바일)
function preventBgScroll(e){ if(e.target===editBackdrop){ e.preventDefault(); } }
editBackdrop?.addEventListener('wheel', preventBgScroll, {passive:false});
editBackdrop?.addEventListener('touchmove', preventBgScroll, {passive:false});

btnEditSave?.addEventListener('click', async ()=>{
  if(!editTargetId) return;
  const sel = Array.from(editCatsBox.querySelectorAll('input.cat:checked')).map(b=>b.value);
  try{
    await updateDoc(doc(db,'videos', editTargetId), { categories: sel });
    // 캐시 갱신 + UI 갱신
    const item = cache.find(x => x.id === editTargetId);
    if(item){ item.data.categories = sel; }
    applyFilter();
    closeEdit();
  }catch(e){ alert('저장 실패: ' + (e.message||e)); }
});

/* ---------- 선택 삭제 ---------- */
btnDeleteSel?.addEventListener('click', async ()=>{
  const ids = Array.from(document.querySelectorAll('.row .selbox:checked'))
    .map(cb => cb.closest('.row')?.dataset.id).filter(Boolean);
  if(ids.length===0){ alert('선택된 항목이 없습니다.'); return; }
  if(!confirm(`선택한 ${ids.length}개 항목을 삭제할까요?`)) return;
  let ok=0, fail=0;
  for(const id of ids){
    try{ await deleteDoc(doc(db,'videos', id)); ok++; }catch{ fail++; }
  }
  // 캐시/화면 반영
  cache = cache.filter(x => !ids.includes(x.id));
  applyFilter();
  alert(`삭제 완료: 성공 ${ok}건, 실패 ${fail}건`);
});

/* ---------- 시작(로그인 유지 보강) ---------- */
let _authFirstHandled = false;
let _authFallbackTimer = null;

document.addEventListener('DOMContentLoaded', ()=>{
  setStatus('로그인 상태 확인 중...');
  _authFallbackTimer = setTimeout(()=>{
    try{
      if(!_authFirstHandled && auth.currentUser){
        _authFirstHandled = true;
        loadInit();
      }else if(!_authFirstHandled){
        if(msg){
          // 고정 문구라 innerHTML 사용 OK (유저 데이터 미포함)
          msg.innerHTML = `<span style="color:#ffb4b4;font-weight:700;">로그인이 필요합니다.</span>
            <a href="signin.html" class="btn" style="background:#4ea1ff; border:0; font-weight:800; margin-left:8px;">로그인하기</a>`;
        }
      }
    }catch(e){ console.error(e); }
  }, 1800);
});

onAuthStateChanged(auth, (user)=>{
  try{
    const loggedIn = !!user;
    signupLink?.classList.toggle('hidden', loggedIn);
    signinLink?.classList.toggle('hidden', loggedIn);
    welcome && (welcome.textContent = loggedIn ? `Hi! ${user?.displayName||'회원'}님` : '');

    if(_authFirstHandled) return;
    _authFirstHandled = true;
    clearTimeout(_authFallbackTimer);

    if (loggedIn) {
      loadInit();
    } else {
      if(msg){
        msg.innerHTML = `<span style="color:#ffb4b4;font-weight:700;">로그인이 필요합니다.</span> 
          <a href="signin.html" class="btn" style="background:#4ea1ff; border:0; font-weight:800; margin-left:8px;">로그인하기</a>`;
      }
    }
  }catch(e){
    console.error(e);
    setStatus('인증 처리 오류: '+(e.message||e));
  }
});
