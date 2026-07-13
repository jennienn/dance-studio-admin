// src/app/api/enrollments/[id]/end/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { koreaDateString } from "@/lib/business-rules";

// 삭제(DELETE)가 아니라 항상 종료 처리만 한다 — 기록 보존 원칙
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const body = await request.json().catch(() => ({}));
  const today = koreaDateString();

  const { error } = await supabase
    .from("enrollments")
    .update({ status: "ended", ended_date: today, end_reason: body.reason ?? null })
    .eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }

  // 진행 중이던 cycle의 알림톡 상태도 초기화 (더 이상 알림 대상 아님)
  await supabase
    .from("enrollment_cycles")
    .update({ notify_status: "not_required", notify_date: null })
    .eq("enrollment_id", params.id)
    .eq("status", "active");

  return NextResponse.json({ ended: true, endedDate: today });
}
