import { describe, it, expect } from 'vitest';
import { certificateTitle, certificateTitleError } from '../../shared/exportTitles.ts';
import { safeFileName } from '../../shared/exportFileNames.ts';
const values={연도:'2026',부서:'총무과',성명:'홍길동',사번:'001',교육명:'개인정보보호',과정명:'안전성 확보조치',이수일:'2026-04-02',증서번호:'CERT-001'};
describe('개별 파일명 규칙',()=>{
 it('치환·확장자·예약이름을 동일하게 처리한다',()=>{expect(certificateTitle('{성명}_{교육명}_{이수일}.PDF ',values)).toBe('홍길동_개인정보보호_2026-04-02');expect(safeFileName(certificateTitle('CON.pdf',values))).toBe('_CON');expect(safeFileName(certificateTitle('../{성명}:보고',values))).not.toContain('/');});
 it('빈 값·긴 규칙·알 수 없는 항목을 안내한다',()=>{for(const x of ['','.pdf','a'.repeat(151),'{없는항목}'])expect(certificateTitleError(x)).not.toBeNull();expect(certificateTitleError('{성명}_{교육명}_{이수일}')).toBeNull();});
});
