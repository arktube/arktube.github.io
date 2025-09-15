// js/firebase-init.js  (arktube safe init, 12.1.0)
// - 여러 번 include 되어도 중복 초기화 방지
// - 퍼시스턴스: indexedDB → local → session → memory 순 폴백
// - GitHub Pages(https://arktube.github.io) + Firebase Hosting 모두 호환

import {
  initializeApp,
  getApps,
  getApp,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// ─────────────────────────────────────
// 운영 시 window.__FIREBASE_CONFIG 주입 가능(예: 환경별 스위칭)
// 없으면 아래 arktube(theark-3c896) 고정값 사용
const fallback = {
  apiKey: "AIzaSyBYIENuzNGaI_v2yGq-_6opbchsLV1PxSw",
  authDomain: "theark-3c896.firebaseapp.com",
  projectId: "theark-3c896",
  storageBucket: "theark-3c896.appspot.com",
  // messagingSenderId / appId 는 필수 아님 (필요 시 콘솔에서 추가 복사)
};

const cfg =
  (globalThis.__FIREBASE_CONFIG && typeof globalThis.__FIREBASE_CONFIG === "object")
    ? globalThis.__FIREBASE_CONFIG
    : fallback;

// 중복 초기화 방지
const app = getApps().length ? getApp() : initializeApp(cfg);

// 기본 모듈
export const auth = getAuth(app);
export const db   = getFirestore(app);

// 퍼시스턴스 단계적 설정 (실패 시 폴백)
try {
  await setPersistence(auth, indexedDBLocalPersistence);
} catch {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    try {
      await setPersistence(auth, browserSessionPersistence);
    } catch {
      await setPersistence(auth, inMemoryPersistence);
    }
  }
}

// 선택: 설정 확인 로그(필요 시 주석 해제)
// console.log("[firebase-init] projectId =", cfg.projectId, "authDomain =", cfg.authDomain);
