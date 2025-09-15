// js/signup.js (arktube v1)
import { db, onAuthStateChanged, signInWithGoogle, ensureUserDoc } from "./js/auth.js";
import { doc, getDoc } from "./js/auth.js";

const btn = document.getElementById("btnGoogle");
const msg = document.getElementById("msg");

function show(text, ok=false){
  if(!msg) return;
  msg.textContent = text;
  msg.className = "msg show " + (ok ? "ok" : "err");
}

// 회원가입 목적: 로그인되면 닉네임 유무 확인 → 없으면 nick.html 로 강제
async function routeAfterLogin(user){
  if(!user) return;
  try{
    await ensureUserDoc(user.uid, user.displayName || "회원");
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!data?.nick;
    location.replace(hasNick ? "index.html" : "nick.html");
  }catch(e){
    console.error("[signup] profile read err:", e);
    // 문제 시에도 닉 설정으로
    location.replace("nick.html");
  }
}

onAuthStateChanged((user)=>{
  if(user) routeAfterLogin(user);
});

btn?.addEventListener("click", async ()=>{
  try{
    await signInWithGoogle();
    show("인증 성공! 닉네임을 정하러 갑니다…", true);
  }catch(e){
    console.error(e);
    show("구글 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
});
