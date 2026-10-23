# 스캔본 OCR 모델

kordoc(npm `kordoc` 4.24.1, MIT)이 쓰는 PP-OCRv5 모델을 미리 받아 둔 것입니다. 서버는 `KORDOC_OFFLINE=1`로 이 폴더의 파일만 읽고 인터넷에서 받지 않습니다(`server/src/ocr/kordoc.ts`).

| 파일 | 출처 (Hugging Face) | 라이선스 | SHA-256 |
|---|---|---|---|
| `ppocr/det.onnx` | PaddlePaddle/PP-OCRv5_mobile_det_onnx — `inference.onnx` | Apache-2.0 | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` |
| `ppocr/rec_korean.onnx` | PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx — `inference.onnx` | Apache-2.0 | `92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08` |
| `ppocr/rec_korean.yml` | PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx — `inference.yml` | Apache-2.0 | `f757fa1c40e99edcf27e9cce879b93eb2a51fa46f5ef39095689b8c37dd75998` |
| `selftest.jpg` | 이 프로젝트의 가상 이수증 일부 (실존 인물 아님) | — | `1788cfa7a61b660c8a8e181aef1cef178d72de6ddd76629e244dd066ea65ae34` |

서버가 켜질 때 `selftest.jpg`를 읽어 "윤하늘"이 나오는지 확인합니다. 모델 파일이 깨졌거나 엔진을 띄우지 못하면 tesseract로 바꿔 읽고 시스템 점검에 알립니다.
