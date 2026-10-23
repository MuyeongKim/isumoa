# 법정교육 이수증 종합 플랫폼

서무가 걷은 법정교육 이수증을 한꺼번에 올리면 AI가 직원·교육 종류·이수일·교육시간을 읽어 분류하고, 서무가 검수해 확정하면 기관 전체 이수 현황과 증빙 자료가 만들어지는 내부망용 웹 프로그램입니다.

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 기반: 로그인·권한, 부서·서무 계정, 교육 과정, 직원 명단 일괄 등록, 설치본 만들기 | 완료 |
| 2 | 이수증 올리기(PDF 쪽 나누기), 처리 대기열, OCR, 검수함, 이수 판정·현황 | 완료 |
| 3 | AI 인식(로컬·기관 AI 서버, Claude API), 교육 분류·직원 매칭, 일괄 확정, 정확도 점검 | 완료 |
| 4 | 대시보드, 이수 현황, 엑셀·ZIP·합본 PDF 내보내기, 감사 로그 화면 | 예정 |
| 5 | 보안 강화, 서비스 등록, 백업·복원, 설치·운영 가이드 | 예정 |

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

## AI 연결

관리자 화면 **설정 > AI 연결**에서 고릅니다. AI를 끄면 규칙(항목 이름과 글자 위치)으로만 읽습니다.

| 종류 | 예 | 개인정보 |
|---|---|---|
| 이 PC·내부망 AI (OpenAI 호환) | Ollama `http://localhost:11434/v1`, 기관 vLLM 서버 `http://ai-server:8000/v1` | 기관 안에만 머묾 |
| Claude API (인터넷) | `claude-opus-5-5` | 기관 밖으로 전송 — 관리자가 "외부 AI 허용"을 켜야 쓸 수 있고, `config.json`의 `allowExternalAi: false`로 아예 막을 수 있음 |

- AI는 이수증에 **적힌 값을 읽는 일**만 합니다. 직원 찾기·교육 분류·날짜 정리·확인할 점은 프로그램이 하고, 직원 명단은 AI에 보내지 않습니다.
- **연결 테스트**는 설치본에 들어 있는 가상 이수증(`server/assets/`)으로 JSON 답 형식, 이미지 읽기 가능 여부, 속도를 확인합니다.
- AI 서버가 멈추면 10초·1분 뒤 다시 시도하고, 그래도 안 되면 규칙으로 읽고 화면 위쪽에 알립니다.
- Claude API는 정책상 답을 거절할 때 다른 모델로 한 번 더 시도하는 서버 측 대체(server-side fallback)를 켜 두었습니다.

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 화면과 서버를 함께 실행 (코드를 고치면 자동 반영) |
| `npm test` | 단위·API 테스트 |
| `npm run typecheck` | 타입 검사 |
| `npm run samples` | 가상 인사 명단 파일 만들기 |
| `npm run samples:certs` | 가상 이수증 PDF·스캔본 만들기 (개발용 그림 라이브러리 사용) |
| `npm run eval -- --truth samples/certs/정답.json` | AI 인식 정확도 점검 (`--truth confirmed`: 확정한 결과를 정답으로, `--rules`: AI 없이, `--model …`: 다른 모델로) |
| `npm run release` | 내부망 설치본 zip 만들기 (`-- --target win-x64 --download-node` 처럼 다른 OS용도 가능) |

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
  src/certs/        이수증 읽기(규칙·AI 합치기), 직원 찾기, 교육 분류, 확인할 점, 이수 판정
  src/ai/           AI 연결 — OpenAI 호환·Claude API 호출, 지시문, 답 검사, 연결 테스트
  assets/           연결 테스트용 가상 이수증
  src/jobs/         쪽 처리 대기열 (꺼졌다 켜져도 이어서 처리)
  src/ocr/          스캔본 글자 읽기 (tesseract.js, 한국어 데이터 포함)
  src/auth/         로그인·세션·권한
shared/    화면과 서버가 함께 쓰는 타입과 규칙
scripts/   가상 명단·이수증 만들기, AI 정확도 점검(eval-ai.ts), 설치본 만들기
tests/     테스트 (fakes/: 장애를 일부러 낼 수 있는 가짜 AI 서버)
docs/      설치 가이드, 정보화 담당 확인 요청서
vendor/    SheetJS (엑셀 읽기) 공식 배포 파일
```

## 기술 선택 이유

- **내부망 설치**: OS별로 따로 컴파일해야 하는 라이브러리를 쓰지 않아서, Mac에서 만든 설치본을 Windows·Linux 서버에 복사만 하면 실행됩니다. DB는 Node 내장 SQLite를 씁니다.
- **외부 연결 없음**: 글꼴(Pretendard, Noto Serif KR), PDF 처리 파일, OCR 한국어 데이터까지 모두 서버에서 직접 제공합니다. (AI 연결에서 Claude API를 고른 경우에만 인터넷에 접속합니다.)
- **PDF는 서무 PC의 브라우저에서 쪽 이미지로 나눈다**: 서버에 그림 라이브러리를 깔지 않아도 되고, 서버는 OCR과 판독만 합니다.
- **서버 코드는 빌드 없이 실행**: Node의 TypeScript 실행 기능을 써서 `server/src`를 그대로 실행합니다.
- **화면 라이브러리는 개발용(devDependencies)**: 화면은 빌드할 때 하나로 묶이므로, 설치본에는 서버 실행에 필요한 라이브러리만 들어갑니다.
