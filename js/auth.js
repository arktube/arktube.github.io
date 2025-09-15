// js/auth.js  (arktube Auth, KidsAni v0.1.4 호환 래퍼)
// - onAuthStateChanged: (cb)와 (auth, cb) 모두 지원
// - signOut: 인자 무시(넘겨도 OK) → 기존 코드와 100% 호환
// - Firestore 유틸 재수출(페이지에서 직접 import 가능)
// - 최초 로그인 시 users/{uid} 문서 보강 + 닉네임 고유 맵 옵션

import { auth, db } from "./firebase-init.js";
export { auth, db };

// Firebase Auth 원함수
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged as fbOnAuthStateChanged,
  signOut as fbSignOut,
  updateProfile as fbUpdateProfile,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

// Firestore 원함수(페이지에서 직접 쓰고 싶을 때 재수출)
export {
  doc,
  runTransaction,
  setDoc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ─────────────────────────────────────
// onAuthStateChanged 래퍼: 두 형태 모두 지원
//   권장: onAuthStateChanged((user)=>{})
//   호환: onAuthStateChanged(auth, (user)=>{})
export function onAuthStateChanged(cbOrAuth, maybeCb) {
  const cb = (typeof cbOrAuth === "function") ? cbOrAuth : maybeCb;
  if (typeof cb !== "function") throw new Error("onAuthStateChanged: callback이 없습니다.");
  return fbOnAuthStateChanged(auth, cb);
}

// 구글 로그인(Popup)
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await signInWithPopup(auth, provider);
  return cred.user; // 필요 시 cred 추가 반환 가능
}

// signOut: 인자 무시(넘겨도 OK) — 기존 코드와 호환
export async function signOut(..._args) { await fbSignOut(auth); }
export async function logout(..._args) { await fbSignOut(auth); } // 별칭

// ─────────────────────────────────────
// 닉네임 정규화(한글/영문/숫자/[-_.], 2~20자)
export function sanitizeNickname(raw) {
  const s = String(raw ?? "").trim();
  return /^[\w가-힣\-_.]{2,20}$/.test(s) ? s : "";
}

// 최초 로그인/가입 직후: /users/{uid} 보강(존재하면 merge)
export async function ensureUserDoc(uid, displayName) {
  const { doc, setDoc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  try {
    await setDoc(
      doc(db, "users", uid),
      {
        displayName: displayName || "회원",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    console.warn("[ensureUserDoc] failed:", e);
  }
}

// (옵션) 닉네임-UID 고유 맵: nickname_to_uid/{lowerNick} = { uid, updatedAt }
export async function claimNicknameUniq(uid, nick) {
  const lower = String(nick || "").toLowerCase();
  if (!lower) throw new Error("닉네임이 비었습니다.");
  const { doc, runTransaction, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");
  const ref = doc(db, "nickname_to_uid", lower);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data()?.uid !== uid) {
      throw new Error("이미 사용 중인 닉네임입니다.");
    }
    tx.set(ref, { uid, updatedAt: serverTimestamp() });
  });
}

// 닉네임 저장 통합(프로필 + /users/{uid} + 고유맵)
export async function setNicknameProfile(uid, nick, { claimUniq = true } = {}) {
  const clean = sanitizeNickname(nick);
  if (!clean) throw new Error("닉네임 형식: 한글/영문/숫자/[-_.], 2~20자");
  const { doc, setDoc, serverTimestamp } =
    await import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js");

  if (claimUniq) await claimNicknameUniq(uid, clean);

  await setDoc(
    doc(db, "users", uid),
    { displayName: clean, updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
    { merge: true },
  );

  if (auth.currentUser?.uid === uid) {
    await fbUpdateProfile(auth.currentUser, { displayName: clean });
  }
  return clean;
}
