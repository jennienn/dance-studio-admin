import { describe, expect, it } from "vitest";
import { advanceNoticeUnavailableSlots } from "@/lib/booking-rules";

describe("개인레슨 당일 예약 제한", () => {
  it("13:00에는 15:00부터 예약할 수 있다", () => {
    const unavailable = advanceNoticeUnavailableSlots("2026-08-03", "2026-08-03", 13 * 60);
    expect(unavailable).toContain(14 * 60 + 30);
    expect(unavailable).not.toContain(15 * 60);
  });

  it("13:10에는 다음 30분 단위인 15:30부터 예약할 수 있다", () => {
    const unavailable = advanceNoticeUnavailableSlots("2026-08-03", "2026-08-03", 13 * 60 + 10);
    expect(unavailable).toContain(15 * 60);
    expect(unavailable).not.toContain(15 * 60 + 30);
  });

  it("미래 날짜의 시간은 현재 시각 때문에 차단하지 않는다", () => {
    expect(advanceNoticeUnavailableSlots("2026-08-04", "2026-08-03", 20 * 60)).toEqual([]);
  });
});
