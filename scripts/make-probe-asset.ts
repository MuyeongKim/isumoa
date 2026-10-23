import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawCertificate, PROVIDERS, type CertData } from './fixtures/certificate.ts';
import { renderScanJpeg } from './fixtures/render.ts';

// "AI 연결 테스트"에 쓰는 가상 이수증(실존 인물·기관 아님)을 만들어 server/assets에 둔다.
// 설치본에 함께 들어가서 내부망에서도 그대로 테스트할 수 있다. 바꿀 일이 있을 때만 다시 실행한다.
//   node scripts/make-probe-asset.ts

const ROOT = new URL('../', import.meta.url).pathname;
const outDir = join(decodeURIComponent(ROOT), 'server', 'assets');
mkdirSync(outDir, { recursive: true });

const data: CertData = {
  template: 'formal',
  name: '윤하늘',
  birth: '1990-07-15',
  department: '정보통신과',
  courseTitle: '2026년 4대폭력 예방 통합교육',
  periodStart: '2026-03-02',
  completedOn: '2026-03-31',
  hoursText: '4시간',
  certNo: '2026-0417',
};

const jpeg = await renderScanJpeg(drawCertificate(data), { dpi: 150, angle: 0.6, noise: 0.3, seed: 7 });
writeFileSync(join(outDir, 'probe-certificate.jpg'), jpeg);

// 텍스트 PDF였다면 뽑혔을 글자 (글자만 읽는 AI 테스트용)
const text = [
  `제 ${data.certNo} 호`,
  '수   료   증',
  `성          명  :  ${data.name}`,
  '생 년 월 일  :  1990. 7. 15.',
  `소          속  :  가람시 ${data.department}`,
  `과    정    명  :  ${data.courseTitle}`,
  '교 육 기 간  :  2026. 3. 2. ~ 2026. 3. 31.',
  `교 육 시 간  :  ${data.hoursText}`,
  '위 사람은 본원에서 실시한 위 교육과정을',
  '성실히 이수하였기에 이 증서를 수여합니다.',
  '2026년 3월 31일',
  `${PROVIDERS.formal}장`,
].join('\n');

writeFileSync(
  join(outDir, 'probe-certificate.json'),
  `${JSON.stringify({ text, expected: { personName: data.name, completedOn: data.completedOn, hours: 4, courseTitle: data.courseTitle } }, null, 2)}\n`,
);
console.log(`만들었습니다: ${outDir}/probe-certificate.jpg (${Math.round(jpeg.length / 1024)}KB), probe-certificate.json`);
