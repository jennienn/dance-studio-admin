import { afterEach, describe, expect, it } from "vitest";
import { notificationsEnabled } from "@/lib/notification-config";

const originalValue = process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED;

afterEach(() => {
  if (originalValue === undefined) delete process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED;
  else process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED = originalValue;
});

describe("알림톡 운영 잠금장치", () => {
  it("환경변수가 없거나 false면 발송을 차단한다", () => {
    delete process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED;
    expect(notificationsEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED = "false";
    expect(notificationsEnabled()).toBe(false);
  });

  it("명시적으로 true인 경우에만 발송을 허용한다", () => {
    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED = "true";
    expect(notificationsEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_NOTIFICATIONS_ENABLED = "TRUE";
    expect(notificationsEnabled()).toBe(false);
  });
});
