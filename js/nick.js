// js/nick.js
import { auth, db } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged } from './auth.js?v=1.5.1';
import { doc, setDoc, serverTimestamp, getDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// auth.js의 sanitizeNickname과 동일 정규식 유지
function sanitizeNickname(raw){
  const s = String(raw||'').trim();
  if (!s) return '';
  return /^[\w가-힣\-_.]{2,20}$/.test(s) ? s : '';
}

const $input = document.getElementById('nick');
const $save  = document.getElementById('saveNick');
const $msg   = document.getElementById('msg');

function tip(t, ok=false){
  if (!$msg) return;
  $msg.textContent = t;
  $msg.className = 'msg show ' + (ok ? 'ok':'err');
}

let currentUid = null;

onAuthStateChanged(auth, async (user)=>{
  if (!user) {
    // 비로그인 접근 시 로그인 페이지로
    location.replace('./signin.html');
    return;
  }
  currentUid = user.uid;

  // 이미 닉이 있으면 바로 홈으로
  try{
    const snap = await getDoc(doc(db,'users', currentUid));
    const data = snap.exists() ? snap.data() : {};
    if (data && typeof data.nickname === 'string' && data.nickname.trim()){
      location.replace('./index.html');
    }
  }catch(e){ /* ignore */ }
});

$save?.addEventListener('click', async ()=>{
  if (!currentUid) return;
  const nick = sanitizeNickname($input?.value);
  if (!nick) {
    tip('닉네임은 2~20자, 한글/영문/숫자/[-_.]만 가능합니다.');
    return;
  }
  try{
    $save.disabled = true;
    await setDoc(doc(db,'users', currentUid), {
      nickname: nick,
      updatedAt: serverTimestamp()
    }, { merge: true });
    tip('저장되었습니다. 이동합니다…', true);
    setTimeout(()=> location.replace('./index.html'), 300);
  }catch(e){
    console.error(e);
    tip('저장 실패: ' + (e?.message || e));
  }finally{
    $save.disabled = false;
  }
});
