// /js/auth.js  (ArkTube v0.1 — Google Only, users/{uid} 생성 보장)
import { auth, db, googleProvider } from './firebase-init.js';
import {
  signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged as _onAuthStateChanged, signOut as _signOut
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

/** onAuthStateChanged 래퍼: (cb) 또는 (auth, cb) 모두 지원 */
export function onAuthStateChanged(a, b){
  if (typeof a === 'function') return _onAuthStateChanged(auth, a);
  return _onAuthStateChanged(a, b);
}

/** users/{uid} 문서 보장: 가입날짜 + 구글표시명 저장 */
export async function ensureUserProfile(user){
  if (!user) return;
  const uid = user.uid;
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid,
      displayName: user.displayName || null,
      email: user.email || null,
      joinedAt: serverTimestamp(),
      role: 'user',
      status: 'active'
    }, { merge: true });
  } else {
    // 표시명이 바뀌었으면 최신화(선택)
    const cur = snap.data();
    if (cur.displayName !== user.displayName) {
      await setDoc(ref, { displayName: user.displayName || null }, { merge: true });
    }
  }
}

/** 팝업 우선, 실패 시 리다이렉트 — 둘 다 profile 보장 */
export async function signInWithGoogle(){
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureUserProfile(cred.user);
    return cred.user;
  } catch (e) {
    await signInWithRedirect(auth, googleProvider);
    // 리다이렉트 복귀 시점
    const result = await getRedirectResult(auth).catch(()=>null);
    if (result?.user) await ensureUserProfile(result.user);
    return result?.user || null;
  }
}

export async function signOut(){ await _signOut(auth); }
export function currentDisplayName(){ return auth.currentUser?.displayName || ''; }

// 로그인 상태 변화 시에도 프로필 보장(자동)
onAuthStateChanged(async (u)=>{ if (u) await ensureUserProfile(u); });

export { auth, db };
