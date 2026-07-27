/**
 * 카카오 템플릿 승인과 운영 환경변수 설정이 모두 끝난 뒤에만 true로 전환한다.
 * 기본값은 false이며 클라이언트 UI와 서버 발송 경로가 같은 값을 사용한다.
 */
export function notificationsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED === "true";
}
