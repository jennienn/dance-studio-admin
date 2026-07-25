import { config } from "dotenv";

config({ path: ".env.local", override: false });

const required = [
  "SOLAPI_API_KEY",
  "SOLAPI_API_SECRET",
  "KAKAO_CHANNEL_ID",
  "KAKAO_SENDER_PHONE",
  "KAKAO_DUE_SOLO_TEMPLATE_ID",
  "KAKAO_DUE_GROUP_TEMPLATE_ID",
  "KAKAO_COMPLETED_SOLO_TEMPLATE_ID",
  "KAKAO_COMPLETED_GROUP_TEMPLATE_ID",
  "CRON_SECRET"
];

const placeholders = [
  /^change-this-/i,
  /^your[_-]/i,
  /^test([_-]|$)/i
];

const errors = [];
for (const name of required) {
  const value = process.env[name]?.trim();
  if (!value) {
    errors.push(`${name}: 값이 없습니다.`);
  } else if (placeholders.some((pattern) => pattern.test(value))) {
    errors.push(`${name}: 예시 값을 실제 운영 값으로 교체해야 합니다.`);
  }
}

const senderPhone = process.env.KAKAO_SENDER_PHONE?.replace(/\D/g, "") ?? "";
if (senderPhone && !/^01\d{8,9}$/.test(senderPhone)) {
  errors.push("KAKAO_SENDER_PHONE: 국내 휴대전화 번호 형식이 아닙니다.");
}

const templateNames = required.filter((name) => name.endsWith("_TEMPLATE_ID"));
const templateIds = templateNames
  .map((name) => process.env[name]?.trim())
  .filter(Boolean);
if (new Set(templateIds).size !== templateIds.length) {
  errors.push("템플릿 ID 4개는 각각 서로 다른 값이어야 합니다.");
}

const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
if (cronSecret && cronSecret.length < 16) {
  errors.push("CRON_SECRET: 최소 16자 이상의 무작위 값을 사용해야 합니다.");
}

if (errors.length > 0) {
  console.error("알림톡 운영 준비 점검에 실패했습니다.");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("알림톡 운영 환경변수 준비가 완료되었습니다.");
  console.log("실제 값은 출력하지 않았습니다. 템플릿 승인 후 내부 번호로 4종 발송을 확인하세요.");
}
