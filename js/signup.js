// js/signup.js (ArkTube — Google only, kidsani 스타일)
// - 팝업 → 리다이렉트 폴백 지원
// - 리다이렉트 복귀 처리(handleRedirectResult)
// - 최초 로그인 시 users/{uid} 최소 문서 생성

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
    const snap = await getDoc(doc(db, 'users', user.uid));
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!(data && typeof data.nickname === 'string' && data.nickname.trim());
    location.replace(hasNick ? 'index.html' : 'nick.html');
  }catch(e){
    console.error('[signup] profile read err:', e);
    // 문제가 있어도 닉 설정 페이지로 보내 복구 가능하게
    location.replace('nick.html');
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
