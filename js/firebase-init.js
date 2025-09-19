// js/firebase-init.js  (ArkTube v0.1, final)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { getAnalytics, isSupported as analyticsSupported } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-analytics.js";

// ===== Firebase Config (정정 반영) =====
const firebaseConfig = {
  apiKey: "AIzaSyBYIENuzNGaI_v2yGq-_6opbchsLV1PxSw",
  authDomain: "theark-3c896.firebaseapp.com",
  projectId: "theark-3c896",
  storageBucket: "theark-3c896.appspot.com",   // ← 중요: 버킷 "이름" 기입
  messagingSenderId: "379931162458",
  appId: "1:379931162458:web:b9a6ffe1feb5b94636a563",
  measurementId: "G-Y1T68JLMBF"
};

// ===== Initialize (중복 방지) =====
const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// 영구 로그인
await setPersistence(auth, browserLocalPersistence);

// Google Provider (공용)
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Analytics (지원환경에서만)
let analytics = null;
try {
  if (await analyticsSupported()) {
    analytics = getAnalytics(app);
  }
} catch (_) {
  // 로컬파일/비지원 환경에서 조용히 무시
}

export { app, auth, db, googleProvider, analytics };
