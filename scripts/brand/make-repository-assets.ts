// 기존 정식 로고에서 저장소 아이콘과 링크 미리보기만 만든다. 앱·Windows 아이콘은 바꾸지 않는다.
// 실행: node scripts/brand/make-repository-assets.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';

const root = fileURLToPath(new URL('../../', import.meta.url));
const brand = join(root, 'docs', 'brand');
for (const [file, family] of [['WantedSans-Regular.ttf', 'RepoRegular'], ['WantedSans-ExtraBold.ttf', 'RepoBold']]) {
  GlobalFonts.register(readFileSync(join(root, 'node_modules', 'wanted-sans', 'fonts', 'ttf', file)), family);
}
const icon = createCanvas(512, 512);
icon.getContext('2d').drawImage(await loadImage(readFileSync(join(brand, 'isumoa-mark-compact.svg'))), 0, 0, 512, 512);
writeFileSync(join(brand, 'isumoa-repository-icon.png'), icon.toBuffer('image/png'));

const preview = createCanvas(1280, 640), ctx = preview.getContext('2d');
ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 1280, 640);
const logo = await loadImage(readFileSync(join(brand, 'isumoa-lockup.png')));
ctx.drawImage(logo, 58, 54, 850, 850 * logo.height / logo.width);
ctx.fillStyle = '#161B26'; ctx.font = '48px RepoBold';
ctx.fillText('수료증 등록부터 기관보고까지', 76, 423);
ctx.fillStyle = '#4A5263'; ctx.font = '25px RepoRegular';
ctx.fillText('PDF·사진·ZIP을 읽고 검수한 뒤 엑셀·PDF로 내보냅니다.', 78, 478);
ctx.fillStyle = '#D23B2C'; ctx.fillRect(78, 530, 1124, 3);
ctx.fillStyle = '#161B26'; ctx.font = '22px RepoBold';
ctx.fillText('Windows 설치판', 78, 581);
ctx.fillStyle = '#4A5263'; ctx.font = '20px RepoRegular';
ctx.fillText('직원 명단 · 기본 교육 16개 · 이수 현황 · 제출 양식', 294, 581);
writeFileSync(join(brand, 'isumoa-social-preview.png'), preview.toBuffer('image/png'));
console.log('저장소 아이콘 512×512 · 소셜 미리보기 1280×640 생성');
