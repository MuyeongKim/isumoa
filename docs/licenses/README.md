# 구성요소 라이선스

`dependency-inventory.json`은 0.5.7 잠금 파일의 개발·빌드·런타임 의존성 목록입니다. `devDependency`에도 React·PDF.js·글꼴처럼 최종 브라우저 번들에 들어가는 항목이 있어 전체 목록을 보관합니다. 이는 법률 검토나 프로젝트 자체의 라이선스 허락을 대신하지 않습니다.

설치본의 `app/vendor/licenses`에는 브라우저 번들에 쓰이는 React·React DOM·React Router·TanStack Query·Lucide·Sonner·PDF.js·Wanted Sans·Noto Serif KR·zip.js의 라이선스 원문을 함께 넣습니다. PDF.js의 CMap·표준 글꼴·WASM 구성요소별 고지는 해당 리소스 폴더에 포함됩니다. 서버 의존성은 설치본의 `app/node_modules` 아래 각 패키지 라이선스를 보존하고 Node 런타임도 LICENSE를 포함합니다.

모델과 한국어 데이터는 별도입니다. PP-OCRv5 모델의 출처·해시·라이선스는 [모델 고지](../../vendor/ocr-models/NOTICE.md), 대체 OCR의 한국어 데이터는 설치본의 `@tesseract.js-data/kor` 구성요소에 있습니다. 모델의 Apache-2.0 원문은 PDF.js와 동일한 표준 라이선스 문서로 함께 제공합니다.

최종 배포를 만들 때 EXE를 추출해 고지와 런타임 파일이 실제 포함되었는지 확인합니다. 소스 폴더에 파일을 두었다는 사실만으로 설치본 고지 완료로 판단하지 않습니다.
