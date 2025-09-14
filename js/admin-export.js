import { auth, db } from "./firebase-init.js";
import {
  collection, getDocs, query, orderBy, limit, startAfter,
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

/* ===== 설정 ===== */
const VIDEO_COLL = "videos"; // 프로젝트에서 사용중인 컬렉션명과 다르면 여기만 바꾸세요.

/* ===== 관리자 게이트 ===== */
async function isAdmin(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch (e) {
    console.error("isAdmin error:", e);
    return false;
  }
}
function deny() {
  alert("관리자만 접근 가능합니다.");
  location.href = "index.html";
}

/* ===== 카테고리 로딩 & 코드 매핑 =====
   - categories.js가 ESM으로 CATEGORIES(또는 default)를 export한다고 가정
   - 실패 시: DB에서 영상의 cats 필드를 스캔해 키 목록을 추정(확실하지 않음: 빈 DB면 목록이 줄어듦)
*/
async function loadCategoriesSafe() {
  try {
    const mod = await import("./categories.js");
    const CATS = mod.CATEGORIES || mod.default || null;
    if (!CATS) throw new Error("CATEGORIES export not found");
    return flattenCats(CATS);
  } catch (e) {
    console.warn("categories.js 로드 실패. DB 스캔으로 대체(확실하지 않음):", e);
    const keys = await scanCategoryKeysFromDB();
    return keys.map(k => ({ key: k, label: k }));
  }
}
function flattenCats(CATS) {
  // 예상 구조: 그룹/하위카테고리 → {key,label}
  const out = [];
  const pushItem = (k, label) => out.push({ key: k, label: label || k });
  // 유연한 파서: 객체/배열 혼합 지원
  const dfs = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(dfs);
    } else if (typeof node === "object") {
      // {key, label} 형태
      if (node.key) pushItem(node.key, node.label);
      // 중첩 탐색
      Object.values(node).forEach(v => {
        if (v && typeof v === "object") dfs(v);
      });
    }
  };
  dfs(CATS);
  // key 중복 제거
  const seen = new Set();
  return out.filter(({key}) => (key && !seen.has(key)) && seen.add(key));
}
async function scanCategoryKeysFromDB() {
  const keys = new Set();
  try {
    const q = query(collection(db, VIDEO_COLL), orderBy("createdAt"), limit(2000));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const cats = d.data().cats || [];
      cats.forEach(k => keys.add(k));
    });
  } catch (e) {
    console.error("scanCategoryKeysFromDB failed:", e);
  }
  return [...keys].sort();
}

/* 안정적 4자리 숫자 코드 (DJB2 해시 → 1000~9999) */
function keyToCodeStable(key) {
  let h = 5381;
  for (const ch of key) h = ((h << 5) + h) + ch.charCodeAt(0);
  const code = (h >>> 0) % 9000 + 1000;
  return String(code);
}
/* 충돌 방지: 키를 정렬된 순서로 배정하며 충돌시 +1 순회 */
function buildCodeMaps(keys) {
  const sorted = [...keys].sort();
  const used = new Set();
  const keyToCode = new Map();
  const codeToKey = new Map();
  for (const k of sorted) {
    let c = keyToCodeStable(k);
    let guard = 0;
    while (used.has(c) && guard < 10000) {
      c = String((Number(c) % 9000) + 1001); // 1001~10000 순회
      guard++;
    }
    used.add(c);
    keyToCode.set(k, c);
    codeToKey.set(c, k);
  }
  return { keyToCode, codeToKey };
}

/* ===== UI ===== */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

let ABORT = false;

async function renderCodeTable(list, keyToCode) {
  const tb = $("#codeTable tbody");
  tb.innerHTML = "";
  for (const {key, label} of list) {
    const tr = document.createElement("tr");
    const code = keyToCode.get(key);
    tr.innerHTML = `<td>${code}</td><td>${key}</td><td>${label || ""}</td>`;
    tb.appendChild(tr);
  }
}

async function extractAll(batchSize, codeToKey, keyToCode) {
  ABORT = false;
  $("#exportBox").value = "";
  $("#stat").textContent = "추출 중…";
  let cursor = null;
  let total = 0;

  const append = (lines) => {
    const ta = $("#exportBox");
    ta.value += (ta.value ? "\n" : "") + lines.join("\n");
  };

  while (!ABORT) {
    const q = cursor
      ? query(collection(db, VIDEO_COLL), orderBy("createdAt"), startAfter(cursor), limit(batchSize))
      : query(collection(db, VIDEO_COLL), orderBy("createdAt"), limit(batchSize));
    const snap = await getDocs(q);
    if (snap.empty) break;

    const lines = [];
    snap.forEach(docu => {
      const d = docu.data();
      const url = d.url || "";
      const cats = Array.isArray(d.cats) ? d.cats : [];
      const codes = cats.map(k => keyToCode.get(k)).filter(Boolean);
      const line = [url, ...codes].join(" ").trim();
      if (url) lines.push(line);
    });
    append(lines);
    total += lines.length;
    $("#stat").textContent = `총 ${total}개 내보냄`;

    const last = snap.docs[snap.docs.length - 1];
    cursor = last;

    if (snap.size < batchSize) break; // 마지막 배치
  }

  $("#stat").textContent = ABORT ? `중지됨 (현재 ${total}개까지)` : `완료 (총 ${total}개)`;
}

function copyText() {
  const txt = $("#exportBox").value;
  navigator.clipboard.writeText(txt).then(() => {
    alert("복사되었습니다.");
  });
}
function downloadTxt() {
  const blob = new Blob([$("#exportBox").value], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `copytube-export-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ===== init ===== */
onAuthStateChanged(auth, async (user) => {
  if (!user || !(await isAdmin(user.uid))) return deny();

  const catsList = await loadCategoriesSafe();
  const { keyToCode, codeToKey } = buildCodeMaps(catsList.map(x => x.key));
  await renderCodeTable(catsList, keyToCode);

  $("#btnExtract").addEventListener("click", async () => {
    const bs = parseInt($("#batchSize").value || "500", 10);
    ABORT = false;
    await extractAll(bs, codeToKey, keyToCode);
  });
  $("#btnStop").addEventListener("click", () => { ABORT = true; });
  $("#btnCopy").addEventListener("click", copyText);
  $("#btnDownload").addEventListener("click", downloadTxt);
  $("#btnClear").addEventListener("click", () => { $("#exportBox").value = ""; $("#stat").textContent = "대기중"; });
});
