// 가상 이수증 모양(실존 기관 아님). 한 번 그린 모양을 텍스트 PDF와 스캔 이미지 두 방식으로 출력한다.
// 좌표는 A4(595×842pt) 기준, 왼쪽 위가 원점이고 y는 글자 기준선이다.

export const PAGE = { width: 595, height: 842 };

export type Op =
  | { kind: 'text'; x: number; y: number; size: number; text: string; align?: 'left' | 'center'; bold?: boolean; color?: string }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; lineWidth: number; color?: string; fill?: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; lineWidth: number; color?: string }
  | { kind: 'seal'; x: number; y: number; size: number };

export type Template = 'formal' | 'table' | 'brief';

export interface CertData {
  template: Template;
  name: string;
  /** YYYY-MM-DD, 없으면 표시하지 않음 */
  birth: string | null;
  department: string;
  courseTitle: string;
  periodStart: string;
  completedOn: string;
  hoursText: string;
  certNo: string;
}

export const PROVIDERS: Record<Template, string> = {
  formal: '가상인재개발원',
  table: '가상사이버교육센터',
  brief: '가상청렴연수원',
};

const [y4, m2, d2] = [(s: string) => s.slice(0, 4), (s: string) => Number(s.slice(5, 7)), (s: string) => Number(s.slice(8, 10))];
const dotted = (s: string) => `${y4(s)}. ${m2(s)}. ${d2(s)}.`;
const korean = (s: string) => `${y4(s)}년 ${m2(s)}월 ${d2(s)}일`;

function formal(d: CertData): Op[] {
  const label = (text: string, value: string, y: number): Op[] => [
    { kind: 'text', x: 92, y, size: 14, text },
    { kind: 'text', x: 200, y, size: 14, text: `:  ${value}` },
  ];
  return [
    { kind: 'rect', x: 30, y: 30, w: 535, h: 782, lineWidth: 2.2 },
    { kind: 'rect', x: 38, y: 38, w: 519, h: 766, lineWidth: 0.7 },
    { kind: 'text', x: 62, y: 84, size: 11, text: `제 ${d.certNo} 호` },
    { kind: 'text', x: PAGE.width / 2, y: 175, size: 36, text: '수   료   증', align: 'center', bold: true },
    ...label('성          명', d.name, 268),
    ...(d.birth ? label('생 년 월 일', dotted(d.birth), 304) : []),
    ...label('소          속', `가람시 ${d.department}`, 340),
    ...label('과    정    명', d.courseTitle, 376),
    ...label('교 육 기 간', `${dotted(d.periodStart)} ~ ${dotted(d.completedOn)}`, 412),
    ...label('교 육 시 간', d.hoursText, 448),
    { kind: 'text', x: PAGE.width / 2, y: 540, size: 14, text: '위 사람은 본원에서 실시한 위 교육과정을', align: 'center' },
    { kind: 'text', x: PAGE.width / 2, y: 566, size: 14, text: '성실히 이수하였기에 이 증서를 수여합니다.', align: 'center' },
    { kind: 'text', x: PAGE.width / 2, y: 650, size: 16, text: korean(d.completedOn), align: 'center' },
    { kind: 'text', x: PAGE.width / 2, y: 728, size: 24, text: `${PROVIDERS.formal}장`, align: 'center', bold: true },
    { kind: 'seal', x: 410, y: 690, size: 52 },
  ];
}

function table(d: CertData): Op[] {
  const rows: [string, string][] = [
    ['이름', d.name],
    ['소속기관', `가람시 ${d.department}`],
    ['교육과정', d.courseTitle],
    ['학습기간', `${d.periodStart} ~ ${d.completedOn}`],
    ['이수시간', d.hoursText],
    ['이수일자', d.completedOn],
    ['증서번호', d.certNo],
  ];
  const top = 215;
  const rowH = 40;
  const ops: Op[] = [
    { kind: 'text', x: 64, y: 72, size: 13, text: PROVIDERS.table, color: '#2b4a6f', bold: true },
    { kind: 'line', x1: 64, y1: 84, x2: 531, y2: 84, lineWidth: 1, color: '#2b4a6f' },
    { kind: 'text', x: PAGE.width / 2, y: 160, size: 30, text: '교육 이수증', align: 'center', bold: true },
    { kind: 'rect', x: 70, y: top, w: 455, h: rowH * rows.length, lineWidth: 1.2 },
  ];
  rows.forEach(([label, value], i) => {
    const y = top + i * rowH;
    ops.push(
      { kind: 'rect', x: 70, y, w: 120, h: rowH, lineWidth: 0.6, fill: '#eef1f4' },
      { kind: 'line', x1: 70, y1: y + rowH, x2: 525, y2: y + rowH, lineWidth: 0.6 },
      { kind: 'text', x: 130, y: y + 26, size: 13, text: label, align: 'center', bold: true },
      { kind: 'text', x: 206, y: y + 26, size: 13, text: value },
    );
  });
  ops.push(
    { kind: 'text', x: PAGE.width / 2, y: 572, size: 14, text: '위 사람은 상기 교육과정을 이수하였음을 증명합니다.', align: 'center' },
    { kind: 'text', x: PAGE.width / 2, y: 646, size: 15, text: korean(d.completedOn), align: 'center' },
    { kind: 'text', x: PAGE.width / 2, y: 716, size: 21, text: `${PROVIDERS.table}장`, align: 'center', bold: true },
    { kind: 'seal', x: 420, y: 682, size: 46 },
  );
  return ops;
}

function brief(d: CertData): Op[] {
  return [
    { kind: 'rect', x: 44, y: 44, w: 507, h: 754, lineWidth: 1.4 },
    { kind: 'text', x: PAGE.width / 2, y: 160, size: 32, text: '교 육 이 수 증', align: 'center', bold: true },
    { kind: 'text', x: 92, y: 258, size: 14, text: `성 명   ${d.name}` },
    ...(d.birth ? [{ kind: 'text' as const, x: 318, y: 258, size: 14, text: `생년월일   ${d.birth}` }] : []),
    { kind: 'text', x: 92, y: 298, size: 14, text: `교육명 : ${d.courseTitle}` },
    { kind: 'text', x: 92, y: 338, size: 14, text: `교육일 : ${d.completedOn.replaceAll('-', '.')} (${d.hoursText})` },
    { kind: 'text', x: 92, y: 378, size: 14, text: `교육기관 : ${PROVIDERS.brief}` },
    { kind: 'text', x: PAGE.width / 2, y: 456, size: 14, text: '위 사람은 위 교육을 이수하였음을 증명합니다.', align: 'center' },
    { kind: 'text', x: 92, y: 612, size: 11, text: `발급번호 : ${d.certNo}` },
    { kind: 'text', x: PAGE.width / 2, y: 660, size: 15, text: korean(d.completedOn), align: 'center' },
    { kind: 'text', x: PAGE.width / 2, y: 730, size: 22, text: `${PROVIDERS.brief}장`, align: 'center', bold: true },
    { kind: 'seal', x: 408, y: 694, size: 48 },
  ];
}

export function drawCertificate(d: CertData): Op[] {
  return d.template === 'formal' ? formal(d) : d.template === 'table' ? table(d) : brief(d);
}

/** 스캔 묶음 맨 앞에 끼워 넣는 제출 표지 (이수증이 아닌 쪽) */
export function drawMemo(lines: string[]): Op[] {
  return lines.map((text, i) => ({ kind: 'text' as const, x: 80, y: 140 + i * 34, size: i === 0 ? 22 : 14, text, bold: i === 0 }));
}
