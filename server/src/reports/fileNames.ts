// 내려받는 파일·ZIP 안 파일의 이름. Windows 탐색기에서 그대로 열리도록:
//  - 쓸 수 없는 글자(\ / : * ? " < > |)와 제어 문자는 바꾸고
//  - 끝의 점·빈칸, CON·PRN 같은 예약 이름을 피하고
//  - 너무 긴 이름은 자른다 (경로 전체 260자 제한을 넉넉히 피하도록)

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_PART = 80;

export function safeName(part: string, fallback = '이름없음'): string {
  let name = part
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if ([...name].length > MAX_PART) name = [...name].slice(0, MAX_PART).join('').trim();
  if (name === '') name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  return name;
}

/** 같은 폴더 안에서 이름이 겹치면 "(2)", "(3)"을 붙인다 */
export class UniqueNames {
  private readonly used = new Set<string>();

  take(dir: string, base: string, ext: string): string {
    for (let n = 1; ; n++) {
      const name = `${dir ? `${dir}/` : ''}${base}${n === 1 ? '' : ` (${n})`}${ext}`;
      const key = name.toLowerCase(); // Windows는 대소문자를 구분하지 않는다
      if (!this.used.has(key)) {
        this.used.add(key);
        return name;
      }
    }
  }
}

/** 이수증 파일 이름: 부서_성명_교육명_이수일 */
export function certificateBaseName(r: { departmentName: string | null; employeeName: string; trainingName: string; completedOn: string }): string {
  return [r.departmentName ?? '부서없음', r.employeeName, r.trainingName, r.completedOn || '이수일없음'].map((p) => safeName(p)).join('_');
}
