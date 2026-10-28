// 2026년 부서 시범운용 기본값. 기관 지침과 대조해 조정한다.
export const DEPLOYMENT_CATALOG_VERSION = '2026.1';
export const DEPLOYMENT_TRAININGS = [
  {
    "code": "privacy",
    "sheetName": "개인정보보호",
    "name": "개인정보보호 교육",
    "category": "정보보호",
    "legalBasis": "개인정보 보호법 제28조",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "개인정보"
    ],
    "active": true
  },
  {
    "code": "infection-prevention",
    "sheetName": "감염병예방",
    "name": "감염병 예방관리및위기대응",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "감염병"
    ],
    "active": true
  },
  {
    "code": "violence-integrated",
    "sheetName": "4대폭력",
    "name": "4대 폭력예방교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 4,
    "keywords": [
      "4대 폭력"
    ],
    "active": true
  },
  {
    "code": "integrity",
    "sheetName": "반부패청렴",
    "name": "청탁금지법등반부패·청렴교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 5,
    "keywords": [
      "청렴"
    ],
    "active": true
  },
  {
    "code": "unification",
    "sheetName": "통일의식",
    "name": "통일의식 교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "통일"
    ],
    "active": true
  },
  {
    "code": "disability-awareness",
    "sheetName": "장애인식",
    "name": "장애인식개선 교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "장애인식"
    ],
    "active": true
  },
  {
    "code": "child-abuse",
    "sheetName": "아동학대",
    "name": "아동학대 예방 교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "아동학대"
    ],
    "active": true
  },
  {
    "code": "human-rights",
    "sheetName": "인권교육",
    "name": "인권교육(도 조례)",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 2,
    "keywords": [
      "행정과인권"
    ],
    "active": true
  },
  {
    "code": "suicide-prevention",
    "sheetName": "자살예방",
    "name": "자살예방교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "생명지킴이"
    ],
    "active": true
  },
  {
    "code": "conflict-of-interest",
    "sheetName": "이해충돌방지",
    "name": "이해충돌방지법",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "이해충돌"
    ],
    "active": true
  },
  {
    "code": "emergency-welfare",
    "sheetName": "긴급복지",
    "name": "긴급복지신고의무자교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "긴급",
      "복지신고"
    ],
    "active": true
  },
  {
    "code": "information-disclosure",
    "sheetName": "정보공개",
    "name": "정보공개교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "정보공개"
    ],
    "active": true
  },
  {
    "code": "active-administration",
    "sheetName": "적극행정",
    "name": "적극행정실천 교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "적극행정"
    ],
    "active": true
  },
  {
    "code": "national-security",
    "sheetName": "공직자안보",
    "name": "공직자안보교육",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "안보"
    ],
    "active": true
  },
  {
    "code": "gender-impact",
    "sheetName": "성별영향평가",
    "name": "성별영향평가",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "성별"
    ],
    "active": true
  },
  {
    "code": "gender-sensitivity",
    "sheetName": "성인지",
    "name": "성인지 감수성",
    "category": "",
    "legalBasis": "",
    "reqType": "hours",
    "reqValue": 1,
    "keywords": [
      "성인지"
    ],
    "active": true
  }
] as const;

// 검수에서 확인한 공통 과정 연결. 직원·증서 정보는 포함하지 않는다.
export const COMMON_COURSE_MAPPINGS = [
  {
    "title": "공직자안보교육",
    "trainingCode": "national-security"
  },
  {
    "title": "사례로알아보는사업성별영향평가",
    "trainingCode": "gender-impact"
  },
  {
    "title": "인권의이해입문편",
    "trainingCode": "human-rights"
  },
  {
    "title": "평등한일상폭력예방교육일반",
    "trainingCode": "violence-integrated"
  }
] as const;
