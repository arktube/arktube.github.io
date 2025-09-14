// js/admin-feedback.js  (v1.0.1-hardening)
// - XSS 하드닝: innerHTML 제거, DOM 생성 + textContent만 사용
// - 초과 길이 가드: 렌더 시 content 5,000자 만큼만 표시(서버 저장값은 그대로)
// - 기타: createdAt 없을 때 표시 보정, 구독 중복 방지

import { auth } from './firebase-init.js';
import { onAuthStateChanged } from './auth.js';
import { requireAdminUI, escapeHTML, fmtDate, isAdminCurrentUser } from './admin-common.js';
import {
  collection, query, orderBy, onSnapshot, deleteDoc, doc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { db } from './firebase-init.js';

const msg   = document.getElementById('msg');
const list  = document.getElementById('list');

/* 드롭다운 (간단) */
const menuBtn  = document.getElementById('menuBtn');
const dropdown = document.getElementById('dropdownMenu');
let isOpen=false;
function open(){ isOpen=true; dropdown?.classList.remove('hidden'); requestAnimationFrame(()=> dropdown?.classList.add('show')); }
function close(){ isOpen=false; dropdown?.classList.remove('show'); setTimeout(()=> dropdown?.classList.add('hidden'),180); }
menuBtn?.addEventListener('click', (e)=>{ e.stopPropagation(); dropdown?.classList.contains('hidden')?open():close(); });
document.addEventListener('pointerdown', (e)=>{ if(!dropdown || dropdown.classList.contains('hidden')) return; if(!e.target.closest('#dropdownMenu,#menuBtn')) close(); }, true);
document.getElementById('btnBack')?.addEventListener('click', ()=> location.href='about.html');

/* 관리자만 접근 */
let unsub = null;
onAuthStateChanged(auth, async (user)=>{
  if (!user || !(await isAdminCurrentUser())){ location.href = 'about.html'; return; }
  startLive();
});

function startLive(){
  msg.textContent = '불러오는 중...';
  const q = query(collection(db,'messages'), orderBy('createdAt','desc'));
  if (unsub) { try{ unsub(); }catch{} }
  unsub = onSnapshot(q, (snap)=>{
    // 초기화
    list.textContent = '';

    if (snap.empty){
      const empty = document.createElement('div');
      empty.className = 'msg';
      empty.textContent = '메시지가 없습니다.';
      list.appendChild(empty);
      msg.textContent='';
      return;
    }

    const frag = document.createDocumentFragment();
    snap.forEach(d=>{
      const v = d.data() || {};
      const display = typeof v.displayName === 'string' ? v.displayName : '회원';
      const content = typeof v.content === 'string' ? v.content : '';
      const when    = fmtDate(v.createdAt) || '';

      // row 컨테이너
      const row = document.createElement('div');
      row.className = 'row';

      // 왼쪽 정보
      const left = document.createElement('div');

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${display} · ${when}`;

      const body = document.createElement('div');
      body.className = 'content';
      // 렌더링 성능 가드: 5,000자까지만 표시(화이트스페이스는 CSS에서 pre-wrap)
      body.textContent = content.length > 5000 ? (content.slice(0,5000) + ' …') : content;

      left.appendChild(meta);
      left.appendChild(body);

      // 우측 액션
      const actions = document.createElement('div');
      actions.className = 'actions';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = '삭제';
      delBtn.addEventListener('click', async ()=>{
        if (!confirm('삭제할까요?')) return;
        try{
          await deleteDoc(doc(db,'messages', d.id));
        }catch(e){
          alert('삭제 실패: ' + (e?.message || e));
        }
      });

      actions.appendChild(delBtn);

      row.appendChild(left);
      row.appendChild(actions);

      frag.appendChild(row);
    });

    list.appendChild(frag);
    msg.textContent='';
  }, (e)=>{
    msg.textContent = '오류: ' + (e?.message || e);
  });
}

window.addEventListener('beforeunload', ()=>{ try{ unsub && unsub(); }catch{} });
