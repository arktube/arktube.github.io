// js/nick.js  (ArkTube 닉 전용, 규칙에 정합)
// - 컬렉션: nicks/{handle}  // handle = lower(nickname)
// - 필드: { nickname, ownerUid, createdAt }
// - users/{uid}: { nickname, ... } 저장 (규칙은 닉 형식만 검증)
// - 성공 시 index.html로 자동 이동

import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from './auth.js';
import {
  doc,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = (s)=>document.querySelector(s);

const form = $('#nick-form');
const input = $('#nick');
const btn = $('#create-btn');
const errEl = $('#error');
const previewWrap = $('#preview');
const previewNick = $('#preview-nick');
const statusEl = $('#status');

let currentUser = null;
let pending = false;

/* 규칙과 100% 일치: 공백 없음, 2~20자, 한글/영문/숫자/[_-.] */
const ALLOWED_RE = /^[A-Za-z0-9_.\-가-힣]{2,20}$/;
const RESERVED = ['admin','administrator','system','null','undefined','support','root'];

// 미리보기 (XSS 방지: textContent만)
input.addEventListener('input', () => {
  const v = input.value.trim();
  if (!v) { previewWrap.style.display='none'; return; }
  previewWrap.style.display = 'block';
  previewNick.textContent = v;
  clearError();
});

onAuthStateChanged((user)=>{
  currentUser = user || null;
  btn.disabled = !currentUser;
  if (!currentUser) showError('로그인이 필요합니다. 로그인 후 시도해 주세요.');
});

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  clearError();
  if (pending) return;
  if (!currentUser) { showError('권한이 없습니다. 로그인 후 시도해 주세요.'); return; }

  const raw = input.value.trim();
  const v = validateNick(raw);
  if (!v.ok) { showError(v.msg); return; }

  try {
    pending = true;
    btn.disabled = true;
    btn.textContent = '등록 중...';
    statusEl.style.display = 'none';

    const res = await createNickTx(currentUser.uid, raw);
    if (res === 'ok') {
      statusEl.style.display = 'block';
      statusEl.className = 'small ok';
      statusEl.textContent = '성공적으로 등록되었습니다. 잠시 후 이동합니다...';
      btn.textContent = '완료';
      input.disabled = true;

      // 뒤로가기로 닉 페이지 안 돌아오게 하려면 replace 사용
      setTimeout(()=> { window.location.replace('./index.html'); }, 600);
    } else if (res === 'ALREADY_EXISTS') {
      showError('이미 사용 중인 닉네임입니다. 다른 닉네임을 선택해주세요.');
      btn.textContent = '등록하기';
    } else if (res === 'USER_HAS_NICK') {
      showError('이미 등록된 닉네임이 있습니다.');
      btn.textContent = '등록하기';
    } else {
      showError('닉네임 등록 중 문제가 발생했습니다. 다시 시도해 주세요.');
      btn.textContent = '등록하기';
    }
  } catch (err) {
    console.error(err);
    showError('알 수 없는 오류가 발생했습니다. 콘솔 로그를 확인해주세요.');
    btn.textContent = '등록하기';
  } finally {
    pending = false;
    if (!input.disabled) btn.disabled = false;
  }
});

function validateNick(nick) {
  if (!ALLOWED_RE.test(nick)) {
    return { ok:false, msg:'2~20자, 한글/영문/숫자/[_-.]만 사용할 수 있습니다(공백 불가).' };
  }
  const lower = nick.toLowerCase();
  if (RESERVED.includes(lower)) return { ok:false, msg:'해당 닉네임은 사용할 수 없습니다.' };
  return { ok:true };
}

// 규칙: handle = lower(nickname), 필드 {nickname, ownerUid, createdAt}
// 트랜잭션으로 중복 차단 + users/{uid}에 nickname 저장
// nick.js 내 createNickTx() 함수만 교체
// 규칙: handle = lower(nickname), 필드 {nickname, ownerUid, createdAt}
// 트랜잭션으로 중복 차단 + users/{uid}에 nickname 저장
async function createNickTx(uid, nickname) {
  const handle = nickname.toLowerCase();
  const nickRef = doc(db, 'nicks', handle);
  const userRef = doc(db, 'users', uid);

  try {
    await runTransaction(db, async (tx) => {
      const nickSnap = await tx.get(nickRef);
      if (nickSnap.exists()) throw { code: 'ALREADY_EXISTS' };

      const userSnap = await tx.get(userRef);
      const userExists = userSnap.exists();

      // 1) nicks 예약 (create-only)
      tx.set(nickRef, {
        nickname,
        ownerUid: uid,
        createdAt: serverTimestamp(),
      });

      // 2) users 프로필 저장
      if (userExists) {
        // update 규칙: nickname, updatedAt 만 보냄 (createdAt 금지)
        tx.set(userRef, {
          nickname,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } else {
        // create일 때만 createdAt 허용
        tx.set(userRef, {
          nickname,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    });

    return 'ok';
  } catch (e) {
    if (e && e.code) return e.code; // 'ALREADY_EXISTS' | 'USER_HAS_NICK' 등
    throw e; // 그 외 오류는 상위에서 처리
  }
}


function showError(msg) {
  errEl.style.display = 'block';
  errEl.textContent = msg;
  statusEl.style.display = 'none';
}
function clearError() {
  errEl.style.display = 'none';
  errEl.textContent = '';
}
