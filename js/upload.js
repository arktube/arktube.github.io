// /js/upload.js — ArkTube v0.1 Upload (safe + spec)
// - 로그인 업로드, 비로그인 개인자료(로컬) 허용
// - ownerUid/ownerName/type/videoId/createdAt 저장
// - videoId 중복 방지(+기등록 카테고리 안내)
// - XSS-safe 카테고리 렌더/개인자료 이름변경
// - Playlist URL 추출 모달(드롭다운) 연동
// - 스와이프 데드존 18% (좌→우 = index)

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import {
  addDoc, collection, serverTimestamp, getDocs, query, where, limit
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { CATEGORY_GROUPS } from './categories.js';
import { isAllowedYouTube, parseYouTube } from './youtube-utils.js';

// --------------- 상단바/드롭다운 ---------------
const $ = (s)=>document.querySelector(s);
const signupLink = $('#signupLink');
const signinLink = $('#signinLink');
const welcome    = $('#welcome');
const menuBtn    = $('#menuBtn');
const dropdown   = $('#dropdownMenu');
const btnSignOut = $('#btnSignOut');
const btnGoUpload= $('#btnGoUpload');
const btnMyUploads = $('#btnMyUploads');
const btnAbout   = $('#btnAbout');
const btnList    = $('#btnList');
const btnCatOrder= $('#btnCatOrder');

function openDropdown(){ dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function closeDropdown(){ dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'), 180); }

onAuthStateChanged(auth, (user)=>{
  const loggedIn = !!user;
  signupLink?.classList.toggle('hidden', loggedIn);
  signinLink?.classList.toggle('hidden', loggedIn);
  if (welcome) welcome.textContent = loggedIn ? `Welcome! ${user.displayName||'회원'}` : '';
  closeDropdown();
});
menuBtn?.addEventListener('click',(e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden') ? openDropdown() : closeDropdown(); });
document.addEventListener('pointerdown',(e)=>{ if(dropdown?.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown(); }, true);
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeDropdown(); });
dropdown?.addEventListener('click',(e)=> e.stopPropagation());

btnGoUpload ?.addEventListener('click', ()=>{ location.href='/upload.html'; closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ auth.currentUser ? (location.href='/manage-uploads.html') : (location.href='/signin.html'); closeDropdown(); });
btnAbout    ?.addEventListener('click', ()=>{ location.href='/about.html'; closeDropdown(); });
btnList     ?.addEventListener('click', ()=>{ location.href='/list.html'; closeDropdown(); });
btnCatOrder ?.addEventListener('click', ()=>{ location.href='/category-order.html'; closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{ await fbSignOut(auth); closeDropdown(); });

// --------------- 메시지/DOM ---------------
const msgTop = $('#msgTop');
const msg    = $('#msg');
function setMsg(t){ msgTop && (msgTop.textContent=t||''); msg && (msg.textContent=t||''); }

const urlsBox = $('#urls');
const btnPaste = $('#btnPaste');
const btnSubmitTop = $('#btnSubmitTop');
const btnSubmitBottom = $('#btnSubmitBottom');
const catsBox = $('#cats');

function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// --------------- 개인 라벨 ---------------
const PERSONAL_LABELS_KEY = 'personalLabels';
function getPersonalLabels(){ try{ return JSON.parse(localStorage.getItem(PERSONAL_LABELS_KEY)||'{}'); }catch{ return {}; } }
function setPersonalLabel(key,label){
  let s = String(label||'').replace(/\r\n?/g,'\n').trim();
  s = s.slice(0,12).replace(/[<>"]/g,'').replace(/[\u0000-\u001F]/g,'');
  const map = getPersonalLabels(); map[key]=s; localStorage.setItem(PERSONAL_LABELS_KEY, JSON.stringify(map));
}
const personalVals = ['personal1','personal2','personal3','personal4'];
const isPersonal = (v)=> personalVals.includes(v);

// --------------- 카테고리 렌더(XSS-safe) ---------------
function renderCats(){
  if(!Array.isArray(CATEGORY_GROUPS) || !CATEGORY_GROUPS.length){
    setMsg('카테고리 정의가 비어 있습니다. js/categories.js 확인 필요.');
    return;
  }
  catsBox?.replaceChildren();
  const labels = getPersonalLabels();
  const frag = document.createDocumentFragment();

  for (const g of CATEGORY_GROUPS){
    const fs = document.createElement('fieldset');
    fs.className='group'; fs.dataset.key=g.key;
    const legend = document.createElement('legend'); legend.textContent = g.label;
    fs.appendChild(legend);

    if (g.key==='personal'){
      const sub = document.createElement('span'); sub.className='subnote'; sub.textContent='(로컬저장소)';
      legend.appendChild(document.createTextNode(' ')); legend.appendChild(sub);
    }

    const grid = document.createElement('div'); grid.className='child-grid'; fs.appendChild(grid);
    for(const c of g.children){
      const lab = document.createElement('label');
      const input = document.createElement('input'); input.type='checkbox'; input.className='cat'; input.value=c.value;
      lab.appendChild(input);
      const name = (g.key==='personal' && labels[c.value]) ? labels[c.value] : c.label;
      lab.appendChild(document.createTextNode(' '+name));

      if(g.key==='personal'){
        const btn = document.createElement('button'); btn.type='button'; btn.className='rename-inline'; btn.textContent='이름변경';
        btn.addEventListener('click', ()=>{
          const cur = labels[c.value] || c.label;
          const nv = prompt('개인자료 이름(최대 12자):', cur);
          if(!nv) return; setPersonalLabel(c.value,nv); renderCats();
        });
        lab.appendChild(document.createTextNode(' ')); lab.appendChild(btn);
      }
      grid.appendChild(lab);
    }

    if(g.key==='personal'){
      const note = document.createElement('div'); note.className='muted'; note.style.margin='6px 4px 2px';
      note.textContent = '개인자료는 단독으로만 등록/재생됩니다.'; fs.appendChild(note);
    }
    frag.appendChild(fs);
  }
  catsBox?.appendChild(frag);

  // 선택 제약
  catsBox?.querySelectorAll('input.cat').forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const v = chk.value;
      if(isPersonal(v) && chk.checked){
        catsBox.querySelectorAll('input.cat').forEach(x=>{ if(x!==chk) x.checked=false; });
        setMsg('개인자료는 단독으로만 사용 가능합니다.'); return;
      }
      if(!isPersonal(v) && chk.checked){
        catsBox.querySelectorAll('.group[data-key="personal"] input.cat:checked').forEach(x=> x.checked=false);
        const normals = Array.from(catsBox.querySelectorAll('input.cat:checked')).map(x=>x.value).filter(x=>!isPersonal(x));
        if(normals.length>3){ chk.checked=false; setMsg('카테고리는 최대 3개까지 선택 가능합니다.'); return; }
      }
      setMsg('');
    });
  });
}
renderCats();

// --------------- 붙여넣기 ---------------
btnPaste?.addEventListener('click', async ()=>{
  try{
    const txt = await navigator.clipboard.readText();
    if(!txt){ setMsg('클립보드가 비어있습니다.'); return; }
    urlsBox.value = (urlsBox.value.trim()? (urlsBox.value.replace(/\s*$/,'')+'\n') : '') + txt.trim();
    setMsg('붙여넣기 완료.');
  }catch{ setMsg('클립보드 접근이 차단되었습니다. 브라우저 설정에서 허용해 주세요.'); }
});

// --------------- 보조 유틸 ---------------
function parseLines(){ return urlsBox.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }
function getOrderValue(){ return document.querySelector('input[name="order"]:checked')?.value || 'bottom'; }

async function fetchTitleById(id){
  if(!id) return '';
  try{
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v='+id)}`);
    if(!res.ok) throw 0;
    const data = await res.json();
    return String(data?.title || '').slice(0,200);
  }catch{ return ''; }
}

async function fetchPublishedAt(id){
  try{
    const key = (window.YT_API_KEY || '').trim();
    if(!key) return null;
    const u = new URL('https://www.googleapis.com/youtube/v3/videos');
    u.searchParams.set('part','snippet'); u.searchParams.set('id', id); u.searchParams.set('key', key);
    const res = await fetch(u.toString());
    const j = await res.json();
    const iso = j?.items?.[0]?.snippet?.publishedAt || null;
    return iso;
  }catch{ return null; }
}

async function findDuplicate(videoId){
  const snap = await getDocs(query(collection(db,'videos'), where('videoId','==', videoId), limit(1)));
  if(snap.empty) return null;
  const d = snap.docs[0];
  return { id:d.id, data:d.data() };
}

// --------------- 등록 본체 ---------------
async function submitAll(){
  setMsg('검사 중...');
  const lines = parseLines();
  if(!lines.length){ setMsg('URL을 한 줄에 하나씩 입력해 주세요.'); return; }

  const selected = Array.from(document.querySelectorAll('.cat:checked')).map(c=>c.value);
  if(!selected.length){ setMsg('카테고리를 최소 1개 선택해 주세요.'); return; }

  const personals = selected.filter(v=> isPersonal(v));
  const normals   = selected.filter(v=> !isPersonal(v));

  // 개인자료 단독(로그인 불필요) → 로컬 저장
  if(personals.length>=1 && normals.length===0){
    if(personals.length>1){ setMsg('개인자료는 한 슬롯만 선택하세요.'); return; }
    const slot = personals[0];
    const key  = `copytube_${slot}`; // 구버전 호환 키
    let arr=[]; try{ arr=JSON.parse(localStorage.getItem(key)||'[]'); }catch{ arr=[]; }
    let added=0;
    for(const raw of lines){
      if(!isAllowedYouTube(raw)) continue;
      const p = parseYouTube(raw);
      if(!p.ok || !p.id) continue;
      arr.push({ url: raw, savedAt: Date.now() });
      added++;
    }
    localStorage.setItem(key, JSON.stringify(arr));
    urlsBox.value=''; document.querySelectorAll('.cat:checked').forEach(c=> c.checked=false);
    setMsg(`로컬 저장 완료: ${added}건 (${slot})`);
    return;
  }

  // 혼합 금지
  if(personals.length>=1 && normals.length>=1){
    setMsg('개인자료는 다른 카테고리와 함께 선택할 수 없습니다.');
    return;
  }

  // 일반/시리즈 서버 업로드: 로그인 필요
  const user = auth.currentUser;
  if(!user){ setMsg('로그인 후 이용하세요.'); return; }

  if(normals.length===0){ setMsg('카테고리를 최소 1개 선택해 주세요.'); return; }
  if(normals.length>3){ setMsg('카테고리는 최대 3개까지 선택 가능합니다.'); return; }

  const order = getOrderValue();
  const list  = (order==='bottom') ? lines.slice().reverse() : lines.slice();

  setMsg(`등록 중... (0/${list.length})`);
  let ok=0, dup=0, bad=0, fail=0;

  for(let i=0;i<list.length;i++){
    const url = list[i];

    if(!isAllowedYouTube(url)){ bad++; setMsg(`YouTube 링크만 등록할 수 있습니다. (${ok+dup+bad+fail}/${list.length})`); continue; }
    const p = parseYouTube(url);
    if(!p.ok || !p.id){ bad++; setMsg(`유효하지 않은 URL입니다. (${ok+dup+bad+fail}/${list.length})`); continue; }

    // 중복 체크
    try{
      const exists = await findDuplicate(p.id);
      if(exists){
        const cats = Array.isArray(exists.data?.categories) ? exists.data.categories : [];
        dup++;
        setMsg(`이미 등록됨 → ${p.id} (카테고리: ${cats.join(', ')})  · 진행: ${ok+dup+bad+fail}/${list.length}`);
        continue;
      }
    }catch{ /* noop */ }

    // 제목 / 공개일(옵션)
    const [title, publishedAt] = await Promise.all([
      fetchTitleById(p.id),
      fetchPublishedAt(p.id), // 키 없으면 null
    ]);

    // Firestore 저장
    try{
      const docData = {
        url,
        ...(title ? { title } : {}),
        type: p.type || 'video',       // 'shorts' | 'video'
        categories: normals,           // 최대 3개
        ownerUid: user.uid,
        ownerName: user.displayName || '',
        videoId: p.id,
        createdAt: serverTimestamp(),
        ...(publishedAt ? { youtubePublishedAt: publishedAt } : {}),
      };
      await addDoc(collection(db,'videos'), docData);
      ok++;
    }catch(e){
      console.error('[upload] addDoc failed:', e?.code, e?.message, e);
      fail++;
    }
    setMsg(`등록 중... (${ok+dup+bad+fail}/${list.length})`);
  }

  setMsg(`완료: 성공 ${ok} · 중복 ${dup} · 무시 ${bad} · 실패 ${fail}`);
  if(ok){ urlsBox.value=''; document.querySelectorAll('.cat:checked').forEach(c=> c.checked=false); }
}

btnSubmitTop   ?.addEventListener('click', submitAll);
btnSubmitBottom?.addEventListener('click', submitAll);

// --------------- 스와이프 네비 (데드존 18%) — 좌→우=index ---------------
(function initSwipe(){
  function initDrag({ goRightHref='/index.html', deadZoneCenterRatio=0.18 }={}){
    const page=document.querySelector('main')||document.body; if(!page) return;
    let x0=0,y0=0,t0=0,active=false,canceled=false;
    const TH=60, SLOP=45, TMAX=700;
    function reset(){ page.style.transition='transform 180ms ease'; requestAnimationFrame(()=>{ page.style.transform='translateX(0)'; }); setTimeout(()=>{ page.style.transition=''; },200); }
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
      if(Math.abs(dy)>SLOP){ canceled=true; active=false; reset(); return; }
      const dxAdj = (dx>0)?dx:0; // 좌→우만
      if(dxAdj===0){ page.style.transform='translateX(0)'; return; }
      e.preventDefault(); page.style.transform='translateX('+dxAdj+'px)';
    }
    function end(e){
      if(!active) return; active=false;
      const t=(e.changedTouches&&e.changedTouches[0])||(e.pointerType?e:null); if(!t) return;
      const dx=t.clientX-x0, dy=t.clientY-y0, dt=Date.now()-t0;
      if(canceled || Math.abs(dy)>SLOP || dt>TMAX){ reset(); return; }
      if(dx>=TH){ page.style.transition='transform 160ms ease'; page.style.transform='translateX(100vw)'; setTimeout(()=>{ location.href=goRightHref; },150); }
      else reset();
    }
    document.addEventListener('touchstart',start,{passive:true});
    document.addEventListener('touchmove', move ,{passive:false});
    document.addEventListener('touchend',  end  ,{passive:true,capture:true});
    document.addEventListener('pointerdown',start,{passive:true});
    document.addEventListener('pointermove', move ,{passive:false});
    document.addEventListener('pointerup',  end  ,{passive:true,capture:true});
  }
  initDrag({ goRightHref:'/index.html', deadZoneCenterRatio:0.18 });
})();
