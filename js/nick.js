// js/nick.js (업데이트된 전체 파일 — 성공 후 자동 이동 포함)
import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from './auth.js';
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

const MIN_LEN = 2;
const MAX_LEN = 20;
const ALLOWED_RE = /^[\p{L}\p{N}\-\_\s]+$/u;
const RESERVED = ['admin','administrator','system','null','undefined','support','root'];

input.addEventListener('input', () => {
  const v = input.value.trim();
  if (v.length === 0) {
    previewWrap.style.display = 'none';
    return;
  }
  previewWrap.style.display = 'block';
  previewNick.textContent = v;
  clearError();
});

onAuthStateChanged((user) => {
  currentUser = user || null;
  if (!currentUser) {
    showError('로그인이 필요합니다. 로그인 후 시도해 주세요.');
    btn.disabled = true;
  } else {
    btn.disabled = false;
  }
});

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearError();

  if (pending) return;
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

  try {
    pending = true;
    btn.disabled = true;
    btn.textContent = '등록 중...';
    statusEl.style.display = 'none';

    const result = await createNicknameTransaction(currentUser.uid, rawNick);
    if (result === 'ok') {
      // 성공 메시지 보여주고 자동 이동
      statusEl.style.display = 'block';
      statusEl.className = 'small ok';
      statusEl.textContent = '성공적으로 등록되었습니다. 잠시 후 인덱스로 이동합니다...';

      // 버튼 텍스트 갱신
      btn.textContent = '완료';
      input.disabled = true;

      // 자동 이동: index 파일이 프로젝트 루트에 있는 경우 './index.html' 사용
      // index 위치가 다르면 아래 경로를 프로젝트에 맞게 수정하세요.
      setTimeout(() => {
        window.location.href = './index.html';
      }, 700); // 0.7초 후 이동 (짧은 지연으로 메시지 확인 가능)
    } else {
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

function validateNick(nick) {
  if (!nick || nick.length < MIN_LEN) return { ok: false, msg: `닉네임은 최소 ${MIN_LEN}자 이상이어야 합니다.` };
  if (nick.length > MAX_LEN) return { ok: false, msg: `닉네임은 최대 ${MAX_LEN}자까지 허용됩니다.` };
  if (!ALLOWED_RE.test(nick)) return { ok: false, msg: '허용되지 않는 문자가 포함되어 있습니다. 한글/영문/숫자/_/-/공백만 허용됩니다.' };
  const lower = nick.toLowerCase();
  for (const r of RESERVED) if (lower === r) return { ok: false, msg: '해당 닉네임은 사용할 수 없습니다.' };
  return { ok: true };
}

function slugFromNick(nick) {
  const n = nick.normalize('NFC').trim().replace(/\s+/g, '_');
  return encodeURIComponent(n);
}

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
      const userSnap = await tx.get(userRef);
      if (userSnap.exists() && userSnap.data().nickname) {
        throw { code: 'USER_HAS_NICK' };
      }
      tx.set(nickRef, {
        uid,
        displayNick: nick,
        createdAt: serverTimestamp()
      });
      tx.set(userRef, {
        nickname: nick,
        nicknameSlug: slug,
        nicknameCreatedAt: serverTimestamp()
      }, { merge: true });
    });
    return 'ok';
  } catch (e) {
    if (e && e.code) return e.code;
    console.error('transaction failed', e);
    throw e;
  }
}

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
