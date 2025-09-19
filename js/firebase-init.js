// js/firebase-init.js  (ArkTube v0.1)
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// --- 프로젝트 설정 (제공값 그대로) ---
const firebaseConfig = {
  apiKey: "AIzaSyBYIENuzNGaI_v2yGq-_6opbchsLV1PxSw",
  authDomain: "theark-3c896.firebaseapp.com",
  projectId: "theark-3c896",
  // 아래 항목은 콘솔에서 필요 시 채워 넣으세요.
  // storageBucket: "theark-3c896.appspot.com",
  // messagingSenderId: "XXXXXXXXXXXX",
  // appId: "1:XXXXXXXXXXXX:web:YYYYYYYYYYYYYYYYYYYYYY"
};

// --- Initialize (중복 초기화 방지) ---
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// 지속 로그인(브라우저 로컬)
await setPersistence(auth, browserLocalPersistence);

// Google Provider (팝업/리다이렉트에서 재사용)
const googleProvider = new GoogleAuthProvider();
// 최소 범위: 기본 프로필/이메일
googleProvider.setCustomParameters({ prompt: 'select_account' });

export { app, auth, db, googleProvider };
