// /js/autocat.js — ArkTube / CopyTube 공용 자동 카테고리 선택 + 서버 학습(클라이언트만) 완성판
// - 첫 번째 유효 URL 기준
// - tags/title/description 점수 + 서버 집계 가산치(0/1/2)
// - 임계치 3 미만이면 자동선택 안 함 → "수동선택 해주세요." + 수동 라디오 전환은 upload.js에서 처리
// - 개인자료/시리즈 자동 제외
// - "최소 난간 5개" 전부 클라이언트에서 처리 (스키마/상한/타이머/분리/백업은 관리자 패널에서)

// ==== 설정 스위치 ==== //
export const ENABLE_SERVER_LEARN = true;   // 서버 학습(쓰기) 사용
export const ENABLE_LOCAL_LEARN  = false;  // 오프라인 폴백용(기본 꺼둠)
export const RATE_LIMIT_MS       = 10000;  // 한 등록 동작 후 10초 내 중복 학습 차단
export const MAX_TOKENS_PER_SAMPLE = 24;   // 한 번의 입력에서 학습 전송 최대 토큰 수

export const USE_TAGS  = true;
export const USE_TITLE = true;
export const USE_DESC  = true;

export const AUTOCAT_SELF_LEARN = ENABLE_LOCAL_LEARN; // 레거시 호환(로컬 self-learn 스위치)

// 점수 테이블/임계치
const THRESHOLD = 3;
const SCORE = { tagExact: 6, titleExact: 4, descExact: 2, partialFactor: 0.5 };
// 서버 집계 가산치는 0/1/2 그대로 더함

// Firestore 컬렉션
const COLL_AGG   = 'autocat_agg';   // 자동선택 시 읽는 집계 결과
// (선택) const COLL_VOTES = 'autocat_votes'; // 원시 로그(기본 비사용)

// 로컬 self-learn(폴백) 저장 키
const MEM_KEY = 'autocat_mem_v1';
const SELF_LEARN_BONUS = 2;
const SELF_LEARN_CAP   = 2;

// ==== 의존 모듈 ==== //
import { CATEGORY_MODEL, CATEGORY_GROUPS } from './categories.js';

// YouTube Data API 키는 upload.html에서 window.YT_DATA_API_KEY || window.YT_API_KEY로 세팅됨
const getYTKey = () => (typeof window !== 'undefined' ? (window.YT_DATA_API_KEY || window.YT_API_KEY || null) : null);

// ==== Firestore 접근 어댑터 ==== //
// firebase-init.js에서 어느 방식으로 초기화했는지 몰라도 최대한 호환되게 탐색
function resolveFirestore() {
  // 우선 window.db (모듈에서 내보낸 인스턴스를 전역에 두는 패턴)
  if (window.db && window.firebaseFns) {
    return { db: window.db, fns: window.firebaseFns }; // { doc, getDoc, runTransaction, serverTimestamp, ...}
  }
  // 모듈 export를 전역에 올려둔 경우
  if (window.__FS && window.__FS.db) return { db: window.__FS.db, fns: window.__FS };
  // Firebase v9 모듈을 전역에 노출한 경우
  if (window.firebaseApp && window.firestoreFns) return { db: window.firestoreFns.getFirestore(window.firebaseApp), fns: window.firestoreFns };
  // Legacy namespace (거의 드묾)
  if (window.firebase && window.firebase.firestore) {
    const db = window.firebase.firestore();
    return {
      db,
      fns: {
        doc: (db, c, id) => db.collection(c).doc(id),
        getDoc: (ref) => ref.get(),
        setDoc: (ref, data, opt) => (opt && opt.merge ? ref.set(data, { merge: true }) : ref.set(data)),
        runTransaction: (db, fn) => db.runTransaction(fn),
        serverTimestamp: () => window.firebase.firestore.FieldValue.serverTimestamp(),
        FieldValue: window.firebase.firestore.FieldValue,
      }
    };
  }
  return null;
}

// 안전 로그
function info(...args){ try{ console.info('[autocat]', ...args); }catch{} }
function warn(...args){ try{ console.warn('[autocat]', ...args); }catch{} }

// ==== 문자열 정규화/토큰화 ==== //
const STOP_KO = ['영상','모음','추천','무료','공식','최신','초보','기초','강의','설명','방법','비법','팁','꿀팁','대회','리뷰','브이로그','브이','채널','구독','좋아요','가이드','요약'];
const STOP_EN = ['the','a','an','to','for','from','and','or','of','how','what','why','best','free','official','new','guide','tutorial','tips','tricks','full','ver','hd','4k'];

const norm = (s='') => String(s).toLowerCase()
  .normalize('NFKC')
  .replace(/[^\p{L}\p{N}\s_]+/gu,' ')
  .replace(/\s+/g,' ')
  .trim();

function tokenizeBase(s=''){ return norm(s).split(' ').filter(Boolean); }

function isStop(tok){
  if(!tok) return true;
  if(tok.length < 2) return true;
  if(STOP_EN.includes(tok)) return true;
  if(STOP_KO.includes(tok)) return true;
  return false;
}

// 결합형(공백/언더스코어 제거 버전) 추가
function addSpaceless(ary){
  const out = new Set(ary);
  ary.forEach(t=>{
    const fused = t.replace(/[\s_]+/g,'');
    if(fused && fused!==t) out.add(fused);
  });
  return Array.from(out);
}

// ==== CATEGORY MODEL 인덱스 ==== //
function buildCategoryIndex(){
  const groups = CATEGORY_MODEL?.groups || CATEGORY_GROUPS || [];
  const cats=[]; // {value,label,isSeries,isPersonal,tokens:[]}
  const personalVals = new Set();
  const seriesVals   = new Set();

  groups.forEach(g=>{
    const isSeries = g?.isSeries===true || String(g?.key||'').startsWith('series_');
    const isPersonal = g?.personal===true || String(g?.key||'')==='personal';
    (g?.children||[]).forEach(c=>{
      const value=String(c.value||'').trim();
      const label=String(c.label||value).trim();
      const tokensRaw = [
        ...tokenizeBase(value.replace(/_/g,' ')),
        ...tokenizeBase(label),
      ].filter(t=>!isStop(t));
      const tokens = addSpaceless(tokensRaw);
      cats.push({ value,label,isSeries,isPersonal,tokens });
      if(isPersonal) personalVals.add(value);
      if(isSeries) seriesVals.add(value);
    });
  });

  // 외부에서 쓸 수 있게 헬퍼 제공(업로드 통합 코드 호환)
  const helpers = {
    isPersonalVal: (v)=> personalVals.has(String(v)),
    isSeriesVal:   (v)=> seriesVals.has(String(v)),
    listValues:    ()=> cats.map(c=>c.value),
  };
  return { cats, helpers };
}
const { cats: CATIDX, helpers: CAT_HELPER } = buildCategoryIndex();
// 업로드 통합 코드와 호환을 위해 전역에도 노출(있어도 되고 없어도 됨)
if(typeof window!=='undefined'){
  window.CATIDX = Object.assign({}, CAT_HELPER);
}

// ==== YouTube 메타 취득 ==== //
async function fetchMeta(videoId, fullUrl){
  const API_KEY = getYTKey();
  const meta = { title:'', description:'', tags:[] };

  if(API_KEY){
    try{
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(API_KEY)}`;
      const r = await fetch(url);
      if(r.ok){
        const j = await r.json();
        const sn = j?.items?.[0]?.snippet;
        if(sn){
          meta.title = sn.title || '';
          meta.description = sn.description || '';
          meta.tags = Array.isArray(sn.tags) ? sn.tags : [];
          return meta;
        }
      }
    }catch(e){ warn('YT Data API 실패', e); }
  }
  // fallback: oEmbed (title만)
  try{
    const o = `https://www.youtube.com/oembed?url=${encodeURIComponent(fullUrl)}&format=json`;
    const r = await fetch(o);
    if(r.ok){
      const j = await r.json();
      meta.title = j?.title || '';
    }
  }catch(e){ warn('oEmbed 실패', e); }
  return meta;
}

// ==== 서버 집계(autocat_agg) 읽기: 지정 토큰들만 on-demand 조회 ==== //
const aggCache = new Map(); // token -> { [cat]: {votes, score} }
async function fetchAggForToken(token){
  if(!ENABLE_SERVER_LEARN) return null;
  if(aggCache.has(token)) return aggCache.get(token);

  const fs = resolveFirestore();
  if(!fs){ warn('Firestore 미탐지 — 서버 가산치 없이 진행'); return null; }
  const { db, fns } = fs;
  try{
    const ref = fns.doc(db, COLL_AGG, token);
    const snap = await fns.getDoc(ref);
    if(!snap || !snap.exists) { aggCache.set(token, null); return null; }
    const data = typeof snap.data === 'function' ? snap.data() : snap; // legacy
    aggCache.set(token, data.cats || null);
    return data.cats || null;
  }catch(e){
    warn('agg 읽기 실패', e);
    return null;
  }
}

// ==== 점수 계산(서버 가산치 반영) ==== //
function tokenizeFromMeta(meta){
  const toks = new Set();

  if(USE_TAGS && Array.isArray(meta.tags)){
    meta.tags.forEach(t=>{
      const tk = norm(String(t));
      if(!isStop(tk)) toks.add(tk);
    });
  }
  if(USE_TITLE && meta.title){
    tokenizeBase(meta.title).forEach(t=>{ if(!isStop(t)) toks.add(t); });
  }
  if(USE_DESC && meta.description){
    tokenizeBase(meta.description).forEach(t=>{ if(!isStop(t)) toks.add(t); });
  }

  const arr = addSpaceless(Array.from(toks));
  return arr.slice(0, MAX_TOKENS_PER_SAMPLE);
}

async function scoreCategories(meta){
  // 원문/토큰 처리
  const titleTokens = USE_TITLE ? tokenizeBase(meta.title).filter(t=>!isStop(t)) : [];
  const descTokens  = USE_DESC  ? tokenizeBase(meta.description).filter(t=>!isStop(t)) : [];
  const tagTokens   = USE_TAGS  ? (Array.isArray(meta.tags) ? meta.tags.map(t=>norm(String(t))).filter(t=>!isStop(t)) : []) : [];

  const baseTokenSet = new Set([ ...titleTokens, ...descTokens, ...tagTokens ]);
  const tokensForAgg = addSpaceless(Array.from(baseTokenSet)).slice(0, MAX_TOKENS_PER_SAMPLE);

  // 서버 가산치 로딩(필요한 토큰만)
  const aggByToken = {};
  if(ENABLE_SERVER_LEARN){
    await Promise.all(tokensForAgg.map(async tk=>{
      aggByToken[tk] = await fetchAggForToken(tk);
    }));
  }

  // (로컬 폴백) self-learn 메모리
  const mem = (AUTOCAT_SELF_LEARN && !ENABLE_SERVER_LEARN) ? getMem() : {};

  const scores = new Map(); // value -> score
  CATIDX.forEach(c=>{
    if(c.isPersonal || c.isSeries) return; // 자동 제외
    let s = 0;

    c.tokens.forEach(tok=>{
      if(!tok) return;
      // 태그/제목/설명 일치/부분일치
      if(tagTokens.includes(tok)) s += SCORE.tagExact;
      if(titleTokens.includes(tok)) s += SCORE.titleExact;
      if(descTokens.includes(tok))  s += SCORE.descExact;

      if(!tagTokens.includes(tok) && tagTokens.some(t=>t.includes(tok))) s += SCORE.tagExact  * SCORE.partialFactor;
      if(!titleTokens.includes(tok) && titleTokens.some(t=>t.includes(tok))) s += SCORE.titleExact * SCORE.partialFactor;
      if(!descTokens.includes(tok)  && descTokens.some(t=>t.includes(tok)))  s += SCORE.descExact  * SCORE.partialFactor;

      // 서버 가산치(토큰별-카테고리별 0/1/2)
      if(ENABLE_SERVER_LEARN){
        const byCat = aggByToken[tok];
        const inc = byCat && byCat[c.value] ? Number(byCat[c.value].score||0) : 0;
        if(inc>0) s += inc;
      }

      // 로컬 폴백 가산치
      const plus = Number(mem?.[tok]?.[c.value] || 0);
      if(plus>0) s += plus;
    });

    if(s>0) scores.set(c.value, (scores.get(c.value)||0)+s);
  });

  const arr = Array.from(scores.entries()).sort((a,b)=> b[1]-a[1]);
  if(arr.length===0) return [];
  const top1 = arr[0];
  if(top1[1] < THRESHOLD) return []; // 임계치 미달

  const result = [top1[0]];
  if(arr.length>=2){
    const top2 = arr[1];
    if(top2[1] >= THRESHOLD && (top1[1]-top2[1]) <= 1){
      result.push(top2[0]);
    }
  }
  return result.slice(0,2);
}

// ==== 외부 API: 첫 번째 유효 URL 기준 자동선택 ==== //
export async function autoSelectForText(text, parseYouTube){
  const lines = String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  let firstId=null, firstUrl=null;
  for(const line of lines){
    try{
      const info = parseYouTube(line);
      if(info?.id){ firstId=info.id; firstUrl=info.url||line; break; }
    }catch{}
  }
  if(!firstId) return { cats:[], meta:null, tokens:[] };

  const meta = await fetchMeta(firstId, firstUrl);
  const cats = await scoreCategories(meta);
  const tokens = tokenizeFromMeta(meta);
  return { cats, meta, tokens };
}

// ==== 학습(쓰기): 수동선택 시 호출 — Firestore만으로 집계(클라 트랜잭션) ==== //
let LAST_VOTE_AT = 0;
let LAST_URL_HASH = null;

function simpleHash(s){
  let h=0, i=0, len=s.length|0;
  for(i=0;i<len;i++){ h=((h<<5)-h + s.charCodeAt(i))|0; }
  return String(h>>>0);
}

// 로컬 폴백 메모리
function getMem(){ try{ return JSON.parse(localStorage.getItem(MEM_KEY)||'{}'); }catch{ return {}; } }
function setMem(obj){ try{ localStorage.setItem(MEM_KEY, JSON.stringify(obj)); }catch{} }
function addMemBonus(tokens=[], cat){
  const mem=getMem();
  tokens.forEach(t=>{
    mem[t]=mem[t]||{};
    const cur=Number(mem[t][cat]||0);
    const next=Math.min(SELF_LEARN_CAP, cur+SELF_LEARN_BONUS);
    mem[t][cat]=next;
  });
  setMem(mem);
}

export async function recordUserCorrection(tokens=[], chosenCats=[], urlText=''){
  // 1) 밸리데이션(최소 난간)
  if(!Array.isArray(tokens) || !tokens.length) return;
  if(!Array.isArray(chosenCats) || !chosenCats.length) return;

  // 카테고리 value 유효성(모델에 존재)
  const validValues = new Set(CATIDX.map(c=>c.value));
  chosenCats = chosenCats.filter(v=> validValues.has(String(v)));
  if(!chosenCats.length) return;

  // 토큰 정규화/필터/상한
  const normTokens = addSpaceless(tokens.map(t=>norm(String(t))).filter(t=>!isStop(t))).slice(0, MAX_TOKENS_PER_SAMPLE);
  if(!normTokens.length) return;

  // 개인/시리즈 카테고리는 학습 제외 (자동선택에서도 제외했으므로 일관)
  chosenCats = chosenCats.filter(v=>{
    const c = CATIDX.find(x=>x.value===v);
    return c && !c.isPersonal && !c.isSeries;
  });
  if(!chosenCats.length) return;

  // 2) 쓰기 상한(10초 타이머 + 같은 텍스트 즉시 반복 차단)
  const now = Date.now();
  if(now - LAST_VOTE_AT < RATE_LIMIT_MS) { info('학습 rate-limit'); return; }
  const hash = urlText ? simpleHash(urlText) : null;
  if(hash && LAST_URL_HASH && hash===LAST_URL_HASH) { info('같은 입력 중복 차단'); return; }
  LAST_VOTE_AT = now; LAST_URL_HASH = hash;

  // 3) 서버 학습(집계 트랜잭션) 또는 로컬 폴백
  if(ENABLE_SERVER_LEARN){
    const fs = resolveFirestore();
    if(!fs){ warn('Firestore 미탐지 — 학습을 로컬 폴백에 기록'); if(ENABLE_LOCAL_LEARN){ chosenCats.forEach(cat=> addMemBonus(normTokens, cat)); } return; }
    const { db, fns } = fs;
    try{
      await Promise.all(normTokens.map(async token=>{
        // 각 토큰×카테고리에 대해 votes 증가 + score(0/1/2) 계단식 산출
        await Promise.all(chosenCats.map(async cat=>{
          await fns.runTransaction(db, async tx=>{
            const ref = fns.doc(db, COLL_AGG, token);
            const snap = await tx.get(ref);
            let data = snap && (typeof snap.data==='function' ? snap.data() : (snap.exists ? snap.data() : null));
            if(!data) data = { cats:{} };
            data.cats = data.cats || {};
            const cur = data.cats[cat]?.votes || 0;
            const votes = cur + 1;
            const score = votes >= 3 ? 2 : 1; // 0/1/2 상한
            data.cats[cat] = { votes, score };
            // updatedAt은 최종 set에서 merge로
            tx.set(ref, Object.assign({}, data, { updatedAt: fns.serverTimestamp() }), { merge:true });
          });
        }));
      }));
      info('서버 학습 반영 완료');
    }catch(e){
      warn('서버 학습 실패 — 로컬 폴백 시도', e);
      if(ENABLE_LOCAL_LEARN){ chosenCats.forEach(cat=> addMemBonus(normTokens, cat)); }
    }
  } else if (ENABLE_LOCAL_LEARN){
    chosenCats.forEach(cat=> addMemBonus(normTokens, cat));
  }
}

// ==== 디버그 유틸 (선택) ==== //
export const memoDebug = {
  read(){ return getMem(); },
  clear(){ localStorage.removeItem(MEM_KEY); },
  set(obj){ setMem(obj||{}); }
};

// ==== (선택) 관리자 패널에서 토큰 → 카테고리 집계 확인용 헬퍼 ==== //
export async function readAggForTokens(tokens=[]){
  const out = {};
  for(const tk of tokens){
    out[tk] = await fetchAggForToken(tk);
  }
  return out;
}
