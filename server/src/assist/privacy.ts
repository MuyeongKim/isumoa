import type { RuleField } from '../../../shared/reviewTools.ts';
import { LABELS, findDates, parseCertificateText } from '../certs/parseText.ts';
import { badRequest } from '../lib/errors.ts';

const MARK = '[개인정보 가림]';
const PRIVATE_FIELDS = new Set<RuleField>(['name', 'birth', 'org', 'dept']);
const EXTRA_LABELS = ['주민등록번호', '주민번호', '사번', '직급', '직위', '성별', '연락처', '전화번호', '휴대전화', '이메일', '주소'];
const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flexible = (v: string) => [...v.replace(/\s/g, '')].map(escape).join('[^\\S\\r\\n]*');
type Aliases = Partial<Record<RuleField, string[]>>;
type PrivateValue = string | null | undefined;

/** Known values also protect misread course/provider fields, without sending the employee roster. */
export function maskPrivateValues(text: string, values: PrivateValue[]): string {
  let out = text.normalize('NFC');
  for (const value of [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => b.length - a.length)) {
    const normalized = value.normalize('NFC').trim();
    if (normalized.replace(/\s/g, '').length < 2 || normalized === MARK) continue;
    const dates = findDates(normalized);
    if (/^\d{8}$/.test(normalized)) dates.push(normalized.slice(0, 4) + '-' + normalized.slice(4, 6) + '-' + normalized.slice(6));
    for (const date of dates) {
      const [y, m, d] = date.split('-');
      const month = Number(m), day = Number(d);
      const pattern = `(?<!\\d)${y}[^\\S\\r\\n]*(?:[-./년][^\\S\\r\\n]*)?0?${month}[^\\S\\r\\n]*(?:[-./월][^\\S\\r\\n]*)?0?${day}(?:[^\\S\\r\\n]*[일.])?(?!\\d)`;
      out = out.replace(new RegExp(pattern, 'g'), MARK);
    }
    const literal = [...normalized.replace(/\s/g, '')].map(escape).join('\\s*');
    out = out.replace(new RegExp(/^\d+$/.test(normalized) ? '(?<!\\d)' + literal + '(?!\\d)' : literal, 'gi'), MARK);
  }
  return out
    .replace(/(?<!\d)\d{6}\s*[-–]?\s*(?:\d[ \t]*){7}(?!\d)/g, MARK)
    .replace(/(?<!\d)\d{6}\s*[-–]?\s*[1-8]\*{6}(?!\d)/g, MARK)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MARK)
    .replace(/0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g, MARK);
}

/** Redact labelled cells/continuations even when OCR did not parse the person's identity. */
export function redactPersonalText(text: string, known: PrivateValue[], aliases: Aliases = {}): { text: string; values: string[] } {
  const labels = LABELS.flatMap(([field, words]) => [...words, ...(aliases[field] ?? [])].map(word => ({ word, field: field as string, personal: PRIVATE_FIELDS.has(field) })))
    .concat(EXTRA_LABELS.map(word => ({ word, field: 'private', personal: true })))
    .sort((a, b) => b.word.length - a.word.length);
  const fields = new Map(labels.map(l => [l.word.replace(/\s/g, ''), l]));
  const pattern = new RegExp(labels.map(l => flexible(l.word)).join('|'), 'g');
  const values = known.filter((v): v is string => !!v).map(v => v.normalize('NFC'));
  let privateContinuation = false;
  const output: string[] = [];
  const collect = (value: string, field = '') => {
    const clean = value.replace(/^[\s:：|│┃ㅣ]+|[\s|│┃ㅣ]+$/g, '').trim();
    if (!clean || clean === MARK) return;
    const cells = clean.split(/[|│┃\t]|\s{2,}/g).map(v => v.trim()).filter(Boolean);
    values.push(clean, ...cells);
    // Values under private-only column headers may also have been misread into another input field.
    for (const cell of cells) {
      if (field === 'name' || field === '') {
        const name = parseCertificateText('성명 : ' + cell).personName;
        if (name) values.push(name);
      }
      values.push(...findDates(cell));
    }
  };
  for (const line of text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')) {
    const tokens: { start: number; end: number; field: string; personal: boolean }[] = [];
    for (const match of line.matchAll(pattern)) {
      const label = fields.get(match[0].replace(/\s/g, ''))!;
      const start = match.index, end = start + match[0].length;
      const before = line.slice(0, start), after = line.slice(end);
      if (before && !/[\s:：|│┃ㅣ]$/.test(before)) continue;
      const separator = !after || /^[\s:：|│┃ㅣ]/.test(after);
      const glued = label.personal && ((label.field === 'name' && /^[가-힣]{2,8}(?:\s{2,}|[|│┃]|$)/.test(after)) || (label.field === 'birth' && /^\d/.test(after)));
      if (!separator && !glued) continue;
      tokens.push({ start, end, field: label.field, personal: label.personal });
    }
    if (!tokens.length) {
      if (privateContinuation) { collect(line); output.push(MARK); }
      else output.push(line);
      continue;
    }
    // Mixed header-only rows do not identify which later cell belongs to which person.
    const emptyPersonal = tokens.some((t, i) => t.personal && !line.slice(t.end, tokens[i + 1]?.start).replace(/[\s:：|│┃ㅣ]/g, ''));
    if (emptyPersonal && tokens.some(t => !t.personal)) throw badRequest('개인정보와 교육 항목의 표 구조를 안전하게 구분하지 못했습니다. AI 추가 검토를 보류했습니다. 규칙 검수와 직접 확인은 계속 사용할 수 있습니다.');
    let protectedLine = '';
    const prefix = line.slice(0, tokens[0].start);
    if (privateContinuation) { collect(prefix); if (prefix.trim()) protectedLine += MARK + ' '; }
    else protectedLine += prefix;
    for (const [i, token] of tokens.entries()) {
      const value = line.slice(token.end, tokens[i + 1]?.start);
      if (token.personal) {
        collect(value, token.field);
        protectedLine += MARK + ' ';
        privateContinuation = true;
      } else {
        protectedLine += line.slice(token.start, token.end) + value;
        privateContinuation = false;
      }
    }
    output.push(protectedLine);
  }
  return { text: maskPrivateValues(output.join('\n'), values).slice(0, 18000), values: [...new Set(values)] };
}

export function privateText(text: string, values: PrivateValue[], aliases: Aliases = {}): string {
  return redactPersonalText(text, values, aliases).text;
}

/** Sanitize every outgoing string, then mask newly discovered values across the complete payload. */
export function sanitizeAiPayload<T>(payload: T, known: PrivateValue[], aliases: Aliases = {}): T {
  const values = known.filter((v): v is string => !!v);
  function walk(value: unknown, sanitize: (text: string) => string): unknown {
    if (typeof value === 'string') return sanitize(value);
    if (Array.isArray(value)) return value.map(v => walk(v, sanitize));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, sanitize)]));
    return value;
  }
  const redacted = walk(payload, text => { const r = redactPersonalText(text, values, aliases); values.push(...r.values); return r.text; });
  return walk(redacted, text => maskPrivateValues(text, values)) as T;
}
