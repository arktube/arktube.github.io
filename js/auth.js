// js/auth.js  (ArkTube Google Only, drop-in)
// - 기존 코드와의 호환을 위해 export 형태 유지
// - 이메일/비번 관련 함수는 제거하되, 혹시 남은 코드가 import해도 즉시 에러로 안내되도록 보호 래퍼 제공
// - 최초 로그인 시 /users/{uid} 최소 프로필 생성

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
  doc, runTransaction, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// re-export 필요한 firestore 유틸(페이지에서 쓰고 있을 수 있음)
export { doc, runTransaction, serverTimestamp };

/* helpers (닉네임 클리너는 일부 페이지에서 재사용할 수 있어 유지) */
export function sanitizeNickname(raw){
  const s = String(raw||'').trim();
  if (!s) return '';
  // 허용: 한글/영문/숫자/[-_.], 길이 2~20
  if (!/^[\w가-힣\-_.]{2,20}$/.test(s)) return '';
  return s;
}

/* 최초 로그인 시 /users/{uid} 최소 프로필 생성/갱신 */
export async function ensureUserDoc(uid, displayName, photoURL){
  try{
    await setDoc(doc(db,'users', uid), {
      displayName: displayName || '회원',
      photoURL: photoURL || null,
      updatedAt: serverTimestamp()
    }, { merge:true });
  }catch(e){ /* ignore */ }
}

/* ============ Google Only ============ */
const provider = new GoogleAuthProvider();
// 계정 선택 강제(필요 시 주석 해제)
// provider.setCustomParameters({ prompt: 'select_account' });

export async function signInWithGoogle() {
  // 팝업 우선, 실패 시 리다이렉트 폴백(iOS 사파리 등)
  try {
    const res = await signInWithPopup(auth, provider);
    const u = res.user;
    await ensureUserDoc(u.uid, u.displayName, u.photoURL);
    return u;
  } catch (err) {
    // 팝업 불가 환경일 수 있음 → 리다이렉트로 폴백
    await signInWithRedirect(auth, provider);
    // 리다이렉트 후 복귀 시 처리
    try {
      const rr = await getRedirectResult(auth);
      if (rr?.user) {
        const u = rr.user;
        await ensureUserDoc(u.uid, u.displayName, u.photoURL);
        return u;
      }
    } catch(e){ /* ignore */ }
    throw err;
  }
}

export const onAuthStateChanged = _onAuthStateChanged;

// 기존 코드 호환: 일부 페이지가 fbSignOut 이름으로 import
export async function fbSignOut(){ await _signOut(auth); }

/* ===== 이메일/비번 API 사용 차단용 가드(혹시 남은 import가 있을 때 즉시 에러) ===== */
function _blocked(name){
  return () => { throw new Error(`[auth.js] ${name}는 비활성화되었습니다: ArkTube는 Google 로그인 전용입니다.`); };
}
export const signInWithEmailAndPassword = _blocked('signInWithEmailAndPassword');
export const createUserWithEmailAndPassword = _blocked('createUserWithEmailAndPassword');
export const updateProfile = _blocked('updateProfile(이메일/비번 경로)');
export const deleteUser = _blocked('deleteUser(이메일/비번 경로)');
