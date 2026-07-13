// src/app/api/enrollments/[id]/cycles/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calcGroupNextDue, GROUP_FIXED_COUNT } from "@/lib/business-rules";

// 과거·현재 주기 이력 조회 (GET /enrollments/:id/cycles)
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("enrollment_cycles")
    .select("*, payments(*)")
    .eq("enrollment_id", params.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ cycles: data });
}

/**
 * 결제 확인(재등록/재결제) = 기존 cycle을 완료 처리하고 새 cycle을 생성.
 * 개인레슨: 잔여 회차가 새 cycle의 carry_over_count로 이월. plan 재선택.
 * 단체레슨: 잔여 이월 없음, 8회로 새로 시작.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const body = await request.json();

  const { data: enrollment, error: enrollError } = await supabase
    .from("enrollments")
    .select("*, members(id, name, phone)")
    .eq("id", params.id)
    .single();
  if (enrollError || !enrollment) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "수강권을 찾을 수 없습니다." } }, { status: 404 });
  }

  const { data: currentCycle } = await supabase
    .from("enrollment_cycles")
    .select("*")
    .eq("enrollment_id", params.id)
    .eq("status", "active")
    .maybeSingle();

  const paymentDate = new Date(body.payment.paymentDate);
  const carry = currentCycle ? currentCycle.total_count - currentCycle.used_count : 0;

  // 기존 active cycle을 completed로 닫는다 (unique index가 active는 하나만 허용하므로 먼저 닫아야 함)
  if (currentCycle) {
    await supabase.from("enrollment_cycles").update({ status: "completed" }).eq("id", currentCycle.id);
  }

  const baseCount = enrollment.kind === "solo" ? body.plan : GROUP_FIXED_COUNT;
  const newCycleRow: Record<string, unknown> = {
    enrollment_id: params.id,
    plan: enrollment.kind === "solo" ? body.plan : null,
    base_count: baseCount,
    carry_over_count: enrollment.kind === "solo" ? carry : 0,
    total_count: baseCount + (enrollment.kind === "solo" ? carry : 0),
    used_count: 0,
    payment_date: paymentDate.toISOString().slice(0, 10)
  };
  if (enrollment.kind === "group") {
    newCycleRow.next_due_date = calcGroupNextDue(paymentDate).toISOString().slice(0, 10);
  }

  const { data: newCycle, error: cycleError } = await supabase
    .from("enrollment_cycles")
    .insert(newCycleRow as never)
    .select()
    .single();
  if (cycleError) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: cycleError.message } }, { status: 500 });
  }

  if (enrollment.kind === "solo") {
    const sessions = Array.from({ length: newCycleRow.total_count as number }, (_, i) => ({
      cycle_id: newCycle.id,
      session_index: i + 1,
      status: "pending" as const
    }));
    await supabase.from("sessions").insert(sessions);
  }

  // 단체레슨 요일 조합이 이번에 바뀌었을 수 있으므로 새로 받으면 새 cycle에 연결 (없으면 직전과 동일하다고 가정하지 않고 비워둠)
  if (enrollment.kind === "group" && Array.isArray(body.scheduleIds) && body.scheduleIds.length) {
    const rows = body.scheduleIds.map((scheduleId: number) => ({ cycle_id: newCycle.id, schedule_id: scheduleId }));
    const { error: scheduleError } = await supabase.from("cycle_schedules").insert(rows);
    if (scheduleError) {
      const isCapacity = scheduleError.message.includes("CLASS_CAPACITY_EXCEEDED");
      return NextResponse.json(
        { error: { code: isCapacity ? "CLASS_CAPACITY_EXCEEDED" : "DB_ERROR", message: scheduleError.message } },
        { status: isCapacity ? 409 : 500 }
      );
    }
  }

  await supabase.from("payments").insert({
    cycle_id: newCycle.id,
    amount: body.payment.amount,
    method: body.payment.method,
    payment_date: paymentDate.toISOString().slice(0, 10),
    status: "completed"
  });

  // 재등록으로 조건에서 벗어났으니 enrollment도 다시 active 상태로 (종료 후 재등록하는 경우 대비)
  await supabase.from("enrollments").update({ status: "active", ended_date: null, end_reason: null }).eq("id", params.id);

  let notification: "sent" | "failed" | "none" = "none";
  if (body.sendNotification) {
    // TODO: 실제 발송 대행사 연동 전까지는 항상 성공 처리
    notification = "sent";
    const message =
      enrollment.kind === "solo"
        ? `개인레슨 ${newCycleRow.total_count}회로 재등록되었습니다.`
        : `재결제가 완료되었습니다.`;
    await supabase
      .from("enrollment_cycles")
      .update({ notify_status: notification, notify_date: new Date().toISOString() })
      .eq("id", newCycle.id);
    await supabase.from("notifications").insert({
      cycle_id: newCycle.id,
      status: notification,
      message,
      trigger_type: "manual_renew"
    });
  }

  return NextResponse.json({ cycleId: newCycle.id, notification }, { status: 201 });
}
