// js/categories.js
// 최종 스펙: 유형(type)과 주제 카테고리(groups)를 분리 관리
// - type: 'shorts' | 'video' (데이터에 필수 저장)
// - groups: 주제 카테고리들 (개인자료 1~4 포함)

export const CATEGORY_MODEL = {
  types: [
    { value: 'shorts', label: '쇼츠' },
    { value: 'video',  label: '일반영상' }
  ],
  groups: [
    {
      group: '개인자료',
      children: [
        { value: 'personal1', label: '자료1' },
        { value: 'personal2', label: '자료2' },
        { value: 'personal3', label: '자료3' },
        { value: 'personal4', label: '자료4' }
      ]
    },
    {
      group: '콘텐츠',
      children: [
        { value: 'music',       label: '뮤직' },
        { value: 'gaming',      label: '게임' },
        { value: 'news',        label: '뉴스' },
        { value: 'documentary', label: '다큐' },
        { value: 'movie',       label: '영화' },
        { value: 'vlog',        label: '브이로그' },
        { value: 'talk',        label: '토크/인터뷰' }
      ]
    },
    {
      group: '학습/개발',
      children: [
        { value: 'education',   label: '학습' },
        { value: 'programming', label: '프로그래밍' },
        { value: 'web',         label: '웹' },
        { value: 'mobile',      label: '모바일' },
        { value: 'ai',          label: 'AI/머신러닝' },
        { value: 'design',      label: '디자인/UX' },
        { value: 'tools',       label: '툴/생산성' }
      ]
    },
    {
      group: '기타',
      children: [
        { value: 'review',      label: '리뷰' },
        { value: 'howto',       label: '튜토리얼' },
        { value: 'science',     label: '과학' },
        { value: 'tech',        label: '테크' },
        { value: 'etc',         label: '기타' }
      ]
    }
  ]
};

// 편의 유틸(선택)
export const CATEGORY_VALUES = CATEGORY_MODEL.groups.flatMap(g => g.children?.map(c => c.value) || []);
export const TYPE_VALUES     = CATEGORY_MODEL.types.map(t => t.value);

// value → label (type/카테고리 공용)
export function labelOf(value){
  const t = CATEGORY_MODEL.types.find(x=>x.value===value);
  if (t) return t.label;
  for(const g of CATEGORY_MODEL.groups){
    const c = (g.children||[]).find(x=>x.value===value);
    if (c) return c.label || value;
  }
  return value;
}
