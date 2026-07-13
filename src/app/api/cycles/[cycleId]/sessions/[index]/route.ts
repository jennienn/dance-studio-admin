// src/app/api/cycles/[cycleId]/sessions/[index]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// 잘못 기록한 회차의 날짜/메모를 수정 (완료 상태는 유지)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string; index: string }> }
) {
  const { cycleId, index } = await params;
  const supabase = await createSupabaseServerClient();
  const body = await request.json();
  const sessionIndex = Number(index);

  const { error } = await supabase
    .from("sessions")
    .update({ date: body.date, note: body.note ?? null })
    .eq("cycle_id", cycleId)
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
  { params }: { params: Promise<{ cycleId: string; index: string }> }
) {
  const { cycleId, index } = await params;
  const supabase = await createSupabaseServerClient();
  const sessionIndex = Number(index);

  const { data: newUsed, error: sessionError } = await supabase.rpc("delete_solo_session_atomic", {
    p_cycle_id: cycleId,
    p_session_index: sessionIndex
  });
  if (sessionError) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: sessionError.message } }, { status: 500 });
  }

  return NextResponse.json({ usedCount: newUsed });
}
