# 법정교육 이수증 종합 플랫폼

서무가 걷은 법정교육 이수증을 한꺼번에 올리면 AI가 직원·교육 종류·이수일·교육시간을 읽어 분류하고, 서무가 검수해 확정하면 기관 전체 이수 현황과 증빙 자료가 만들어지는 내부망용 웹 프로그램입니다.

## 진행 상황

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 기반: 로그인·권한, 부서·서무 계정, 교육 과정, 직원 명단 일괄 등록, 설치본 만들기 | 완료 |
| 2 | 이수증 올리기(PDF 페이지 분할), 처리 대기열, OCR, 수동 검수, 이수 판정 | 예정 |
| 3 | AI 인식(기관 AI 서버·Ollama), 교육 분류·직원 매칭, 일괄 확정, 정확도 점검 | 예정 |
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

시연용 가상 명단 만들기: `npm run samples` → `samples/` 폴더

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 화면과 서버를 함께 실행 (코드를 고치면 자동 반영) |
| `npm test` | 단위·API 테스트 |
| `npm run typecheck` | 타입 검사 |
| `npm run samples` | 가상 인사 명단 파일 만들기 |
| `npm run release` | 내부망 설치본 zip 만들기 (`-- --target win-x64 --download-node` 처럼 다른 OS용도 가능) |

## 폴더 구조

```
web/       화면 (React)
  src/pages/        화면별 파일 (직원 명단, 교육 과정, 설정 …)
  src/components/   공통 부품 (사이드바, 표, 대화상자 …)
server/    서버 (Fastify)
  src/routes/       API — 화면이 부르는 주소별 처리
  src/db/           DB 구조(migrations/*.sql), 공공기관 교육 기본 목록
  src/roster/       인사 명단 파일 읽기·비교
  src/auth/         로그인·세션·권한
shared/    화면과 서버가 함께 쓰는 타입과 규칙
scripts/   가상 명단 만들기, 설치본 만들기
tests/     테스트
docs/      설치 가이드, 정보화 담당 확인 요청서
vendor/    SheetJS (엑셀 읽기) 공식 배포 파일
```

## 기술 선택 이유

- **내부망 설치**: OS별로 따로 컴파일해야 하는 라이브러리를 쓰지 않아서, Mac에서 만든 설치본을 Windows·Linux 서버에 복사만 하면 실행됩니다. DB는 Node 내장 SQLite를 씁니다.
- **외부 연결 없음**: 글꼴(Pretendard, Noto Serif KR)까지 모두 서버에서 직접 제공합니다.
- **서버 코드는 빌드 없이 실행**: Node의 TypeScript 실행 기능을 써서 `server/src`를 그대로 실행합니다.
- **화면 라이브러리는 개발용(devDependencies)**: 화면은 빌드할 때 하나로 묶이므로, 설치본에는 서버 실행에 필요한 라이브러리만 들어갑니다.
