// src/app/api/cycles/[cycleId]/sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calcSoloValidEnd } from "@/lib/business-rules";

export async function GET(_request: NextRequest, { params }: { params: { cycleId: string } }) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("cycle_id", params.cycleId)
    .order("session_index");
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ sessions: data });
}

export async function POST(request: NextRequest, { params }: { params: { cycleId: string } }) {
  const supabase = createSupabaseServerClient();
  const body = await request.json();
  const { sessionIndex, date, expired, note } = body ?? {};

  if (!sessionIndex || !date) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "회차와 날짜는 필수입니다." } },
      { status: 422 }
    );
  }

  const { data: cycle, error: cycleFetchError } = await supabase
    .from("enrollment_cycles")
    .select("*")
    .eq("id", params.cycleId)
    .single();
  if (cycleFetchError || !cycle) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "주기를 찾을 수 없습니다." } }, { status: 404 });
  }

  const { error: sessionError } = await supabase
    .from("sessions")
    .update({ date, status: expired ? "auto" : "done", note: note ?? null })
    .eq("cycle_id", params.cycleId)
    .eq("session_index", sessionIndex);

  if (sessionError) {
    // idx_sessions_no_duplicate_date UNIQUE 위반 → 같은 날짜에 이미 다른 회차가 기록된 경우
    const isDuplicate = sessionError.message.includes("duplicate") || sessionError.code === "23505";
    return NextResponse.json(
      {
        error: {
          code: isDuplicate ? "DUPLICATE_RECORD" : "DB_ERROR",
          message: isDuplicate ? "같은 날짜에 이미 기록된 회차가 있습니다." : sessionError.message
        }
      },
      { status: isDuplicate ? 409 : 500 }
    );
  }

  const update: Record<string, unknown> = { used_count: cycle.used_count + 1 };

  // 이번이 이 주기의 첫 기록(=최초 done/auto)이면 첫 수업일과 유효기간을 여기서 확정한다
  if (cycle.used_count === 0 && cycle.plan) {
    update.first_class_date = date;
    update.valid_end_date = calcSoloValidEnd(new Date(date), cycle.plan).toISOString().slice(0, 10);
  }

  const { error: updateError } = await supabase.from("enrollment_cycles").update(update).eq("id", params.cycleId);
  if (updateError) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: updateError.message } }, { status: 500 });
  }

  return NextResponse.json({ usedCount: update.used_count });
}
