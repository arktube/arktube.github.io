// js/nick.js (중복 방지 버전: nicks 예약 + users 저장 배치)
import { auth, db } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged } from './auth.js?v=1.5.1';
import {
  doc, setDoc, getDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
function sanitizeNickname(raw){
  const s0 = String(raw||'');
  const s1 = s0.replace(INVISIBLE_RE, '');
  const s2 = s1.normalize('NFC').trim();
  if (!s2) return '';
  return /^[A-Za-z0-9가-힣._-]{2,20}$/.test(s2) ? s2 : '';
}

const $input = document.getElementById('nickInput');
const $save  = document.getElementById('nickSave');
const $msg   = document.getElementById('msg');

function tip(t, ok=false){
  if (!$msg) return;
  $msg.textContent = t;
  $msg.className = 'msg show ' + (ok ? 'ok':'err');
}

let currentUid = null;

onAuthStateChanged(async (user)=>{
  if (!user) { location.replace('./signin.html'); return; }
  currentUid = user.uid;

  // 이미 닉 있으면 홈으로
  try{
    const snap = await getDoc(doc(db,'users', currentUid));
    const data = snap.exists() ? snap.data() : {};
    if (data && typeof data.nickname === 'string' && data.nickname.trim()){
      location.replace('./index.html');
    }
  }catch(e){}
});

async function saveNicknameAtomic(uid, rawNick){
  const nickname = sanitizeNickname(rawNick);
  if (!nickname) throw new Error('닉네임 형식 오류');

  const lowerId = nickname.toLowerCase(); // 한글은 변화 없음
  const userRef = doc(db, 'users', uid);
  const newRef  = doc(db, 'nicks', lowerId);

  // 기존 닉 예약 해제 준비
  const snap = await getDoc(userRef);
  const oldNickname = snap.exists() ? (snap.data().nickname || '') : '';
  const oldLowerId  = oldNickname ? oldNickname.toLowerCase() : null;
  const oldRef      = oldLowerId ? doc(db, 'nicks', oldLowerId) : null;

  const batch = writeBatch(db);
  if (oldRef) batch.delete(oldRef);
  // 새 예약(규칙상 create-only, 이미 있으면 커밋 거절)
  batch.set(newRef, { nickname, ownerUid: uid, createdAt: serverTimestamp() });
  // 사용자 문서 갱신
  batch.set(userRef, { nickname, updatedAt: serverTimestamp() }, { merge: true });

  await batch.commit();
}

$save?.addEventListener('click', async ()=>{
  if (!currentUid) return;
  const raw = $input?.value;
  try{
    $save.disabled = true;
    await saveNicknameAtomic(currentUid, raw);
    tip('저장되었습니다. 이동합니다…', true);
    setTimeout(()=> location.replace('./index.html'), 250);
  }catch(e){
    console.error(e);
    const msg = (e?.code === 'permission-denied')
      ? '이미 사용 중인 닉네임입니다.'
      : (e?.message || '저장 실패');
    tip(msg);
  }finally{
    $save.disabled = false;
  }
});
