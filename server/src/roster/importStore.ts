import { randomUUID } from 'node:crypto';
import type { RosterSheet } from './readRosterFile.ts';

// 명단 일괄 등록은 "파일 올리기 → 열 확인 → 미리보기 → 반영" 여러 단계라서
// 읽어 둔 파일 내용을 잠시 메모리에 보관한다. 30분이 지나면 지운다.

const TTL_MS = 30 * 60_000;

interface StoredImport {
  userId: number;
  fileName: string;
  sheets: RosterSheet[];
  createdAt: number;
}

const imports = new Map<string, StoredImport>();

function sweep() {
  const now = Date.now();
  for (const [id, item] of imports) if (now - item.createdAt > TTL_MS) imports.delete(id);
}

export function saveImport(userId: number, fileName: string, sheets: RosterSheet[]): string {
  sweep();
  const id = randomUUID();
  imports.set(id, { userId, fileName, sheets, createdAt: Date.now() });
  return id;
}

export function getImport(id: string, userId: number): StoredImport | null {
  sweep();
  const item = imports.get(id);
  return item && item.userId === userId ? item : null;
}

export function deleteImport(id: string) {
  imports.delete(id);
}
