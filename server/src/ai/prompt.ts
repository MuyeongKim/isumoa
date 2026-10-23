import type { Training } from '../../../shared/types.ts';

// AI에 보내는 지시문. 바꾸면 PROMPT_VERSION을 올린다 (쪽마다 어떤 지시문으로 읽었는지 남긴다).

export const PROMPT_VERSION = 'cert-extract-v1';

export const SYSTEM_PROMPT = `당신은 한국 공공기관의 법정교육 이수증(수료증·교육이수증)을 읽어 정해진 JSON으로 옮기는 도우미입니다.

지킬 것:
1. 이수증에 적힌 값을 적힌 그대로 옮깁니다. 날짜·시간의 형식을 바꾸거나 추측해서 채우지 않습니다. 없거나 읽을 수 없는 값은 null입니다.
2. personName은 이수증의 성명(이름) 칸에 적힌 교육 이수자의 이름입니다. 교육기관장 이름, 서명, 담당자 이름은 넣지 않습니다.
3. completionDate는 이수일·수료일·교육일 항목의 날짜입니다. 그런 항목이 없으면 맨 아래의 발급일을 넣습니다. periodStart·periodEnd는 교육기간의 시작·끝입니다.
4. hours는 교육시간을 적힌 그대로 넣습니다 (예: "4시간", "60분", "2차시").
5. trainingCodes는 아래 교육 목록에서 이 과정에 해당하는 code를 고릅니다. 여러 폭력예방 교육을 묶은 통합과정이면 여러 개를 고릅니다. 맞는 교육이 없으면 빈 배열입니다.
6. 한 쪽에 이수증이 여러 장이면 certificates에 한 장씩 넣습니다. 이수증이 아닌 쪽(제출 표지, 공문, 빈 쪽)이면 isCertificate는 false, certificates는 빈 배열입니다.
7. JSON만 답합니다. 설명 문장은 쓰지 않습니다.`;

export function trainingList(trainings: Training[]): string {
  return trainings
    .map((t) => `- ${t.code}: ${t.name}${t.keywords.length ? ` (과정명에 자주 나오는 말: ${t.keywords.join(', ')})` : ''}`)
    .join('\n');
}

export function userPrompt(input: { trainings: Training[]; text: string | null; textSource: 'pdf' | 'ocr' | null; hasImage: boolean }): string {
  const parts = [`교육 목록:\n${trainingList(input.trainings)}`];
  if (input.text && input.textSource === 'pdf') {
    parts.push(`이수증 PDF에서 뽑은 글자:\n"""\n${input.text.slice(0, 6000)}\n"""`);
  } else if (input.text && input.textSource === 'ocr') {
    parts.push(
      input.hasImage
        ? `참고: 스캔 이미지를 OCR로 읽은 글자입니다. 틀린 글자가 많을 수 있으니 이미지를 우선해서 읽으세요.\n"""\n${input.text.slice(0, 6000)}\n"""`
        : `스캔 이미지를 OCR로 읽은 글자입니다. 틀린 글자가 있을 수 있습니다.\n"""\n${input.text.slice(0, 6000)}\n"""`,
    );
  }
  parts.push(input.hasImage ? '첨부한 이수증 이미지를 읽어 JSON으로 답하세요.' : '위 글자를 읽어 JSON으로 답하세요.');
  return parts.join('\n\n');
}

/** JSON 모드를 지원하지 않는 서버에는 지시문 끝에 모양을 직접 적어 준다 */
export const JSON_SHAPE_HINT = `답의 모양:
{"isCertificate": true, "certificates": [{"personName": "홍길동", "birthDate": null, "department": null, "courseTitle": "...", "provider": null, "certificateNo": null, "completionDate": "2026. 3. 31.", "periodStart": null, "periodEnd": null, "hours": "4시간", "trainingCodes": ["..."]}]}`;
