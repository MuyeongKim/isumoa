/** AppShell이 화면 이동·로그아웃·종료 전에 현재 편집 입력을 보호한다. */
export interface PendingEdits {
  dirty: boolean;
  busy?: boolean;
  saveDescription?: string;
  save: () => Promise<boolean>;
  discard: () => void;
}

export interface EditGuard {
  setPendingEdits: (edits: PendingEdits | null) => void;
  clearPendingEdits: () => void;
  /** 처리 중 사용자가 요청한 메뉴 이동·로그아웃·종료가 있는지. 내부 '다음' 이동보다 우선한다. */
  hasPendingNavigation: () => boolean;
}
