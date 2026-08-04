import { describe, expect, it } from "vitest";
import {
  advanceNoticeUnavailableSlots,
  bookingTimeSlots,
  isBookingDateWithinRange,
  lateCancellationCharges,
  soloBookingValidEnd
} from "@/lib/booking-rules";

describe("개인레슨 예약 시간", () => {
  it("10:00부터 22:00까지 30분 단위로 제공한다", () => {
    const slots = bookingTimeSlots();
    expect(slots[0]).toBe(600);
    expect(slots.at(-1)).toBe(1320);
    expect(slots).toHaveLength(25);
  });
});

describe("개인레슨 예약 유효기간", () => {
  it.each([
    [4, "2026-09-04"],
    [8, "2026-10-02"],
    [12, "2026-10-30"]
  ] as const)("%i회권은 결제일 기준 임시 예약 만료일을 계산한다", (plan, expected) => {
    expect(soloBookingValidEnd("2026-08-01", plan)).toBe(expected);
  });

  it("모바일 날짜 선택기에서도 예약 가능 기간 밖의 날짜를 거부한다", () => {
    expect(isBookingDateWithinRange("2026-08-03", "2026-08-03", "2026-09-04")).toBe(true);
    expect(isBookingDateWithinRange("2026-09-04", "2026-08-03", "2026-09-04")).toBe(true);
    expect(isBookingDateWithinRange("2026-08-02", "2026-08-03", "2026-09-04")).toBe(false);
    expect(isBookingDateWithinRange("2026-09-05", "2026-08-03", "2026-09-04")).toBe(false);
  });
});

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

describe("개인레슨 취소 횟수 차감", () => {
  it("예약일 전날 19:59까지는 차감하지 않는다", () => {
    expect(lateCancellationCharges("2026-08-05", "2026-08-04", 19 * 60 + 59)).toBe(false);
  });

  it("예약일 전날 20:00부터 차감한다", () => {
    expect(lateCancellationCharges("2026-08-05", "2026-08-04", 20 * 60)).toBe(true);
  });

  it("예약 당일 취소는 차감한다", () => {
    expect(lateCancellationCharges("2026-08-05", "2026-08-05", 10 * 60)).toBe(true);
  });
});
