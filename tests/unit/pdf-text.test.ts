import { describe, expect, it } from 'vitest';
import { joinPdfTextItems, type PdfTextItem } from '../../shared/pdfText.ts';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';

const item = (str: string, x: number, y: number, width: number, hasEOL = false): PdfTextItem => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL });

describe('PDF 화면 배치 순서', () => {
  it('값이 먼저 그려진 PDF도 머리글을 왼쪽에 놓고 줄바꿈 과정명을 잇는다', () => {
    const text = joinPdfTextItems([
      item('제 9 기 [Mobile 겸용] 사례로 알아보는 사업', 160, 500, 300, true),
      item('과 정 :', 75, 500, 50), item('성별영향평가', 160, 480, 100),
      item('기 간 : 2026.04.01. ~ 2026.04.06.', 75, 460, 300),
      item('상시학습인정시간 : 1시간', 75, 440, 200),
    ]);
    expect(text.split('\n')[0]).toBe('과 정 :  제 9 기 [Mobile 겸용] 사례로 알아보는 사업');
    expect(parseCertificateText(text)).toMatchObject({ courseTitle: '제 9 기 [Mobile 겸용] 사례로 알아보는 사업 성별영향평가', completedOn: '2026-04-06', hours: 1 });
  });

  it('그리기 순서의 줄 끝 표시보다 실제 위치로 같은 줄을 묶는다', () => {
    const text = joinPdfTextItems([item('홍길동', 160, 600, 40, true), item('성 명 :', 75, 600, 50), item('수 료 증', 200, 700, 100)]);
    expect(text).toBe('수 료 증\n성 명 :  홍길동');
    expect(parseCertificateText(text).personName).toBe('홍길동');
  });
});
