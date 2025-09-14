// js/auth-util.js
// 아이디/이메일 정규화 + 검증 유틸

export const DEFAULT_ID_DOMAIN = 'copytube.local';

// 영어 소문자 아이디만 허용 (a~z)
// (원하면 숫자도 허용: /^[a-z0-9]+$/ 로 변경)
export function isValidSimpleId(id) {
  return /^[a-z0-9]+$/.test(id);
}

// 입력이 이메일이면 그대로(소문자), 아이디이면 영어 소문자만 허용 후 도메인 부착
export function normalizeIdOrEmail(input, opts = {}) {
  const domain = (opts.domain || DEFAULT_ID_DOMAIN).toLowerCase();
  let v = (input || '').trim();
  if (!v) return '';

  // 이메일로 보이는 경우
  if (v.includes('@')) {
    return v.toLowerCase();
  }

  // 아이디로 취급: 선행 '@' 제거 후 전부 소문자
  if (v.startsWith('@')) v = v.slice(1);
  v = v.toLowerCase();

  if (!isValidSimpleId(v)) {
    // 영어 아이디 규칙 위반 → 빈 문자열 반환(상위에서 메시지 처리)
    return '';
  }
  return `${v}@${domain}`;
}

// 과거 '첫 글자 잘림' 계정 호환용 보조 시도 값
export function dropFirstCharVariant(emailOrId, opts = {}) {
  const domain = (opts.domain || DEFAULT_ID_DOMAIN).toLowerCase();
  let v = (emailOrId || '').trim();
  if (!v) return '';

  if (v.includes('@')) {
    const at = v.indexOf('@');
    const local = v.slice(0, at);
    const host  = v.slice(at + 1);
    const fixedLocal = local.length > 1 ? local.slice(1) : local;
    return `${fixedLocal}@${host}`.toLowerCase();
  } else {
    if (v.startsWith('@')) v = v.slice(1);
    if (v.length > 1) v = v.slice(1);
    return `${v.toLowerCase()}@${domain}`;
  }
}
