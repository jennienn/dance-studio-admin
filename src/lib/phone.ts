export const PHONE_FORMAT_MESSAGE = "연락처는 010-0000-0000 형식으로 입력해주세요.";
export const DUPLICATE_PHONE_MESSAGE =
  "이미 등록된 연락처입니다. 기존 회원에서 수강권을 추가해주세요.";

export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function isValidMemberPhone(value: unknown): value is string {
  return typeof value === "string" && /^010-\d{4}-\d{4}$/.test(value);
}
