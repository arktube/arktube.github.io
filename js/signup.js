// signup.js
import { auth } from './js/firebase-init.js';
import { signInWithGoogle, onAuthStateChanged } from './js/auth.js';

const $ = (s)=>document.querySelector(s);
const btn = $('#btn-google');
const err = $('#err');

function setBusy(b){
  if (!btn) return;
  btn.disabled = b;
  btn.textContent = b ? '처리 중…' : 'Google로 회원가입';
}

btn?.addEventListener('click', async ()=>{
  err.hidden = true;
  setBusy(true);
  try {
    const user = await signInWithGoogle();
    if (user) location.href = '/index.html';
  } catch (e) {
    console.error(e);
    err.textContent = '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    err.hidden = false;
  } finally {
    setBusy(false);
  }
});

// 이미 로그인 상태면 바로 이동
onAuthStateChanged(auth, (u)=>{
  if (u) location.href = '/index.html';
});
