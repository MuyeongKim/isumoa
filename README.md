# 법정교육 이수증 종합 플랫폼

서무가 걷은 법정교육 이수증을 한꺼번에 올리면 프로그램이 직원·교육 종류·이수일·교육시간을 읽어 분류하고, 서무가 검수해 확정하면 기관 전체 이수 현황과 증빙 자료가 만들어지는 프로그램입니다. 내부망 서버에 두고 여럿이 쓰거나(서버판), Windows PC에 설치해 혼자 쓸 수 있습니다(PC판).

이수증은 **PC·서버 안에서만** 읽습니다. PDF의 글자는 그대로 읽고, 스캔본은 프로그램에 들어 있는 OCR(kordoc, PP-OCRv5 한국어 모델)로 읽은 뒤 항목 이름과 위치 규칙으로 판독합니다. AI 서버나 인터넷에 이수증을 보내지 않습니다.

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 기반: 로그인·권한, 부서·서무 계정, 교육 과정, 직원 명단 일괄 등록, 설치본 만들기 | 완료 |
| 2 | 이수증 올리기(PDF 쪽 나누기), 처리 대기열, OCR, 검수함, 이수 판정·현황 | 완료 |
| 3 | 교육 분류·직원 매칭, 일괄 확정, 정확도 점검 (이때 넣은 AI 인식은 6단계에서 뺌) | 완료 |
| 4 | 대시보드(전체·교육별·부서별 이수율), 엑셀·이수증 ZIP·교육별 합본 PDF 내보내기, 감사 로그 화면 | 완료 |
| 5 | 접속기록(위·변조 확인·월 점검), 내려받기 사유, HTTPS, 주민번호 가림, 보관기간·파기, 백업·복원, 서비스 등록, 시스템 점검, 설치·운영 가이드 | 완료 |
| 6 | AI 기능 제거, 스캔본 OCR을 kordoc(PP-OCRv5)으로, Windows PC 설치판(설치.bat, 프로그램 끄기) | 완료 |

## 개발 환경에서 실행

Node.js 24가 필요합니다.

```bash
npm install
npm run dev
```

- 화면: http://localhost:5173 (처음 접속하면 기관명과 관리자 계정을 만듭니다)
- 서버 API: http://localhost:3000
- 데이터: `data/` 폴더 (DB와 파일, git에 올리지 않음)

시연용 가상 자료 만들기 (실존 인물·기관 아님):
- `npm run samples` → `samples/` 가상 인사 명단 (xlsx·xls·CP949 CSV)
- `npm run samples:certs` → `samples/certs/` 가상 이수증 (개별 PDF 39개, 40쪽 스캔 묶음, 정답.json)

## 이수증 읽기

| 이수증 | 읽는 방법 |
|---|---|
| 글자가 든 PDF | 서무 PC의 브라우저가 PDF 글자를 뽑아 올림 → 규칙으로 판독 |
| 스캔본 PDF·사진 | 서버가 쪽 이미지를 kordoc OCR(PP-OCRv5 한국어)로 읽음 → 같은 규칙으로 판독 |

- OCR 모델(`vendor/ocr-models/`, 약 18MB)이 설치본에 들어 있어 인터넷 없이 동작합니다. kordoc 엔진을 띄우지 못하는 PC(예: Visual C++ 런타임이 없음)에서는 tesseract로 자동으로 바꿔 읽고, **설정 > 시스템 점검**에 알립니다.
- 직원 찾기·교육 분류·날짜 정리·"확인할 점"은 모두 규칙으로 합니다. 확인할 점이 없는 이수증은 검수함의 **정상 n건 일괄 확정**으로 한 번에 확정합니다.
- 가상 이수증 79쪽(글자 PDF와 스캔본) 시험: 78쪽을 모두 맞게 읽었고, 확인할 점 없이 틀린 쪽은 0, 스캔본은 쪽당 약 0.4초(이 Mac 기준).

## PC 설치판 (Windows)

`npm run release -- --target win-x64 --desktop --download-node`로 `release/법정교육이수증-설치-버전-win-x64.zip`을 만듭니다. 압축을 풀고 `설치.bat`을 두 번 누르면 관리자 권한 없이 설치되고, 바탕화면의 **법정교육 이수증** 아이콘으로 실행합니다. 자세한 내용은 [docs/PC설치안내.md](docs/PC설치안내.md).

## 내보내기

**내보내기** 화면에서 연도·부서를 골라 받습니다. 확정한 이수증만 들어가고, 서무는 담당 부서 것만 받습니다. 받은 기록은 감사 로그에 남습니다.

| 자료 | 내용 |
|---|---|
| 이수 현황 엑셀 | 요약(교육별·부서별 이수율) · 직원별 · 미이수자 · 상세 내역(근거 이수증) 4개 시트 |
| 이수증 ZIP | 교육별 또는 부서별 폴더에 `부서_성명_교육명_이수일.pdf`. 파일 이름에 UTF-8 표시를 달아 Windows 탐색기에서 한글이 깨지지 않음 |
| 교육별 합본 PDF | 교육 하나의 이수증을 부서·성명 순서로 한 파일에 |

이수증 PDF는 올린 원본 PDF에서 그 쪽을 그대로 옮겨 와 글자 정보와 화질이 유지됩니다 (원본을 열 수 없으면 저장한 쪽 이미지로 만듭니다).

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 화면과 서버를 함께 실행 (코드를 고치면 자동 반영) |
| `npm test` | 단위·API 테스트 |
| `npm run typecheck` | 타입 검사 |
| `npm run samples` | 가상 인사 명단 파일 만들기 |
| `npm run samples:certs` | 가상 이수증 PDF·스캔본 만들기 (개발용 그림 라이브러리 사용) |
| `npm run eval -- --truth samples/certs/정답.json` | 판독 정확도 점검 (`--truth confirmed`: 확정한 결과를 정답으로, `--engine tesseract`: 대체 OCR로) |
| `npm run restore -- --check` | 백업 복원 연습 (`--list` 목록, `--apply --yes` 실제 복원 — 서버를 멈춘 뒤) |
| `npm run release` | 서버용 설치본 zip 만들기 (`-- --target linux-x64 --download-node` 처럼 다른 OS용도, `-- --target win-x64 --desktop --download-node`는 PC 설치판) |

## 폴더 구조

```
web/       화면 (React)
  src/pages/        화면별 파일 (이수증 올리기, 검수함, 이수 현황, 직원 명단 …)
  src/upload/       브라우저에서 PDF를 쪽 이미지·글자로 나누어 올리기 (pdf.js)
  src/components/   공통 부품 (사이드바, 표, 대화상자 …)
server/    서버 (Fastify)
  src/routes/       API — 화면이 부르는 주소별 처리
  src/db/           DB 구조(migrations/*.sql), 공공기관 교육 기본 목록
  src/roster/       인사 명단 파일 읽기·비교
  src/certs/        이수증 판독 규칙, 직원 찾기, 교육 분류, 확인할 점, 이수 판정
  src/reports/      이수 현황 계산(대시보드·엑셀 공용), 엑셀, 이수증 ZIP·합본 PDF, 파일 이름
  src/ops/          백업, 보관기간·파기, 매일 하는 예약 작업
  src/jobs/         쪽 처리 대기열 (꺼졌다 켜져도 이어서 처리)
  src/ocr/          스캔본 글자 읽기 (kordoc PP-OCRv5, 안 되면 tesseract.js)
  src/auth/         로그인·세션·권한
shared/    화면과 서버가 함께 쓰는 타입과 규칙
scripts/   가상 명단·이수증 만들기, 판독 정확도 점검(eval-ocr.ts), 백업 복원(restore.ts), 설치본 만들기
deploy/    서비스 등록 파일 (Windows 작업 스케줄러, Linux systemd), PC 설치판 스크립트(windows-desktop/)
tests/     테스트
docs/      설치 가이드, 운영 가이드, 정보화 담당 확인 요청서, PC 설치 안내
vendor/    SheetJS (엑셀 읽기) 공식 배포 파일, OCR 모델(ocr-models/ — PP-OCRv5 한국어, Apache-2.0)
```

## 기술 선택 이유

- **내부망 설치**: 설치본에 실행용 Node와 대상 OS용 OCR 엔진(onnxruntime-node, sharp)까지 넣어, 서버·PC에 복사만 하면 실행됩니다. 설치본을 만들 때 대상 OS용이 아닌 네이티브 파일이 섞이면 실패 처리합니다. DB는 Node 내장 SQLite를 씁니다.
- **외부 연결 없음**: 글꼴(Wanted Sans, 직인용 Noto Serif KR), PDF 처리 파일, OCR 모델까지 모두 설치본 안에서 제공합니다. 이수증을 AI나 인터넷으로 보내지 않습니다.
- **OCR은 kordoc**: 같은 가상 이수증으로 비교했을 때 스캔본을 tesseract보다 정확하게 읽었습니다(스캔 41쪽 중 tesseract 37쪽, kordoc 41쪽). kordoc(MIT)과 PP-OCRv5 모델(Apache-2.0)은 상업·공공 사용에 제한이 없는 라이선스입니다.
- **PDF는 서무 PC의 브라우저에서 쪽 이미지로 나눈다**: 서버에 그림 라이브러리를 깔지 않아도 되고, 서버는 OCR과 판독만 합니다.
- **서버 코드는 빌드 없이 실행**: Node의 TypeScript 실행 기능을 써서 `server/src`를 그대로 실행합니다.
- **화면 라이브러리는 개발용(devDependencies)**: 화면은 빌드할 때 하나로 묶이므로, 설치본에는 서버 실행에 필요한 라이브러리만 들어갑니다.
