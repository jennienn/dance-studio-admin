// src/lib/business-rules.ts
//
// 결제 필요 여부 / 알림톡 발송 대상 여부를 판정하는 단일 기준.
// v2: "수강권(enrollment)"이 아니라 "주기(enrollment_cycle)" 단위로 판정한다.
// 재등록/재결제할 때마다 새 cycle이 생기고, 판정은 항상 해당 enrollment의
// status='active'인 cycle 하나를 대상으로 한다.
// 이 파일의 함수 결과만을 신뢰해야 하며, 프론트엔드는 이 로직을 다시 구현하지 않는다.

export type EnrollmentKind = "solo" | "group";

export interface CycleLike {
  kind: EnrollmentKind;
  enrollmentStatus: "active" | "ended"; // 부모 enrollment의 상태
  cycleStatus: "active" | "completed" | "expired";
  // solo
  plan?: 4 | 8 | 12 | null;
  totalCount: number;
  usedCount: number;
  validEndDate?: string | null; // ISO date, 첫 수업 전이면 null
  // group
  nextDueDate?: string | null; // ISO date
}

export const WEEKS_BY_PLAN: Record<4 | 8 | 12, number> = {
  4: 5,
  8: 9,
  12: 12
};

export const GROUP_RENEWAL_WEEKS = 5;
export const GROUP_FIXED_COUNT = 8;

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

export function daysUntil(target: string | Date, today: Date = new Date()): number {
  const t = typeof target === "string" ? new Date(target) : target;
  const msPerDay = 1000 * 60 * 60 * 24;
  const a = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

export function remainOf(c: Pick<CycleLike, "totalCount" | "usedCount">): number {
  return c.totalCount - c.usedCount;
}

export type StatusResult = "danger" | null;

/**
 * "결제 필요" 판정.
 * - enrollment가 이미 종료(ended)됐거나 cycle이 active가 아니면 항상 제외
 * - 개인레슨: 첫 수업 전(validEndDate가 아직 null)이면 유효기간 판단을 보류 — 잔여 1회 이하 조건만 본다
 *   (요구사항명세서 v1.1: "첫 수업일이 정해지지 않은 경우 유효기간 종료일도 미정으로 둔다")
 * - 개인레슨(첫 수업 이후): 유효기간이 지났거나, 잔여 1회 이하
 * - 단체레슨: 재결제 예정일까지 7일 이하로 남음(이미 지난 경우 포함)
 */
export function cycleStatus(c: CycleLike, today: Date = new Date()): StatusResult {
  if (c.enrollmentStatus === "ended" || c.cycleStatus !== "active") return null;

  if (c.kind === "solo") {
    if (c.validEndDate && daysUntil(c.validEndDate, today) < 0) return "danger";
    return remainOf(c) <= 1 ? "danger" : null;
  }

  if (!c.nextDueDate) return null;
  return daysUntil(c.nextDueDate, today) <= 7 ? "danger" : null;
}

/**
 * 알림톡 자동발송 대상 여부. 반드시 cycleStatus와 동일한 기준을 사용한다.
 */
export function isNotificationEligible(c: CycleLike, today: Date = new Date()): boolean {
  return cycleStatus(c, today) === "danger";
}

export interface StatusText {
  text: string;
  tone: "danger" | "warning" | "muted";
}

export function soloStatusText(c: CycleLike, today: Date = new Date()): StatusText {
  if (!c.validEndDate) {
    return { text: "첫 수업 전", tone: "muted" };
  }
  if (daysUntil(c.validEndDate, today) < 0) {
    return { text: "이용기간 만료", tone: "danger" };
  }
  const remain = remainOf(c);
  if (remain <= 0) return { text: "잔여 0회", tone: "danger" };
  if (remain === 1) return { text: "잔여 1회", tone: "warning" };
  return { text: `잔여 ${remain}회`, tone: "muted" };
}

export function groupStatusText(c: CycleLike, today: Date = new Date()): StatusText {
  if (!c.nextDueDate) return { text: "-", tone: "muted" };
  const d = daysUntil(c.nextDueDate, today);
  if (d < 0) return { text: `${-d}일 지남`, tone: "danger" };
  if (d === 0) return { text: "오늘 결제 예정", tone: "danger" };
  if (d <= 7) return { text: `결제 D-${d}`, tone: "warning" };
  return { text: "결제 예정", tone: "muted" };
}

/**
 * 개인레슨 "첫 수업 기록" 시점에 유효기간을 확정한다.
 * 등록/재등록 시점이 아니라, 실제 1회차 수업 날짜가 기록되는 순간 호출해야 한다.
 */
export function calcSoloValidEnd(firstClassDate: Date, plan: 4 | 8 | 12): Date {
  return addWeeks(firstClassDate, WEEKS_BY_PLAN[plan]);
}

/** 단체레슨 결제 시 다음 결제 예정일 계산 */
export function calcGroupNextDue(paymentDate: Date): Date {
  return addWeeks(paymentDate, GROUP_RENEWAL_WEEKS);
}

/** 알림톡 문구 템플릿 — 카카오 템플릿 심사 등록 시 이 문구를 그대로 사용할 것 */
export function buildNotificationMessage(c: CycleLike & { className?: string | null }): string {
  if (c.kind === "solo") {
    return `현재 ${c.totalCount}회 중 1회 남았습니다. 재등록 원하시면 재결제 부탁드립니다.`;
  }
  return `${c.className ?? "수업"} 수강 기간이 1주일 남았습니다. 재등록 원하시면 1주일 이내에 결제 부탁드립니다.`;
}
