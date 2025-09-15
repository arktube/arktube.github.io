// js/index.js — CATEGORY_MODEL 전용 + 개인자료 + 쇼츠/일반 필터 + 연속재생
import './firebase-init.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';

const PERSONAL_ENABLED = true;
const PERSONAL_SLOTS = [
  { key:'personal1', label:'자료1' },{ key:'personal2', label:'자료2' },
  { key:'personal3', label:'자료3' },{ key:'personal4', label:'자료4' },
  { key:'personal5', label:'자료5' },{ key:'personal6', label:'자료6' },
  { key:'personal7', label:'자료7' },{ key:'personal8', label:'자료8' },
];

const GROUP_ORDER_KEY = 'groupOrderV1';
const PERSONAL_LABELS_KEY = 'personalLabels';
const SELECTED_CATS_KEY = 'selectedCats';     // "ALL" | string[] | "personalX"
const AUTONEXT_KEY = 'autonext';              // '1' | '0'
const MEDIA_KEY = 'selectedMedia';            // 'both' | 'shorts' | 'video'

// ===== 상단바 =====
const $ = (s)=>document.querySelector(s);
const signupLink   = $("#signupLink");
const signinLink   = $("#signinLink");
const welcome      = $("#welcome");
const menuBtn      = $("#menuBtn");
const dropdown     = $("#dropdownMenu");
const btnSignOut   = $("#btnSignOut");
const btnGoUpload  = $("#btnGoUpload");
const btnMyUploads = $("#btnMyUploads");
const btnAbout     = $("#btnAbout");
const btnList      = $("#btnList");
const brandHome    = $("#brandHome");

function openDropdown(){ dropdown?.classList.remove("hidden"); requestAnimationFrame(()=> dropdown?.classList.add("show")); }
function closeDropdown(){ dropdown?.classList.remove("show"); setTimeout(()=> dropdown?.classList.add("hidden"),180); }

onAuthStateChanged(auth,(user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle("hidden", loggedIn);
  signinLink?.classList.toggle("hidden", loggedIn);
  welcome.textContent = loggedIn ? `Welcome! ${user.displayName || '회원'}` : "";
  closeDropdown();
});
menuBtn?.addEventListener("click",(e)=>{ e.stopPropagation(); dropdown.classList.contains("hidden") ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu, #menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener("click",(e)=> e.stopPropagation());
btnMyUploads ?.addEventListener("click", ()=>{ location.href = "manage-uploads.html"; closeDropdown(); });
btnGoUpload  ?.addEventListener("click", ()=>{ location.href = "upload.html"; closeDropdown(); });
btnAbout     ?.addEventListener("click", ()=>{ location.href = "about.html"; closeDropdown(); });
btnSignOut   ?.addEventListener("click", async ()=>{ await fbSignOut(); closeDropdown(); });
btnList      ?.addEventListener("click", ()=>{ persistSelectedCats(); location.href = "list.html"; closeDropdown(); });
brandHome    ?.addEventListener("click",(e)=>{ e.preventDefault(); window.scrollTo({top:0,behavior:"smooth"}); });

// ===== 연속재생 & 미디어(쇼츠/일반) 필터 =====
const cbAutoNext   = $('#cbAutoNext');
const cbShortsOnly = $('#cbShortsOnly');
const cbVideoOnly  = $('#cbVideoOnly');

function readAutonext(){ const v=(localStorage.getItem(AUTONEXT_KEY)||'').toLowerCase(); return v==='1'||v==='true'||v==='on'; }
function writeAutonext(on){ localStorage.setItem(AUTONEXT_KEY, on?'1':'0'); }

cbAutoNext.checked = readAutonext();
cbAutoNext.addEventListener('change', ()=> writeAutonext(cbAutoNext.checked));

// 미디어 필터: 상호배타 (둘 다 꺼짐=both)
function saveMedia(){ 
  const val = cbShortsOnly.checked ? 'shorts' : (cbVideoOnly.checked ? 'video' : 'both');
  localStorage.setItem(MEDIA_KEY, val);
}
function loadMedia(){
  const m = localStorage.getItem(MEDIA_KEY) || 'both';
  cbShortsOnly.checked = (m==='shorts');
  cbVideoOnly.checked  = (m==='video');
}
loadMedia();
cbShortsOnly.addEventListener('change', ()=>{ if(cbShortsOnly.checked) cbVideoOnly.checked=false; saveMedia(); });
cbVideoOnly .addEventListener('change', ()=>{ if(cbVideoOnly.checked)  cbShortsOnly.checked=false; saveMedia(); });

// ===== 카테고리 렌더 =====
const catsBox      = document.getElementById("cats");
const cbToggleAll  = document.getElementById("cbToggleAll");
const catTitleBtn  = document.getElementById("btnOpenOrder");

function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem(PERSONAL_LABELS_KEY)||'{}'); }catch{ return {}; } }
function setPersonalLabel(key,label){
  let s = String(label||'').trim().slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
  const map = getPersonalLabels(); map[key]=s; localStorage.setItem(PERSONAL_LABELS_KEY, JSON.stringify(map));
}
function applyGroupOrder(groups){
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(GROUP_ORDER_KEY)||'null'); }catch{}
  const order = Array.isArray(saved) && saved.length ? saved : groups.map(g=>g.key);
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>(idx.get(a.key)??999) - (idx.get(b.key)??999));
}

function renderGroups(){
  const frag = document.createDocumentFragment();

  // 개인자료 (옵션 ON)
  if (PERSONAL_ENABLED){
    const fs = document.createElement('fieldset'); fs.className='group'; fs.dataset.group='personal';
    const lg = document.createElement('legend'); lg.textContent = '개인자료'; const m = document.createElement('span'); m.className='muted'; m.textContent=' (로컬저장소 · 단독 재생)'; lg.appendChild(m);
    fs.appendChild(lg);

    const grid = document.createElement('div'); grid.className='child-grid'; fs.appendChild(grid);
    const labels = getPersonalLabels();

    PERSONAL_SLOTS.forEach(slot=>{
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type='checkbox'; input.className='cat'; input.value=slot.key;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + (labels[slot.key] || slot.label)));

      const btn = document.createElement('button'); btn.type='button'; btn.className='rename-btn'; btn.textContent='이름변경';
      btn.addEventListener('click', ()=>{
        const cur = labels[slot.key] || slot.label;
        const name = prompt('개인자료 이름(최대 12자):', cur);
        if(!name) return; setPersonalLabel(slot.key, name); renderGroups(); applySavedSelection();
      });
      label.appendChild(document.createTextNode(' ')); label.appendChild(btn);
      grid.appendChild(label);
    });

    const tip = document.createElement('div'); tip.className='muted'; tip.style.margin='6px 4px 2px'; tip.textContent='개인자료는 다른 카테고리와 함께 선택할 수 없습니다.';
    fs.appendChild(tip);
    frag.appendChild(fs);
  }

  // 공통 그룹(쇼츠/일반 동일) — 첫 super의 groups 사용 + 순서 적용
  const groups = applyGroupOrder(CATEGORY_MODEL[0]?.groups || []);
  groups.forEach(g=>{
    const fs = document.createElement('fieldset'); fs.className='group'; fs.dataset.group=g.key;
    const lg = document.createElement('legend'); lg.textContent = g.label; fs.appendChild(lg);
    const grid = document.createElement('div'); grid.className='child-grid'; fs.appendChild(grid);

    g.children.forEach(c=>{
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type='checkbox'; input.className='cat'; input.value=c.value;
      label.appendChild(input); label.appendChild(document.createTextNode(' ' + c.label));
      grid.appendChild(label);
    });

    frag.appendChild(fs);
  });

  catsBox.replaceChildren(frag);

  // 제약: 개인자료 단독, 일반 카테고리 3개까지
  catsBox.querySelectorAll('input.cat').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const v = chk.value;
      const isPersonal = PERSONAL_SLOTS.some(s=>s.key===v);

      if (isPersonal && chk.checked){
        catsBox.querySelectorAll('input.cat').forEach(x=>{ if(x!==chk) x.checked=false; });
        return;
      }
      if (!isPersonal && chk.checked && PERSONAL_ENABLED){
        catsBox.querySelectorAll('.group[data-group="personal"] input.cat:checked').forEach(x=> x.checked=false);
      }

      const normals = Array.from(catsBox.querySelectorAll('input.cat:checked'))
        .map(x=>x.value)
        .filter(val => !PERSONAL_SLOTS.some(s=>s.key===val));
      if (normals.length > 3){
        chk.checked = false;
        alert('카테고리는 최대 3개까지 선택 가능합니다.');
      }
      refreshAllParentStates();
      cbToggleAll.checked = computeAllSelected();
    });
  });
}
renderGroups();

// 전체선택(일반 카테고리만)
function computeAllSelected(){
  const real = Array.from(catsBox.querySelectorAll('.group:not([data-group="personal"]) input.cat'));
  if (!real.length) return false;
  return real.every(c=> c.checked);
}
function setParentStateByChildren(groupEl){
  // (부모 토글 버튼은 없지만, 전체선택/상태 계산을 위한 헬퍼)
}
function refreshAllParentStates(){ /* no-op (구조 단순화) */ }

function selectAll(on){
  catsBox.querySelectorAll('.group:not([data-group="personal"]) input.cat').forEach(b=> b.checked=!!on);
  catsBox.querySelectorAll('.group[data-group="personal"] input.cat:checked').forEach(c=> c.checked=false);
  cbToggleAll.checked = !!on;
}
cbToggleAll?.addEventListener('change', ()=> selectAll(cbToggleAll.checked));

// 저장/복원
function applySavedSelection(){
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{}
  if (!saved || saved==="ALL"){
    selectAll(true);
    return;
  }
  if (typeof saved === 'string' && saved.startsWith('personal')){
    // 개인자료 선택 복원
    selectAll(false);
    const el = catsBox.querySelector(`.group[data-group="personal"] input.cat[value="${saved}"]`);
    if (el) el.checked = true;
    return;
  }
  // 배열
  selectAll(false);
  const set = new Set(saved);
  catsBox.querySelectorAll('.cat').forEach(ch=>{ if (set.has(ch.value)) ch.checked=true; });
  cbToggleAll.checked = computeAllSelected();
}
applySavedSelection();

// 버튼: 영상보기
document.getElementById('btnWatch')?.addEventListener('click', ()=>{
  // 선택 모음
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(v => PERSONAL_SLOTS.some(s=>s.key===v));
  const normals   = selected.filter(v => !PERSONAL_SLOTS.some(s=>s.key===v));

  // 개인자료 단독
  if (personals.length===1 && normals.length===0){
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(personals[0]));
    location.href = `watch.html?personal=${encodeURIComponent(personals[0])}`;
    return;
  }
  if (personals.length>=1 && normals.length>=1){
    alert('개인자료는 다른 카테고리와 함께 선택할 수 없습니다.');
    return;
  }

  // 일반 카테고리
  const isAll = computeAllSelected();
  const toSave = (normals.length===0 || isAll) ? "ALL" : normals;
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(toSave));
  // 연속재생/미디어는 이미 각각 저장됨
  location.href = 'watch.html';
});

// 목록 가기 전에 선택 저장
function persistSelectedCats(){
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(v => PERSONAL_SLOTS.some(s=>s.key===v));
  const normals   = selected.filter(v => !PERSONAL_SLOTS.some(s=>s.key===v));
  if (personals.length===1 && normals.length===0){
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(personals[0]));
    return;
  }
  const isAll = computeAllSelected();
  const toSave = (normals.length===0 || isAll) ? "ALL" : normals;
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(toSave));
}
