// js/signup.js (ArkTube v1 — Google only, 닉네임 분기 고정)
// - nickname 필드 기준으로 분기 (기존 nick → nickname 수정)
// - onAuthStateChanged: auth 인자 없이 래퍼 사용
// - Firestore doc/getDoc는 firebase/firestore에서 import

import { db, onAuthStateChanged, signInWithGoogle, ensureUserDoc } from './auth.js?v=1.5.1';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const btn = document.getElementById('btnGoogle');
const msg = document.getElementById('msg');

function show(text, ok=false){
  if(!msg) return;
  msg.textContent = text;
  msg.className = 'msg show ' + (ok ? 'ok' : 'err');
}

async function routeAfterLogin(user){
  if(!user) return;
  try{
    // 최초 로그인 시 사용자 문서 보장
    await ensureUserDoc(user.uid, user.displayName || '회원');

    // 닉네임 존재 여부 확인
    const snap = await getDoc(doc(db, 'users', user.uid));
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!(data && typeof data.nickname === 'string' && data.nickname.trim());

    location.replace(hasNick ? 'index.html' : 'nick.html');
  }catch(e){
    console.error('[signup] profile read err:', e);
    // 문제가 있어도 닉 설정 페이지로 보내 복구 가능하게 함
    location.replace('nick.html');
  }
}

// 이미 로그인 상태면 자동 분기
onAuthStateChanged((user)=>{
  if (user) routeAfterLogin(user);
});

// 버튼 클릭 → Google 로그인
btn?.addEventListener('click', async ()=>{
  try{
    btn.disabled = true;
    show('인증 중입니다…', true);
    const user = await signInWithGoogle(); // popup → redirect 폴백은 auth.js에서 처리
    if (user) await routeAfterLogin(user);
  }catch(e){
    console.error(e);
    show('구글 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }finally{
    btn.disabled = false;
  }
});
