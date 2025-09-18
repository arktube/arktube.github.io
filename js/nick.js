// js/nick.js (ArkTube — 닉네임 설정 최종판: 2단계 쓰기 + 롤백)
// - Step1: nicks/{lower(nickname)} create-only (중복 차단)
// - Step2: users/{uid}.nickname merge (규칙이 nicks 소유/존재 검사)
// - 실패 시 롤백: Step2 실패하면 Step1에서 만든 nicks 문서 삭제
// - 한글/영문/숫자/[-_.], 2~20자 + 제로폭 제거 + NFC 정규화

import { db } from './firebase-init.js?v=1.5.1';
import { onAuthStateChanged } from './auth.js?v=1.5.1';
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp
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

// 이미 로그인되어 있으면 현재 닉 로딩 → 있으면 홈으로
onAuthStateChanged(async (user)=>{
  if (!user) {
    location.replace('./signin.html');
    return;
  }
  currentUid = user.uid;

  try{
    const snap = await getDoc(doc(db,'users', currentUid));
    const data = snap.exists() ? snap.data() : {};
    if (data && typeof data.nickname === 'string' && data.nickname.trim()){
      location.replace('./index.html');
    }
  }catch(e){
    console.warn('[nick] preload failed:', e);
  }
});

async function saveNicknameAtomic(uid, rawNick){
  const nickname = sanitizeNickname(rawNick);
  if (!nickname) throw new Error('닉네임은 2~20자, 한글/영문/숫자/[-_.]만 가능합니다.');

  const lowerId = nickname.toLowerCase(); // 한글은 변화 없음
  const userRef = doc(db, 'users', uid);
  const nickRef = doc(db, 'nicks', lowerId);

  // 현재 유저의 기존 닉 확인 (나중에 해제)
  const userSnap = await getDoc(userRef);
  const oldNickname = userSnap.exists() ? (userSnap.data().nickname || '') : '';
  const oldLowerId  = oldNickname ? oldNickname.toLowerCase() : null;

  // 기존 닉과 동일하면 바로 성공 처리
  if (oldLowerId && oldLowerId === lowerId) {
    // 그래도 users.updatedAt만 보정
    await setDoc(userRef, { updatedAt: serverTimestamp() }, { merge: true });
    return;
  }

  // Step1) 새 닉 예약 생성 (create-only; 규칙: ID==lower(nickname), ownerUid==auth.uid)
  // 필드는 ['nickname','ownerUid','createdAt']만!
  await setDoc(nickRef, {
    nickname,
    ownerUid: uid,
    createdAt: serverTimestamp(),
  }, { merge: false });

  let step2Done = false;
  try {
    // Step2) users/{uid}에 nickname 저장 (규칙이 nicks 존재/소유 검사)
    await setDoc(userRef, {
      nickname,
      updatedAt: serverTimestamp()
    }, { merge: true });
    step2Done = true;

    // (선택) 이전 예약 해제: 본인 소유일 때만 규칙 통과
    if (oldLowerId && oldLowerId !== lowerId) {
      await deleteDoc(doc(db, 'nicks', oldLowerId));
    }
  } catch (e) {
    // 롤백: Step2 실패 시, 방금 만든 예약 삭제
    try { await deleteDoc(nickRef); } catch(_) {}
    throw e;
  }
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
    console.error('[nick] commit error:', e);
    // 규칙 위반(중복/소유 등) → 대부분 permission-denied
    const msg =
      e?.code === 'permission-denied'
        ? '이미 사용 중이거나 권한이 없습니다.'
        : (e?.message || '저장에 실패했습니다.');
    tip(msg);
  }finally{
    $save.disabled = false;
  }
});
