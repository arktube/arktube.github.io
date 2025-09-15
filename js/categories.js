// js/categories.js (arktube v1 - Christian taxonomy)

/** 공통 세부카테고리 세트 */
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
      { value:'kids_sermon', label:'어린이 설교' },
      { value:'kids_praise2',label:'어린이 찬양' },
      { value:'youth',       label:'청소년·청년' },
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
  {
    key: 'by_person',
    label: '인물별 모음',
    children: [
      { value:'pick1', label:'추천1' },
      { value:'pick2', label:'추천2' },
    ],
  },
];

/** 더큰카테고리: 쇼츠 / 일반영상 */
export const CATEGORY_MODEL = [
  { superKey:'shorts', superLabel:'쇼츠', groups: SHARED_GROUPS },
  { superKey:'video',  superLabel:'일반영상', groups: SHARED_GROUPS },
];

// (옵션) 전체 value 나열
export function ALL_CATEGORY_VALUES(){
  return CATEGORY_MODEL.flatMap(s => s.groups.flatMap(g => g.children.map(c => c.value)));
}
