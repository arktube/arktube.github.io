// js/signup.js (v0.1.3 — route fix)
import { auth, db, onAuthStateChanged, signInWithGoogle, ensureUserDoc } from "./auth.js";
import { doc, getDoc } from "./auth.js";

const $ = (id) => document.getElementById(id);
const btnGoogle = $("btnGoogle");
const msg = $("msg");

function show(text, ok = false) {
  if (!msg) return;
  msg.textContent = text;
  msg.className = "msg show " + (ok ? "ok" : "err");
}

// ✅ 닉네임 유무는 Firestore의 users/{uid}.nick만 본다 (displayName 사용 X)
async function routeAfterLogin(user) {
  if (!user) return;
  try {
    // 사용자 문서가 없으면 보강(첫 로그인 대비)
    await ensureUserDoc(user.uid, user.displayName || "회원");

    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!data?.nick;   // ← 오직 nick 필드만 체크

    location.replace(hasNick ? "index.html" : "nick.html");
  } catch (e) {
    // 문제가 있어도 닉 설정 페이지로 보냄
    location.replace("nick.html");
  }
}

// 로그인 상태 감지 → 항상 routeAfterLogin 사용
onAuthStateChanged(async (user) => {
  if (user) routeAfterLogin(user);
});

// [Google로 시작]
btnGoogle?.addEventListener("click", async () => {
  try {
    await signInWithGoogle();    // 팝업 로그인
    show("로그인 성공! 닉네임을 정하러 가요…", true);
    // onAuthStateChanged에서 routeAfterLogin 처리
  } catch (e) {
    console.error(e);
    show("구글 인증에 실패했어요. 잠시 후 다시 시도해 주세요.");
  }
});
