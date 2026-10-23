/**
 * 내려받기 파일 이름. 한글 이름은 filename*(RFC 5987)로 보내고,
 * 이를 모르는 오래된 프로그램을 위해 영문 이름을 함께 준다.
 */
export function contentDisposition(fileName: string, fallback = 'download'): string {
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
