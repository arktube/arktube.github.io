// js/signin.js (ArkTube — Google only, kidsani 스타일)
// - 팝업 → 리다이렉트 폴백 지원
// - 리다이렉트 복귀 처리(handleRedirectResult)
// - users/{uid} 문서 없으면 최소 프로필 생성(닉네임은 나중에 nick.html에서)

import { db } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged, signInWithGoogle, handleRedirectResult } from './auth.js?v=1.5.2';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $btn = document.getElementById('btnGoogle');
const $msg = document.getElementById('msg');

function showMsg(text, ok=false){
  if (!$msg) return;
  $msg.textContent = text;
  $msg.className = 'msg show ' + (ok ? 'ok' : 'err');
}

async function ensureProfile(user){
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // rules: create 허용 필드만 사용
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
  await ensureProfile(user);
  const snap = await getDoc(doc(db, 'users', user.uid));
  const data = snap.exists() ? snap.data() : {};
  const hasNick = !!(data && typeof data.nickname === 'string' && data.nickname.trim());
  location.replace(hasNick ? './index.html' : './nick.html');
}

// ① 리다이렉트 복귀 처리(모바일/팝업 불가 대비)
handleRedirectResult()
  .then(res => { if (res?.user) routeAfterLogin(res.user); })
  .catch(() => { /* no-op */ });

// ② 이미 로그인 상태면 즉시 분기
onAuthStateChanged((user)=>{ if (user) routeAfterLogin(user); });

// ③ 버튼 클릭 → Google 로그인
$btn?.addEventListener('click', async ()=>{
  try{
    $btn.disabled = true;
    showMsg('로그인 중입니다… 잠시만요.', true);
    const user = await signInWithGoogle(); // 팝업 성공: user, 리다이렉트 폴백: null
    if (user) await routeAfterLogin(user);
  }catch(e){
    console.error(e);
    showMsg('로그인 실패: ' + (e?.message || e));
  }finally{
    $btn.disabled = false;
  }
});
