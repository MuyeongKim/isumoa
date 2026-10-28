import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OcrEngine, OcrReadResult, OcrTextLine } from './engine.ts';

// 기본 OCR: kordoc(https://github.com/chrisryugj/kordoc, MIT)의 PP-OCRv5 한국어 모델(Apache-2.0)을 ONNX로 돌린다.
// 모델 파일은 vendor/ocr-models/에 들어 있고(설치본에 함께), 인터넷에 접속하지 않는다(KORDOC_OFFLINE).
//
// kordoc은 줄마다 글자와 위치를 준다. 이수증은 "성 명      : 홍길동"처럼 항목 이름과 값이 떨어져 있어
// 따로 읽히는 일이 많으므로, 높이가 같은 줄끼리 묶어 왼쪽부터 이어 붙인 글로 바꿔 규칙 판독기에 넘긴다.

interface KordocResult {
  success: boolean;
  error?: string;
  markdown?: string;
  warnings?: { code?: string; message?: string }[];
  ocrLines?: { lines: OcrTextLine[] }[];
}

type Parse = (input: Buffer, options: Record<string, unknown>) => Promise<KordocResult>;

/** 높이가 겹치는 줄끼리 한 행으로 묶어 왼쪽부터 이어 붙인다 */
export function rowsText(lines: OcrTextLine[]): string {
  const rows: OcrTextLine[][] = [];
  for (const line of [...lines].sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2))) {
    const center = line.box.y + line.box.h / 2;
    const row = rows.find((r) => Math.abs(r[0].box.y + r[0].box.h / 2 - center) < Math.min(r[0].box.h, line.box.h) * 0.6);
    if (row) row.push(line);
    else rows.push([line]);
  }
  // 칸 사이는 넓게 띄워 둔다 — 규칙 판독기가 "항목 이름 + 넓은 빈칸 + 값"을 찾는다
  return rows.map((r) => r.sort((a, b) => a.box.x - b.box.x).map((l) => l.text.trim()).join('    ')).join('\n');
}

/** 줄 정보가 없을 때(드묾) 쓰는 Markdown → 글: 표 칸은 넓은 빈칸으로, 이스케이프는 풀기 */
export function markdownToText(md: string): string {
  return md
    .split('\n')
    .filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l))
    .map((l) => (l.trim().startsWith('|') ? l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('    ') : l))
    .join('\n')
    .replace(/\\([~*_\-#[\]()|\\`>.!+])/g, '$1');
}

export async function createKordocOcr(modelDir: string): Promise<OcrEngine> {
  // kordoc을 불러오기 전에 정해야 한다: 인터넷 접속 금지, 모델은 설치본 폴더에서
  process.env.KORDOC_OFFLINE = '1';
  process.env.KORDOC_MODEL_CACHE = modelDir;
  const { parse } = (await import('kordoc')) as unknown as { parse: Parse };

  const read = async (image: Buffer): Promise<OcrReadResult> => {
    const result = await parse(image, { ocr: 'force', ocrLines: true, images: false, tableFormat: 'gfm' });
    if (!result.success) throw new Error(result.error ?? 'kordoc OCR 실패');
    const lines = result.ocrLines?.flatMap((p) => p.lines) ?? [];
    return { text: lines.length > 0 ? rowsText(lines) : markdownToText(result.markdown ?? ''), lines };
  };

  // 시작할 때 한 번: 모델·엔진이 실제로 한국어를 읽는지 확인한다 (못 읽으면 engine.ts가 tesseract로 바꾼다)
  const selftest = (await read(await readFile(join(modelDir, 'selftest.jpg')))).text;
  if (!selftest.replace(/\s/g, '').includes('윤하늘')) {
    throw new Error(`자체 점검 이미지를 읽지 못했습니다 (읽은 글: ${selftest.slice(0, 40) || '없음'})`);
  }

  // ONNX 세션을 여러 쪽이 동시에 쓰지 않도록 차례로 읽는다
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (imagePath: string) => {
    const result = queue.then(async () => read(await readFile(imagePath)));
    queue = result.catch(() => undefined);
    return result;
  };
  return {
    name: 'kordoc-ppocrv5',
    label: 'kordoc (PP-OCRv5 한국어)',
    fallbackReason: null,
    async recognize(imagePath) { return (await enqueue(imagePath)).text; },
    recognizeWithLayout: enqueue,
    async close() {
      await queue;
    },
  };
}
