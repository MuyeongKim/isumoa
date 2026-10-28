// PowerShell의 실제 유지보수 함수를 가상 폴더·실제 HTTP에서 실행한다. Windows 설치 UI 검증과는 별도다.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { buildApp } from '../server/src/app.ts';
import { loadConfig } from '../server/src/config.ts';
import { openDatabase } from '../server/src/db/sqlite.ts';
import { runMigrations } from '../server/src/db/migrate.ts';

const { values } = parseArgs({ options: { powershell: { type: 'string' }, output: { type: 'string' }, program: { type: 'string' } } });
if (!values.powershell) throw new Error('--powershell에 검증용 pwsh 실행 파일을 지정하세요.');
const output = resolve(values.output ?? 'data/desktop-maintenance-check');
mkdirSync(output, { recursive: true });
const sandbox = mkdtempSync(join(output, 'isolated-'));
const program = resolve(values.program ?? 'deploy/windows-desktop');
const { raw, db } = openDatabase(':memory:'); runMigrations(raw);
const app = await buildApp({ db, config: { ...loadConfig({}), dataDir: sandbox, desktop: true, webDistDir: '/nonexistent' }, version: 'desktop-check', shutdownToken: 'a'.repeat(48) }, { logger: false });
const foreignRequests: { path: string; tokenHeader: boolean }[] = [];
const foreign = createServer((req, res) => {
  foreignRequests.push({ path: req.url ?? '', tokenHeader: Boolean(req.headers['x-shutdown-token']) });
  const mode = req.url?.split('/')[1];
  if (mode === 'redirect') { res.writeHead(302, { location: '/spoof/api/health' }); res.end(); return; }
  if (mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>다른 프로그램</h1>'); return; }
  res.setHeader('content-type', 'application/json');
  if (mode === 'generic') { res.end(JSON.stringify({ ok: true, version: '1' })); return; }
  if (mode === 'oversize') { res.end(JSON.stringify({ application: 'isumoa', proof: '0'.repeat(10000) })); return; }
  res.end(JSON.stringify({ ok: mode === 'stringok' ? 'true' : true, application: 'isumoa', protocol: 1, version: 'fake', ...(mode !== 'spoof' ? { proof: '0'.repeat(64) } : {}) }));
});
try {
  const healthyUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(r => foreign.listen(0, '127.0.0.1', r));
  const foreignPort = (foreign.address() as { port: number }).port;
  const temporary = createServer(); await new Promise<void>(r => temporary.listen(0, '127.0.0.1', r));
  const freePort = (temporary.address() as { port: number }).port;
  await new Promise<void>((r, reject) => temporary.close(err => err ? reject(err) : r()));
  const result = await promisify(execFile)(values.powershell, ['-NoProfile', '-NonInteractive', '-File', resolve('tests/windows-desktop/maintenance.test.ps1'), '-Root', sandbox,
    '-HealthyUrl', healthyUrl, '-ForeignUrl', `http://127.0.0.1:${foreignPort}`, '-FreePort', String(freePort), '-Program', program], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
  writeFileSync(join(output, 'powershell-output.txt'), result.stdout + result.stderr);
  if (foreignRequests.some(r => r.tokenHeader || r.path.includes('a'.repeat(48)))) throw new Error('확인되지 않은 서버로 실행 열쇠가 전송됐습니다.');
  const gateArgs = ['-NoProfile', '-NonInteractive', '-File', resolve('tests/windows-desktop/gate.test.ps1'), '-Root', sandbox, '-Program', program];
  // 서로 다른 실제 프로세스가 설치/실행/제거 잠금을 공유하는지 확인한다.
  const holder = promisify(execFile)(values.powershell, [...gateArgs, '-Mode', 'hold'], { timeout: 30000 });
  try {
    for (let n = 0; n < 100 && !existsSync(join(sandbox, 'gate-held')); n++) await new Promise(r => setTimeout(r, 50));
    if (!existsSync(join(sandbox, 'gate-held'))) throw new Error('유지보수 잠금 준비 실패');
    let blocked = false;
    try { await promisify(execFile)(values.powershell, [...gateArgs, '-Mode', 'acquire'], { timeout: 10000 }); }
    catch (error) { const e = error as { code?: number; stdout?: string }; blocked = e.code === 7 && Boolean(e.stdout?.includes('이미 진행 중')); }
    if (!blocked) throw new Error('설치와 실행이 동시에 잠금을 획득했습니다.');
  } finally {
    writeFileSync(join(sandbox, 'gate-release'), 'release');
    await holder;
  }
  const released = await promisify(execFile)(values.powershell, [...gateArgs, '-Mode', 'acquire'], { timeout: 10000 });
  if (!released.stdout.includes('gate-acquired')) throw new Error('작업 종료 후 잠금 해제 실패');
  const proof = JSON.parse(readFileSync(join(sandbox, 'powershell-results.json'), 'utf8'));
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ ...proof, gateCases: 3, concurrentProcessBlocked: true, gateReleased: true, productionApiOverHttp: true, secretSentToForeignServer: false, foreignRequests, sandbox, program }, null, 2));
  console.log(result.stdout);
  console.log(`결과: ${join(output, 'verification.json')}`);
} catch (error) {
  const e = error as Error & { stdout?: string; stderr?: string };
  writeFileSync(join(output, 'powershell-output.txt'), (e.stdout ?? '') + (e.stderr ?? '') + '\n' + e.message);
  throw error;
} finally {
  await app.close();
  await new Promise<void>(r => foreign.close(() => r()));
  await db.destroy();
}
