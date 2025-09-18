// js/auth.js  (ArkTube Google Only, drop-in, backwards-compatible)
// - onAuthStateChanged(cb) / onAuthStateChanged(auth, cb) 둘 다 지원
// - Google 로그인 팝업/리다이렉트 지원 + 리다이렉트 결과 처리 핸들러
// - 최초 로그인 시 users/{uid} 최소 문서 생성 (없을 때만)

import { auth, db } from './firebase-init.js?v=1.5.1';
export { auth, db };

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged as _onAuthStateChanged,
  signOut as _signOut
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  doc, getDoc, runTransaction, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// 필요할 수 있는 firestore 유틸 재노출
export { doc, getDoc, runTransaction, serverTimestamp };

/* -------------------------------------------------------
 * onAuthStateChanged 호환 래퍼
 * - (cb) 또는 (auth, cb) 모두 허용
 * - 내부적으로 기본 auth를 고정해서 사용 (CopyTube 스타일)
 * - 다른 auth 인스턴스를 넘겨도 그대로 처리
 * ----------------------------------------------------- */
export function onAuthStateChanged(a, b) {
  // 형태 1: onAuthStateChanged(cb)
  if (typeof a === 'function' && b === undefined) {
    return _onAuthStateChanged(auth, (user) => { try { a(user); } catch(e){ console.error('[auth] listener error:', e); } },
      (err)=>console.error('[auth] onAuthStateChanged error:', err));
  }
  // 형태 2: onAuthStateChanged(auth, cb)
  if (a && typeof b === 'function') {
    return _onAuthStateChanged(a, (user) => { try { b(user); } catch(e){ console.error('[auth] listener error:', e); } },
      (err)=>console.error('[auth] onAuthStateChanged error:', err));
  }
  throw new TypeError('onAuthStateChanged: expected (cb) or (auth, cb)');
}

/* -------------------------
 * Google 로그인/로그아웃
 * ----------------------- */
export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  await _ensureUserDoc(result?.user?.uid);
  return result;
}

export async function signInWithGoogleRedirect() {
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(auth, provider);
}

export async function handleRedirectResult() {
  const result = await getRedirectResult(auth);
  if (result?.user?.uid) await _ensureUserDoc(result.user.uid);
  return result;
}

export async function signOut() {
  return _signOut(auth);
}

// 호환: 기존 코드가 fbSignOut 이름을 import하는 경우를 위해 별칭 제공
export async function fbSignOut() {
  return _signOut(auth);
}

/* ----------------------------------------------
 * 최초 로그인시 users/{uid} 최소 프로필 보장 (없을 때만)
 * -------------------------------------------- */
async function _ensureUserDoc(uid) {
  if (!uid) return;
  const ref = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        createdAt: serverTimestamp(),
        nickname: null,
        role: 'user'
      });
    }
  });
}
/* ✅ 추가: 외부에서 쓸 수 있도록 공개 export */
export async function ensureUserDoc(uid) {
  return _ensureUserDoc(uid);
}

/* ✅ 추가: signup.js가 기대하는 이름으로 로그인 함수 제공 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result?.user ?? null;
    if (user?.uid) await _ensureUserDoc(user.uid);
    return user; // signup.js에서 user를 바로 사용
  } catch (e) {
    // 팝업 불가 환경이면 redirect 폴백
    try {
      await signInWithRedirect(auth, provider);
      // redirect 후 복귀 시점은 별도 처리 없으면 user를 즉시 못 받지만,
      // 팝업이 가능한 환경이라면 여기로 오지 않습니다.
      return null;
    } catch {
      throw e; // 원래 오류 다시 던져서 상위에서 메시지 표시
    }
  }
}
