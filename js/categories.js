// js/categories.js

export const CATEGORY_GROUPS = [

  /* 일상 (스포츠 제거, 뉴스 추가) */
  {
    key: 'daily',
    label: '일상',
    children: [
      { value: 'fun',            label: '유머짤' },
      { value: 'funstory',       label: '유머스토리' },
      { value: 'baby',           label: '아기' },
      { value: 'animal',         label: '동물' },
      { value: 'national_pride', label: '국뽕' },
      { value: 'meme',           label: '밈' },
      { value: 'person',         label: '인물' },
      { value: 'touch',          label: '감동' },
      { value: 'variety',        label: '예능' },
      { value: 'celeb',          label: '연예' },
      { value: 'news',           label: '뉴스' },     // ★ 신규
      { value: 'ads',         label: '광고' },
      { value: 'nature',         label: '자연' },
      { value: 'proman',         label: '달인마술' },
      { value: 'saida',          label: '사이다' },
    ],
  },

  /* 생활정보 */
  {
    key: 'lifeinfo',
    label: '생활정보',
    children: [
      { value: 'common',     label: '상식' },
      { value: 'life',       label: '생활팁' },
      { value: 'beauty',     label: '미용' },
      { value: 'housework',  label: '가사' },
      { value: 'health',     label: '건강' },
      { value: 'exercise',   label: '운동' },
      { value: 'self',       label: '자기관리' },
      { value: 'social',     label: '사회생활' },
      { value: 'law',        label: '법률' },
      { value: 'estate',     label: '부동산' },
      { value: 'parenting',  label: '육아' },
      { value: 'misinfo',    label: '가짜정보' },
    ],
  },

  /* 여가·미식 (게임 이동, 독서/악기연주 추가, 집꾸미기 라벨 변경) */
  {
    key: 'leisure_food',
    label: '여가·취미',
    children: [
      { value: 'cook',            label: '요리' },
      { value: 'activity',        label: '액티비티' },
      { value: 'proart',          label: '예술' },
      { value: 'hobby',           label: '취미' },
      { value: 'play',            label: '놀이' },
      { value: 'making',          label: '제작수리' },
      { value: 'mobility',        label: '모빌리티' },
      { value: 'interior',        label: '인테리어건축' }, // ★ 라벨만 변경(키 유지)
      { value: 'reading',         label: '독서' },          // ★ 신규
      { value: 'instrument_play', label: '악기연주' },      // ★ 신규
      { value: 'sports_fishing',    label: '낚시' },
      { value: 'camera',            label: '카메라영상' }, 
      { value: 'game',            label: '게임' },          // ★ (정보·IT → 이동)
    ],
  },

 
  /* 스포츠 (신규 대분류) */
  {
    key: 'sports',
    label: '스포츠',
    children: [
      { value: 'sports_fight',      label: '격투' },                  // 격투vs → 격투
      { value: 'sports_soccer',     label: '축구' },
      { value: 'sports_basketball', label: '농구' },
      { value: 'sports_baseball',   label: '야구' },
      { value: 'sports_golf',   label: '골프' },
      { value: 'sports_racket',     label: '탁구/테니스/배드민턴' }, // 탁테배 
      { value: 'water',            label: '수영물놀이' }, 
      { value: 'sports_etc',   label: '그외' },
    ],
  },

  /* 정보·IT (게임 제거) */
  {
    key: 'infoit',
    label: '정보·IT',
    children: [
      { value: 'new_product', label: '신제품' },
      { value: 'tech_future', label: '기술미래' },
      { value: 'computer',    label: '컴퓨터' },
      { value: 'coding',      label: '코딩' },
      { value: 'graphic',     label: '그래픽영상' },
      { value: 'app',         label: '앱·어플' },
      { value: 'engineer',    label: '공학' },
    ],
  },

  /* 제품리뷰 (대분류) */
  {
    key: 'product_review',
    label: '제품리뷰',
    children: [
      { value: 'prd_smart',     label: '스마트기기' },
      { value: 'prd_electro',   label: '전자기기' },
      { value: 'prd_sports',    label: '운동·스포츠' },
      { value: 'prd_vehicle',   label: '자동차·이동' },
      { value: 'prd_housework', label: '가사' },
      { value: 'prd_kitchen',   label: '주방' },
      { value: 'prd_garden',    label: '원예·수렵' },
      { value: 'prd_tools',     label: '도구' },
      { value: 'prd_health',    label: '건강·의료' },
      { value: 'prd_pet',       label: '애완' },
      { value: 'prd_study',     label: '공부' },
      { value: 'prd_misc',      label: '그외' },
    ],
  },

  /* 생존 */
  {
    key: 'survival',
    label: '생존',
    children: [
      { value: 'expert_master',  label: '전문가' },
      { value: 'agri_fish_ind',  label: '농어광공업' },
      { value: 'camp',       label: '캠핑매듭' },
      { value: 'survival',       label: '서바이벌' },
      { value: 'military',       label: '군사' },
    ],
  },

         /* 여행·미식  */
  {
    key: 'travel_food',
    label: '여행·미식',
    children: [
      { value: 'foodie',          label: '국내맛집' },
      { value: 'travel',          label: '국내여행' },
      { value: 'jfoodie',          label: '일본맛집' },
      { value: 'jtravel',          label: '일본여행' },
      { value: 'afoodie',          label: '미국맛집' },
      { value: 'atravel',          label: '미국여행' },
      { value: 'efoodie',          label: '유럽맛집' },
      { value: 'etravel',          label: '유럽여행' },
      { value: 'wfoodie',          label: '세계맛집' },
      { value: 'wtravel',          label: '세계여행' },
    ],
  },

    /* 영상·리뷰 */
  {
    key: 'media',
    label: '영상·리뷰',
    children: [
      { value: 'movie',      label: '영화' },
      { value: 'movie_s',      label: '영화짤' },
      { value: 'drama',      label: '드라마' },
      { value: 'drama_s',      label: '드라마짤' },
      { value: 'anime',      label: '애니' },
      { value: 'anime_s',      label: '애니짤' },
      { value: 'comic',      label: '만화' },
      { value: 'novel',      label: '소설' },
      { value: 'media_etc',  label: '그외' },
    ],
  },

  /* ★ 음악감상 (영상·리뷰 아래) */
  {
    key: 'music_listen',
    label: '음악감상',
    children: [
      { value: 'music_kpop',           label: 'K-pop' },
      { value: 'music_kayo',           label: 'K가요' },
      { value: 'music_ballad',         label: '발라드' },
      { value: 'music_rock',           label: 'Rock' },
      { value: 'music_hiphop_rnb',     label: '힙합 & R&B' },
      { value: 'music_pop',            label: 'Pop' },
      { value: 'music_jpop',            label: 'J-Pop' },
      { value: 'music_3pop',            label: '3rd_Pop' },
      { value: 'music_classic',        label: '클래식' },
      { value: 'music_ost_musical',    label: '영화/뮤지컬' },
      { value: 'music_ani',            label: '애니메이션' },
      { value: 'music_children',       label: '동요/어린이' },
      { value: 'music_internet',       label: '인터넷/Creator' },
      { value: 'music_jazz',           label: '재즈(Jazz)' },
      { value: 'music_newage_healing', label: '뉴에이지/힐링' },
      { value: 'music_gospel',         label: '가스펠' },
    ],
  },

  /* 교육 */
  {
    key: 'edu',
    label: '교육',
    children: [
      { value: 'edu_general', label: '일반' },
      { value: 'edu_child',   label: '어린이' },
      { value: 'science',     label: '과학' },
            { value: 'physics',     label: '물리' },
      { value: 'chemical',     label: '화학' },
      { value: 'biology',     label: '생명' },
      { value: 'earthspace',     label: '지구우주' },
      { value: 'math',        label: '수학' },
      { value: 'english',     label: '영어' },
      { value: 'korean',      label: '국어' },
      { value: 'edu_social',  label: '사회' }, // 충돌 방지용 확정 키
      { value: 'history',     label: '국사' },
      { value: 'whistory',     label: '세계사' },
       { value: 'geography',     label: '지리' },
      { value: 'art',         label: '미술' },
      { value: 'music',       label: '음악' },
      { value: 'japanese',    label: '일본어' },
      { value: 'other_lang',  label: '기타언어' },
    ],
  },

    /* 사회 */
  {
    key: 'society',
    label: '사회',
    children: [
      { value: 'politics',    label: '시사정치' },
      { value: 'finance',     label: '금융경제' },
      { value: 'era_insight', label: '시대통찰' },
      { value: 'christian',   label: '기독교' },
    ],
  },
  
  /* 의학 */
  {
    key: 'medical',
    label: '의학',
    children: [
      { value: 'med_general', label: '일반' },
      { value: 'internal',    label: '내과' },
      { value: 'surgery',     label: '외과' },
      { value: 'pediatrics',  label: '소아과' },
      { value: 'obgy',        label: '산부인과' },
      { value: 'urology',     label: '신비뇨기과' },
      { value: 'os',          label: '근골격계' },
      { value: 'dermacos',    label: '피부성형' },
      { value: 'neuro',       label: '신경' },
      { value: 'ophthalmo',   label: '안과' },
      { value: 'ent',         label: '이비인후과' },
      { value: 'psychology',  label: '정신건강' },
      { value: 'dental',      label: '구강치과' },
      { value: 'saib',        label: '대체의학' },
    ],
  },

  /* 기타 */
  {
    key: 'etc',
    label: '기타',
    children: [
      { value: 'etc', label: '미분류' },
    ],
  },

  /* 성별·연령 (신규 대분류) */
  {
    key: 'demographics',
    label: '성별·연령',
    children: [
      { value: 'female', label: '여성용' },
      { value: 'male',   label: '남성용' },
      { value: 'youth',  label: '잼민이' },
      { value: 'senior', label: '노인' },
    ],
  },

  /* 시리즈 — ★ 개인자료 바로 앞에 배치 */
  {
    key: 'series',
    label: '시리즈',
    children: [
      { value: 'series_miraculous', label: '미라큘러스' },
      { value: 'series_marvel',     label: '마블' },
    ],
  },

  /* 개인자료 (로컬 저장 전용) — 항상 최하단 */
  {
    key: 'personal',
    label: '개인자료',
    personal: true,
    children: [
      { value: 'personal1',  label: '자료1' },
      { value: 'personal2',  label: '자료2' },
      { value: 'personal3',  label: '자료3' },
      { value: 'personal4',  label: '자료4' },
      { value: 'personal5',  label: '자료5' },
      { value: 'personal6',  label: '자료6' },
      { value: 'personal7',  label: '자료7' },
      { value: 'personal8',  label: '자료8' },
      
    ],
  },
];

export function ALL_CATEGORY_VALUES() {
  return CATEGORY_GROUPS.flatMap(g => g.children.map(c => c.value));
}
