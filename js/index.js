// /js/index.js — ArkTube Index (makelist 연계 + 플로팅 도움말 + 스와이프)
// 키 규칙: selectedCats / view:type / aut o n e x t
import * as Makelist from './makelist.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';
import { auth } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { initHeader } from './admin-common.js';
try { initHeader?.({ greeting: 'Welcome!' }); } catch {}

const SELECTED_CATS_KEY = 'selectedCats';
const VIEW_TYPE_KEY     = 'view:type';  // ← arktube: 접두사 제거
const AUTONEXT_KEY      = 'autonext';

const catsBox      = document.getElementById('cats');
const cbToggleAll  = document.getElementById('cbToggleAll');
const btnWatch     = document.getElementById('btnWatch');
const btnOpenOrder = document.getElementById('btnOpenOrder');
const cbAutoNext   = document.getElementById('cbAutoNext');
const typeWrap     = document.getElementById('typeToggle');

// 드롭다운 항목
const btnList      = document.getElementById('btnList');
const btnDropdown  = document.getElementById('btnDropdown');
const dropdown     = document.getElementById('dropdownMenu');
const btnGoUpload  = document.getElementById('btnGoUpload');
const brandHome    = document.getElementById('brandHome');

// 도움말
const helpBtn = document.getElementById('btnHelp');
const helpOverlay = document.getElementById('helpOverlay');

const isSeriesGroupKey = (k)=> typeof k==='string' && k.startsWith('series_');
const isPersonalVal    = (v)=> v && String(v).startsWith('personal');
const isSeriesVal      = (v)=> v && String(v).startsWith('series_');

// ===== Dropdown v1.5 토글 =====
(function initDropdown(){
  if (!btnDropdown || !dropdown) return;
  let open=false;
  function setOpen(x){
    open=!!x;
    btnDropdown.setAttribute('aria-expanded', open?'true':'false');
    dropdown.setAttribute('aria-hidden', open?'false':'true');
    if (open){
      dropdown.classList.remove('hidden'); requestAnimationFrame(()=> dropdown.classList.add('open'));
    } else {
      dropdown.classList.remove('open'); setTimeout(()=> dropdown.classList.add('hidden'), 150);
    }
  }
  btnDropdown.addEventListener('click', (e)=>{ e.preventDefault(); setOpen(!open); });
  document.addEventListener('pointerdown', (e)=>{ if (!open) return; if (!e.target.closest('#dropdownMenu,#btnDropdown')) setOpen(false); }, true);
  document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') setOpen(false); });
  dropdown.addEventListener('click', (e)=>{ if (e.target.closest('button,[role="menuitem"],a')) setOpen(false); });
})();

// ===== 도움말 플로팅 =====
helpBtn?.addEventListener('click', ()=>{
  helpOverlay?.classList.add('show');
  helpOverlay?.setAttribute('aria-hidden','false');
});
helpOverlay?.addEventListener('click',(e)=>{
  if (e.target === helpOverlay){
    helpOverlay.classList.remove('show');
    helpOverlay.setAttribute('aria-hidden','true');
  }
});
document.addEventListener('keydown',(e)=>{
  if (e.key==='Escape' && helpOverlay?.classList.contains('show')){
    helpOverlay.classList.remove('show');
    helpOverlay.setAttribute('aria-hidden','true');
  }
});

// ===== 카테고리 모델(FALLBACK) =====
function buildGroups(){
  if (Array.isArray(CATEGORY_MODEL)) {
    // New schema: [{label, key, children:[{label,value}]}]
    return CATEGORY_MODEL.map(g=>({
      key: g.key || g.label || '',
      label: g.label || g.key || '',
      isSeries: isSeriesGroupKey(g.key || ''),
      isPersonal: (g.key==='personal'),
      children: (g.children||[]).map(c=>({ value:c.value, label:c.label }))
    }));
  }
  // Fallback to CATEGORY_GROUPS
  const groups = Array.isArray(CATEGORY_GROUPS)? CATEGORY_GROUPS : (CATEGORY_MODEL?.groups||[]);
  return groups.map(g=>({
    key: g.key,
    label: g.label,
    isSeries: g.isSeries===true || isSeriesGroupKey(g.key||''),
    isPersonal: g.personal===true || (g.key==='personal'),
    children: (g.children||[]).map(c=>({ value:c.value, label:c.label }))
  }));
}
const GROUPS = buildGroups();

// 개인자료 라벨(12자) — 업로드 v15와 동일 규칙
function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem('personalLabels')||'{}'); }catch{ return {}; } }
function personalLabel(key){
  const m=getPersonalLabels(); if (m[key]) return m[key];
  const n=(key.match(/^personal(\d)$/)||[])[1]; return n ? `자료${n}` : key;
}

// ===== 렌더 =====
function renderCategories(){
  if(!catsBox) return;
  const labels = getPersonalLabels();
  const frag = document.createDocumentFragment();

  GROUPS.forEach(g=>{
    const fs = document.createElement('fieldset');
    fs.className='group'; fs.dataset.key=g.key;

    const legend = document.createElement('legend');
    if (g.isPersonal) {
      legend.innerHTML = `<span style="font-weight:800;">${g.label}</span> <span class="subnote">(로컬저장소)</span>`;
    } else {
      const togg = document.createElement('label');
      togg.className='group-toggle';
      const chk = document.createElement('input'); chk.type='checkbox'; chk.className='group-check'; chk.dataset.group=g.key;
      togg.appendChild(chk); togg.appendChild(document.createTextNode(g.label));
      legend.appendChild(togg);
    }
    fs.appendChild(legend);

    const grid=document.createElement('div'); grid.className='child-grid'; fs.appendChild(grid);
    g.children.forEach(c=>{
      const lab = document.createElement('label');
      const inp = document.createElement('input'); inp.type='checkbox'; inp.className='cat'; inp.value=c.value;
      const span= document.createElement('span');
      span.textContent=' '+ (g.isPersonal ? (labels[c.value] || personalLabel(c.value)) : (c.label||c.value));
      lab.appendChild(inp); lab.appendChild(span);

      // 시리즈: 이어보기 미니버튼
      if (g.isSeries){
        const rb = document.createElement('button');
        rb.type='button'; rb.className='resume-mini'; rb.textContent='이어보기';
        rb.title='이 시리즈 이어보기';
        rb.addEventListener('click', async (e)=>{
          e.stopPropagation();
          await Makelist.makeForWatchFromIndex({ cats:[c.value], type: currentViewType() });
          location.href = '/watch.html?from=index';
        });
        lab.appendChild(rb);
      }

      grid.appendChild(lab);
    });

    if (g.isPersonal){
      const note=document.createElement('div'); note.className='muted';
      note.textContent='개인자료는 단독 선택/재생만 가능합니다.';
      fs.appendChild(note);
    }

    frag.appendChild(fs);
  });

  catsBox.replaceChildren(frag);
  bindGroupInteractions();
  applySavedSelectionToUI();
  syncParents();
}
renderCategories();

// ===== 선택/부모-자식 동기화 =====
function syncParents(){
  catsBox.querySelectorAll('.group').forEach(g=>{
    const parent=g.querySelector('.group-check'); if (!parent) return;
    const children=[...g.querySelectorAll('input.cat')];
    const total=children.length; const checked=children.filter(c=>c.checked).length;
    if (checked===0){ parent.checked=false; parent.indeterminate=false; }
    else if (checked===total){ parent.checked=true; parent.indeterminate=false; }
    else { parent.checked=false; parent.indeterminate=true; }
  });
  if (cbToggleAll) cbToggleAll.checked = computeAllSelected();
}
function computeAllSelected(){
  // 전체선택은 personal/series 그룹 제외
  const normals=[...catsBox.querySelectorAll('.group:not([data-key="personal"])')]
    .filter(g=> !isSeriesGroupKey(g.dataset.key));
  if (!normals.length) return false;
  return normals.every(g=> [...g.querySelectorAll('input.cat')].every(i=>i.checked));
}
function bindGroupInteractions(){
  // 부모 토글
  catsBox.querySelectorAll('.group-check').forEach(parent=>{
    parent.addEventListener('change', ()=>{
      const groupEl = parent.closest('.group');
      groupEl.querySelectorAll('input.cat').forEach(c=> c.checked = parent.checked);
      // personal 단독성: personal이 켜져 있으면 다른건 끄기
      if (groupEl.dataset.key!=='personal'){
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
      }
      syncParents();
      persistSelectionFromUI();
    });
  });
  // 자식 토글
  catsBox.querySelectorAll('input.cat').forEach(child=>{
    child.addEventListener('change', ()=>{
      const v=child.value; const groupEl = child.closest('.group');
      // personal 단독성
      if (isPersonalVal(v) && child.checked){
        catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked').forEach(c=> c.checked=false);
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat').forEach(c=>{ if(c!==child) c.checked=false; });
      }
      if (!isPersonalVal(v) && child.checked){
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(c=> c.checked=false);
      }
      // 부모 상태
      const parent=groupEl.querySelector('.group-check'); if (parent) {
        const kids=[...groupEl.querySelectorAll('input.cat')];
        const total=kids.length; const checked=kids.filter(c=>c.checked).length;
        if (checked===0){ parent.checked=false; parent.indeterminate=false; }
        else if (checked===total){ parent.checked=true; parent.indeterminate=false; }
        else { parent.checked=false; parent.indeterminate=true; }
      }
      syncParents();
      persistSelectionFromUI();
    });
  });
}

// ===== 전체선택 =====
cbToggleAll?.addEventListener('change', ()=>{
  const on=cbToggleAll.checked;
  // personal/series 제외
  catsBox.querySelectorAll('.group').forEach(g=>{
    const key=g.dataset.key||'';
    if (key==='personal' || isSeriesGroupKey(key)) {
      g.querySelectorAll('input.cat').forEach(c=> c.checked=false);
    } else {
      g.querySelectorAll('input.cat').forEach(c=> c.checked=on);
    }
  });
  syncParents();
  persistSelectionFromUI();
});

// ===== 형식/연속재생 =====
function currentViewType(){
  const r = typeWrap?.querySelector('input[name="vtype"]:checked');
  return r?.value || 'both';
}
(function initTypeAndAutonext(){
  // view:type (기본 both)
  const savedType = localStorage.getItem(VIEW_TYPE_KEY) || 'both';
  const radio = typeWrap?.querySelector(`input[value="${savedType}"]`) || typeWrap?.querySelector('#type_both');
  if (radio) radio.checked = true;
  typeWrap?.addEventListener('change', ()=>{
    const v = currentViewType();
    localStorage.setItem(VIEW_TYPE_KEY, v);
  });

  // 연속재생
  const savedAuto = localStorage.getItem(AUTONEXT_KEY);
  cbAutoNext.checked = (savedAuto==='1' || savedAuto==='true' || savedAuto==='on');
  cbAutoNext.addEventListener('change', ()=>{
    localStorage.setItem(AUTONEXT_KEY, cbAutoNext.checked ? '1':'0');
  });
})();

// ===== 선택 상태 저장/복원 =====
function persistSelectionFromUI(){
  const chosen = [...catsBox.querySelectorAll('input.cat:checked')].map(c=>c.value);
  const normals = chosen.filter(v=> !isPersonalVal(v));
  const personals = chosen.filter(isPersonalVal);

  if (personals.length===1 && normals.length===0) {
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(personals));
  } else if (normals.length===0) {
    localStorage.setItem(SELECTED_CATS_KEY, 'ALL');
  } else {
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(normals));
  }
}
function applySavedSelectionToUI(){
  let raw = localStorage.getItem(SELECTED_CATS_KEY);
  if (!raw || raw==='ALL'){
    // 일반만 전체선택
    catsBox.querySelectorAll('.group').forEach(g=>{
      const key=g.dataset.key||'';
      const check = !(key==='personal' || isSeriesGroupKey(key));
      g.querySelectorAll('input.cat').forEach(c=> c.checked = check);
    });
  } else {
    try {
      const set = new Set(JSON.parse(raw));
      catsBox.querySelectorAll('input.cat').forEach(c=> c.checked = set.has(c.value));
      // personal 단독성 정리
      const personals=[...catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked')];
      const normals=[...catsBox.querySelectorAll('.group:not([data-key="personal"]) input.cat:checked')];
      if (personals.length && normals.length) personals.forEach(c=> c.checked=false);
      if (personals.length>1) personals.slice(1).forEach(c=> c.checked=false);
    } catch {
      // 복원 실패면 ALL
      localStorage.setItem(SELECTED_CATS_KEY, 'ALL');
      applySavedSelectionToUI();
      return;
    }
  }
  syncParents();
}

// ===== 이동: 영상보기 / 목록 =====
btnWatch?.addEventListener('click', async ()=>{
  const type = currentViewType();
  const selected = [...catsBox.querySelectorAll('input.cat:checked')].map(c=>c.value);
  const personals = selected.filter(isPersonalVal);
  const normals   = selected.filter(v=>!isPersonalVal(v));

  // 저장
  localStorage.setItem(VIEW_TYPE_KEY, type);
  localStorage.setItem(AUTONEXT_KEY, cbAutoNext.checked?'1':'0');
  if (personals.length===1 && normals.length===0) {
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(personals));
    await Makelist.makeForWatchFromIndex({ cats: personals, type });
  } else {
    const isAll = computeAllSelected();
    const cats = (normals.length===0 || isAll) ? 'ALL' : normals;
    localStorage.setItem(SELECTED_CATS_KEY, JSON.stringify(cats));
    await Makelist.makeForWatchFromIndex({ cats, type });
  }
  location.href = '/watch.html?from=index';
});

btnList?.addEventListener('click', async ()=>{
  const type = currentViewType();
  const raw = localStorage.getItem(SELECTED_CATS_KEY) || 'ALL';
  const cats = (raw==='ALL') ? 'ALL' : JSON.parse(raw);
  await Makelist.makeForListFromIndex({ cats, type });
  location.href = '/list.html';
});

btnOpenOrder?.addEventListener('click', ()=> location.href='/category-order.html');
btnGoUpload?.addEventListener('click', ()=> location.href='/upload.html');
brandHome?.addEventListener('click', ()=> location.href='/index.html');

// ===== 스와이프: 좌→우 = list (데드존 18%) =====
(function initSwipeToList({ goRightHref='/list.html', deadZoneCenterRatio=0.18 }={}){
  let sx=0, sy=0, t0=0, tracking=false;
  const TH=70, MAX_OFF_Y=90, MAX_T=700;
  const point=(e)=> e.touches?.[0] || e.changedTouches?.[0] || e;

  function inDead(x){
    const vw=Math.max(document.documentElement.clientWidth, window.innerWidth||0);
    const L=vw*(0.5-deadZoneCenterRatio/2), R=vw*(0.5+deadZoneCenterRatio/2);
    return x>=L && x<=R;
  }
  function onStart(e){
    const p=point(e); if(!p) return;
    if (inDead(p.clientX)) return;
    sx=p.clientX; sy=p.clientY; t0=Date.now(); tracking=true;
  }
  async function onEnd(e){
    if(!tracking) return; tracking=false;
    const p=point(e); const dx=p.clientX-sx, dy=p.clientY-sy, dt=Date.now()-t0;
    if(Math.abs(dy)>MAX_OFF_Y || dt>MAX_T) return;
    if(dx>=TH && goRightHref){
      // list 진입 전 상태 전달
      const type = currentViewType();
      const raw = localStorage.getItem(SELECTED_CATS_KEY) || 'ALL';
      const cats = (raw==='ALL') ? 'ALL' : JSON.parse(raw);
      await Makelist.makeForListFromIndex({ cats, type });
      document.documentElement.classList.add('slide-out-right');
      setTimeout(()=> location.href=goRightHref, 200);
    }
  }
  document.addEventListener('touchstart', onStart, {passive:true});
  document.addEventListener('touchend',   onEnd,   {passive:true});
  document.addEventListener('pointerdown', onStart, {passive:true});
  document.addEventListener('pointerup',   onEnd,   {passive:true});
})();
