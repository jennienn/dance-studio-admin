import { describe, expect, it } from "vitest";
import {
  calcGroupNextDue,
  calcSoloValidEnd,
  canAddMemberToClass,
  countDistinctMembers,
  cycleStatus,
  daysUntil,
  formatDisplayDate,
  groupStatusText,
  isFixedTermCycle,
  koreaDateString,
  remainOf,
  soloStatusText,
  type CycleLike
} from "@/lib/business-rules";

const activeSolo = (overrides: Partial<CycleLike> = {}): CycleLike => ({
  kind: "solo",
  enrollmentStatus: "active",
  cycleStatus: "active",
  plan: 8,
  totalCount: 8,
  usedCount: 0,
  validEndDate: null,
  ...overrides
});

describe("개인레슨 규칙", () => {
  it.each([
    [4, "2026-08-18"],
    [8, "2026-09-15"],
    [12, "2026-10-13"]
  ] as const)("%i회권의 첫 수업 기준 유효기간을 계산한다", (plan, expected) => {
    expect(calcSoloValidEnd(new Date("2026-07-14T00:00:00+09:00"), plan).toISOString().slice(0, 10)).toBe(expected);
  });

  it("첫 수업 전에는 만료일이 없고 기간 만료로 판정하지 않는다", () => {
    const cycle = activeSolo({ totalCount: 4, usedCount: 0, validEndDate: null });
    expect(cycle.validEndDate).toBeNull();
    expect(cycleStatus(cycle, new Date("2026-12-31T12:00:00+09:00"))).toBeNull();
  });

  it("잔여 횟수와 잔여 1회 이하 결제 필요 상태를 계산한다", () => {
    expect(remainOf({ totalCount: 8, usedCount: 7 })).toBe(1);
    expect(cycleStatus(activeSolo({ usedCount: 7 }), new Date("2026-07-14T12:00:00+09:00"))).toBe("danger");
  });

  it("유효기간이 지난 active cycle을 결제 필요로 판정한다", () => {
    expect(
      cycleStatus(activeSolo({ validEndDate: "2026-07-13" }), new Date("2026-07-14T12:00:00+09:00"))
    ).toBe("danger");
  });

  it("재등록 모델은 이전 completed cycle과 새 active cycle을 함께 보존할 수 있다", () => {
    const cycles = [
      activeSolo({ cycleStatus: "completed", totalCount: 8, usedCount: 7 }),
      activeSolo({ cycleStatus: "active", totalCount: 5, usedCount: 0 })
    ];
    expect(cycles).toHaveLength(2);
    expect(cycles.filter((cycle) => cycle.cycleStatus === "active")).toHaveLength(1);
    expect(cycles[0].cycleStatus).toBe("completed");
  });
});

describe("단체레슨 규칙", () => {
  it("결제일에서 5주 뒤를 다음 결제 예정일로 계산한다", () => {
    expect(calcGroupNextDue(new Date("2026-07-14T00:00:00+09:00")).toISOString().slice(0, 10)).toBe("2026-08-18");
  });

  it("결제 예정일 7일 전부터 결제 필요 상태다", () => {
    const cycle: CycleLike = {
      kind: "group",
      enrollmentStatus: "active",
      cycleStatus: "active",
      totalCount: 8,
      usedCount: 3,
      nextDueDate: "2026-07-21"
    };
    expect(cycleStatus(cycle, new Date("2026-07-14T12:00:00+09:00"))).toBe("danger");
  });

  it("출석 횟수는 usedCount로 추적한다", () => {
    expect(remainOf({ totalCount: 8, usedCount: 3 })).toBe(5);
  });

  it("복수 요일의 같은 회원을 정원에서 한 명으로 계산한다", () => {
    expect(countDistinctMembers([1, 1, 2, 2, 3])).toBe(3);
  });

  it("정원 10명은 허용하고 11번째 신규 회원은 차단한다", () => {
    const ten = Array.from({ length: 10 }, (_, index) => index + 1);
    expect(canAddMemberToClass(ten, 10)).toBe(true);
    expect(canAddMemberToClass(ten, 11)).toBe(false);
  });
});

describe("상태 표기 문구", () => {
  it("날짜를 YYYY.MM.DD 형태로 표기한다", () => {
    expect(formatDisplayDate("2026-08-18")).toBe("2026.08.18");
  });

  it("개인레슨: 평상시엔 잔여+유효기간을 함께 표기한다", () => {
    const cycle = activeSolo({ totalCount: 8, usedCount: 3, validEndDate: "2026-09-15" });
    expect(soloStatusText(cycle, new Date("2026-07-14T12:00:00+09:00"))).toEqual({
      text: "잔여 5회 · 유효기간 2026.09.15",
      tone: "muted"
    });
  });

  it("개인레슨: 유효기간 7일 이내면 결제 임박 + D-Day로 강조한다", () => {
    const cycle = activeSolo({ totalCount: 8, usedCount: 3, validEndDate: "2026-07-18" });
    expect(soloStatusText(cycle, new Date("2026-07-14T12:00:00+09:00"))).toEqual({
      text: "결제 임박 · 잔여 5회 · D-4",
      tone: "danger"
    });
  });

  it("개인레슨: 잔여 1회 이하면 유효기간이 남아 있어도 결제 임박으로 표기한다", () => {
    const cycle = activeSolo({ totalCount: 8, usedCount: 7, validEndDate: "2026-12-31" });
    expect(soloStatusText(cycle, new Date("2026-07-14T12:00:00+09:00")).text).toBe("결제 임박 · 잔여 1회");
  });

  it("단체레슨: 평상시엔 잔여+유효기간을 함께 표기한다", () => {
    const cycle: CycleLike = {
      kind: "group",
      enrollmentStatus: "active",
      cycleStatus: "active",
      totalCount: 8,
      usedCount: 3,
      nextDueDate: "2026-08-18"
    };
    expect(groupStatusText(cycle, new Date("2026-07-14T12:00:00+09:00"))).toEqual({
      text: "잔여 5회 · 유효기간 2026.08.18",
      tone: "muted"
    });
  });

  it("단체레슨: 결제 예정일 7일 이내면 결제 임박 + D-Day로 강조한다", () => {
    const cycle: CycleLike = {
      kind: "group",
      enrollmentStatus: "active",
      cycleStatus: "active",
      totalCount: 8,
      usedCount: 3,
      nextDueDate: "2026-07-21"
    };
    expect(groupStatusText(cycle, new Date("2026-07-14T12:00:00+09:00"))).toEqual({
      text: "결제 임박 · 잔여 5회 · D-7",
      tone: "warning"
    });
  });
});

describe("고정 기간형(fixed-term) 판정 — 스타터 패키지 단체 절반용", () => {
  it("kind='solo'는 항상 고정 기간형이다", () => {
    expect(isFixedTermCycle(activeSolo())).toBe(true);
  });

  it("kind='group'은 isFixedTerm이 없으면 반복결제형이다", () => {
    const cycle: CycleLike = {
      kind: "group",
      enrollmentStatus: "active",
      cycleStatus: "active",
      totalCount: 4,
      usedCount: 0,
      nextDueDate: null
    };
    expect(isFixedTermCycle(cycle)).toBe(false);
  });

  it("kind='group'이라도 isFixedTerm=true면 validEndDate+잔여 기준으로 danger를 판정한다", () => {
    const packageGroupCycle: CycleLike = {
      kind: "group",
      enrollmentStatus: "active",
      cycleStatus: "active",
      totalCount: 4,
      usedCount: 0,
      nextDueDate: null,
      validEndDate: "2026-07-13",
      isFixedTerm: true
    };
    expect(isFixedTermCycle(packageGroupCycle)).toBe(true);
    expect(cycleStatus(packageGroupCycle, new Date("2026-07-14T12:00:00+09:00"))).toBe("danger");
  });

  it("kind='group' + isFixedTerm=true는 nextDueDate가 없어도 결제 예정으로 오판하지 않는다", () => {
    const packageGroupCycle: CycleLike = {
      kind: "group",
      enrollmentStatus: "active",
      cycleStatus: "active",
      totalCount: 4,
      usedCount: 1,
      nextDueDate: null,
      validEndDate: "2026-08-01",
      isFixedTerm: true
    };
    expect(cycleStatus(packageGroupCycle, new Date("2026-07-14T12:00:00+09:00"))).toBeNull();
  });
});

describe("한국 날짜 규칙", () => {
  it("UTC 오후가 한국에서는 다음 날짜인 경우 한국 날짜를 반환한다", () => {
    expect(koreaDateString(new Date("2026-07-13T15:30:00.000Z"))).toBe("2026-07-14");
  });

  it("한국 자정부터 오전 9시 사이에도 전날로 바뀌지 않는다", () => {
    expect(koreaDateString(new Date("2026-07-13T16:00:00.000Z"))).toBe("2026-07-14");
    expect(koreaDateString(new Date("2026-07-13T23:59:59.000Z"))).toBe("2026-07-14");
  });

  it("날짜 차이를 시간대가 아닌 달력 날짜로 계산한다", () => {
    expect(daysUntil("2026-07-15", new Date("2026-07-14T00:30:00+09:00"))).toBe(1);
  });
});
