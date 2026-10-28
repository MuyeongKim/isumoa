import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeProgramManifest(programDir: string, version: string): void {
  function list(dir: string, prefix = ''): { path: string; bytes: number; sha256: string }[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = prefix + entry.name;
      if (entry.isDirectory()) return list(join(dir, entry.name), path + '/');
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
InitPluginsDir
SetOutPath "$PLUGINSDIR\\program"
File /r "${path(programDir)}/*"
SetOutPath "$PLUGINSDIR\\setup"
File "${path(join(outDir, 'setup', 'install.ps1'))}"
DetailPrint "프로그램 설치 중… 기존 자료는 보존합니다."
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
