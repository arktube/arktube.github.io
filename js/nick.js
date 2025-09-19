// /js/nick.js v0.1.2
import { auth, db } from "./firebase-init.js?v=0.1.0";
import {
  onAuthStateChanged, updateProfile, setNicknameProfile, sanitizeNickname
} from "./auth.js?v=0.1.1";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

function $(s){ return document.querySelector(s); }
function setMsg(t){
  const el = $("#nickMsg");
  if (el) el.textContent = t || "";
}

// DOMContentLoaded 후 바인딩 (초기 null 회피)
window.addEventListener("DOMContentLoaded", () => {
  const input = $("#nickInput");
  const saveBtn = $("#nickSave");

  if (!input || !saveBtn) {
    console.warn("[nick] required elements missing");
    return;
  }

  // 로그인 상태 감시
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setMsg("로그인이 필요합니다.");
      setTimeout(() => location.href = "signin.html", 600);
      return;
    }

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const cur = snap.exists() ? String(snap.data()?.displayName || "") : "";
      if (cur) {
        input.value = cur;
        setMsg("이미 닉네임이 설정되어 있습니다. 변경 후 저장을 누르세요.");
      } else {
        setMsg("닉네임을 입력해 주세요.");
      }
    } catch(e) {
      console.error(e);
      setMsg("사용자 정보를 불러오지 못했습니다.");
    }
  });

  async function saveNickname(){
    const user = auth.currentUser;
    if (!user) { setMsg("로그인이 필요합니다."); return; }

    const clean = sanitizeNickname(input.value);
    if (!clean) {
      setMsg("닉네임 형식: 한글/영문/숫자/_-. · 2~20자");
      input.focus();
      return;
    }

    saveBtn.disabled = true;
    setMsg("저장 중…");
    try {
      // 닉 점유를 규칙과 맞춰 쓰는 경우:
      // await setNicknameProfile(user.uid, clean, { claimUniq: true });

      // 우선은 단순 저장(규칙 그대로여도 정상 동작)
      await setDoc(doc(db, "users", user.uid), {
        displayName: clean,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });

      if (auth.currentUser?.uid === user.uid) {
        await updateProfile(user, { displayName: clean });
      }

      setMsg("닉네임이 저장되었습니다.");
      setTimeout(() => location.href = "upload.html", 600);
    } catch(e) {
      console.error(e);
      setMsg(e?.message || "닉네임 저장 중 오류가 발생했습니다.");
    } finally {
      saveBtn.disabled = false;
    }
  }

  saveBtn.addEventListener("click", (e) => { e.preventDefault(); saveNickname(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); saveNickname(); }
  });
});
