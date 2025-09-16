// js/index.js — CATEGORY_MODEL 기반 렌더 (개인자료=데이터 기준 4칸), 쇼츠/일반 필터, 연속재생, 로그인유지, 드롭다운
import './firebase-init.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';

// ===== 상수 (스토리지 키) =====
const GROUP_ORDER_KEY   = 'groupOrderV1';
const PERSONAL_LABELS_KEY = 'personalLabels';
const SELECTED_CATS_KEY = 'selectedCats';   // "ALL" | string[] | "personalX"
const AUTONEXT_KEY      = 'autonext';       // '1' | '0'
const MEDIA_KEY         = 'selectedMedia';  // 'both' | 'shorts' | 'video'

// ===== 상단바 / 로그인 유지 / 드롭다운 =====
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
brandHome    ?.addEventListener("click",(e)=>{ /* 홈으로 이동/스크롤 탑 */ });

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

function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem(PERSONAL_LABELS_KEY)||'{}'); }catch{ return {}; } }
function setPersonalLabel(key,label){
  let s = String(label||'').trim().slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
  const map = getPersonalLabels(); map[key]=s; localStorage.setItem(PERSONAL_LABELS_KEY, JSON.stringify(map));
}

/** 그룹 정렬: 저장된 순서(or 기본 순서)를 사용. key가 없으면 group명을 사용 */
function applyGroupOrder(groups){
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(GROUP_ORDER_KEY)||'null'); }catch{}
  const baseOrder = groups.map(g => g.key || g.group);
  const order = Array.isArray(saved) && saved.length ? saved : baseOrder;
  const idx = new Map(order.map((k,i)=>[k,i]));
  return groups.slice().sort((a,b)=>{
    const ak = a.key || a.group, bk = b.key || b.group;
    return (idx.get(ak)??999) - (idx.get(bk)??999);
  });
}

/** 개인자료 그룹을 데이터에서 찾아 반환 */
function findPersonalGroup(model){
  return (model.groups || []).find(g => (g.key || g.group) === '개인자료');
}

function renderGroups(){
  const frag = document.createDocumentFragment();
  const modelGroups = CATEGORY_MODEL.groups || [];
  const ordered = applyGroupOrder(modelGroups);

  const labelsMap = getPersonalLabels();
  const personalGroup = findPersonalGroup(CATEGORY_MODEL);
  const personalValues = new Set((personalGroup?.children||[]).map(c=>c.value));

  ordered.forEach(g=>{
    const fs = document.createElement('fieldset'); fs.className='group'; fs.dataset.group = (g.key || g.group);
    const lg = document.createElement('legend'); lg.textContent = g.group || g.key || ''; 
    // 개인자료면 서브 설명 추가
    if ((g.key||g.group) === '개인자료'){
      const m = document.createElement('span'); m.className='muted'; m.textContent=' (로컬저장소 · 단독 재생)'; lg.appendChild(m);
    }
    fs.appendChild(lg);

    const grid = document.createElement('div'); grid.className='child-grid'; fs.appendChild(grid);

    (g.children||[]).forEach(c=>{
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type='checkbox'; input.className='cat'; input.value=c.value;
      label.appendChild(input);
      const isPersonal = personalValues.has(c.value);
      const shownLabel = isPersonal ? (labelsMap[c.value] || c.label) : c.label;
      label.appendChild(document.createTextNode(' ' + shownLabel));

      // 개인자료인 경우: 이름변경 버튼 붙이기
      if (isPersonal){
        const btn = document.createElement('button'); btn.type='button'; btn.className='rename-btn'; btn.textContent='이름변경';
        btn.addEventListener('click', ()=>{
          const cur = labelsMap[c.value] || c.label;
          const name = prompt('개인자료 이름(최대 12자):', cur);
          if(!name) return; setPersonalLabel(c.value, name); renderGroups(); applySavedSelection();
        });
        label.appendChild(document.createTextNode(' '));
        label.appendChild(btn);
      }

      grid.appendChild(label);
    });

    // 개인자료 안내
    if ((g.key||g.group) === '개인자료'){
      const tip = document.createElement('div'); tip.className='muted'; tip.style.margin='6px 4px 2px';
      tip.textContent='개인자료는 다른 카테고리와 함께 선택할 수 없습니다.';
      fs.appendChild(tip);
    }

    frag.appendChild(fs);
  });

  catsBox.replaceChildren(frag);

  // 선택 제약: 개인자료 단독, 일반 카테고리 3개까지
  catsBox.querySelectorAll('input.cat').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const v = chk.value;
      const isPersonal = personalValues.has(v);

      if (isPersonal && chk.checked){
        // 개인자료 체크 시, 나머지 해제
        catsBox.querySelectorAll('input.cat').forEach(x=>{ if(x!==chk) x.checked=false; });
        cbToggleAll.checked = false;
        return;
      }
      if (!isPersonal && chk.checked){
        // 일반 체크 시, 개인자료 해제
        catsBox.querySelectorAll('.group[data-group="개인자료"] input.cat:checked').forEach(x=> x.checked=false);
      }

      const normals = Array.from(catsBox.querySelectorAll('input.cat:checked'))
        .filter(x => !personalValues.has(x.value));
      if (normals.length > 3){
        chk.checked = false;
        alert('카테고리는 최대 3개까지 선택 가능합니다.');
      }
      cbToggleAll.checked = computeAllSelected(personalValues);
    });
  });
}
renderGroups();

// 전체선택(일반 카테고리만)
function computeAllSelected(personalValues){
  const real = Array.from(catsBox.querySelectorAll('input.cat'))
    .filter(i => !personalValues.has(i.value));
  if (!real.length) return false;
  return real.every(c=> c.checked);
}
function selectAll(on){
  // 일반만 토글
  const personalValues = new Set((findPersonalGroup(CATEGORY_MODEL)?.children||[]).map(c=>c.value));
  catsBox.querySelectorAll('input.cat').forEach(b=>{
    if (personalValues.has(b.value)) { b.checked = false; return; }
    b.checked = !!on;
  });
  cbToggleAll.checked = !!on;
}
const cbToggleAll = document.getElementById("cbToggleAll");
cbToggleAll?.addEventListener('change', ()=> selectAll(cbToggleAll.checked));

// 저장/복원
function applySavedSelection(){
  const personalValues = new Set((findPersonalGroup(CATEGORY_MODEL)?.children||[]).map(c=>c.value));
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(SELECTED_CATS_KEY)||'null'); }catch{}

  if (!saved || saved==="ALL"){
    selectAll(true);
    return;
  }
  if (typeof saved === 'string' && personalValues.has(saved)){
    selectAll(false);
    const el = catsBox.querySelector(`.group[data-group="개인자료"] input.cat[value="${saved}"]`);
    if (el) el.checked = true;
    return;
  }
  // 배열
  selectAll(false);
  const set = new Set(saved);
  catsBox.querySelectorAll('.cat').forEach(ch=>{ if (set.has(ch.value)) ch.checked=true; });
  const allOn = computeAllSelected(personalValues);
  cbToggleAll.checked = allOn;
}
applySavedSelection();

// 버튼: 영상보기
document.getElementById('btnWatch')?.addEventListener('click', ()=>{
  const personalValues = new Set((findPersonalGroup(CATEGORY_MODEL)?.children||[]).map(c=>c.value));
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(v => personalValues.has(v));
  const normals   = selected.filter(v => !personalValues.has(v));

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
  const isAll = computeAllSelected(personalValues);
  const toSave = (normals.length===0 || isAll) ? "ALL" : normals;
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(toSave));
  location.href = 'watch.html';
});

// 목록 이동 전 선택 저장
function persistSelectedCats(){
  const personalValues = new Set((findPersonalGroup(CATEGORY_MODEL)?.children||[]).map(c=>c.value));
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  const personals = selected.filter(v => personalValues.has(v));
  const normals   = selected.filter(v => !personalValues.has(v));
  if (personals.length===1 && normals.length===0){
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(personals[0]));
    return;
  }
  const isAll = computeAllSelected(personalValues);
  const toSave = (normals.length===0 || isAll) ? "ALL" : normals;
  localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(toSave));
}
