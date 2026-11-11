import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Windows에서 링크 해석에 기대지 않는다. 실행에 쓰지 않는 npm 명령은 빼고 내부 링크는 내용으로 바꾼다. */
export function cleanWindowsPayload(programDir: string) {
  if (lstatSync(programDir).isSymbolicLink()) throw new Error('Windows 프로그램 폴더가 심볼릭 링크입니다.');
  const root = realpathSync(programDir);
  const changes = { removedBinDirectories: [] as string[], removedLinks: [] as { path: string; target: string }[], materializedLinks: [] as { path: string; target: string }[] };
  const names = (dir: string) => readdirSync(dir).sort();
  const label = (path: string) => relative(root, path).split(sep).join('/');
  function removedLinks(path: string) {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) changes.removedLinks.push({ path: label(path), target: readlinkSync(path) });
    else if (entry.isDirectory()) for (const name of names(path)) removedLinks(join(path, name));
  }
  function removeBins(dir: string, inModules = false) {
    for (const name of names(dir)) {
      const path = join(dir, name), entry = lstatSync(path);
      if (inModules && name === '.bin') {
        removedLinks(path);
        rmSync(path, { recursive: true, force: true });
        changes.removedBinDirectories.push(label(path));
      } else if (entry.isDirectory()) removeBins(path, inModules || name === 'node_modules');
    }
  }
  function linkTarget(path: string) {
    let target: string;
    try { target = realpathSync(path); }
    catch (cause) { throw new Error(`Windows 배포 링크의 대상을 읽을 수 없습니다: ${label(path)}`, { cause }); }
    const inside = relative(root, target);
    if (inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) throw new Error(`Windows 배포 폴더 밖을 가리키는 링크입니다: ${label(path)}`);
    return target;
  }
  // 복사 전에 링크 그래프를 검사한다. 외부 파일이나 순환 링크가 발견되면 내용을 가져오지 않는다.
  function validate(dir: string, parents: Set<string>) {
    const target = realpathSync(dir);
    if (parents.has(target)) throw new Error(`Windows 배포에 순환 디렉터리 링크가 있습니다: ${label(dir)}`);
    const next = new Set(parents).add(target);
    for (const name of names(dir)) {
      const path = join(dir, name), entry = lstatSync(path);
      if (entry.isSymbolicLink()) {
        const resolved = linkTarget(path), stat = lstatSync(resolved);
        if (stat.isDirectory()) validate(resolved, next);
        else if (!stat.isFile()) throw new Error(`Windows 배포 링크가 일반 파일·폴더를 가리키지 않습니다: ${label(path)}`);
      } else if (entry.isDirectory()) validate(path, next);
    }
  }
  function materialize(dir: string) {
    function copyContents(source: string, destination: string) {
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) copyContents(linkTarget(source), destination);
      else if (stat.isDirectory()) {
        mkdirSync(destination, { recursive: true });
        for (const name of names(source)) copyContents(join(source, name), join(destination, name));
      } else copyFileSync(source, destination);
    }
    for (const name of names(dir)) {
      const path = join(dir, name), entry = lstatSync(path);
      if (entry.isSymbolicLink()) {
        const target = linkTarget(path);
        rmSync(path);
        copyContents(target, path);
        changes.materializedLinks.push({ path: label(path), target: label(target) });
      } else if (entry.isDirectory()) materialize(path);
    }
  }
  removeBins(root);
  validate(root, new Set());
  materialize(root);
  // node_modules 자체가 내부 디렉터리 링크였던 경우에도 복사된 npm 명령을 남기지 않는다.
  removeBins(root);
  return changes;
}

export function writeProgramManifest(programDir: string, version: string): void {
  if (lstatSync(programDir).isSymbolicLink()) throw new Error('프로그램 manifest를 만들 수 없습니다: 프로그램 폴더가 심볼릭 링크입니다.');
  function list(dir: string, prefix = ''): { path: string; bytes: number; sha256: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = prefix + entry.name;
      const stat = lstatSync(join(dir, entry.name));
      if (stat.isSymbolicLink()) throw new Error(`프로그램 manifest에 심볼릭 링크를 포함할 수 없습니다: ${path}`);
      if (stat.isDirectory()) return list(join(dir, entry.name), path + '/');
      if (path === 'program-manifest.json') return [];
      const bytes = readFileSync(join(dir, entry.name));
      return [{ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
    });
  }
  writeFileSync(join(programDir, 'program-manifest.json'), JSON.stringify({ version, files: list(programDir) }, null, 2) + '\n');
}

/** NSIS는 Windows에서만 실행되는 PE를 macOS/Linux에서도 컴파일한다. 실제 Windows 기동 검증은 별도다. */
export function buildWindowsExe(root: string, outDir: string, programDir: string, version: string): string {
  const buildDir = join(root, 'release', '.nsis', version);
  mkdirSync(buildDir, { recursive: true });
  // NSIS 문자열에서 경로의 $, 따옴표와 줄바꿈을 코드로 해석하지 않도록 한다.
  const path = (value: string) => value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"').replace(/[\r\n]/g, '');
  const launcher = join(programDir, '이수모아.exe');
  const installer = join(root, 'release', `이수모아-설치-${version}-win-x64.exe`);
  const common = `Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
Name "이수모아"
Icon "${path(join(programDir, 'app.ico'))}"
VIProductVersion "${version}.0"
VIAddVersionKey "ProductName" "이수모아"
VIAddVersionKey "FileVersion" "${version}"
VIAddVersionKey "LegalCopyright" "이수모아"
`;
  const powershell = `StrCpy $0 "$WINDIR\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
IfFileExists "$WINDIR\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe" 0 +2
  StrCpy $0 "$WINDIR\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"
`;
  const launchSource = `${common}
OutFile "${path(launcher)}"
SilentInstall silent
AutoCloseWindow true
VIAddVersionKey "FileDescription" "이수모아 실행"
Section
${powershell}
IfFileExists "$EXEDIR\\launch.ps1" +3 0
  MessageBox MB_OK|MB_ICONSTOP "프로그램 파일이 없습니다. 이수모아 설치 파일로 다시 설치해 주세요."
  Abort
ClearErrors
Exec '\"$0\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"$EXEDIR\\launch.ps1\"'
IfErrors 0 +2
  MessageBox MB_OK|MB_ICONSTOP "프로그램을 시작하지 못했습니다. 기관 보안 정책과 설치 안내를 확인해 주세요."
SectionEnd
`;
  const setupSource = `${common}
!include "MUI2.nsh"
OutFile "${path(installer)}"
VIAddVersionKey "FileDescription" "이수모아 설치 ${version}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "이수모아 ${version} 설치"
!define MUI_WELCOMEPAGE_TEXT "Windows 10·11 64비트 PC에 설치합니다.$\\r$\\n$\\r$\\n관리자 권한 없이 현재 사용자의 프로그램 폴더에 설치하고 바탕화면에 실행 아이콘을 만듭니다.$\\r$\\n$\\r$\\n기존 이수증·직원·설정·백업은 보존합니다. 설치 중에는 이수모아 사용을 잠시 멈춰 주세요.$\\r$\\n$\\r$\\n임시 압축 해제 공간을 포함해 2GB 이상 여유 공간이 필요합니다."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "이수모아 실행"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!define MUI_FINISHPAGE_TEXT "설치를 마쳤습니다. 바탕화면과 시작 메뉴의 이수모아 아이콘으로 실행할 수 있습니다.$\\r$\\n$\\r$\\n처음 실행하면 기관명과 관리자 계정을 설정합니다."
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"

Section "이수모아 설치"
!insertmacro MUI_HEADER_TEXT "1/2 설치 파일 풀기" "임시 폴더에 설치 파일을 풉니다."
InitPluginsDir
SetOutPath "$PLUGINSDIR\\program"
File /r "${path(programDir)}/*"
SetOutPath "$PLUGINSDIR\\setup"
File "${path(join(outDir, 'setup', 'install.ps1'))}"
!insertmacro MUI_HEADER_TEXT "2/2 프로그램 설치 및 확인" "파일을 복사하고 검증한 뒤 바로가기를 등록합니다."
DetailPrint "설치 파일의 복사와 무결성 확인에 시간이 걸릴 수 있습니다."
${powershell}
ClearErrors
ExecWait '\"$0\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"$PLUGINSDIR\\setup\\install.ps1\" -FromExe' $1
IfErrors install_failed
StrCmp $1 0 install_ok
install_failed:
  MessageBox MB_OK|MB_ICONSTOP "설치를 완료하지 못했습니다. 표시된 오류와 PC 설치 안내를 확인해 주세요."
  SetErrorLevel 1
  Abort
install_ok:
SectionEnd

Function LaunchApp
Exec '\"$LOCALAPPDATA\\Programs\\isumoa\\이수모아.exe\"'
FunctionEnd
`;
  for (const [name, source] of [['launcher.nsi', launchSource], ['installer.nsi', setupSource]]) {
    const file = join(buildDir, name);
    writeFileSync(file, source, 'utf8');
    execFileSync('makensis', ['-V2', file], { cwd: root, stdio: 'inherit' });
    if (name === 'launcher.nsi') writeProgramManifest(programDir, version);
  }
  return installer;
}
