# 이수모아 로고 사용 안내

![이수모아 로고](isumoa-lockup.png)

**이름**: 이수모아 (부제: 법정교육 이수증 종합 플랫폼)

**뜻**: 흩어진 법정교육 이수증을 **모아** 한곳에서 확인한다. 로고의 빨간 네모는 확인 도장(직인)이고, 글자를 감싼 네 모서리 괄호는 이수증을 스캔해 한곳에 모은다는 뜻이다.

## 파일

| 파일 | 쓰는 곳 |
|---|---|
| `isumoa-mark.svg` · `isumoa-mark-1024.png` | 네모 로고만. 프로필, 표지, 큰 아이콘 |
| `isumoa-repository-icon.png` | GitLab 프로젝트 아이콘과 저장소 README에 쓰는 512×512 PNG |
| `isumoa-social-preview.png` | GitHub 링크 공유용 1280×640 미리보기 이미지 |
| `isumoa-mark-compact.svg` | 작은 곳(가로 40px 이하)용. 괄호를 빼고 글자를 키움 |
| `isumoa-lockup.svg` · `.png` | 로고 + 이름 + 부제, 밝은 바탕 (문서·발표 자료·공문) |
| `isumoa-lockup-reverse.svg` · `.png` | 같은 가로 로고, 어두운 바탕용 (PNG는 장청색 바탕) |

SVG는 글꼴이 필요 없는 그림이라 어느 PC에서 열어도 똑같이 보인다. 워드·파워포인트·한글에는 PNG나 SVG를 그림으로 넣으면 된다.

## 색

| 이름 | 값 | 어디에 |
|---|---|---|
| 인주 빨강 | `#D23B2C` | 로고 네모 (바꾸지 않는다) |
| 잉크 | `#161B26` | 이름 글자 (밝은 바탕) |
| 장청 | `#2438A6` | 프로그램 버튼·선택 표시, 어두운 바탕 |

## 지키면 좋은 것

- 가로세로 비율을 바꾸지 않는다. 늘리거나 찌그러뜨리지 않는다.
- 로고 둘레에 네모 높이의 1/4 이상 여백을 둔다.
- 빨간 네모의 색, 안의 흰 글자와 괄호를 바꾸지 않는다. 어두운 바탕에서는 `reverse` 가로 로고를 쓴다.
- 40px보다 작게 쓸 때는 `compact`를 쓴다. 16px 아이콘은 "모" 한 글자만 쓴다 (Windows 아이콘은 이미 그렇게 만들어 두었다).

## 만들고 고치기

로고는 `scripts/brand/make-brand.ts` 한 곳에서만 그린다. 모양을 바꾸려면 이 파일을 고치고 `npm run brand`를 실행하면, 프로그램 화면의 로고·탭 아이콘·Windows 아이콘·이 폴더의 파일이 한꺼번에 새로 만들어진다.

글자 윤곽은 [Wanted Sans](https://github.com/wanteddev/wanted-sans)(SIL Open Font License 1.1, © Wanted Lab)를 그림으로 옮긴 것이다.

저장소용 PNG는 `node scripts/brand/make-repository-assets.ts`로 다시 만듭니다. 기존 compact SVG와 정식 가로 로고를 사용하며 앱·Windows 아이콘의 모양은 바꾸지 않습니다.
