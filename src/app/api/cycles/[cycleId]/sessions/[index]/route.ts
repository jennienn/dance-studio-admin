// src/app/api/cycles/[cycleId]/sessions/[index]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// 잘못 기록한 회차의 날짜/메모를 수정 (완료 상태는 유지)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { cycleId: string; index: string } }
) {
  const supabase = createSupabaseServerClient();
  const body = await request.json();
  const sessionIndex = Number(params.index);

  const { error } = await supabase
    .from("sessions")
    .update({ date: body.date, note: body.note ?? null })
    .eq("cycle_id", params.cycleId)
    .eq("session_index", sessionIndex);

  if (error) {
    const isDuplicate = error.code === "23505";
    return NextResponse.json(
      {
        error: {
          code: isDuplicate ? "DUPLICATE_RECORD" : "DB_ERROR",
          message: isDuplicate ? "같은 날짜에 이미 기록된 회차가 있습니다." : error.message
        }
      },
      { status: isDuplicate ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

// 기록 취소(되돌리기) — pending으로 되돌리고 잔여 회차를 복원
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { cycleId: string; index: string } }
) {
  const supabase = createSupabaseServerClient();
  const sessionIndex = Number(params.index);

  const { error: sessionError } = await supabase
    .from("sessions")
    .update({ date: null, status: "pending", note: null })
    .eq("cycle_id", params.cycleId)
    .eq("session_index", sessionIndex);
  if (sessionError) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: sessionError.message } }, { status: 500 });
  }

  const { data: cycle } = await supabase.from("enrollment_cycles").select("*").eq("id", params.cycleId).single();
  const newUsed = Math.max(0, (cycle?.used_count ?? 1) - 1);
  const update: Record<string, unknown> = { used_count: newUsed };

  // 취소한 결과 이 주기에 완료된 회차가 하나도 없으면, 첫 수업일/유효기간도 다시 미확정 상태로 되돌린다
  if (newUsed === 0) {
    update.first_class_date = null;
    update.valid_end_date = null;
  }

  await supabase.from("enrollment_cycles").update(update).eq("id", params.cycleId);
  return NextResponse.json({ usedCount: newUsed });
}
