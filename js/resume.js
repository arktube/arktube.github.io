// /js/resume.js — series resume helper (localStorage, GC, multi-tab sync)
// key:    resume:{type}:{groupKey}:{subKey}
// value:  { sort:"createdAt-desc"|"createdAt-asc"|"random:SEED", index:Number, t:Number(sec), savedAt:Number }
//
// 추가 기능:
// - 오래된 항목 자동 정리(GC): 기본 120일 경과 시 삭제 + 비정상/깨진 JSON 자동 정리
// - JSON 파싱 오류 복구: decodeURIComponent 재시도 → 실패 시 해당 항목 삭제
// - 스토리지 이벤트 처리(다중 탭 동기화): 다른 탭에서 변경되면 변경 이벤트 발행
// - 변경 이벤트 구독 onChange/offChange 제공 (watch/index 등에서 실시간 반영 가능)
//
// 사용 예시:
//   onChange((e) => { console.log('resume change', e.detail); });
//   const r = loadResume({ type:'video', groupKey:'series', subKey:'series_foo' });
//   saveResume({ type, groupKey, subKey, sort:'createdAt-asc', index:3, t:120 });
//   clearResume({ type, groupKey, subKey });
//
// 비고:
// - 비로그인 공개 열람 기준: uid 네임스페이스 없이 "기기 단위" 저장
// - 필요 시 makeKey에 uid 포함 구현으로 확장 가능

const LS = typeof localStorage !== 'undefined' ? localStorage : null;
const PREFIX = 'resume:';
const AUTONEXT_KEY = 'autonext';        // index의 연속재생 토글 상태 (일반 키명)
const EVENT_NAME = 'resume-change';     // 변경 알림 이벤트 이름(일반화)

// ---- 내부 이벤트 버스 ----
const bus = (typeof window !== 'undefined' && typeof window.EventTarget !== 'undefined')
  ? new EventTarget()
  : null;

function emitChange(detail) {
  if (!bus) return;
  try {
    bus.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
  } catch {}
}

// ---- 공개: 변경 이벤트 구독/해제 ----
export function onChange(handler) {
  if (!bus || typeof handler !== 'function') return () => {};
  const wrapped = (ev) => handler(ev);
  bus.addEventListener(EVENT_NAME, wrapped);
  // 해제 함수 반환
  return () => {
    try { bus.removeEventListener(EVENT_NAME, wrapped); } catch {}
  };
}
export function offChange(handler) {
  if (!bus || typeof handler !== 'function') return;
  try { bus.removeEventListener(EVENT_NAME, handler); } catch {}
}

// ---- AutoNext (index 전용 토글 상태 공유) ----
export function getAutoNext() {
  try { return (LS.getItem(AUTONEXT_KEY) === '1'); } catch { return false; }
}
export function setAutoNext(on) {
  try {
    LS.setItem(AUTONEXT_KEY, on ? '1' : '0');
    emitChange({ kind:'autonext', key: AUTONEXT_KEY, value: on ? '1' : '0', source: 'local' });
  } catch {}
}

// ---- 키 조립 ----
export function makeKey({ type, groupKey, subKey }) {
  return `${PREFIX}${type}:${groupKey}:${subKey}`;
}

// ---- JSON 파싱(복구 포함) ----
function parseJSONSafe(raw, { keyForCleanup } = {}) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // 한 번 더 복구 시도: decodeURIComponent → JSON.parse
    try {
      const decoded = decodeURIComponent(raw);
      const obj = JSON.parse(decoded);
      // 복구 성공하면 정상화(다음 접근 시 오류 방지)
      try { if (keyForCleanup) LS.setItem(keyForCleanup, JSON.stringify(obj)); } catch {}
      return obj;
    } catch {
      // 완전 실패: 깨진 항목 정리
      try { if (keyForCleanup) LS.removeItem(keyForCleanup); } catch {}
      return null;
    }
  }
}

// ---- 스키마 검증/보정 ----
function sanitizePayload(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const out = {};
  const s = String(obj.sort || '');
  if (!(s === 'createdAt-desc' || s === 'createdAt-asc' || s.startsWith('random'))) return null;
  out.sort = s;

  const idx = Number(obj.index);
  if (!Number.isFinite(idx) || idx < 0) return null;
  out.index = Math.floor(idx);

  const t = Number(obj.t);
  out.t = Number.isFinite(t) && t >= 0 ? Math.floor(t) : 0;

  const savedAt = Number(obj.savedAt);
  out.savedAt = Number.isFinite(savedAt) ? savedAt : Date.now();
  return out;
}

// ---- CRUD ----
export function loadResume({ type, groupKey, subKey }) {
  try {
    const key = makeKey({ type, groupKey, subKey });
    const raw = LS.getItem(key);
    const obj = parseJSONSafe(raw, { keyForCleanup: key });
    const sane = sanitizePayload(obj);
    return sane || null;
  } catch { return null; }
}

export function saveResume({ type, groupKey, subKey, sort, index, t }) {
  try {
    const key = makeKey({ type, groupKey, subKey });
    const payload = sanitizePayload({ sort, index, t, savedAt: Date.now() });
    if (!payload) return; // 잘못된 인자면 저장 안 함
    LS.setItem(key, JSON.stringify(payload));
    emitChange({ kind:'resume', key, value: payload, source: 'local' });
  } catch {}
}

export function clearResume({ type, groupKey, subKey }) {
  try {
    const key = makeKey({ type, groupKey, subKey });
    LS.removeItem(key);
    emitChange({ kind:'resume', key, value: null, source: 'local' });
  } catch {}
}

// ---- GC: 오래된 항목/깨진 항목 정리 ----
// 기본 정책:
//  - maxAgeDays: 120일 경과 항목 삭제
//  - maxScan: 한 번에 최대 1000개 키 스캔(성능 보호)
//  - 깨진 JSON/스키마 불일치 항목 즉시 삭제
export function vacuumOld({ maxAgeDays = 120, maxScan = 1000 } = {}) {
  if (!LS) return { scanned: 0, removed: 0 };
  const now = Date.now();
  const ageMs = maxAgeDays * 24 * 60 * 60 * 1000;

  let scanned = 0;
  let removed = 0;

  try {
    const len = LS.length;
    for (let i = 0; i < len && scanned < maxScan; i++) {
      const k = LS.key(i);
      if (!k || (!k.startsWith(PREFIX) && k !== AUTONEXT_KEY)) continue;
      scanned++;

      if (k === AUTONEXT_KEY) {
        // AutoNext는 보존
        continue;
      }

      const raw = LS.getItem(k);
      const obj = parseJSONSafe(raw, { keyForCleanup: k });
      const sane = sanitizePayload(obj);
      if (!sane) {
        // 깨진 JSON/스키마 불일치 → 삭제
        try { LS.removeItem(k); removed++; } catch {}
        continue;
      }
      if (now - sane.savedAt > ageMs) {
        try { LS.removeItem(k); removed++; } catch {}
      }
    }
  } catch {}

  return { scanned, removed };
}

// ---- 시작 시 1회 GC 수행(부담 낮은 파라미터) ----
try { vacuumOld({ maxAgeDays: 120, maxScan: 1000 }); } catch {}

// ---- 스토리지 이벤트(다중 탭 동기화) ----
// 다른 탭/창에서 localStorage가 변경되면 여기로 이벤트가 옴.
// 우리 prefix/AUTONEXT만 필터하여 변경 이벤트를 애플리케이션에 전달.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (ev) => {
    try {
      const { key, newValue } = ev;
      if (!key || (!key.startsWith(PREFIX) && key !== AUTONEXT_KEY)) return;

      if (key === AUTONEXT_KEY) {
        emitChange({ kind:'autonext', key, value: newValue, source: 'storage' });
        return;
      }

      // resume 항목
      const obj = parseJSONSafe(newValue || null);
      const sane = sanitizePayload(obj);
      emitChange({ kind:'resume', key, value: sane || null, source: 'storage' });
    } catch {}
  });
}
