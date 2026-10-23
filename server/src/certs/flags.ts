import type { CertificateFlag, CertificateStatus, EmployeeStatus, ReqType } from '../../../shared/types.ts';
import { nameKey } from '../lib/text.ts';

// 검수 화면에 띄울 "확인할 점". 저장할 때마다 지금 값으로 다시 계산한다.
// error는 고치기 전에는 확정할 수 없고, warning은 확인을 권하는 표시다.

export interface FlagContext {
  status: CertificateStatus;
  personName: string | null;
  personBirth: string | null;
  personDept: string | null;
  employee: {
    name: string;
    departmentId: number | null;
    departmentName: string | null;
    birthDate: string | null;
    status: EmployeeStatus;
  } | null;
  /** 이름이 같은 직원이 여럿이라 자동으로 고르지 못한 경우 그 수 */
  ambiguousCount: number;
  trainings: { name: string; reqType: ReqType }[];
  inactiveMatches: string[];
  completedOn: string | null;
  hours: number | null;
  hoursText: string | null;
  batchYear: number;
  year: number | null;
  looksLikeCertificate: boolean;
  route: string | null;
  /** 같은 직원·교육·이수일로 이미 있는 다른 이수증 */
  duplicateIds: number[];
  /** 확정하려는 사람이 다룰 수 있는 부서 (관리자는 null) */
  scope: number[] | null;
  today: string;
}

const error = (code: string, message: string): CertificateFlag => ({ code, level: 'error', message });
const warning = (code: string, message: string): CertificateFlag => ({ code, level: 'warning', message });
const info = (code: string, message: string): CertificateFlag => ({ code, level: 'info', message });

function compact(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '');
}

export function computeFlags(ctx: FlagContext): CertificateFlag[] {
  const flags: CertificateFlag[] = [];
  const e = ctx.employee;

  if (!ctx.looksLikeCertificate && !e) {
    flags.push(warning('not-certificate', '이수증이 아닌 쪽 같습니다(표지·빈 쪽 등). 맞으면 제외해 주세요.'));
  }

  if (!e) {
    if (ctx.ambiguousCount > 1) {
      flags.push(error('no-employee', `이름이 '${ctx.personName}'인 직원이 ${ctx.ambiguousCount}명입니다. 맞는 직원을 골라 주세요.`));
    } else if (ctx.personName) {
      flags.push(error('no-employee', `이수증의 이름 '${ctx.personName}'과(와) 맞는 직원을 찾지 못했습니다. 직원을 골라 주세요.`));
    } else {
      flags.push(error('no-employee', '이수증에서 이름을 읽지 못했습니다. 직원을 골라 주세요.'));
    }
  } else {
    if (!ctx.personName) {
      flags.push(warning('no-name-read', '이수증에서 이름 항목을 읽지 못했습니다. 고른 직원이 맞는지 원본과 대조해 주세요.'));
    }
    if (ctx.personName && nameKey(ctx.personName) !== nameKey(e.name)) {
      flags.push(warning('name-differs', `이수증의 이름은 '${ctx.personName}'입니다. 고른 직원 '${e.name}'이(가) 맞는지 확인해 주세요.`));
    }
    if (ctx.personBirth && e.birthDate && ctx.personBirth !== e.birthDate) {
      flags.push(warning('birth-differs', `이수증의 생년월일(${ctx.personBirth})이 직원 정보(${e.birthDate})와 다릅니다.`));
    }
    if (ctx.personDept && e.departmentName && !compact(ctx.personDept).includes(compact(e.departmentName))) {
      flags.push(warning('dept-differs', `이수증의 소속은 '${ctx.personDept}'이고, 직원 부서는 '${e.departmentName}'입니다.`));
    }
    if (e.status === 'retired') flags.push(warning('retired', '퇴직 처리된 직원입니다.'));
    if (ctx.scope && (e.departmentId === null || !ctx.scope.includes(e.departmentId))) {
      flags.push(error('out-of-scope', `담당 부서 직원이 아닙니다(${e.departmentName ?? '부서 없음'}). 관리자에게 확정을 요청해 주세요.`));
    }
  }

  if (ctx.trainings.length === 0) {
    flags.push(error('no-training', '어떤 교육인지 정하지 못했습니다. 교육을 골라 주세요.'));
  }
  if (ctx.inactiveMatches.length > 0) {
    flags.push(warning('inactive-training', `'${ctx.inactiveMatches.join(', ')}'과(와) 맞아 보이지만 사용하지 않는 교육입니다. 교육 과정 화면에서 사용으로 바꾸거나 제외해 주세요.`));
  }

  if (!ctx.completedOn) {
    flags.push(error('no-date', '이수일을 읽지 못했습니다. 이수일을 넣어 주세요.'));
  } else {
    const year = Number(ctx.completedOn.slice(0, 4));
    if (year !== ctx.batchYear) {
      flags.push(warning('year-differs', `이수일이 ${year}년입니다. 올릴 때 고른 대상 연도는 ${ctx.batchYear}년입니다.`));
    }
    if (ctx.completedOn > ctx.today) flags.push(warning('future-date', '이수일이 오늘보다 뒤입니다.'));
  }

  const needsHours = ctx.trainings.some((t) => t.reqType === 'hours');
  if (ctx.hours === null && ctx.hoursText && /차시/.test(ctx.hoursText)) {
    flags.push(warning('hours-sessions', `교육시간이 '${ctx.hoursText}'로 적혀 있습니다. 시간으로 바꿔 넣어 주세요.`));
  } else if (ctx.hours === null && needsHours) {
    flags.push(warning('no-hours', '교육시간을 읽지 못했습니다. 시간 기준 교육이라 시간을 넣어 주세요.'));
  }

  if (ctx.duplicateIds.length > 0) {
    flags.push(warning('duplicate', `같은 직원·교육·이수일의 이수증이 이미 있습니다(${ctx.duplicateIds.map((id) => `#${id}`).join(', ')}). 중복이면 제외해 주세요.`));
  }
  if (ctx.route === 'ocr') {
    flags.push(info('ocr', '스캔본을 OCR로 읽었습니다. 이름과 날짜를 원본과 대조해 주세요.'));
  } else if (ctx.route === 'ai-ocr') {
    flags.push(info('ocr', '스캔본을 OCR로 읽고 AI가 정리했습니다. 이름과 날짜를 원본과 대조해 주세요.'));
  } else if (ctx.route === 'ai-vision') {
    flags.push(info('ai-vision', 'AI가 스캔 이미지를 직접 읽었습니다. 이름과 날짜를 원본과 대조해 주세요.'));
  }
  return flags;
}

export function hasBlockingFlag(flags: CertificateFlag[]): boolean {
  return flags.some((f) => f.level === 'error');
}

/** 계산한 확인할 점에 인식할 때 남긴 확인할 점을 더한다 (같은 종류는 한 번만) */
export function withNotes(flags: CertificateFlag[], notes: CertificateFlag[]): CertificateFlag[] {
  const merged = [...flags];
  for (const note of notes) if (!merged.some((f) => f.code === note.code)) merged.push(note);
  const order = { error: 0, warning: 1, info: 2 };
  return merged.sort((a, b) => order[a.level] - order[b.level]);
}
