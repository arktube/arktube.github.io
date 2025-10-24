// /js/categories.js  (ArkTube v0.1 — CATEGORY MODEL & GROUPS)

// ========== 기존 CATEGORY_GROUPS ==========
export const CATEGORY_GROUPS = [
  {
    key: 'praise',
    label: '찬양',
    children: [
      { value: 'hymn',        label: '찬송가' },
      { value: 'ccm',         label: 'CCM' },
      { value: 'ccm1',        label: '찬양감사기쁨' },
      { value: 'ccm2',        label: '소망위로용서' },
      { value: 'ccm3',        label: '사랑축복' },
      { value: 'ccm4',        label: '말씀묵상' },
      { value: 'ccm5',        label: '교회선교' },
      { value: 'ccm6',        label: '특별절기' },
      { value: 'kids_praise', label: '어린이 찬양' },
    ],
  },
  {
    key: 'faith_life',
    label: '신앙생활',
    children: [
      { value: 'christian_knowledge', label: '기독교지식' },
      { value: 'one_word_day',        label: '하루한말씀' },
      { value: 'comfort',             label: '위로영상' },
      { value: 'faith_vlog',          label: '신앙브이로그' },
      { value: 'angel_babies',        label: '아기천사들' },
      { value: 'gathering_ad',        label: '모임광고' },
    ],
  },
  {
    key: 'word',
    label: '말씀',
    children: [
      { value: 'bible_reading', label: '성경통독' },
      { value: 'bible_study',   label: '성경공부' },
      { value: 'meditation',    label: '묵상' },
      { value: 'sermon',        label: '설교' },
    ],
  },
  {
    key: 'prayer',
    label: '기도',
    children: [
      { value: 'testimony', label: '간증' },
      { value: 'prayer',    label: '기도' },
      { value: 'intercede', label: '중보기도' },
    ],
  },
  {
    key: 'next_gen',
    label: '다음세대',
    children: [
      { value: 'kids_sermon',  label: '어린이 설교' },
      { value: 'kids_praise2', label: '어린이 찬양' },
      { value: 'youth',        label: '청소년·청년' },
    ],
  },
  {
    key: 'media',
    label: '미디어',
    children: [
      { value: 'christian_youtuber', label: '기독교 유튜버' },
      { value: 'christian_movie',    label: '기독교 영화·드라마' },
    ],
  },
  {
    key: 'mission_history',
    label: '선교·역사',
    children: [
      { value: 'korean_church_history', label: '한국교회사' },
      { value: 'reformation',           label: '종교개혁' },
      { value: 'world_mission',         label: '세계선교' },
      { value: 'historical_theology',   label: '역사신학' },
      { value: 'figures',               label: '인물' },
    ],
  },
  {
    key: 'general_info',
    label: '일반정보',
    children: [
      { value: 'common',   label: '상식' },
      { value: 'lifetips', label: '생활팁' },
      { value: 'health',   label: '건강' },
      { value: 'fitness',  label: '운동' },
    ],
  },

  /* ===== 시리즈 (key가 series_로 시작) ===== */
  {
    key: 'series_music',
    label: '애니메이션',
    children: [
      { value:'pick1', label:'슈퍼북시즈1' },
      { value:'pick2', label:'추천2' },
    ],
  },
  {
    key: 'series_bible',
    label: '시리즈',
    children: [
      { value:'pick3', label:'추천3' },
      { value:'pick4', label:'추천4' },
    ],
  },
  {
    key: 'series_person',
    label: '시리즈',
    children: [
      { value:'pick5', label:'추천5' },
      { value:'pick6', label:'추천6' },
    ],
  },

  /* ===== 개인자료 (local 전용) ===== */
  {
    key: 'personal',
    label: '개인자료',
    personal: true,
    children: [
      { value:'personal1', label:'자료1' },
      { value:'personal2', label:'자료2' },
      { value:'personal3', label:'자료3' },
      { value:'personal4', label:'자료4' },
    ],
  },
];

// ========== CATEGORY_MODEL (ArkTube 표준 스펙) ==========
// - types: 'shorts' | 'video' (업로드 시 필수 저장)
// - groups: 주제 그룹 목록 (series_는 시리즈, personal은 로컬 전용)
// - 호환성 위해 각 그룹에 key/label 외에 group, personal, isSeries도 포함
const TYPES = [
  { value: 'shorts', label: '쇼츠' },
  { value: 'video',  label: '일반영상' },
];

const GROUPS_MODEL = CATEGORY_GROUPS.map(g => ({
  key: g.key,
  group: g.label,                // 일부 코드가 group 이름을 기대하는 경우 대비
  label: g.label,
  personal: !!g.personal,
  isSeries: typeof g.key === 'string' && g.key.startsWith('series_'),
  children: g.children.slice(),  // 동일 참조 방지용 얕은 복사
}));

export const CATEGORY_MODEL = {
  types: TYPES,
  groups: GROUPS_MODEL,
};
