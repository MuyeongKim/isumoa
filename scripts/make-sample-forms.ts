// 시연·테스트용 가상 제출 양식(엑셀)을 만든다 (실제 기관 양식이 아님).
// 실행: npm run samples:forms  →  samples/forms/ 에 명단형 양식 3개가 생긴다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_FORMS } from './fixtures/forms.ts';

const OUT_DIR = fileURLToPath(new URL('../samples/forms/', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of SAMPLE_FORMS) {
  writeFileSync(join(OUT_DIR, name), await build());
  console.log(`  ${name}`);
}
console.log(`가상 제출 양식 ${SAMPLE_FORMS.length}개를 만들었습니다: ${OUT_DIR}`);
