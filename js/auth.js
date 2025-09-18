// js/auth.js  (ArkTube Google Only, kidsani 규칙 호환 최종)
// - onAuthStateChanged(cb) / onAuthStateChanged(auth, cb) 둘 다 지원
// - Google 로그인 팝업/리다이렉트 + 리다이렉트 결과 처리
// - 최초 로그인 시 users/{uid} 최소 문서 생성: {createdAt, updatedAt} 만 기록
//   (⚠ 규칙상 nickname/role 은 생성 시 금지. nickname 은 nick.html에서 별도 저장)

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
 * ----------------------------------------------------- */
export function onAuthStateChanged(a, b) {
  // 형태 1: onAuthStateChanged(cb)
  if (typeof a === 'function' && b === undefined) {
    return _onAuthStateChanged(
      auth,
      (user) => { try { a(user); } catch(e){ console.error('[auth] listener error:', e); } },
      (err)  => console.error('[auth] onAuthStateChanged error:', err)
    );
  }
  // 형태 2: onAuthStateChanged(auth, cb)
  if (a && typeof b === 'function') {
    return _onAuthStateChanged(
      a,
      (user) => { try { b(user); } catch(e){ console.error('[auth] listener error:', e); } },
      (err)  => console.error('[auth] onAuthStateChanged error:', err)
    );
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

// 호환 별칭
export async function fbSignOut() {
  return _signOut(auth);
}

/* -------------------------------------------------------
 * 외부에서 직접 호출 가능한 보장 함수
 * ----------------------------------------------------- */
export async function ensureUserDoc(uid) {
  return _ensureUserDoc(uid);
}

/* -------------------------------------------------------
 * users/{uid} 최소 프로필 보장 (규칙 호환)
 * - 최초 생성: { createdAt, updatedAt }만 기록
 * - 이후 로그인: updatedAt만 갱신
 * ----------------------------------------------------- */
async function _ensureUserDoc(uid) {
  if (!uid) return;
  const ref = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      // ✅ 규칙 허용 키만 사용 (nickname/role 쓰지 않음)
      tx.set(ref, {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      tx.set(ref, { updatedAt: serverTimestamp() }, { merge: true });
    }
  });
}

/* -------------------------------------------------------
 * 한 함수로 팝업 우선 + 리다이렉트 폴백
 *  - signin.js / signup.js 에서 이 함수만 쓰면 됩니다.
 * ----------------------------------------------------- */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    const { user } = await signInWithPopup(auth, provider);
    if (user?.uid) await _ensureUserDoc(user.uid);
    return user ?? null;
  } catch (e) {
    // 팝업 불가 환경 → 리다이렉트 폴백
    await signInWithRedirect(auth, provider);
    // 리다이렉트 복귀 시점에서 handleRedirectResult()가 처리
    return null;
  }
}
