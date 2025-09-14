import { auth, db } from "./firebase-init.js";
import {
  collection, doc, getDoc, writeBatch, serverTimestamp,
  getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

/* ===== 설정 ===== */
const VIDEO_COLL = "videos";

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

/* ===== 카테고리 & 코드 ===== */
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
  const out = [];
  const pushItem = (k, label) => out.push({ key: k, label: label || k });
  const dfs = (node) => {
    if (!node) return;
    if (Array.isArray(node)) node.forEach(dfs);
    else if (typeof node === "object") {
      if (node.key) pushItem(node.key, node.label);
      Object.values(node).forEach(v => { if (v && typeof v === "object") dfs(v); });
    }
  };
  dfs(CATS);
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
function keyToCodeStable(key) {
  let h = 5381;
  for (const ch of key) h = ((h << 5) + h) + ch.charCodeAt(0);
  const code = (h >>> 0) % 9000 + 1000;
  return String(code);
}
function buildCodeMaps(keys) {
  const sorted = [...keys].sort();
  const used = new Set();
  const keyToCode = new Map();
  const codeToKey = new Map();
  for (const k of sorted) {
    let c = keyToCodeStable(k);
    let guard = 0;
    while (used.has(c) && guard < 10000) {
      c = String((Number(c) % 9000) + 1001);
      guard++;
    }
    used.add(c);
    keyToCode.set(k, c);
    codeToKey.set(c, k);
  }
  return { keyToCode, codeToKey };
}

/* ===== 유틸 ===== */
const $ = sel => document.querySelector(sel);

async function docIdFromUrl(url) {
  // 안정적 doc id: SHA-1(url) 앞 16자
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-1", enc.encode(url));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
  return "vid_" + hex.slice(0,16);
}

function parseLines(text) {
  const out = [];
  const errors = [];
  const lines = (text || "").split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s+/);
    const url = parts[0];
    const codes = parts.slice(1);
    if (!/^https?:\/\//i.test(url)) {
      errors.push(`L${idx+1}: URL 형식 아님 → '${line}'`);
      return;
    }
    if (codes.length === 0 || codes.length > 3) {
      errors.push(`L${idx+1}: 코드 개수는 1~3개여야 함 → '${line}'`);
      return;
    }
    out.push({ url, codeList: codes, lineNo: idx+1 });
  });
  return { items: out, errors };
}

function printLog(msg, type="info") {
  const el = $("#log");
  el.textContent += (el.textContent ? "\n" : "") + msg;
  el.classList.remove("ok","err");
  if (type === "ok") el.classList.add("ok");
  if (type === "err") el.classList.add("err");
  el.scrollTop = el.scrollHeight;
}

async function uploadInBatches(items, codeToKey, batchSize, currentUid) {
  let ok = 0, fail = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const batch = writeBatch(db);
    for (const it of chunk) {
      try {
        const cats = [];
        for (const c of it.codeList) {
          const key = codeToKey.get(c);
          if (!key) throw new Error(`알 수 없는 코드 ${c} (L${it.lineNo})`);
          cats.push(key);
        }
        const id = await docIdFromUrl(it.url);
        const ref = doc(db, VIDEO_COLL, id);
        batch.set(ref, {
          url: it.url,
          cats: cats,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          addedBy: currentUid || null
        }, { merge: true });
      } catch (e) {
        fail++;
        printLog(`에러: ${e.message}`, "err");
      }
    }
    await batch.commit();
    ok += chunk.length - (fail - (ok + fail - (i + chunk.length)));
    $("#stat").textContent = `업로드 중… ${Math.min(i + chunk.length, items.length)} / ${items.length}`;
  }
  return { ok, fail };
}

/* ===== init ===== */
onAuthStateChanged(auth, async (user) => {
  if (!user || !(await isAdmin(user.uid))) return deny();

  const catsList = await loadCategoriesSafe();
  const { keyToCode, codeToKey } = buildCodeMaps(catsList.map(x => x.key));

  // 코드표 렌더
  const tb = document.querySelector("#codeTable tbody");
  tb.innerHTML = "";
  for (const { key, label } of catsList) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${keyToCode.get(key)}</td><td>${key}</td><td>${label || ""}</td>`;
    tb.appendChild(tr);
  }

  $("#btnValidate").addEventListener("click", () => {
    $("#log").textContent = "";
    const { items, errors } = parseLines($("#inputBox").value);
    const badCodes = [];
    for (const it of items) {
      for (const c of it.codeList) {
        if (!codeToKey.has(c)) badCodes.push(`L${it.lineNo}: 미정의 코드 ${c}`);
      }
    }
    if (errors.length || badCodes.length) {
      errors.concat(badCodes).forEach(e => printLog(e, "err"));
      $("#stat").textContent = `검증 실패: ${errors.length + badCodes.length}건`;
    } else {
      printLog(`검증 성공: ${items.length}줄`, "ok");
      $("#stat").textContent = `검증 성공`;
    }
  });

  $("#btnUpload").addEventListener("click", async () => {
    $("#log").textContent = "";
    const dry = $("#dryRun").checked;
    const bs = parseInt($("#batchSize").value || "400", 10);

    const { items, errors } = parseLines($("#inputBox").value);
    if (errors.length) {
      errors.forEach(e => printLog(e, "err"));
      $("#stat").textContent = `검증 실패: ${errors.length}건`;
      return;
    }
    // 코드 존재성 검사
    const bad = [];
    for (const it of items) {
      for (const c of it.codeList) if (!codeToKey.has(c)) bad.push(`L${it.lineNo}: 미정의 코드 ${c}`);
    }
    if (bad.length) {
      bad.forEach(e => printLog(e, "err"));
      $("#stat").textContent = `검증 실패: ${bad.length}건`;
      return;
    }

    if (dry) {
      printLog(`드라이런: 업로드될 항목 ${items.length}개`, "ok");
      $("#stat").textContent = `드라이런 완료`;
      return;
    }

    $("#stat").textContent = "업로드 시작…";
    const { ok, fail } = await uploadInBatches(items, codeToKey, bs, user.uid);
    printLog(`완료: 성공 ${ok}개 / 실패 ${fail}개`, fail ? "err" : "ok");
    $("#stat").textContent = `완료: 성공 ${ok} / 실패 ${fail}`;
  });
});
