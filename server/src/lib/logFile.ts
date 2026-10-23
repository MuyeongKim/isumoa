import { createWriteStream, mkdirSync, readdirSync, rmSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

// 서버 로그를 화면과 파일에 함께 쓴다. 서비스(작업 스케줄러·systemd)로 실행하면 화면이 없어서 파일이 필요하다.
// 파일은 날짜별(logs/server-2026-10-23.log)로 나누고, 90일이 지난 파일은 지운다.

function seoulDate(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
}

export function createLogStream(dir: string, keepDays = 90): Writable {
  mkdirSync(dir, { recursive: true });
  let day = '';
  let file: WriteStream | null = null;

  const rotate = () => {
    const today = seoulDate();
    if (today === day && file) return file;
    file?.end();
    day = today;
    file = createWriteStream(join(dir, `server-${today}.log`), { flags: 'a' });
    const cutoff = seoulDate(new Date(Date.now() - keepDays * 86_400_000));
    for (const name of readdirSync(dir)) {
      const m = /^server-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (m && m[1] < cutoff) rmSync(join(dir, name), { force: true });
    }
    return file;
  };

  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      process.stdout.write(chunk);
      rotate().write(chunk, callback);
    },
  });
}
