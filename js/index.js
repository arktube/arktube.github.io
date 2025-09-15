// js/index.js (arktube v1 - SuperCategory: shorts/video)

// 필요한 모듈은 여기서 import (index.html은 이 파일만 로드)
import './firebase-init.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { CATEGORY_MODEL } from './categories.js';

/* ---------- 상단바 상태 ---------- */
const signupLink   = document.getElementById("signupLink");
const signinLink   = document.getElementById("signinLink");
const welcome      = document.getElementById("welcome");
const menuBtn      = document.getElementById("menuBtn");
const dropdown     = document.getElementById("dropdownMenu");
const btnSignOut   = document.getElementById("btnSignOut");
const btnGoUpload  = document.getElementById("btnGoUpload");
const btnMyUploads = document.getElementById("btnMyUploads");
const btnAbout     = document.getElementById("btnAbout");
const btnList      = document.getElementById("btnList");
const brandHome    = document.getElementById("brandHome");

let isMenuOpen=false;
function openDropdown(){ isMenuOpen=true; dropdown.classList.remove("hidden"); requestAnimationFrame(()=> dropdown.classList.add("show")); }
function closeDropdown(){ isMenuOpen=false; dropdown.classList.remove("show"); setTimeout(()=> dropdown.classList.add("hidden"),180); }

onAuthStateChanged((user)=>{
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
btnSignOut   ?.addEventListener("click", async ()=>{
  if(!auth.currentUser){ location.href='signin.html'; return; }
  await fbSignOut(auth); closeDropdown();
});
btnList      ?.addEventListener("click", ()=>{ location.href = "list.html"; closeDropdown(); });
brandHome    ?.addEventListener("click",(e)=>{ e.preventDefault(); window.scrollTo({top:0,behavior:"smooth"}); });

/* ---------- 연속재생(autonext) ---------- */
(function setupAutoNext(){
  const KEY = 'autonext';
  const $auto = document.getElementById('cbAutoNext');
  if (!$auto) return;

  const read = () => {
    const v = (localStorage.getItem(KEY) || '').toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  };
  const write = (on) => { localStorage.setItem(KEY, on ? '1' : '0'); };

  const hasSaved = localStorage.getItem(KEY) != null;
  if (hasSaved) $auto.checked = read(); else write($auto.checked);
  $auto.addEventListener('change', () => write($auto.checked));
  window.addEventListener('storage', (e)=>{ if (e.key === KEY) $auto.checked = read(); });
})();

/* ---------- 모델 렌더 ---------- */
const catsBox      = document.getElementById("cats");
const btnWatch     = document.getElementById("btnWatch");
const cbToggleAll  = document.getElementById("cbToggleAll");
const cbShortsOnly = document.getElementById("cbShortsOnly");
const cbVideoOnly  = document.getElementById("cbVideoOnly");
const catTitleBtn  = document.getElementById("btnOpenOrder");

function render(){
  const html = CATEGORY_MODEL.map(superSet=>{
    const groupsHTML = superSet.groups.map(g=>{
      const kids = g.children.map(c=>(
        `<label><input type="checkbox" class="cat" value="${c.value}" data-super="${superSet.superKey}"> ${c.label}</label>`
      )).join('');
      return `
        <fieldset class="group" data-super="${superSet.superKey}" data-group="${g.key}">
          <legend>
            <label class="group-toggle">
              <input type="checkbox" class="group-check" data-super="${superSet.superKey}" data-group="${g.key}">
              <span>${g.label}</span>
            </label>
          </legend>
          <div class="child-grid">${kids}</div>
        </fieldset>
      `;
    }).join('');
    return `
      <section class="super" data-super="${superSet.superKey}">
        <div class="super-title"><span>${superSet.superLabel}</span></div>
        ${groupsHTML}
      </section>
    `;
  }).join('');
  catsBox.innerHTML = html;
  bindGroupInteractions();
}
render();

/* ---------- parent/child sync ---------- */
function setParentStateByChildren(superKey, groupKey){
  const groupEl = catsBox.querySelector(`.group[data-super="${superKey}"][data-group="${groupKey}"]`);
  if (!groupEl) return;
  const parent = groupEl.querySelector('.group-check');
  const children = Array.from(groupEl.querySelectorAll('input.cat'));
  const total = children.length;
  const checked = children.filter(c=>c.checked).length;
  if (checked===0){ parent.checked=false; parent.indeterminate=false; }
  else if (checked===total){ parent.checked=true; parent.indeterminate=false; }
  else { parent.checked=false; parent.indeterminate=true; }
}
function setChildrenByParent(superKey, groupKey, on){
  const groupEl = catsBox.querySelector(`.group[data-super="${superKey}"][data-group="${groupKey}"]`);
  groupEl?.querySelectorAll('input.cat').forEach(c=> c.checked = !!on);
}
function refreshAllParents(){
  CATEGORY_MODEL.forEach(s=>{
    s.groups.forEach(g=> setParentStateByChildren(s.superKey, g.key));
  });
}

function bindGroupInteractions(){
  // parent
  catsBox.querySelectorAll('.group-check').forEach(parent=>{
    parent.addEventListener('change', ()=>{
      const superKey = parent.getAttribute('data-super');
      const groupKey = parent.getAttribute('data-group');
      setChildrenByParent(superKey, groupKey, parent.checked);
      setParentStateByChildren(superKey, groupKey);
      syncAllToggle();
    });
  });
  // child
  catsBox.querySelectorAll('input.cat').forEach(child=>{
    child.addEventListener('change', ()=>{
      const superKey = child.getAttribute('data-super');
      const groupEl = child.closest('.group');
      const groupKey = groupEl?.getAttribute('data-group');
      if (superKey && groupKey) setParentStateByChildren(superKey, groupKey);
      syncAllToggle();
    });
  });
}

/* ---------- 전체선택 ---------- */
function allChildren(){
  return Array.from(catsBox.querySelectorAll('input.cat'));
}
function computeAllSelected(){
  const kids = allChildren();
  return kids.length>0 && kids.every(c=> c.checked);
}
function selectAll(on){
  allChildren().forEach(c=> c.checked = !!on);
  refreshAllParents();
}
function syncAllToggle(){
  if (!cbToggleAll) return;
  cbToggleAll.checked = computeAllSelected();
}
cbToggleAll?.addEventListener('change', ()=>{ selectAll(!!cbToggleAll.checked); });

/* ---------- 쇼츠만 / 일반영상만: 재생 필터 ---------- */
function readSelectedMedia(){
  const s = cbShortsOnly?.checked;
  const v = cbVideoOnly?.checked;
  if (s && v) return 'both';   // 둘 다 켜면 both
  if (s) return 'shorts';
  if (v) return 'video';
  return 'both';               // 기본값
}
function persistSelectedForWatch(){
  // 선택된 세부카테고리
  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  localStorage.setItem('selectedCats', JSON.stringify(selected.length? selected : "ALL"));
  // 미디어(쇼츠/일반) 필터
  localStorage.setItem('selectedMedia', readSelectedMedia()); // 'both' | 'shorts' | 'video'
  // 연속재생
  const auto = document.getElementById('cbAutoNext')?.checked ? '1' : '0';
  localStorage.setItem('autonext', auto);
}

/* ---------- 초기 복원 ---------- */
(function restore(){
  // cats
  let savedCats=null;
  try{ savedCats = JSON.parse(localStorage.getItem('selectedCats')||'null'); }catch{}
  if (savedCats === "ALL" || !savedCats){
    selectAll(true);
  } else if (Array.isArray(savedCats)){
    selectAll(false);
    const set = new Set(savedCats);
    allChildren().forEach(ch=>{ if (set.has(ch.value)) ch.checked=true; });
    refreshAllParents();
  }
  // media
  const savedMedia = (localStorage.getItem('selectedMedia') || 'both');
  const cbS = document.getElementById('cbShortsOnly');
  const cbV = document.getElementById('cbVideoOnly');
  if (savedMedia === 'shorts'){ if(cbS) cbS.checked = true; if(cbV) cbV.checked = false; }
  else if (savedMedia === 'video'){ if(cbS) cbS.checked = false; if(cbV) cbV.checked = true; }
  else { if(cbS) cbS.checked = false; if(cbV) cbV.checked = false; } // both

  syncAllToggle();
})();

/* ---------- 이동 ---------- */
document.getElementById('btnWatch')?.addEventListener('click', ()=>{
  sessionStorage.removeItem('playQueue'); sessionStorage.removeItem('playIndex');
  persistSelectedForWatch();
  location.href = 'watch.html';
});

/* ---------- 간단 스와이프: 좌→우=list, 우→좌=upload ---------- */
(function simpleSwipe(){
  let sx=0, sy=0, t0=0, on=false;
  const THX=70, THY=80, TMAX=600;
  function pt(e){ return e.touches?.[0] || e.changedTouches?.[0] || e; }
  function start(e){ const p=pt(e); if(!p) return; sx=p.clientX; sy=p.clientY; t0=Date.now(); on=true; }
  function end(e){
    if(!on) return; on=false;
    const p=pt(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
    if(Math.abs(dy)>THY || dt>TMAX) return;
    if(dx>=THX){ location.href='list.html'; }
    else if(dx<=-THX){ location.href='upload.html'; }
  }
  document.addEventListener('touchstart', start, {passive:true});
  document.addEventListener('touchend',   end,   {passive:true});
  document.addEventListener('pointerdown',start, {passive:true});
  document.addEventListener('pointerup',  end,   {passive:true});
})();
