import { createKordocOcr } from './kordoc.ts';
import { createTesseractOcr } from './tesseract.ts';

export interface OcrTextLine {
  text: string;
  confidence: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface OcrReadResult {
  text: string;
  lines: OcrTextLine[];
}

// 스캔본을 읽는 OCR. 두 가지 중 쓸 수 있는 것을 고른다.
//  - kordoc (PP-OCRv5 한국어, ONNX): 기본. 가상 이수증 비교에서 스캔 41쪽을 모두 맞게 읽었다(tesseract는 37쪽)
//  - tesseract.js (WebAssembly): kordoc의 엔진(네이티브 라이브러리)을 띄우지 못하는 PC에서 대신 쓴다
// 둘 다 이 프로그램 안에서만 돌고 인터넷에 접속하지 않는다.

export interface OcrEngine {
  /** DB에 남기는 이름 — 엔진이 바뀌면 다시 읽기 때 새로 읽는다 */
  readonly name: string;
  /** 화면에 보여 줄 이름 */
  readonly label: string;
  /** 기본 엔진을 못 띄워 대신 쓰는 중이면 그 이유 */
  readonly fallbackReason: string | null;
  recognize(imagePath: string): Promise<string>;
  /** 표 문서를 읽을 때 쓰는 글줄 위치. 지원하지 않는 엔진은 일반 텍스트로 읽는다. */
  recognizeWithLayout?(imagePath: string): Promise<OcrReadResult>;
  close(): Promise<void>;
}

/** kordoc을 먼저 띄워 보고(자체 점검 포함), 안 되면 tesseract를 돌려준다. 이유는 fallbackReason에 남는다 */
export async function createOcrEngine(options: { modelDir: string; prefer?: 'kordoc' | 'tesseract' }): Promise<OcrEngine> {
  if (options.prefer === 'tesseract') return createTesseractOcr(null);
  try {
    return await createKordocOcr(options.modelDir);
  } catch (err) {
    return createTesseractOcr(err instanceof Error ? err.message : String(err));
  }
}
