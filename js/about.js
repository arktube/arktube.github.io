// js/about.js (v1.2.1-xss-hardened)
// - 드롭다운 로직 index 패턴 유지
// - 의견 전송: 이중 제출 방지, maxlength 보강, UA/입력 길이 가드
// - XSS 방어: innerHTML 미사용 유지(메시지는 textContent로만 표시)
// - 저장 전 sanitizeMessage()로 서버 측 정제 일치

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged, signOut as fbSignOut } from './auth.js';
import { addDoc, collection, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';
import { requireAdminUI, sanitizeMessage } from './admin-common.js';

/* ---------- 상단바 요소 ---------- */
const signupLink   = document.getElementById('signupLink');
const signinLink   = document.getElementById('signinLink');
const welcome      = document.getElementById('welcome');

const menuBtn      = document.getElementById('menuBtn');
const dropdown     = document.getElementById('dropdownMenu');
const btnAbout     = document.getElementById('btnAbout');
const btnMyUploads = document.getElementById('btnMyUploads');
const btnGoUpload  = document.getElementById('btnGoUpload');
const btnSignOut   = document.getElementById('btnSignOut');

let isMenuOpen = false;
function openDropdown(){
  if (!dropdown) return;
  isMenuOpen = true;
  dropdown.classList.remove('hidden');
  requestAnimationFrame(()=> dropdown.classList.add('show'));
}
function closeDropdown(){
  if (!dropdown) return;
  isMenuOpen = false;
  dropdown.classList.remove('show');
  setTimeout(()=> dropdown.classList.add('hidden'), 180);
}

/* ---------- 로그인 상태 동기화 ---------- */
onAuthStateChanged(auth, (user)=>{
  const logged = !!user;
  signupLink?.classList.toggle('hidden', logged);
  signinLink?.classList.toggle('hidden', logged);
  if (welcome) welcome.textContent = logged ? `Hi! ${user?.displayName || '회원'}님` : '';
  closeDropdown();
});

/* ---------- 드롭다운 동작 ---------- */
menuBtn?.addEventListener('click', (e)=>{
  e.stopPropagation();
  if (!dropdown) return;
  dropdown.classList.contains('hidden') ? openDropdown() : closeDropdown();
});
document.addEventListener('pointerdown', (e)=>{
  if (!dropdown || dropdown.classList.contains('hidden')) return;
  if (!e.target.closest('#dropdownMenu,#menuBtn')) closeDropdown();
}, true);
document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeDropdown(); });
dropdown?.addEventListener('click', (e)=> e.stopPropagation());

/* ---------- 드롭다운 내 네비게이션 ---------- */
btnAbout    ?.addEventListener('click', ()=>{ location.href = 'about.html';          closeDropdown(); });
btnMyUploads?.addEventListener('click', ()=>{ location.href = 'manage-uploads.html'; closeDropdown(); });
btnGoUpload ?.addEventListener('click', ()=>{ location.href = 'upload.html';         closeDropdown(); });
btnSignOut  ?.addEventListener('click', async ()=>{
  if (!auth.currentUser){ location.href = 'signin.html'; return; }
  try { await fbSignOut(auth); } catch {}
  closeDropdown();
});

/* ---------- 관리자 전용 영역/버튼 표시 ---------- */
const adminSection    = document.getElementById('adminSection');
const btnAdminMsgs    = document.getElementById('btnAdminMsgs');
const btnAdminMembers = document.getElementById('btnAdminMembers');
const btnAdminExport  = document.getElementById('btnAdminExport');
const btnAdminBulk    = document.getElementById('btnAdminBulk');

requireAdminUI([adminSection, btnAdminMsgs, btnAdminMembers, btnAdminExport, btnAdminBulk]);

btnAdminMsgs   ?.addEventListener('click', ()=> location.href='admin-feedback.html');
btnAdminMembers?.addEventListener('click', ()=> location.href='admin-members.html');
btnAdminExport ?.addEventListener('click', ()=> location.href='admin-export.html');
btnAdminBulk   ?.addEventListener('click', ()=> location.href='admin-bulk-upload.html');

/* ---------- 의견 전송 ---------- */
const btnSend  = document.getElementById('btnSend');
const feedback = document.getElementById('feedback');
const msgEl    = document.getElementById('msg');

// 클라이언트 측 길이 제한(서버와 일치: 2000자)
try { feedback?.setAttribute('maxlength', '2000'); } catch {}

function setMsg(t){ if (msgEl) msgEl.textContent = t || ''; }

// 간단한 이중 제출 가드
let sending = false;

btnSend?.addEventListener('click', async ()=>{
  const user = auth.currentUser;
  if (!user){ setMsg('로그인 후 전송할 수 있어요.'); return; }
  if (sending) return;

  const raw = String(feedback.value || '');
  const clean = sanitizeMessage(raw); // 공백/제어문자 제거 + 2000자 제한

  if (!clean){
    setMsg('내용을 입력해 주세요.');
    return;
  }

  // UA 과도 길이/민감 정보 최소화
  let ua = navigator.userAgent || '';
  if (ua.length > 512) ua = ua.slice(0, 512);

  sending = true;
  btnSend.disabled = true;
  setMsg('전송 중...');

  try{
    await addDoc(collection(db,'messages'), {
      uid: user.uid,
      displayName: user.displayName || '회원',
      content: clean,                  // 서버에서 렌더할 때 반드시 escapeHTML() 사용
      ua,
      createdAt: serverTimestamp()
    });
    if (feedback) feedback.value = '';
    setMsg('전송되었습니다. 감사합니다!');
  }catch(e){
    // 내부 오류 메시지를 그대로 노출하지 않음
    setMsg('전송에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.');
  }finally{
    sending = false;
    btnSend.disabled = false;
  }
});
