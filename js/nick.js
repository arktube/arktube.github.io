// js/nick.js
// 모듈 방식 (프로젝트의 firebase-init.js, auth.js 를 그대로 사용합니다)
// 전에 사용하시던 import 경로와 동일하게 맞추어 주세요.

import { auth, db } from './firebase-init.js'; // 프로젝트에 맞는 상대경로 사용
import { onAuthStateChanged } from './auth.js'; // 사용중인 auth 래퍼
import {
  doc,
  runTransaction,
  serverTimestamp,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = (s) => document.querySelector(s);

const form = $('#nick-form');
const input = $('#nick');
const btn = $('#create-btn');
const errEl = $('#error');
const previewWrap = $('#preview');
const previewNick = $('#preview-nick');
const statusEl = $('#status');

let currentUser = null;
let pending = false;

// 유효성 검사 규칙
const MIN_LEN = 2;
const MAX_LEN = 20;
const ALLOWED_RE = /^[\p{L}\p{N}\-\_\s]+$/u; // 유니코드 글자(한글 포함), 숫자, -, _, 공백 허용
const RESERVED = ['admin','administrator','system','null','undefined','support','root'];

// 유저가 입력할 때 실시간 미리보기(안전하게 textContent로만 출력)
input.addEventListener('input', () => {
  const v = input.value.trim();
  if (v.length === 0) {
    previewWrap.style.display = 'none';
    return;
  }
  previewWrap.style.display = 'block';
  previewNick.textContent = v; // 절대 innerHTML 사용 금지
  clearError();
});

// 인증 상태 감지 (auth는 바꾸지 않는다고 하셨으니 기존 래퍼 사용)
onAuthStateChanged((user) => {
  currentUser = user || null;
  if (!currentUser) {
    showError('로그인이 필요합니다. 로그인 후 시도해 주세요.');
    btn.disabled = true;
  } else {
    btn.disabled = false;
  }
});

// 폼 제출 처리
form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearError();

  if (pending) return; // 이중요청 방지
  if (!currentUser) {
    showError('권한이 없습니다. 로그인 후 시도해 주세요.');
    return;
  }

  const rawNick = input.value.trim();
  const valid = validateNick(rawNick);
  if (!valid.ok) {
    showError(valid.msg);
    return;
  }

  // 닉네임을 DB에 안전하게 등록 (트랜잭션으로 중복 방지)
  try {
    pending = true;
    btn.disabled = true;
    btn.textContent = '등록 중...';
    statusEl.style.display = 'none';

    const result = await createNicknameTransaction(currentUser.uid, rawNick);
    if (result === 'ok') {
      statusEl.style.display = 'block';
      statusEl.className = 'small ok';
      statusEl.textContent = '성공적으로 등록되었습니다.';
      btn.textContent = '완료';
      input.disabled = true;
    } else {
      // result은 오류 코드
      handleCreateError(result);
      btn.textContent = '등록하기';
    }
  } catch (e) {
    console.error('닉네임 등록 오류:', e);
    showError('알 수 없는 오류가 발생했습니다. 콘솔 로그 확인 또는 관리자에 문의하세요.');
    btn.textContent = '등록하기';
  } finally {
    pending = false;
    if (!input.disabled) btn.disabled = false;
  }
});

// 유효성 검사 함수
function validateNick(nick) {
  if (!nick || nick.length < MIN_LEN) return { ok: false, msg: `닉네임은 최소 ${MIN_LEN}자 이상이어야 합니다.` };
  if (nick.length > MAX_LEN) return { ok: false, msg: `닉네임은 최대 ${MAX_LEN}자까지 허용됩니다.` };
  if (!ALLOWED_RE.test(nick)) return { ok: false, msg: '허용되지 않는 문자가 포함되어 있습니다. 한글/영문/숫자/_/-/공백만 허용됩니다.' };
  const lower = nick.toLowerCase();
  for (const r of RESERVED) if (lower === r) return { ok: false, msg: '해당 닉네임은 사용할 수 없습니다.' };
  return { ok: true };
}

// 닉네임으로 안전한 문서 ID 생성 (스페이스->언더스코어, NFC 정규화, URI 인코딩)
function slugFromNick(nick) {
  const n = nick.normalize('NFC').trim().replace(/\s+/g, '_');
  // doc id로 안전하게 만들기 위해 encodeURIComponent 사용
  return encodeURIComponent(n);
}

// 트랜잭션으로 닉네임 유일성 보장 및 users/{uid}에 닉네임 저장
async function createNicknameTransaction(uid, nick) {
  const slug = slugFromNick(nick);
  const nickRef = doc(db, 'nicknames', slug);
  const userRef = doc(db, 'users', uid);

  try {
    await runTransaction(db, async (tx) => {
      const nickSnap = await tx.get(nickRef);
      if (nickSnap.exists()) {
        throw { code: 'ALREADY_EXISTS' };
      }
      // (선택) 사용자가 이미 닉을 가지고 있는 경우: 덮어쓰기 허용 안함 또는 변경 로직
      const userSnap = await tx.get(userRef);
      if (userSnap.exists() && userSnap.data().nickname) {
        // 이미 닉이 있는 경우 덮어쓰지 않음(정책에 따라 변경 가능)
        throw { code: 'USER_HAS_NICK' };
      }
      // 닉네임 문서 생성
      tx.set(nickRef, {
        uid,
        displayNick: nick,
        createdAt: serverTimestamp()
      });
      // users/{uid}에 nickname 필드 저장 (merge)
      tx.set(userRef, {
        nickname: nick,
        nicknameSlug: slug,
        nicknameCreatedAt: serverTimestamp()
      }, { merge: true });
    });
    return 'ok';
  } catch (e) {
    // runTransaction 내부에서 던진 에러를 구분
    if (e && e.code) return e.code;
    // Firestore transaction 중의 다른 에러
    console.error('transaction failed', e);
    throw e;
  }
}

// 에러 처리/메시지 맵핑
function handleCreateError(code) {
  if (code === 'ALREADY_EXISTS') {
    showError('이미 사용 중인 닉네임입니다. 다른 닉네임을 선택해주세요.');
  } else if (code === 'USER_HAS_NICK') {
    showError('이미 등록된 닉네임이 있습니다. 닉네임 변경은 계정 설정에서 가능합니다.');
  } else {
    showError('닉네임 등록 중 문제가 발생했습니다. 다시 시도해 주세요.');
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
