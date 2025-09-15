// js/nick.js (arktube v1)
import { auth, db, onAuthStateChanged, setNicknameProfile, sanitizeNickname } from './auth.js';
import { doc, getDoc } from './auth.js';

const $ = (id)=>document.getElementById(id);
const input = $("nickInput");
const saveBtn = $("nickSave");
const msg = $("msg");

function show(text, ok=false){
  if(!msg) return;
  msg.textContent = text;
  msg.className = "msg show " + (ok ? "ok" : "err");
}

// 미로그인 접근 차단 + 기존 닉 프리필
onAuthStateChanged(async (user)=>{
  if(!user){
    location.replace("signin.html");
    return;
  }
  try{
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const nick = (typeof data?.nick === "string" && data.nick.trim()) || user.displayName || "";
    if(nick && input && !input.value) input.value = nick;
  }catch(e){
    console.warn("[nick] preload err:", e);
  }
});

saveBtn?.addEventListener("click", async ()=>{
  const user = auth.currentUser;
  if(!user){
    location.replace("signin.html");
    return;
  }
  const raw = input?.value ?? "";
  const clean = sanitizeNickname(raw);
  if(!clean){
    show("형식: 한글/영문/숫자/[-_.], 2~20자입니다.");
    return;
  }
  try{
    await setNicknameProfile(user.uid, clean, { claimUniq: true });
    show("저장되었습니다. 홈으로 이동합니다…", true);
    setTimeout(()=>location.replace("index.html"), 400);
  }catch(e){
    console.error(e);
    show(e?.message || "저장 중 오류가 발생했습니다.");
  }
});
