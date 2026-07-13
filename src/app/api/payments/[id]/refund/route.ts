// src/app/api/payments/[id]/refund/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * 환불 처리. body: { amount, note? }
 *
 * TODO (정책 확정 대기 중 — 요구사항명세서 확인 필요):
 * - 환불된 결제가 속한 enrollment_cycle을 어떻게 처리할지 (예: 8회 중 3회 사용 후 환불 시
 *   남은 5회를 자동으로 종료 처리할지, 운영자가 수강 종료를 별도로 눌러야 하는지)
 * - 사용한 회차만큼 차감한 부분 환불 금액을 시스템이 자동 계산해줄지, 운영자가 직접 입력할지
 * 지금은 payments 테이블에 환불 금액/상태만 기록하고, cycle 상태는 건드리지 않는다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const body = await request.json();
  const { amount, note } = body ?? {};

  if (!amount || amount <= 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "환불 금액을 입력해주세요." } },
      { status: 422 }
    );
  }

  const { data: payment, error: fetchError } = await supabase
    .from("payments")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError || !payment) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "결제 내역을 찾을 수 없습니다." } }, { status: 404 });
  }

  const status = amount >= payment.amount ? "refunded" : "partially_refunded";

  const { error } = await supabase
    .from("payments")
    .update({ status, refunded_amount: amount, note: note ?? payment.note })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status });
}
