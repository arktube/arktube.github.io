// js/categories.js (ArkTube v1 — Christian taxonomy, 타입 목록 + 동일 구성, s_ 접두 제거)
// - 최상단 4축: shorts → video → series → personal
// - video / shorts: 같은 그룹·항목 구성 (라벨 동일)
// - 예약 key: 'series', 'personal' (index.js 로직에서 사용)

//////////////////////////////
// 1) 타입 목록 (UI/설정용)
//////////////////////////////
export const TYPES = [
  { value: 'shorts', label: '쇼츠' },
  { value: 'video',  label: '일반영상' },
];

//////////////////////////////
// 2) 공통 세부카테고리 세트 (series 제외)
//////////////////////////////
const SHARED_GROUPS = [
  {
    key: 'faith_life',
    label: '신앙생활',
    children: [
      { value:'christian_knowledge', label:'기독교지식' },
      { value:'one_word_day',        label:'하루한말씀' },
      { value:'comfort',             label:'위로영상' },
      { value:'faith_vlog',          label:'신앙브이로그' },
      { value:'angel_babies',        label:'아기천사들' },
      { value:'gathering_ad',        label:'모임광고' },
    ],
  },
  {
    key: 'praise',
    label: '찬양',
    children: [
      { value:'hymn',        label:'찬송가' },
      { value:'ccm',         label:'CCM' },
      { value:'kids_praise', label:'어린이 찬양' },
    ],
  },
  {
    key: 'word',
    label: '말씀',
    children: [
      { value:'bible_reading', label:'성경통독' },
      { value:'bible_study',   label:'성경공부' },
      { value:'meditation',    label:'묵상' },
      { value:'sermon',        label:'설교' },
    ],
  },
  {
    key: 'prayer',
    label: '기도',
    children: [
      { value:'testimony', label:'간증' },
      { value:'prayer',    label:'기도' },
      { value:'intercede', label:'중보기도' },
    ],
  },
  {
    key: 'next_gen',
    label: '다음세대',
    children: [
      { value:'kids_sermon',  label:'어린이 설교' },
      { value:'kids_praise2', label:'어린이 찬양' },
      { value:'youth',        label:'청소년·청년' },
    ],
  },
  {
    key: 'media',
    label: '미디어',
    children: [
      { value:'christian_youtuber', label:'기독교 유튜버' },
      { value:'christian_movie',    label:'기독교 영화·드라마' },
    ],
  },
  {
    key: 'mission_history',
    label: '선교·역사',
    children: [
      { value:'korean_church_history', label:'한국교회사' },
      { value:'reformation',           label:'종교개혁' },
      { value:'world_mission',         label:'세계선교' },
      { value:'historical_theology',   label:'역사신학' },
      { value:'figures',               label:'인물' },
    ],
  },
  {
    key: 'general_info',
    label: '일반정보',
    children: [
      { value:'common',   label:'상식' },
      { value:'lifetips', label:'생활팁' },
      { value:'health',   label:'건강' },
      { value:'fitness',  label:'운동' },
    ],
  },
];

//////////////////////////////
// 3) 최종 모델 (순서: shorts → video → series → personal)
//////////////////////////////
export const CATEGORY_MODEL = {
  // 쇼츠 (영상과 동일 구성)
  shorts: { groups: SHARED_GROUPS },

  // 일반영상 (쇼츠와 동일 구성)
  video:  { groups: SHARED_GROUPS },

  // 시리즈 (선택)
  series: {
    key: 'series',   // ★ 예약 key
    label: '시리즈',
    children: [
      { value:'pick1', label:'추천1' },
      { value:'pick2', label:'추천2' },
    ],
  },

  // 개인자료 (단독 재생 전용)
  personal: {
    key: 'personal', // ★ 예약 key
    label: '개인자료',
    children: [
      { value: 'personal1', label: '자료1' },
      { value: 'personal2', label: '자료2' },
      { value: 'personal3', label: '자료3' },
      { value: 'personal4', label: '자료4' },
    ],
  },
};

//////////////////////////////
// 4) (선택) 보조 유틸
//////////////////////////////
export const PERSONAL_VALUES = ['personal1','personal2','personal3','personal4'];
export const SERIES_VALUES   = CATEGORY_MODEL.series.children.map(c => c.value);
export const ALL_CATEGORY_VALUES =
  [...CATEGORY_MODEL.shorts.groups, ...CATEGORY_MODEL.video.groups]
    .flatMap(g => (g.children || []).map(c => c.value));
