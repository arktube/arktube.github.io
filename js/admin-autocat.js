// admin-autocat.js — 서버 집계 토큰 관리(클라만으로 동작). 관리자 접근은 TODO 자리 한 줄로 전환 가능.
import { autoSelectForText } from './autocat.js';
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';

// ====== 설정 ======
const COLL_AGG = 'autocat_agg';
const PAGE_SIZE = 200; // 한 번에 읽는 문서 수
const ENABLE_DELETE_FIELD = false; // deleteField 미노출 환경용. true면 FieldValue.delete 사용.

// ====== Firestore 핸들 ======
function fs(){ return window.__FS || null; }

// ====== 접근 제어 (지금은 모두 허용 / 나중에 한 줄만 바꿔 잠금) ======
async function canAccess(){
  // TODO: 관리자 등록 후 아래 라인을 원하는 체크로 교체
  // 예시) return await isAdminUser();
  return true;
}

// (예시) admins 컬렉션 uid 체크 — 관리자 등록 후 사용
async function isAdminUser(){
  try{
    const user = window?.auth?.currentUser || null;
    if(!user) return false;
    const { db, doc, getDoc } = fs();
    const adminRef = doc(db, 'admins', user.uid);
    const snap = await getDoc(adminRef);
    return snap?.exists?.() || (snap && typeof snap.data === 'function' && snap.data());
  }catch{ return false; }
}

// ====== 상태 ======
let _cursorLast = null;     // 페이지네이션 커서
let _items = [];            // 현재 로드한 전체 문서(클라 메모리)
let _catValues = new Set(); // 유효 카테고리 value
let _sortKey = 'token_asc';

// ====== 초기 ======
init().catch(err=> console.error(err));

async function init(){
  // 카테고리 value 목록
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  groups.forEach(g => (g.children||[]).forEach(c => _catValues.add(String(c.value || '').trim())));

  // 접근 체크
  const ok = await canAccess();
  document.getElementById('accessState').textContent = ok ? '허용됨(현재)' : '거부됨';
  if(!ok){
    alert('접근 권한이 없습니다.');
    return;
  }

  bindUI();
  await loadMore(); // 첫 페이지 로드
}

// ====== UI 바인딩 ======
function bindUI(){
  const $q = document.getElementById('q');
  const $sort = document.getElementById('sort');

  document.getElementById('refreshBtn').addEventListener('click', async ()=>{
    _cursorLast = null; _items = [];
    await loadMore(true);
  });

  document.getElementById('loadMoreBtn').addEventListener('click', async ()=>{
    await loadMore();
  });

  $q.addEventListener('input', renderList);
  $sort.addEventListener('change', ()=>{
    _sortKey = $sort.value;
    renderList();
  });

  document.getElementById('exportBtn').addEventListener('click', onExport);
  document.getElementById('importFile').addEventListener('change', onImport);
  document.getElementById('resetBtn').addEventListener('click', onResetAll);

  document.getElementById('simRunBtn').addEventListener('click', runSim);
}

// ====== 로딩 / 페이지네이션 ======
async function loadMore(resetStats=false){
  const handler = fs();
  if(!handler){ alert('Firestore 핸들 없음'); return; }
  const { db, doc, getDoc, setDoc, runTransaction } = handler;
  const { getDocs, query, collection, limit, orderBy, startAfter } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');

  let q = query(collection(db, COLL_AGG), orderBy('__name__'), limit(PAGE_SIZE));
  if(_cursorLast) q = query(collection(db, COLL_AGG), orderBy('__name__'), startAfter(_cursorLast), limit(PAGE_SIZE));
  const snap = await getDocs(q);
  const docs = [];
  snap.forEach(d=>{
    const data = d.data();
    docs.push({ id: d.id, data });
  });
  _items = _items.concat(docs);
  _cursorLast = snap.docs.length ? snap.docs[snap.docs.length-1] : _cursorLast;

  renderList();
  if(resetStats) showStats();
}

// ====== 리스트 렌더 ======
function renderList(){
  const $list = document.getElementById('list');
  const $q = document.getElementById('q');
  const term = ($q.value||'').toLowerCase().trim();

  // 필터
  let rows = _items.filter(it=>{
    if(!term) return true;
    if(it.id.includes(term)) return true;
    const cats = it.data?.cats || {};
    for(const k in cats){
      if(k.includes(term)) return true;
      if(String(cats[k]?.score ?? '').includes(term)) return true;
    }
    return false;
  });

  // 정렬
  rows = rows.sort((a,b)=>{
    if(_sortKey==='token_asc') return a.id.localeCompare(b.id);
    if(_sortKey==='token_desc') return b.id.localeCompare(a.id);
    const sa = sumScore(a.data?.cats); const sb = sumScore(b.data?.cats);
    if(_sortKey==='score_desc') return sb - sa;
    if(_sortKey==='score_asc') return sa - sb;
    return 0;
  });

  // 렌더
  const frag = document.createDocumentFragment();
  rows.forEach(it=>{
    const el = renderRow(it);
    frag.appendChild(el);
  });
  $list.innerHTML = '';
  $list.appendChild(frag);

  showStats();
}

function sumScore(cats){
  if(!cats) return 0;
  let s=0;
  Object.values(cats).forEach(v=>{
    const n = Number(v?.score||0);
    if(!Number.isNaN(n)) s+=n;
  });
  return s;
}

function renderRow(item){
  const wrap = document.createElement('div');
  wrap.className = 'card';

  const cats = item.data?.cats || {};
  const kv = Object.entries(cats)
    .filter(([cat,val])=> val && typeof val==='object') // null/잘못된 값 무시
    .map(([cat,val])=> ({ cat, votes:Number(val.votes||0), score:Number(val.score||0) }));

  wrap.innerHTML = `
    <h3><span class="mono">${escapeHtml(item.id)}</span></h3>
    <table>
      <thead><tr><th style="width:40%">카테고리(value)</th><th>votes</th><th>score(0~2)</th><th class="right">작업</th></tr></thead>
      <tbody>${kv.length ? kv.map(rowTpl).join('') : `<tr><td class="muted" colspan="4">매핑 없음</td></tr>`}</tbody>
    </table>
    <div class="footer">
      <div class="muted">총 매핑 ${kv.length}개 · 가산치 합 ${kv.reduce((a,b)=>a+Number(b.score||0),0)}</div>
      <div class="row-actions">
        <button class="btn" data-act="add" data-token="${escapeHtml(item.id)}">매핑 추가</button>
        <button class="btn danger" data-act="delete-token" data-token="${escapeHtml(item.id)}">토큰 삭제</button>
      </div>
    </div>
  `;

  // 이벤트 바인딩
  wrap.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', onRowAction);
  });

  return wrap;
}

function rowTpl(r){
  const id = `${r.cat}`;
  return `
    <tr data-cat="${escapeHtml(r.cat)}">
      <td><span class="mono">${escapeHtml(r.cat)}</span></td>
      <td><input type="number" class="votes" value="${Number(r.votes||0)}" min="0" step="1" style="width:80px"/></td>
      <td><input type="number" class="score" value="${Number(r.score||0)}" min="0" max="2" step="1" style="width:80px"/></td>
      <td class="right">
        <button class="btn" data-act="save-cat" data-token-parent>저장</button>
        <button class="btn" data-act="remove-cat" data-token-parent>삭제</button>
      </td>
    </tr>
  `;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

// ====== 행 작업 ======
async function onRowAction(e){
  const act = e.currentTarget.getAttribute('data-act');
  const token = e.currentTarget.getAttribute('data-token') ||
                e.currentTarget.closest('.card')?.querySelector('h3 .mono')?.textContent;

  if(act==='delete-token'){
    if(!confirm(`토큰 "${token}" 을(를) 완전히 삭제할까요?`)) return;
    await writeToken(token, null); // 전체 삭제
    await reloadAfterWrite();
    return;
  }

  if(act==='add'){
    const cat = prompt('추가할 카테고리 value를 입력(예: game_minecraft)');
    if(!cat) return;
    if(!_catValues.has(cat)){ alert('유효한 카테고리 value가 아닙니다.'); return; }
    await writeToken(token, { [cat]: { votes:1, score:1 } }, true);
    await reloadAfterWrite();
    return;
  }

  if(act==='save-cat' || act==='remove-cat'){
    const tr = e.currentTarget.closest('tr');
    const cat = tr.getAttribute('data-cat');
    if(act==='remove-cat'){
      if(!confirm(`카테고리 "${cat}" 매핑을 삭제할까요?`)) return;
      await removeCatMapping(token, cat);
      await reloadAfterWrite();
      return;
    }
    // save
    const v = Number(tr.querySelector('.votes').value||0);
    const s = clamp(Number(tr.querySelector('.score').value||0), 0, 2);
    // votes→score 일관 규칙(계단식) 유지 권장
    const score = v>=3 ? 2 : (v>0 ? 1 : 0);
    await writeToken(token, { [cat]: { votes:v, score } }, true);
    await reloadAfterWrite();
  }
}

function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

async function removeCatMapping(token, cat){
  const { db, doc, getDoc, setDoc, runTransaction } = fs();
  if(ENABLE_DELETE_FIELD){
    const { deleteField } = await import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js');
    const ref = doc(db, COLL_AGG, token);
    await setDoc(ref, { cats: { [cat]: deleteField() } }, { merge:true });
    return;
  }
  // deleteField 미사용: 문서 전체 cats를 읽어 cat 키만 제거 후 overwrite
  await runTransaction(db, async (tx)=>{
    const ref = doc(db, COLL_AGG, token);
    const snap = await tx.get(ref);
    if(!snap.exists()) return;
    const data = snap.data() || {};
    const cats = data.cats || {};
    delete cats[cat];
    tx.set(ref, { cats, updatedAt: window.__FS.serverTimestamp() }, { merge:true });
  });
}

async function writeToken(token, catsPatchOrNull, merge=false){
  const { db, doc, setDoc } = fs();
  const ref = doc(db, COLL_AGG, token);
  if(catsPatchOrNull===null){
    // 전체 삭제
    await setDoc(ref, {}, { merge:false }); // 빈 문서로 덮어쓰면 에러. 그래서 다음 줄로 실제 삭제를 대체:
    // delete 전체를 원하면 rules/함수 필요. 여기서는 cats를 빈 객체로 덮습니다.
    await setDoc(ref, { cats: {}, updatedAt: window.__FS.serverTimestamp() }, { merge:false });
    return;
  }
  // merge면 cats map만 병합
  await setDoc(ref, { cats: catsPatchOrNull, updatedAt: window.__FS.serverTimestamp() }, { merge });
}

async function reloadAfterWrite(){
  _cursorLast = null; _items = [];
  await loadMore(true);
}

// ====== 통계 ======
function showStats(){
  const totalDocs = _items.length;
  let totalMappings = 0;
  let totalScore = 0;
  _items.forEach(it=>{
    const cats = it.data?.cats || {};
    Object.values(cats).forEach(v=>{
      if(v && typeof v==='object'){
        totalMappings += 1;
        totalScore += Number(v.score||0);
      }
    });
  });
  document.getElementById('stats').textContent = `문서 ${totalDocs}개 · 매핑 ${totalMappings}개 · 가산치 합 ${totalScore}`;
}

// ====== Export / Import / Reset ======
async function onExport(){
  const payload = {};
  _items.forEach(it => { payload[it.id] = it.data?.cats || {}; });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `autocat_agg_backup_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function onImport(e){
  const file = e.target.files?.[0];
  if(!file) return;
  const text = await file.text();
  let json=null;
  try{ json = JSON.parse(text); }catch{ alert('JSON 파싱 실패'); return; }

  if(!confirm('가져온 JSON을 병합 적용할까요? (확인=병합, 취소=중단)')){ e.target.value=''; return; }

  const { db, doc, setDoc } = fs();
  const keys = Object.keys(json);
  for(const token of keys){
    const cats = json[token];
    if(typeof cats!=='object'){ continue; }
    // votes->score 일관 유지
    const patch = {};
    Object.keys(cats).forEach(cat=>{
      const v = Number(cats[cat]?.votes||0);
      const s = v>=3 ? 2 : (v>0 ? 1 : 0);
      patch[cat] = { votes:v, score:s };
    });
    await setDoc(doc(db, COLL_AGG, token), { cats: patch, updatedAt: window.__FS.serverTimestamp() }, { merge:true });
  }
  alert('병합 완료');
  e.target.value='';
  await reloadAfterWrite();
}

async function onResetAll(){
  if(!confirm('정말 전체 초기화할까요? 이 작업은 되돌릴 수 없습니다. (Export로 백업 권장)')) return;
  // 안전하게: 현재 로드된 문서만 초기화
  const { db, doc, setDoc } = fs();
  for(const it of _items){
    await setDoc(doc(db, COLL_AGG, it.id), { cats:{}, updatedAt: window.__FS.serverTimestamp() }, { merge:false });
  }
  alert('초기화 완료(현재 로드분). 더 있는 경우 더 불러오기 후 반복하세요.');
  await reloadAfterWrite();
}

// ====== 시뮬레이터 ======
async function runSim(){
  const s = (document.getElementById('simInput').value||'').trim();
  if(!s){ return; }
  // parseYouTube는 youtube-utils.js에 있음 (upload 페이지와 동일 네이밍 가정)
  const parseYouTube = (u)=> window.parseYouTube ? window.parseYouTube(u) : { id:null, url:u };
  const { cats, tokens } = await autoSelectForText(s, parseYouTube);
  const out = document.getElementById('simResult');
  if(Array.isArray(cats) && cats.length){
    out.innerHTML = `<span class="ok">선택 예상:</span> ${cats.join(', ')}\n토큰: ${tokens.join(', ')}`;
  }else{
    out.innerHTML = `<span class="danger">임계치 미달 → 수동선택 권장</span>\n토큰: ${tokens.join(', ')}`;
  }
}
