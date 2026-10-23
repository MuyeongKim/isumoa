/** 표 머리글처럼 좁은 곳에 쓰는 교육 이름: "청렴교육(부패방지교육)" → "청렴", "성희롱 예방교육" → "성희롱" */
export function shortTrainingName(name: string): string {
  return name.replace(/\(.*?\)/g, '').replace(/\s*(예방)?\s*교육$/, '').trim();
}
