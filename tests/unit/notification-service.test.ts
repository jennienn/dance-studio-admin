import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  messageFor,
  variablesFor,
  type NotificationCycleRow
} from "@/lib/notification-service";

function cycle(
  overrides: Partial<NotificationCycleRow> = {}
): NotificationCycleRow {
  return {
    id: "cycle-1",
    status: "active",
    plan: 8,
    base_count: 8,
    total_count: 10,
    used_count: 7,
    payment_date: "2026-07-27",
    valid_end_date: "2026-09-28",
    next_due_date: null,
    enrollments: {
      kind: "solo",
      status: "active",
      package_id: null,
      members: { name: "테스트회원_알림", phone: "010-0000-0000" },
      classes: null,
      enrollment_packages: null
    },
    ...overrides
  };
}

describe("회원별 알림톡 템플릿", () => {
  it("개인레슨 잔여 횟수와 만료일을 회원 cycle 값으로 치환한다", () => {
    const row = cycle();

    expect(messageFor(row, "auto")).toContain("현재 잔여 횟수: 3회 / 10회");
    expect(messageFor(row, "auto")).toContain("만료 예정일: 2026.09.28");
    expect(variablesFor(row, "auto")).toEqual({
      "#{회원명}": "테스트회원_알림",
      "#{잔여횟수}": "3",
      "#{총횟수}": "10",
      "#{만료예정일}": "2026.09.28"
    });
  });

  it("개인레슨 등록 횟수는 이월을 제외한 결제 횟수, 유효기간은 plan 주수로 안내한다", () => {
    const row = cycle();

    expect(messageFor(row, "registration")).toContain("등록 횟수: 총 8회");
    expect(messageFor(row, "registration")).toContain("첫 수업일로부터 9주 이내");
    expect(variablesFor(row, "registration")).toEqual({
      "#{회원명}": "테스트회원_알림",
      "#{등록횟수}": "8",
      "#{유효주수}": "9"
    });
  });

  it("단체레슨 재등록 안내에 수업명과 결제 예정일을 넣는다", () => {
    const row = cycle({
      plan: null,
      base_count: 8,
      total_count: 8,
      used_count: 6,
      valid_end_date: null,
      next_due_date: "2026-08-31",
      enrollments: {
        kind: "group",
        status: "active",
        package_id: null,
        members: { name: "테스트회원_단체", phone: "010-0000-0001" },
        classes: { name: "K-POP" },
        enrollment_packages: null
      }
    });

    expect(messageFor(row, "auto")).toContain("K-POP 클래스 수강권이 1주일 후 만료");
    expect(messageFor(row, "auto")).toContain("만료 예정일: 2026.08.31");
    expect(variablesFor(row, "auto")).toEqual({
      "#{회원명}": "테스트회원_단체",
      "#{수업명}": "K-POP",
      "#{만료예정일}": "2026.08.31"
    });
  });

  it("단체레슨 등록 완료 안내에 결제일부터 다음 결제 예정일까지의 기간을 넣는다", () => {
    const row = cycle({
      plan: null,
      base_count: 8,
      total_count: 8,
      payment_date: "2026-07-27",
      valid_end_date: null,
      next_due_date: "2026-08-31",
      enrollments: {
        kind: "group",
        status: "active",
        package_id: null,
        members: { name: "테스트회원_단체", phone: "010-0000-0001" },
        classes: { name: "다이어트댄스" },
        enrollment_packages: null
      }
    });

    expect(messageFor(row, "registration")).toContain("수강 기간: 2026.07.27 ~ 2026.08.31");
    expect(variablesFor(row, "registration")).toEqual({
      "#{회원명}": "테스트회원_단체",
      "#{수업명}": "다이어트댄스",
      "#{수강시작일}": "2026.07.27",
      "#{수강종료일}": "2026.08.31"
    });
  });
});
