// 이수증 글자(PDF 글자층 또는 OCR 결과)에서 성명·과정명·이수일·교육시간 등을 규칙으로 뽑는다.
// PDF 글자층과 로컬 OCR이 같은 판독 규칙을 쓴다.
// "성명 : 홍길동", "성 명   홍길동"처럼 "항목 이름 + 값" 형태를 찾는다.

import type { CertificateFlag } from '../../../shared/types.ts';

export interface ParsedCertificate {
  personName: string | null;
  personBirth: string | null;
  personDept: string | null;
  courseTitle: string | null;
  provider: string | null;
  certNo: string | null;
  completedOn: string | null;
  hours: number | null;
  /** 읽은 그대로의 교육시간 (예: "2차시") */
  hoursText: string | null;
  /** 교육시간이 차시 단위라 시간으로 바꾸지 못함 */
  hoursInSessions: boolean;
  looksLikeCertificate: boolean;
  notes: CertificateFlag[];
}

type Field = 'name' | 'birth' | 'org' | 'dept' | 'course' | 'period' | 'completed' | 'hours' | 'certNo' | 'provider';

// 긴 이름을 먼저 둔다 ("교육과정명"이 "교육과정"보다 먼저 맞도록)
const LABELS: [Field, string[]][] = [
  ['course', ['교육과정명', '과정명', '교육과정', '교육명', '강좌명', '연수과정', '연수명', '과정']],
  ['period', ['교육기간', '학습기간', '연수기간', '수강기간', '이수기간', '수료기간', '기간']],
  ['completed', ['이수일자', '수료일자', '교육일자', '이수일', '수료일', '교육일']],
  ['hours', ['상시학습인정시간', '상시학습시간', '학습인정시간', '교육시간', '학습시간', '이수시간', '인정시간', '연수시간', '수강시간']],
  ['certNo', ['증서번호', '수료번호', '이수번호', '발급번호', '증명번호', '수료증번호']],
  ['provider', ['교육기관', '운영기관', '시행기관', '발급기관']],
  ['birth', ['생년월일']],
  ['org', ['소속기관', '소속']],
  ['dept', ['소속부서', '부서']],
  ['name', ['성명', '이름', '성함']],
];

/** "성명" → /성\s*명/ : OCR이나 양식이 글자 사이를 띄워 써도 찾는다 */
function labelPattern(word: string): string {
  return [...word].join('\\s*');
}

const LABEL_RE = new RegExp(
  LABELS.flatMap(([, words]) => words)
    .sort((a, b) => b.length - a.length)
    .map(labelPattern)
    .join('|'),
  'g',
);

const LABEL_FIELD = new Map<string, Field>(LABELS.flatMap(([field, words]) => words.map((w) => [w, field] as const)));

/**
 * OCR이 항목 이름과 값을 붙여 읽은 줄을 띄운다: "성명송주주" → "성명 송주주", "생년월일1974-08-25" → "생년월일 1974-08-25".
 * 이름은 뒤에 한글 2~4자와 줄 끝(또는 넓은 빈칸)이 올 때만, 날짜·시간 항목은 뒤에 숫자가 올 때만 (문장 속 낱말은 건드리지 않게).
 */
const labelsOf = (...fields: Field[]) =>
  LABELS.filter(([f]) => fields.includes(f))
    .flatMap(([, words]) => words)
    .sort((a, b) => b.length - a.length)
    .map(labelPattern)
    .join('|');
const GLUED_NAME_RE = new RegExp(`^(${labelsOf('name')})(?=[가-힣]{2,4}(\\s{2,}|$))`);
const GLUED_NUMBER_RE = new RegExp(`^(${labelsOf('birth', 'completed', 'period', 'hours')})(?=\\d)`);

function unglue(line: string): string {
  return line.replace(GLUED_NAME_RE, '$1 ').replace(GLUED_NUMBER_RE, '$1 ');
}

const DATE_RE = /(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*(?:일|\.)?/g;

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function findDates(text: string): string[] {
  const dates: string[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) dates.push(date);
  }
  return dates;
}

function cleanLine(line: string): string {
  return line
    .normalize('NFC')
    .replace(/[：]/g, ':')
    .replace(/^[\s|ㅣ_.,:;'"`~·ㆍ\-]+/, '')
    .replace(/[\s|ㅣ_]+$/, '');
}

function cleanValue(value: string): string {
  return value
    .replace(/^[\s:|ㅣ_.\-]+/, '')
    .replace(/[\s|ㅣ_ㆍ.,]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 한 줄에서 "항목 이름 + 값" 쌍을 모두 찾는다 (한 줄에 여러 항목이 있을 수 있다) */
function labelValues(line: string): [Field, string][] {
  const found: { field: Field; start: number; end: number }[] = [];
  for (const m of line.matchAll(LABEL_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    const before = line.slice(0, start);
    const after = line.slice(end);
    // 문장 속 단어("위 교육과정을")가 아니라 항목 이름일 때만: 줄 맨 앞이거나 앞에 넓은 빈칸, 뒤에 콜론이나 빈칸
    const atStart = before.trim() === '';
    const spacedBefore = /\s{2,}$|[|:]\s*$/.test(before) || (/\s$/.test(before) && /^\s*:/.test(after));
    const separatedAfter = after.trim() === '' || /^\s*:|^\s+\S/.test(after);
    // 짧은 머리글은 문장 속 "과정 안내" 등을 잘못 잡지 않도록 명시적인 구분이 있을 때만 쓴다.
    const label = m[0].replace(/\s+/g, '');
    const shortValue = label === '기간' ? /^\s+\d{4}\s*(?:[./-]|년)/.test(after) : /^\s+(?:제\s*)?\d+\s*기\s/.test(after);
    if (['과정', '기간'].includes(label) && after.trim() !== '' && !/^\s*:|^\s{2,}\S/.test(after) && !shortValue) continue;
    if ((atStart || spacedBefore) && separatedAfter) {
      found.push({ field: LABEL_FIELD.get(label)!, start, end });
    }
  }
  return found.map((f, i) => [f.field, cleanValue(line.slice(f.end, found[i + 1]?.start ?? line.length))]);
}

function parseName(value: string): string | null {
  // 앞에 붙은 OCR 잡음 기호는 건너뛰고, 첫 낱말만 이름으로 본다 ("조재재     개" → 조재재)
  const tokens = value.replace(/^[^가-힣0-9]{0,3}/, '').split(/\s+/);
  const first = /^([가-힣]{2,5})(?![가-힣])/.exec(tokens[0] ?? '');
  if (first) return first[1];
  // 글자마다 띄어 쓴 이름: "홍 길 동"
  const singles: string[] = [];
  for (const token of tokens) {
    if (!/^[가-힣]$/.test(token)) break;
    singles.push(token);
  }
  return singles.length >= 2 && singles.length <= 4 ? singles.join('') : null;
}

export function parseHours(value: string): { hours: number | null; text: string; sessions: boolean } | null {
  const session = /(\d+(?:\.\d+)?)\s*차시/.exec(value);
  const hour = /(\d+(?:\.\d+)?)\s*(?:시간|hr|h|H)(?![가-힣])/.exec(value);
  const minute = /(\d+)\s*분/.exec(value);
  if (hour) {
    const hours = Number(hour[1]) + (minute ? Number(minute[1]) / 60 : 0);
    return { hours: Math.round(hours * 100) / 100, text: value.slice(hour.index, minute ? minute.index + minute[0].length : hour.index + hour[0].length).trim(), sessions: false };
  }
  if (minute) return { hours: Math.round((Number(minute[1]) / 60) * 100) / 100, text: minute[0], sessions: false };
  if (session) return { hours: null, text: session[0].replace(/\s+/g, ''), sessions: true };
  return null;
}

const PROVIDER_RE = /([가-힣A-Za-z0-9]{2,24}(?:원|센터|기관|연구소|학교|협회|공단|위원회|재단|아카데미))장(?![가-힣])/;

export function parseCertificateText(raw: string): ParsedCertificate {
  const lines = raw.split(/\r?\n/).map(cleanLine).map(unglue).filter((l) => l !== '');
  const values = new Map<Field, string>();
  const notes: CertificateFlag[] = [];
  let pending: Field | null = null;
  for (const original of lines) {
    // 일부 PDF 변환기는 같은 줄의 값 뒤에 머리글을 붙인다. 기수로 시작하는 명확한 경우만 복구한다.
    const line = original.replace(/^(제\s*\d+\s*기\s*.+?)\s*(?:과\s*정\s*명|과\s*정)\s*:\s*$/, '과정 : $1');
    if (line !== original && !notes.some(note => note.code === 'reading-order-recovered')) notes.push({ code: 'reading-order-recovered', level: 'warning', message: 'PDF 글자 순서가 뒤바뀐 과정명 항목을 복구했습니다. 원본과 대조해 주세요.' });
    const pairs = labelValues(line);
    if (pairs.length) {
      pending = null;
      for (const [index, [field, value]] of pairs.entries()) {
        if (values.has(field)) continue;
        if (value !== '') values.set(field, value);
        if (index === pairs.length - 1 && (field === 'course' || value === '')) pending = field;
      }
    } else if (pending) {
      // 항목 이름과 날짜가 다른 줄에 놓인 서식. 날짜 경계 검사보다 먼저 해당 항목에 연결한다.
      if (['birth', 'completed', 'period'].includes(pending) && findDates(line).length > 0) {
        const dateValue: string = pending === 'period' ? [values.get('period'), cleanValue(line)].filter(Boolean).join(' ') : cleanValue(line);
        values.set(pending, dateValue);
        pending = pending === 'period' && findDates(dateValue).length < 2 ? 'period' : null;
        continue;
      }
      // 과정명이 다음 줄로 이어질 수 있다. 다른 항목·증명 문구·날짜·기관장 이름에서 멈춘다.
      const boundary = /^[가-힣A-Za-z\s]{1,20}\s*:|^(?:위\s*사람|상기|소정|성실히|본\s*수료증|※|https?:\/\/)/.test(line) ||
        findDates(line).length > 0 || PROVIDER_RE.test(line) || /^(?:수\s*료\s*증|이\s*수\s*증)$/.test(line);
      if (boundary) { pending = null; continue; }
      if (pending === 'course') {
        const joined = [values.get('course'), cleanValue(line)].filter(Boolean).join(' ');
        if (joined.length <= 300) values.set('course', joined);
        else pending = null;
      } else {
        values.set(pending, cleanValue(line));
        pending = null;
      }
    }
  }
  const text = lines.join('\n');

  const personName = values.has('name') ? parseName(values.get('name')!) : null;
  const personBirth = values.has('birth') ? (findDates(values.get('birth')!)[0] ?? null) : null;

  // 이수일: 이수일 항목 → 교육기간의 끝 날짜 → 날짜만 있는 줄(발급일) → 생년월일이 아닌 가장 늦은 날짜
  let completedOn = values.has('completed') ? (findDates(values.get('completed')!)[0] ?? null) : null;
  if (!completedOn && values.has('period')) {
    // 시작·끝 날짜를 모두 읽었을 때만 믿는다 (OCR이 기간을 망가뜨리면 엉뚱한 날짜가 남는다)
    const period = findDates(values.get('period')!);
    if (period.length >= 2) completedOn = period.at(-1)!;
  }
  if (!completedOn) {
    const periodDates = findDates(values.get('period') ?? '');
    const dateOnly = [...new Set(lines.filter(l => findDates(l).length === 1 && l.replace(DATE_RE, '').replace(/[\s_.·-]/g, '') === '')
      .flatMap(findDates).filter(date => date !== personBirth && !(periodDates.length === 1 && periodDates[0] === date)))];
    completedOn = dateOnly.length === 1 ? dateOnly[0] : null;
  }
  if (!completedOn) {
    completedOn = findDates(text).filter((d) => d !== personBirth).sort().at(-1) ?? null;
    if (completedOn) notes.push({ code: 'date-inferred', level: 'warning', message: '이수일·교육기간 항목을 확인하지 못해 문서의 날짜를 사용했습니다. 원본과 대조해 주세요.' });
  }

  // 교육시간: 시간 항목 → 글 속의 "(2시간)" 같은 표기
  const hoursInfo =
    (values.has('hours') ? parseHours(values.get('hours')!) : null) ??
    parseHours(lines.find((l) => /\d\s*(?:시간|차시)/.test(l) && !findDates(l.replace(/\(.*\)/, '')).length) ?? '') ??
    parseHours(/\((\d+(?:\.\d+)?\s*(?:시간|차시))\)/.exec(text)?.[1] ?? '');

  const certNoValue = values.get('certNo');
  const certNo =
    (certNoValue ? /[0-9A-Za-z가-힣][0-9A-Za-z가-힣-]*/.exec(certNoValue)?.[0] : undefined) ??
    /제\s*([0-9A-Za-z][0-9A-Za-z-]{3,})\s*호/.exec(text)?.[1] ??
    null;

  const providerLine = [...lines].reverse().find((l) => PROVIDER_RE.test(l));
  const provider = values.get('provider') ?? (providerLine ? PROVIDER_RE.exec(providerLine)![1] : null);

  const courseTitle = values.get('course') ?? null;
  const org = values.get('org');
  const dept = values.get('dept');
  const personDept = org && dept ? (org.replace(/\s/g, '').includes(dept.replace(/\s/g, '')) ? org : `${org} ${dept}`) : org ?? dept ?? null;
  const hasCertificateHeading = lines.some(line => /^(?:(?:교\s*육|연\s*수|학\s*습)\s*)?(?:수\s*료\s*증|이\s*수\s*증|(?:수\s*료|이\s*수)\s*확\s*인\s*서)\s*[.!]?$/.test(line));
  const completedStatement = /이수하였|이수했|수료하였|수료했|교육과정을마쳤|교육을마쳤|교육을완료하였/.test(text.replace(/\s/g, ''));
  const identifiedEvidence = certNo !== null && provider !== null && personName !== null && courseTitle !== null;
  return {
    personName,
    personBirth,
    personDept,
    courseTitle,
    provider,
    certNo,
    completedOn,
    hours: hoursInfo?.hours ?? null,
    hoursText: hoursInfo?.text ?? null,
    hoursInSessions: hoursInfo?.sessions ?? false,
    looksLikeCertificate: (hasCertificateHeading || completedStatement || identifiedEvidence) && completedOn !== null && (personName !== null || courseTitle !== null),
    notes,
  };
}

/** 글자층에 대체 문자·조합 설명 문자 같은 손상 흔적이 있으면 원본 이미지의 OCR로 전환한다. */
export function hasUsableText(text: string | null): boolean {
  if (text && /[\uFFFD\u2F00-\u2FFF]/u.test(text)) return false;
  return (text?.match(/[가-힣A-Za-z0-9]/g)?.length ?? 0) >= 30;
}
