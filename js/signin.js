// js/signin.js (arktube v1)
import { db, onAuthStateChanged, signInWithGoogle, ensureUserDoc } from "./js/auth.js";
import { doc, getDoc } from "./js/auth.js";

const btn = document.getElementById("btnGoogle");
const msg = document.getElementById("msg");

function show(text, ok=false){
  if(!msg) return;
  msg.textContent = text;
  msg.className = "msg show " + (ok ? "ok" : "err");
}

async function routeAfterLogin(user){
  if(!user) return;
  try{
    // 프로필 문서 보강(첫 로그인 대비)
    await ensureUserDoc(user.uid, user.displayName || "회원");
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!data?.nick;
    // 로그인 페이지는 닉 유무 관계없이 "시청" 목적 → 닉 있으면 index, 없으면 nick
    location.replace(hasNick ? "index.html" : "nick.html");
  }catch(e){
    console.error("[signin] profile read err:", e);
    // 문제가 있으면 일단 index로
    location.replace("index.html");
  }
}

onAuthStateChanged((user)=>{
  if(user) routeAfterLogin(user);
});

btn?.addEventListener("click", async ()=>{
  try{
    await signInWithGoogle();
    show("로그인 성공! 잠시만요…", true);
    // 라우팅은 onAuthStateChanged에서 처리
  }catch(e){
    console.error(e);
    show("구글 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
  }
});
