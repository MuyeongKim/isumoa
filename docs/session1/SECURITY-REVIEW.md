# 0.5.6 AI·개인정보·배포 점검

이번 변경에서 수료증의 외부 AI 전송이나 새 외부 통신 경로를 추가하지 않았습니다. 로컬 OCR·교육 연결 규칙과 검수 화면을 보완했고, 최신 의존성 공지와 최종 설치본 포함 자료를 점검합니다. 악성코드 부재 인증이나 전체 침투시험 결과는 아닙니다.

## 확인 후 보완한 항목

| ID | 등급·범위 | 재현 근거와 조치 |
|---|---|---|
| SEC-01 | 중간, 의존성 가용성 | npm audit에서 glob·minimatch의 새 공지 2종으로 9개 연관 패키지 표시. glob 14.0.3·minimatch 11.0.3으로 고정하고 ExcelJS의 이전 임시파일·압축해제 의존성도 갱신. 전체 회귀와 XLSX 저장·읽기로 호환성 확인 |
| SEC-02 | 낮음, 배포 고지 | React 등 UI 구성요소는 개발 의존성이라 서버용 node_modules만으로 라이선스 고지가 충분하지 않음. UI·글꼴 라이선스 원문을 vendor/licenses에 추가해 설치본에 포함 |
| REL-01 | 정확성, 줄바꿈 날짜 | 날짜 항목 다음 줄을 경계로 버려 생년월일이 이수일에 들어간 합성 사례. 날짜 필드에 먼저 연결하고 생년월일을 발급일 후보에서 제외. 기간의 두 줄 날짜도 연결하며 여러 무표제 날짜는 경고. 회귀 추가 |
| REL-02 | 정확성, PDF 손상 | PDF 글자층의 손상 문자가 과정명에 남은 사례. 조합 설명·부수 문자와 대체 문자가 있는 글자층은 이미지 OCR로 전환. 회귀 추가 |

공지 원문: [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249). 이번 공지는 가용성 문제이며 개인정보 유출 발견으로 해석하지 않습니다.

코드 위치: `server/src/certs/parseText.ts`의 `parseCertificateText`·`hasUsableText`, `server/src/certs/recognize.ts`의 `recognizePage`, `package.json`의 `overrides`, `vendor/licenses`. 정확한 버전과 라인·해시는 제출본 소스 고정 시 함께 기록합니다.

## 남아 있는 운영 확인

- EXE는 미서명입니다. 기관의 허용·백신 정책과 Windows 실제 실행은 사용자가 시험 PC에서 확인해야 합니다.
- 기존 EXE 설치·기동·업데이트 보조 프로세스는 PowerShell의 프로세스 실행 정책에 `Bypass`를 지정합니다(`scripts/windows-exe.ts:52`, `scripts/windows-exe.ts:82`, `server/src/updates/service.ts:45`). PC의 영구 실행 정책이나 백신 설정을 바꾸지는 않습니다. 기관 그룹 정책이 우선하므로 서명 강제 기관에서는 실행이 막힐 수 있습니다. 기관 정보화 담당자에게 이 동작을 알리고 허용 여부를 확인해야 합니다. [Microsoft 실행 정책 설명](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_execution_policies?view=powershell-5.1)
- 새로 제공하는 Windows 분리 검증 스크립트는 실행 정책을 지정하지 않습니다. 차단되면 정보화 담당자 확인 후 수행합니다.
- 원본·DB·백업은 앱 자체 암호화가 없습니다. Windows 계정·디스크·보관 폴더의 접근 통제가 필요합니다.
- 현재 점검은 소스·의존성·패키지와 모의 자료 회귀 범위입니다. 알려지지 않은 공급망 변경, 실제 기관 네트워크 정책, Windows 프로세스 통신·Defender 검사까지 검증한 것으로 표시하지 않습니다.
