// js/categories.js (ArkTube 콘텐츠 × CopyTube 형식)

export const CATEGORY_GROUPS = [
  {
    key: 'praise',
    label: '찬양',
    children: [
      { value:'hymn',        label:'찬송가' },
      { value:'ccm',         label:'CCM' },
      { value:'ccm1',         label:'찬양감사기쁨' },
      { value:'ccm2',         label:'소망위로용서' },
      { value:'ccm3',         label:'사랑축복' },
      { value:'ccm4',         label:'말씀묵상' },
      { value:'ccm5',         label:'교회선교' },            
      { value:'ccm6',         label:'특별절기' },            
      { value:'kids_praise', label:'어린이 찬양' },
    ],
  },
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
  {
    key: 'series',
    label: '시리즈',
    children: [
      { value:'pick1', label:'추천1' },
      { value:'pick2', label:'추천2' },
    ],
  },

  // CopyTube 형식에 맞춰 personal 블록은 맨 아래 배치(라벨은 로컬에서 변경 가능)
  {
    key: 'personal',
    label: '개인자료',
    personal: true,
    children: [
      { value: 'personal1',  label: '자료1' },
      { value: 'personal2',  label: '자료2' },
      { value: 'personal3',  label: '자료3' },
      { value: 'personal4',  label: '자료4' },
    ],
  },
];

export function ALL_CATEGORY_VALUES() {
  return CATEGORY_GROUPS.flatMap(g => g.children.map(c => c.value));
}
