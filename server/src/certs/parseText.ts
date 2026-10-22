// 이수증 글자(PDF 글자층 또는 OCR 결과)에서 성명·과정명·이수일·교육시간 등을 규칙으로 뽑는다.
// AI 없이도 동작하는 기본 방식이고, AI를 쓸 때도 결과를 대조하는 데 쓴다.
// "성명 : 홍길동", "성 명   홍길동"처럼 "항목 이름 + 값" 형태를 찾는다.

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
}

type Field = 'name' | 'birth' | 'dept' | 'course' | 'period' | 'completed' | 'hours' | 'certNo' | 'provider';

// 긴 이름을 먼저 둔다 ("교육과정명"이 "교육과정"보다 먼저 맞도록)
const LABELS: [Field, string[]][] = [
  ['course', ['교육과정명', '과정명', '교육과정', '교육명', '강좌명', '연수과정', '연수명']],
  ['period', ['교육기간', '학습기간', '연수기간', '수강기간', '이수기간']],
  ['completed', ['이수일자', '수료일자', '교육일자', '이수일', '수료일', '교육일']],
  ['hours', ['교육시간', '학습시간', '이수시간', '인정시간', '연수시간', '수강시간']],
  ['certNo', ['증서번호', '수료번호', '이수번호', '발급번호', '증명번호', '수료증번호']],
  ['provider', ['교육기관', '운영기관', '시행기관', '발급기관']],
  ['birth', ['생년월일']],
  ['dept', ['소속기관', '소속부서', '소속', '부서']],
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
    const spacedBefore = /\s{2,}$|[|:]\s*$/.test(before);
    const separatedAfter = /^\s*:|^\s+\S/.test(after);
    if ((atStart || spacedBefore) && separatedAfter) {
      found.push({ field: LABEL_FIELD.get(m[0].replace(/\s+/g, ''))!, start, end });
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

function parseHours(value: string): { hours: number | null; text: string; sessions: boolean } | null {
  const session = /(\d+(?:\.\d+)?)\s*차시/.exec(value);
  if (session) return { hours: null, text: session[0].replace(/\s+/g, ''), sessions: true };
  const hour = /(\d+(?:\.\d+)?)\s*(?:시간|hr|h|H)(?![가-힣])/.exec(value);
  const minute = /(\d+)\s*분/.exec(value);
  if (hour) {
    const hours = Number(hour[1]) + (minute ? Number(minute[1]) / 60 : 0);
    return { hours: Math.round(hours * 100) / 100, text: value.slice(hour.index, minute ? minute.index + minute[0].length : hour.index + hour[0].length).trim(), sessions: false };
  }
  if (minute) return { hours: Math.round((Number(minute[1]) / 60) * 100) / 100, text: minute[0], sessions: false };
  return null;
}

const PROVIDER_RE = /([가-힣A-Za-z0-9]{2,24}(?:원|센터|기관|연구소|학교|협회|공단|위원회|재단|아카데미))장(?![가-힣])/;

export function parseCertificateText(raw: string): ParsedCertificate {
  const lines = raw.split(/\r?\n/).map(cleanLine).filter((l) => l !== '');
  const values = new Map<Field, string>();
  for (const line of lines) {
    for (const [field, value] of labelValues(line)) {
      if (value !== '' && !values.has(field)) values.set(field, value);
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
    const dateOnly = lines.find((l) => /^\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\.?$/.test(l.replace(/[^\d년월일\s.]/g, '').trim()));
    completedOn = dateOnly ? (findDates(dateOnly)[0] ?? null) : null;
  }
  if (!completedOn) {
    completedOn = findDates(text).filter((d) => d !== personBirth).sort().at(-1) ?? null;
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
  const hasCertificateWords = /수\s*료|이\s*수|증\s*서|증\s*명/.test(text);
  return {
    personName,
    personBirth,
    personDept: values.get('dept') ?? null,
    courseTitle,
    provider,
    certNo,
    completedOn,
    hours: hoursInfo?.hours ?? null,
    hoursText: hoursInfo?.text ?? null,
    hoursInSessions: hoursInfo?.sessions ?? false,
    looksLikeCertificate: hasCertificateWords && completedOn !== null && (personName !== null || courseTitle !== null),
  };
}

/** PDF 글자층이 쓸 만한지: 한글·영숫자가 30자 이상 */
export function hasUsableText(text: string | null): boolean {
  return (text?.match(/[가-힣A-Za-z0-9]/g)?.length ?? 0) >= 30;
}
