// js/sanitize.js
// 입력값 이스케이프 & 화이트리스트 기반 필터링 유틸

/** HTML 문자 이스케이프 (innerHTML에 넣기 전 필수) */
export function escapeHTML(input) {
  const s = String(input ?? '');
  return s.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/** 개인자료 라벨(사용자 지정 이름) 필터링 */
export function safePersonalLabel(input) {
  const raw = String(input ?? '').normalize('NFC');
  let v = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  v = v.replace(/[^0-9A-Za-z가-힣·.\-_\s()[\]]/g, '');
  v = v.replace(/\s+/g, ' ').trim();
  if (v.length > 20) v = v.slice(0, 20).trim();
  return v;
}

/** HTTPS + youtube host + id 추출 가능 */
export function isAllowedYouTubeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    const okHost = /^(www\.)?(youtube\.com|m\.youtube\.com|youtu\.be)$/.test(host);
    if (!okHost) return false;
    return !!extractYouTubeId(raw);
  } catch {
    return false;
  }
}

/** YouTube 동영상 ID 추출 */
export function extractYouTubeId(raw) {
  try {
    const u = new URL(String(raw));
    const host = u.hostname.toLowerCase();

    if (host.endsWith('youtu.be')) {
      const seg = u.pathname.split('/').filter(Boolean);
      return seg[0] || '';
    }
    if (host.includes('youtube.com')) {
      if (u.pathname.startsWith('/shorts/')) {
        const seg = u.pathname.split('/').filter(Boolean);
        return seg[1] || '';
      }
      const v = u.searchParams.get('v');
      if (v) return v;
    }
    const m = String(raw).match(/(?:youtu\.be\/|v=|shorts\/)([^?&#/]+)/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/** 줄단위 URL 텍스트 정리 */
export function sanitizeUrlList(text) {
  const arr = String(text ?? '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  return Array.from(new Set(arr));
}
