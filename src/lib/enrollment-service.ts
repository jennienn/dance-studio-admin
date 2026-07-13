// src/lib/enrollment-service.ts
//
// enrollment(정체성) + enrollment_cycle(1번째 주기) + payment 생성을 한 번에 처리한다.
// 신규 회원가입(POST /api/members)과 기존 회원의 수강권 추가(POST /api/enrollments)가
// 동일한 절차를 거치므로 이 함수 하나로 단일화한다 — 둘 중 하나만 고쳐서 로직이
// 갈라지는 사고를 막기 위함.
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { calcGroupNextDue, GROUP_FIXED_COUNT } from "@/lib/business-rules";

type Supabase = ReturnType<typeof createSupabaseServerClient>;

export interface EnrollmentCreationInput {
  kind: "solo" | "group";
  plan?: 4 | 8 | 12;
  className?: string;
  scheduleIds?: number[];
  payment: { amount: number; method: "card" | "transfer" | "cash"; paymentDate: string };
}

export type EnrollmentCreationResult =
  | { ok: true; enrollmentId: string; cycleId: string }
  | { ok: false; status: number; code: string; message: string };

export async function createEnrollmentWithCycle(
  supabase: Supabase,
  memberId: number,
  input: EnrollmentCreationInput
): Promise<EnrollmentCreationResult> {
  const paymentDate = new Date(input.payment.paymentDate);

  let classId: number | null = null;
  if (input.kind === "group") {
    const { data: cls, error: clsError } = await supabase
      .from("classes")
      .select("id")
      .eq("name", input.className)
      .single();
    if (clsError || !cls) {
      return { ok: false, status: 422, code: "VALIDATION_ERROR", message: "존재하지 않는 반입니다." };
    }
    classId = cls.id;
  }

  const { data: newEnrollment, error: enrollError } = await supabase
    .from("enrollments")
    .insert({ member_id: memberId, kind: input.kind, class_id: classId })
    .select()
    .single();
  if (enrollError) {
    return { ok: false, status: 500, code: "DB_ERROR", message: enrollError.message };
  }

  const baseCount = input.kind === "solo" ? input.plan! : GROUP_FIXED_COUNT;
  const cycleRow: Record<string, unknown> = {
    enrollment_id: newEnrollment.id,
    plan: input.kind === "solo" ? input.plan : null,
    base_count: baseCount,
    carry_over_count: 0,
    total_count: baseCount,
    used_count: 0,
    payment_date: paymentDate.toISOString().slice(0, 10)
    // valid_end_date, first_class_date: 개인레슨은 첫 수업 기록 시 확정 (지금은 NULL)
  };
  if (input.kind === "group") {
    cycleRow.next_due_date = calcGroupNextDue(paymentDate).toISOString().slice(0, 10);
  }

  const { data: newCycle, error: cycleError } = await supabase
    .from("enrollment_cycles")
    .insert(cycleRow as never)
    .select()
    .single();
  if (cycleError) {
    const isCapacity = cycleError.message.includes("CLASS_CAPACITY_EXCEEDED");
    return {
      ok: false,
      status: isCapacity ? 409 : 500,
      code: isCapacity ? "CLASS_CAPACITY_EXCEEDED" : "DB_ERROR",
      message: cycleError.message
    };
  }

  if (input.kind === "solo") {
    const sessions = Array.from({ length: baseCount }, (_, i) => ({
      cycle_id: newCycle.id,
      session_index: i + 1,
      status: "pending" as const
    }));
    await supabase.from("sessions").insert(sessions);
  }

  if (input.kind === "group" && Array.isArray(input.scheduleIds)) {
    const rows = input.scheduleIds.map((scheduleId: number) => ({ cycle_id: newCycle.id, schedule_id: scheduleId }));
    const { error: scheduleError } = await supabase.from("cycle_schedules").insert(rows);
    if (scheduleError) {
      const isCapacity = scheduleError.message.includes("CLASS_CAPACITY_EXCEEDED");
      return {
        ok: false,
        status: isCapacity ? 409 : 500,
        code: isCapacity ? "CLASS_CAPACITY_EXCEEDED" : "DB_ERROR",
        message: scheduleError.message
      };
    }
  }

  const { error: paymentError } = await supabase.from("payments").insert({
    cycle_id: newCycle.id,
    amount: input.payment.amount,
    method: input.payment.method,
    payment_date: paymentDate.toISOString().slice(0, 10),
    status: "completed"
  });
  if (paymentError) {
    return { ok: false, status: 500, code: "DB_ERROR", message: paymentError.message };
  }

  return { ok: true, enrollmentId: newEnrollment.id, cycleId: newCycle.id };
}
