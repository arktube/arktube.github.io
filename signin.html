<!-- js/signin.js (v0.1.1) -->
<script type="module">
import { db } from './firebase-init.js';
import { signInWithGoogle, onAuthStateChanged } from './auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

const btnGoogle = document.getElementById('btnGoogle');
const msg = document.getElementById('msg');

function show(text, ok=false){
  msg.textContent = text;
  msg.className = 'msg show ' + (ok ? 'ok' : 'err');
}

// 여러 저장 키를 허용: nick / nickShown / nickname (+ displayName 보완)
const NICK_KEYS = ['nick', 'nickShown', 'nickname'];
function pickNick(data, user){
  for (const k of NICK_KEYS){
    const v = data && typeof data[k] === 'string' ? data[k].trim() : '';
    if (v.length >= 2) return v;
  }
  const dn = typeof user?.displayName === 'string' ? user.displayName.trim() : '';
  return dn.length >= 2 ? dn : '';
}

let navigated = false;
function go(url){
  if (navigated) return;
  navigated = true;
  location.replace(url);
}

// 로그인 상태면 닉 유무 확인 → 분기
onAuthStateChanged(async (user)=>{
  if(!user) return;
  try{
    const snap = await getDoc(doc(db, 'users', user.uid));
    const data = snap.exists() ? snap.data() : null;
    const nick = pickNick(data, user);
    const hasNick = !!nick;

    // 닉 있으면 index, 없으면 nick 설정
    go(hasNick ? 'index.html' : 'nick.html');
  }catch(e){
    // 권한/네트워크 문제 등으로 읽기 실패해도
    // "무조건 닉 페이지"로 보내지 않고, 우선 index로 보냄
    console.error('[signin] failed to read user profile:', e);
    go('index.html');
  }
});

btnGoogle?.addEventListener('click', async ()=>{
  try{
    await signInWithGoogle();
    show('로그인 성공! 잠시만요…', true);
    // 라우팅은 onAuthStateChanged에서 처리
  }catch(e){
    show('구글 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.');
    console.error(e);
  }
});
</script>
