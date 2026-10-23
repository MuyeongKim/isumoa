// 화면을 하위 경로(예: /kmy/edu-cert/)에 올릴 때를 위한 기준 경로. 빌드할 때 VITE_BASE 로 정하고, 기본은 루트('')다.
export const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** 서버(같은 출처)의 절대 경로 앞에 기준 경로를 붙인다 (예: /api/x → /kmy/edu-cert/api/x) */
export const withBase = (path: string) => `${BASE}${path}`;
