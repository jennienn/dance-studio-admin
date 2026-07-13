import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createSupabaseServerClient>;

export interface EnrollmentCreationInput {
  kind: "solo" | "group";
  plan?: 4 | 8 | 12;
  className?: string;
  scheduleIds?: number[];
  payment: { amount: number; method: "card" | "transfer" | "cash"; paymentDate: string };
}

export interface EnrollmentCreationFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type EnrollmentCreationResult =
  | { ok: true; enrollmentId: string; cycleId: string }
  | EnrollmentCreationFailure;

interface AtomicEnrollmentRow {
  enrollment_id: string;
  cycle_id: string;
}

function rpcFailure(error: { message: string; code?: string }): EnrollmentCreationFailure {
  const isCapacity = error.message.includes("CLASS_CAPACITY_EXCEEDED");
  const isValidation = error.message.includes("VALIDATION_ERROR") || error.code === "22023";
  return {
    ok: false,
    status: isCapacity ? 409 : isValidation ? 422 : 500,
    code: isCapacity ? "CLASS_CAPACITY_EXCEEDED" : isValidation ? "VALIDATION_ERROR" : "DB_ERROR",
    message: error.message
  };
}

export async function createEnrollmentWithCycle(
  supabase: Supabase,
  memberId: number,
  input: EnrollmentCreationInput
): Promise<EnrollmentCreationResult> {
  const { data, error } = await supabase
    .rpc("create_enrollment_with_cycle_atomic", {
      p_member_id: memberId,
      p_kind: input.kind,
      p_plan: input.kind === "solo" ? input.plan ?? null : null,
      p_class_name: input.kind === "group" ? input.className ?? null : null,
      p_schedule_ids: input.kind === "group" ? input.scheduleIds ?? [] : [],
      p_amount: input.payment.amount,
      p_method: input.payment.method,
      p_payment_date: input.payment.paymentDate
    })
    .single();

  if (error || !data) return rpcFailure(error ?? { message: "DB_ERROR: 생성 결과가 없습니다." });
  const row = data as AtomicEnrollmentRow;
  return { ok: true, enrollmentId: row.enrollment_id, cycleId: row.cycle_id };
}

export function mapEnrollmentRpcError(error: { message: string; code?: string }): EnrollmentCreationFailure {
  return rpcFailure(error);
}
