// /js/signup.js
import { auth } from './firebase-init.js';
import { signInWithGoogle, onAuthStateChanged, ensureUserProfile } from './auth.js';

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
    if (user) {
      // 안전: 혹시 모를 경합 대비 한 번 더 보장
      await ensureUserProfile(user);
      location.href = '/index.html';
    }
  } catch (e) {
    console.error(e);
    err.textContent = '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
    err.hidden = false;
  } finally {
    setBusy(false);
  }
});

// 이미 로그인 상태라면: 프로필 보장 후 이동
onAuthStateChanged(auth, async (u)=>{
  if (!u) return;
  try { await ensureUserProfile(u); } catch {}
  location.href = '/index.html';
});
