# 이수모아 PC판 제거. 시작 메뉴의 '이수모아 제거' 또는 Windows 설정 > 앱에서 실행한다.
# 자료(DB·쪽 이미지)는 묻고 지운다(기본은 남김). 백업 폴더는 지우지 않는다.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

# 지울 프로그램 폴더 안에 머물러 있으면 폴더가 지워지지 않는다
Set-Location -LiteralPath $env:TEMP
[Environment]::CurrentDirectory = $env:TEMP

try {
  if ((Show-Message "$AppName 프로그램을 이 PC에서 제거할까요?" 'Question' 'YesNo' 'Button2') -ne 'Yes') { exit 0 }
  Stop-Server

  $removeData = (Show-Message ("이수증 자료(DB·쪽 이미지)와 설정·기록도 지울까요?`n`n" +
      "[아니요]를 누르면 남겨 두어, 다시 설치하면 그대로 이어 씁니다.`n" +
      "백업 폴더(문서\이수모아 백업)는 어느 쪽이든 지우지 않습니다.`n`n자료 위치: $DataHome") 'Warning' 'YesNo' 'Button2') -eq 'Yes'

  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) "$OldAppName.lnk") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) $AppName) -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) $OldAppName) -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $UninstallKey -Recurse -Force -ErrorAction SilentlyContinue

  Remove-Tree $AppHome
  if ($removeData) { Remove-Tree $DataHome }

  $kept = if ($removeData) { '' } else { "`n자료는 남겨 두었습니다: $DataHome" }
  Show-Message "제거했습니다.$kept" | Out-Null
} catch {
  Show-Message "제거하지 못했습니다.`n`n$($_.Exception.Message)" 'Error' | Out-Null
  exit 1
}
