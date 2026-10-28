// 직원 자료 없이, 알려진 의존성 취약점과 보안 경계 회귀를 다시 확인한다.
import { execFileSync } from 'node:child_process';
const run = (args: string[]) => execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
run(['audit', '--omit=dev']);
run(['test', '--', 'tests/api/request-boundary.test.ts', 'tests/api/privacy-formats.test.ts', 'tests/api/security.test.ts', 'tests/api/auth-and-scope.test.ts', 'tests/api/program-updates.test.ts', 'tests/unit/security.test.ts']);
