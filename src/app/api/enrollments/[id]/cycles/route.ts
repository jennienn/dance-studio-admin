import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapEnrollmentRpcError } from "@/lib/enrollment-service";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("enrollment_cycles")
    .select("*, payments(*)")
    .eq("enrollment_id", params.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  return NextResponse.json({ cycles: data });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const body = await request.json();
  if (!body?.payment) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "결제 정보를 입력해주세요." } },
      { status: 422 }
    );
  }

  const { data, error } = await supabase
    .rpc("renew_enrollment_atomic", {
      p_enrollment_id: params.id,
      p_plan: body.plan ?? null,
      p_schedule_ids: Array.isArray(body.scheduleIds) ? body.scheduleIds : [],
      p_amount: body.payment.amount,
      p_method: body.payment.method,
      p_payment_date: body.payment.paymentDate
    })
    .single();
  if (error || !data) {
    const failure = mapEnrollmentRpcError(error ?? { message: "DB_ERROR: 재등록 결과가 없습니다." });
    const status = error?.code === "P0002" ? 404 : failure.status;
    return NextResponse.json({ error: { code: status === 404 ? "NOT_FOUND" : failure.code, message: failure.message } }, { status });
  }

  const row = data as { cycle_id: string; total_count: number };
  let notification: "sent" | "failed" | "none" = "none";
  if (body.sendNotification) {
    notification = "sent";
    const { data: enrollment } = await supabase.from("enrollments").select("kind").eq("id", params.id).single();
    const message =
      enrollment?.kind === "solo"
        ? `개인레슨 ${row.total_count}회로 재등록되었습니다.`
        : "재결제가 완료되었습니다.";
    await supabase
      .from("enrollment_cycles")
      .update({ notify_status: notification, notify_date: new Date().toISOString() })
      .eq("id", row.cycle_id);
    await supabase.from("notifications").insert({
      cycle_id: row.cycle_id,
      status: notification,
      message,
      trigger_type: "manual_renew"
    });
  }
  return NextResponse.json({ cycleId: row.cycle_id, totalCount: row.total_count, notification }, { status: 201 });
}
