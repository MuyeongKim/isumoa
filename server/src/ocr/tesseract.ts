import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import Tesseract from 'tesseract.js';

// 스캔본(글자 정보가 없는 쪽)을 읽는 OCR. tesseract.js는 WebAssembly라 OS와 상관없이 돌고,
// 한국어 학습 데이터도 node_modules에 들어 있어 인터넷 없이 동작한다.
// (기본값은 인터넷에서 학습 데이터를 받으므로 langPath를 반드시 지정한다)

export interface OcrEngine {
  recognize(imagePath: string): Promise<string>;
  close(): Promise<void>;
}

const require = createRequire(import.meta.url);
const KOR_DATA = join(dirname(require.resolve('@tesseract.js-data/kor/package.json')), '4.0.0_best_int');

/**
 * 같은 쪽을 두 방식으로 읽어 합친다.
 *  - 한 단 읽기(PSM 4): 표 모양 이수증에 강함
 *  - 한 덩어리 읽기(PSM 6): 글자 사이를 띄운 항목 이름("성    명")을 잘 남김
 * 규칙 판독기는 앞쪽 값을 먼저 쓰므로 한 단 읽기 결과를 앞에 둔다.
 */
export function createTesseractOcr(): OcrEngine {
  let worker: Promise<Tesseract.Worker> | null = null;
  const getWorker = () => (worker ??= Tesseract.createWorker('kor', Tesseract.OEM.LSTM_ONLY, { langPath: KOR_DATA, cacheMethod: 'none' }));
  // OCR 일꾼은 하나라서 여러 쪽을 함께 처리할 때는 차례로 읽는다 (읽기 방식 설정이 섞이지 않게)
  let queue: Promise<unknown> = Promise.resolve();

  async function read(imagePath: string): Promise<string> {
    const w = await getWorker();
    const texts: string[] = [];
    for (const mode of [Tesseract.PSM.SINGLE_COLUMN, Tesseract.PSM.SINGLE_BLOCK]) {
      await w.setParameters({ tessedit_pageseg_mode: mode, preserve_interword_spaces: '1' });
      const { data } = await w.recognize(imagePath);
      texts.push(data.text.trim());
    }
    return texts.join('\n\n');
  }

  return {
    recognize(imagePath) {
      const result = queue.then(() => read(imagePath));
      queue = result.catch(() => undefined);
      return result;
    },
    async close() {
      if (!worker) return;
      const w = await worker;
      worker = null;
      await w.terminate();
    },
  };
}
