import { db } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged, signInWithGoogle, handleRedirectResult } from './auth.js?v=1.5.2';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const btn = document.getElementById('btnGoogle');
const msg = document.getElementById('msg');

function show(text, ok=false){
  if (!msg) return;
  msg.textContent = text;
  msg.className = 'msg show ' + (ok ? 'ok' : 'err');
}

async function ensureProfile(user){
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } else {
    await setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true });
  }
}

async function routeAfterLogin(user){
  if (!user) return;
  try{
    await ensureProfile(user);
    // 닉 검사 제거 — 항상 인덱스로 이동
    location.replace('index.html');
  }catch(e){
    console.error('[signup] profile read err:', e);
    // 문제가 있어도 인덱스로 이동하도록 처리 (닉 페이지 사용 안함)
    location.replace('index.html');
  }
}

// ① 리다이렉트 복귀 처리
handleRedirectResult()
  .then(res => { if (res?.user) routeAfterLogin(res.user); })
  .catch(() => { /* no-op */ });

// ② 이미 로그인 상태면 자동 분기
onAuthStateChanged((user)=>{ if (user) routeAfterLogin(user); });

// ③ 버튼 클릭 → Google 로그인
btn?.addEventListener('click', async ()=>{
  try{
    btn.disabled = true;
    show('인증 중입니다…', true);
    const user = await signInWithGoogle();
    if (user) await routeAfterLogin(user);
  }catch(e){
    console.error(e);
    show('구글 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }finally{
    btn.disabled = false;
  }
});
