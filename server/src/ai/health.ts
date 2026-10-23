// AI 서버 상태. 연결 실패가 이어지면 잠시(2분) AI를 쉬고 규칙으로만 읽는다.
// 쉬는 동안에도 처리는 멈추지 않고, 화면 위쪽 안내줄에 이유를 보여 준다.

const REST_AFTER_FAILURES = 2;
const REST_MS = 2 * 60_000;

export class AiHealth {
  private failures = 0;
  private lastError: string | null = null;
  private lastFailureAt = 0;

  recordSuccess(): void {
    this.failures = 0;
    this.lastError = null;
  }

  recordFailure(message: string): void {
    this.failures++;
    this.lastError = message;
    this.lastFailureAt = Date.now();
  }

  /** 연결 실패가 이어져 AI를 잠시 쉬는 중인지 */
  resting(now = Date.now()): boolean {
    return this.failures >= REST_AFTER_FAILURES && now - this.lastFailureAt < REST_MS;
  }

  /** 화면에 보여 줄 최근 AI 장애 (정상이면 null) */
  error(): string | null {
    return this.lastError;
  }

  /** 설정을 바꾸면 처음부터 다시 본다 */
  reset(): void {
    this.failures = 0;
    this.lastError = null;
  }
}
