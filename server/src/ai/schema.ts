import { z } from 'zod';

// AI가 돌려줄 답의 모양. 값은 "적힌 그대로" 받고, 날짜·시간 정리는 코드가 한다.
// 같은 모양을 JSON 스키마(서버에 보냄)와 zod(받은 답 검사) 두 가지로 둔다 — 고칠 때 함께 고친다.

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const CERTIFICATE_FIELDS = {
  personName: nullableString,
  birthDate: nullableString,
  department: nullableString,
  courseTitle: nullableString,
  provider: nullableString,
  certificateNo: nullableString,
  completionDate: nullableString,
  periodStart: nullableString,
  periodEnd: nullableString,
  hours: nullableString,
  trainingCodes: { type: 'array', items: { type: 'string' } },
};

export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isCertificate', 'certificates'],
  properties: {
    isCertificate: { type: 'boolean' },
    certificates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: Object.keys(CERTIFICATE_FIELDS),
        properties: CERTIFICATE_FIELDS,
      },
    },
  },
} as const;

/** 빠지거나 형식이 다른 칸은 null로 받아 준다 (작은 모델이 가끔 칸을 빼먹는다) */
const text = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === 'string' ? v.normalize('NFC').trim() || null : typeof v === 'number' ? String(v) : null));

export const ExtractedCertificate = z.object({
  personName: text,
  birthDate: text,
  department: text,
  courseTitle: text,
  provider: text,
  certificateNo: text,
  completionDate: text,
  periodStart: text,
  periodEnd: text,
  hours: text,
  trainingCodes: z
    .unknown()
    .optional()
    .transform((v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])),
});
export type ExtractedCertificate = z.infer<typeof ExtractedCertificate>;

export const Extraction = z.object({
  isCertificate: z.boolean(),
  certificates: z.array(ExtractedCertificate),
});
export type Extraction = z.infer<typeof Extraction>;
