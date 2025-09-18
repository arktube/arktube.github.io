// js/signin.js (ArkTube v1 — Google only)
import { db } from './firebase-init.js?v=1.5.1';
import { signInWithGoogle, onAuthStateChanged, handleRedirectResult } from './auth.js?v=1.5.2';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $btn = document.getElementById('btnGoogle');
const $msg = document.getElementById('msg');

function showMsg(text, ok=false){
  if (!$msg) return;
  $msg.textContent = text;
  $msg.className = 'msg show ' + (ok ? 'ok':'err');
}

async function afterLoginRoute(user){
  if (!user) return;
  try{
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!(data && typeof data.nickname === 'string' && data.nickname.trim());
    location.replace(hasNick ? './index.html' : './nick.html');
  }catch(e){
    console.error('[signin] user doc read err:', e);
    location.replace('./index.html');
  }
}

// ① 리다이렉트 복귀 시 결과 처리(모바일/팝업불가 브라우저 대비)
handleRedirectResult()
  .then(res => { if (res?.user) afterLoginRoute(res.user); })
  .catch(() => { /* no-op */ });

// ② 이미 로그인되어 들어온 경우 자동 분기
onAuthStateChanged((user)=>{
  if (user) afterLoginRoute(user);
});

// ③ 버튼 클릭 → Google 로그인
$btn?.addEventListener('click', async ()=>{
  try{
    $btn.disabled = true;
    showMsg('로그인 중입니다… 잠시만요.', true);
    const user = await signInWithGoogle();  // 팝업 성공 시 user, 리다이렉트 폴백 시 null
    if (user) await afterLoginRoute(user);  // 리다이렉트 케이스는 상단 ①에서 처리
  }catch(e){
    console.error(e);
    showMsg('로그인 실패: ' + (e?.message || e));
  }finally{
    $btn.disabled = false;
  }
});
