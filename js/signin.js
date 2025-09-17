// js/signin.js (ArkTube Google Only)
import { auth, db } from './firebase-init.js?v=1.5.1';
import { signInWithGoogle, onAuthStateChanged } from './auth.js?v=1.5.1';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const $btn = document.getElementById('btnGoogle');
const $msg = document.getElementById('msg');

function showMsg(text, ok=false){
  if (!$msg) return;
  $msg.textContent = text;
  $msg.className = 'msg show ' + (ok ? 'ok':'err');
}

async function afterLoginRoute(user){
  // 로그인 직후: users/{uid}.nickname 있으면 홈, 없으면 nick.html
  const ref = doc(db, 'users', user.uid);
  let snap;
  try{
    snap = await getDoc(ref);
  }catch(e){
    // 네트워크/권한 문제 시에도 일단 홈으로 보냄(복구 가능)
    location.href = './index.html';
    return;
  }

  const data = snap.exists() ? snap.data() : {};
  if (data && typeof data.nickname === 'string' && data.nickname.trim()){
    location.href = './index.html';
  } else {
    // 닉네임 최초 설정 페이지로
    location.href = './nick.html';
  }
}

// 이미 로그인되어 들어온 경우 자동 분기
onAuthStateChanged(auth, (user)=>{
  if (user) {
    afterLoginRoute(user);
  }
});

$btn?.addEventListener('click', async ()=>{
  try{
    $btn.disabled = true;
    showMsg('로그인 중입니다… 잠시만요.', true);
    const user = await signInWithGoogle(); // auth.js에서 popup→redirect 폴백 처리
    if (user) await afterLoginRoute(user);
  }catch(e){
    console.error(e);
    showMsg('로그인 실패: ' + (e?.message || e));
  }finally{
    $btn.disabled = false;
  }
});
