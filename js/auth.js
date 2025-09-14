// js/auth.js  (?v=1.5.1)
import { auth, db } from './firebase-init.js?v=1.5.1';
export { auth, db };

import {
  onAuthStateChanged as _onAuthStateChanged,
  signInWithEmailAndPassword as _signInWithEmailAndPassword,
  createUserWithEmailAndPassword as _createUserWithEmailAndPassword,
  updateProfile as _updateProfile,
  deleteUser as _deleteUser,
  signOut as _signOut,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  doc, runTransaction, setDoc, serverTimestamp,
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// re-export 필요한 firestore 유틸(페이지에서 쓰고 있음)
export { doc, runTransaction, serverTimestamp };

/* helpers */
export function sanitizeNickname(raw){
  const s = String(raw||'').trim();
  if (!s) return '';
  // 허용: 한글/영문/숫자/[-_.], 길이 2~20
  if (!/^[\w가-힣\-_.]{2,20}$/.test(s)) return '';
  return s;
}
export function normalizeLoginId(raw){
  const s = String(raw||'').trim();
  const emailLike = s.includes('@') ? s : `${s.toLowerCase()}@copytube.local`;
  return { emailLike };
}

/* auth wrappers */
export const onAuthStateChanged = _onAuthStateChanged;
export const signInWithEmailAndPassword = _signInWithEmailAndPassword;
export const createUserWithEmailAndPassword = _createUserWithEmailAndPassword;
export const updateProfile = _updateProfile;
export const deleteUser = _deleteUser;
export const signOut = _signOut;

/* after signup: optionally create /users/{uid} profile */
export async function ensureUserDoc(uid, displayName){
  try{
    await setDoc(doc(db,'users', uid), {
      displayName: displayName || '회원',
      updatedAt: serverTimestamp()
    }, { merge:true });
  }catch(e){ /* ignore */ }
}
