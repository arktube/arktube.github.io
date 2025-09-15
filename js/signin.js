// js/signin.js (arktube v1)
import { db, onAuthStateChanged, signInWithGoogle, ensureUserDoc } from './auth.js';
import { doc, getDoc } from './auth.js';

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
    await ensureUserDoc(user.uid, user.displayName || "회원");
    const snap = await getDoc(doc(db, "users", user.uid));
    const data = snap.exists() ? snap.data() : {};
    const hasNick = !!data?.nick;
    location.replace(hasNick ? "index.html" : "nick.html");
  }catch(e){
    console.error("[signin] profile read err:", e);
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
  }catch(e){
    console.error(e);
    show("구글 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
  }
});
