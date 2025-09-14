// js/firebase-init.js ?v=1.5.1 (iOS Safari 대비: 확실한 폴백 + 중복 초기화 방지)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBdZwzeAB91VnR0yqZK9qcW6LsOdCfHm8U",
  authDomain: "copytube-daf30.firebaseapp.com",
  projectId: "copytube-daf30",
  storageBucket: "copytube-daf30.firebasestorage.app",
  messagingSenderId: "117023042089",
  appId: "1:117023042089:web:0546aa120f3ced3947ca38",
  measurementId: "G-CNPT9SCSYH"
};

const app = initializeApp(firebaseConfig);

/*
 iOS 사파리(특히 프라이빗 모드)에서는 IndexedDB / localStorage가 제한될 수 있습니다.
 initializeAuth에 복수 퍼시스턴스를 주고, 마지막에 inMemory까지 두면
 어떤 환경에서도 Auth 초기화가 실패하지 않도록 보장됩니다.
 또한 번들/모듈 중복 로드 시 initializeAuth 재호출로 에러가 날 수 있으니
 전역 플래그로 1회만 initializeAuth를 수행합니다.
*/
let auth;
if (!globalThis.__copytubeAuthInitialized) {
  try {
    auth = initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence, // 최종 폴백
      ],
    });
  } catch (e) {
    // 이미 어딘가에서 getAuth(app)로 초기화된 경우 등
    auth = getAuth(app);
  }
  globalThis.__copytubeAuthInitialized = true;
} else {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
