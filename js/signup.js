// js/signup.js  (username or email signup)
// - nickname: only a–z (lowercase). Stored to usernames/{nickLower} for uniqueness.
// - email: normal email signup (no usernames mapping).
// - If usernames mapping fails after account creation (race), the new user is deleted immediately.

import { auth, db } from './firebase-init.js';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp, setDoc as _setDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const $ = (s)=>document.querySelector(s);
const form   = $('#signupForm');
const idBox  = $('#signupIdOrEmail');
const pwBox  = $('#signupPassword');

function isEmail(v){
  return /.+@.+\..+/.test(v);
}
function toNickLower(raw){
  return String(raw||'').trim().toLowerCase();
}
function isValidNick(nickLower){
  // 영소문자만 (길이 제한은 UI가 안내, 여기서는 2~20 권장)
  return /^[a-z]{2,20}$/.test(nickLower);
}
function synthEmailFromNick(nickLower){
  // Firebase는 이메일이 필요하므로 내부용 도메인으로 전환
  return `${nickLower}@copytube.local`;
}
function msg(text){
  // 간단 안내: submit 버튼 바로 위/아래에 alert 대신 브라우저 기본 경고 사용 최소화
  // 여기선 콘솔과 alert을 병행 (원하면 UI 문구 영역 추가 가능)
  console.log('[signup]', text);
}

async function ensureNickAvailable(nickLower){
  // Firestore: usernames/{nickLower} 존재 여부 확인
  try{
    const snap = await getDoc(doc(db,'usernames', nickLower));
    return !snap.exists();
  }catch{
    // 네트워크 이슈 시엔 일단 사용 불가로 취급 (보수적으로)
    return false;
  }
}

async function claimNickMapping(uid, nickLower){
  // Security Rules가 "이미 존재하면 create 불가"로 막고 있어야 함.
  // (rules에서: allow create: if !exists(doc))
  await setDoc(doc(db,'usernames', nickLower), {
    uid,
    createdAt: serverTimestamp()
  });
}

async function createUserDoc(uid, displayName){
  try{
    await setDoc(doc(db,'users', uid), {
      displayName,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    }, { merge: true });
  }catch(e){
    // non-fatal
    console.warn('users doc write failed:', e);
  }
}

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();

  const rawId = idBox.value;
  const password = pwBox.value;

  // 간단 가드
  if(!rawId || !password){
    alert('아이디(또는 이메일)와 비밀번호를 입력해 주세요.');
    return;
  }

  // 이메일 경로
  if (isEmail(rawId)){
    try{
      const cred = await createUserWithEmailAndPassword(auth, rawId.trim(), password);
      const user = cred.user;
      // displayName: 이메일 앞부분을 기본 닉으로
      const displayName = String(rawId).split('@')[0].toLowerCase();
      try{ await updateProfile(user, { displayName }); }catch{}
      await createUserDoc(user.uid, displayName);
      location.href = 'index.html';
    }catch(err){
      console.error(err);
      alert(readableError(err));
    }
    return;
  }

  // 닉네임 경로 (영소문자만)
  const nickLower = toNickLower(rawId);
  if (!isValidNick(nickLower)){
    alert('아이디는 영어 소문자, 숫자 2~20자로 입력해 주세요.');
    return;
  }

  // (선체크) 사용 가능 확인
  const free = await ensureNickAvailable(nickLower);
  if (!free){
    alert('이미 사용 중인 아이디입니다. 다른 아이디를 선택해 주세요.');
    return;
  }

  const emailSynth = synthEmailFromNick(nickLower);

  try{
    // 1) 계정 생성
    const cred = await createUserWithEmailAndPassword(auth, emailSynth, password);
    const user = cred.user;

    // 2) 사용자 프로필/문서
    try{ await updateProfile(user, { displayName: nickLower }); }catch{}
    await createUserDoc(user.uid, nickLower);

    // 3) usernames 맵핑(유일). 규칙에 의해 이미 존재하면 실패 -> 계정 롤백
    try{
      await claimNickMapping(user.uid, nickLower);
    }catch(mapErr){
      console.error('mapping failed, rolling back user:', mapErr);
      // 방금 만든 계정 제거 (즉시 가능)
      try{ await deleteUser(user); }catch{}
      alert('해당 아이디가 방금 다른 사람에게 선점되었습니다. 다시 시도해 주세요.');
      return;
    }

    // 성공
    location.href = 'index.html';

  }catch(err){
    console.error(err);
    alert(readableError(err));
  }
});

function readableError(e){
  const code = e?.code || '';
  const msg  = e?.message || '';

  if (code.includes('auth/email-already-in-use')) return '이미 사용 중인 이메일입니다.';
  if (code.includes('auth/weak-password'))       return '비밀번호가 너무 짧습니다. (Firebase 정책: 최소 6자)';
  if (code.includes('auth/invalid-email'))       return '이메일 형식이 올바르지 않습니다.';
  if (code.includes('auth/network-request-failed')) return '네트워크 오류입니다. 잠시 후 다시 시도해 주세요.';
  return msg || '알 수 없는 오류가 발생했습니다.';
}
