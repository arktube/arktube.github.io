// js/nick.js (ArkTube 최종 — 닉네임 중복 방지 + 규칙 일치)
// - 예약 컬렉션: nicks/{lower(nickname)} (create-only)
// - users/{uid}.nickname 저장 (merge)
// - 배치 커밋으로 원자 처리
// - 한글/영문/숫자/[-_.], 2~20자 + 제로폭 제거 + NFC 정규화

import { auth, db } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged } from './auth.js?v=1.5.1';
import {
  doc, getDoc, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// 보이지 않는 제어/제로폭 문자 제거
const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// 클라-규칙 동일 정책: 한글/영문/숫자/[-_.], 2~20자
function sanitizeNickname(raw){
  const s0 = String(raw || '');
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
  $msg.className = 'msg show ' + (ok ? 'ok' : 'err');
}

let currentUid = null;

onAuthStateChanged(async (user)=>{
  if (!user) {
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
  }catch(e){
    // 읽기 실패 시에는 페이지에 머물러서 재시도 가능
    console.warn('[nick] preload failed:', e);
  }
});

async function saveNicknameAtomic(uid, rawNick){
  const nickname = sanitizeNickname(rawNick);
  if (!nickname) throw new Error('닉네임은 2~20자, 한글/영문/숫자/[-_.]만 가능합니다.');

  const lowerId = nickname.toLowerCase(); // 한글은 변화 없음
  const userRef = doc(db, 'users', uid);
  const newRef  = doc(db, 'nicks', lowerId);

  // 기존 닉(예약) 확인: 있으면 old 예약 해제
  const snap = await getDoc(userRef);
  const oldNickname = snap.exists() ? (snap.data().nickname || '') : '';
  const oldLowerId  = oldNickname ? oldNickname.toLowerCase() : null;

  const batch = writeBatch(db);

  if (oldLowerId && oldLowerId !== lowerId) {
    // 규칙: nicks/{handle} delete는 ownerUid == auth.uid만 허용 → 본인 예약만 삭제 가능
    batch.delete(doc(db, 'nicks', oldLowerId));
  }

  // 새 예약(규칙상 create-only, 이미 존재하면 커밋 전체가 거절됨 → 중복 방지)
  batch.set(newRef, {
    nickname,
    ownerUid: uid,
    createdAt: serverTimestamp()
  });

  // 사용자 문서 갱신(merge)
  batch.set(userRef, {
    nickname,
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();
}

$save?.addEventListener('click', async ()=>{
  if (!currentUid) return;
  try{
    $save.disabled = true;
    const raw = $input?.value;
    await saveNicknameAtomic(currentUid, raw);
    tip('저장되었습니다. 이동합니다…', true);
    setTimeout(()=> location.replace('./index.html'), 250);
  }catch(e){
    console.error(e);
    // 규칙 위반(중복 포함) → 대부분 permission-denied
    const msg =
      e?.code === 'permission-denied'
        ? '이미 사용 중인 닉네임입니다.'
        : (e?.message || '저장에 실패했습니다.');
    tip(msg);
  }finally{
    $save.disabled = false;
  }
});
