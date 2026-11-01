import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 이미지·엑셀·SQLite 검증을 함께 띄워도 작업당 제한시간을 지키도록 병렬 수를 제한한다.
    maxWorkers: 2,
  },
});
