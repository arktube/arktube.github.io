// js/admin-common.js
import { auth, db } from './firebase-init.js';
import { onAuthStateChanged } from './auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

export function escapeHTML(s=''){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));
}

export function sanitizeMessage(raw=''){
  // 앞뒤 공백 제거 + 줄바꿈 정규화 + 길이 제한 + 제어문자 제거
  let s = String(raw).replace(/\r\n?/g, '\n').trim();
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
  if (s.length > 2000) s = s.slice(0, 2000);
  return s;
}

export async function isAdminCurrentUser(){
  const u = auth.currentUser;
  if (!u) return false;
  try{
    const snap = await getDoc(doc(db,'admins', u.uid));
    return snap.exists();
  }catch{ return false; }
}

export function requireAdminUI(adminOnlyEls){
  // adminOnlyEls: NodeList 또는 배열(관리자만 보여줄 엘리먼트들)
  onAuthStateChanged(auth, async (user)=>{
    const ok = !!user && await isAdminCurrentUser();
    adminOnlyEls.forEach(el => {
     if (!el) return;
     el.style.display = ok ? 'block' : 'none';
    });
  });
}

export function fmtDate(ts){
  try{
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  }catch{ return ''; }
}
