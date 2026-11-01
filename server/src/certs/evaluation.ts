import type { CertificateFlag, Training } from '../../../shared/types.ts';
import type { RuleBundle } from '../../../shared/reviewTools.ts';
import type { MatchableEmployee } from './employeeMatcher.ts';
import { computeFlags, withNotes } from './flags.ts';
import { buildDraft } from './processPage.ts';
import type { Recognition } from './recognize.ts';
import { configuredRuleFlags, integratedViolenceFlags, unieduCertificateFlags } from './trainingClassifier.ts';

// 평가에서도 설치된 규칙을 사용한다. 확정 결과를 학습한 매핑은 정답 유출을 막기 위해 사용하지 않는다.
export function evaluateRecognition(recognition:Recognition,ctx:{year:number;trainings:Training[];employees:MatchableEmployee[];rules:RuleBundle}): { draft: ReturnType<typeof buildDraft>; flags: CertificateFlag[] } {
  const {year,trainings,employees,rules}=ctx;
  const draft = buildDraft(recognition, { trainings, employees, rules, learned: new Map(), scope: null, year });
  const e = employees.find((x) => x.id === draft.match.employeeId);
  const flags = computeFlags({
    status: 'draft',
    personName: draft.read.personName,
    personBirth: draft.read.personBirth,
    personDept: draft.read.personDept,
    employee: e ? { name: e.name, departmentId: e.departmentId, departmentName: e.departmentName, birthDate: e.birthDate, status: e.status } : null,
    ambiguousCount: e ? 0 : draft.match.candidates.length,
    trainings: trainings.filter((t) => draft.trainingIds.includes(t.id)).map((t) => ({ name: t.name, reqType: t.reqType })),
    inactiveMatches: [],
    completedOn: draft.read.completedOn,
    hours: draft.read.hours,
    hoursText: draft.read.hoursText,
    batchYear: year,
    year: draft.read.completedOn ? Number(draft.read.completedOn.slice(0, 4)) : year,
    looksLikeCertificate: draft.read.looksLikeCertificate,
    route: recognition.route,
    duplicateIds: [],
    scope: null,
    today: new Date().toISOString().slice(0, 10),
  });
  const context={rules,provider:draft.read.provider,year:draft.read.completedOn?Number(draft.read.completedOn.slice(0,4)):year,hours:draft.read.hours,fullText:recognition.text};
  flags.push(...integratedViolenceFlags(draft.read.courseTitle,trainings.filter(t=>draft.trainingIds.includes(t.id)),context),...configuredRuleFlags(draft.read.courseTitle,context),...unieduCertificateFlags(draft.read.courseTitle, {rules,
    provider: draft.read.provider, year: draft.read.completedOn ? Number(draft.read.completedOn.slice(0, 4)) : year,
    hours: draft.read.hours, fullText: recognition.text,
  }));
  return { draft, flags: withNotes(flags, draft.notes) };
}
