// js/signin.js (ArkTube v1 — Google only, 닉네임 분기 고정)
// - nickname 필드 기준으로 분기
// - onAuthStateChanged: auth 인자 없이 래퍼 사용

import { auth, db } from './firebase-init.js';
import { signInWithGoogle, onAuthStateChanged } from './auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $btn = document.getElementById('btnGoogle');
const $msg = document.getElementById('msg');

function showMsg(text, ok=false){
  if (!$msg) return;
  $msg.textContent = text;
  $msg.className = 'msg show ' + (ok ? 'ok':'err');
}

async function afterLoginRoute(user){
  try{
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!(data && typeof data.nickname === 'string' && data.nickname.trim());
    location.href = hasNick ? './index.html' : './nick.html';
  }catch(e){
    console.error('[signin] user doc read err:', e);
    // 네트워크/권한 문제 시에도 서비스 접근 가능하도록 홈으로
    location.href = './index.html';
  }
}

// 이미 로그인되어 들어온 경우 자동 분기
onAuthStateChanged((user)=>{
  if (user) afterLoginRoute(user);
});

// 버튼 클릭 → Google 로그인
$btn?.addEventListener('click', async ()=>{
  try{
    $btn.disabled = true;
    showMsg('로그인 중입니다… 잠시만요.', true);
    const user = await signInWithGoogle();
    if (user) await afterLoginRoute(user);
  }catch(e){
    console.error(e);
    showMsg('로그인 실패: ' + (e?.message || e));
  }finally{
    $btn.disabled = false;
  }
});
