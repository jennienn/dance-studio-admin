// src/app/api/cycles/[cycleId]/sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("cycle_id", cycleId)
    .order("session_index");
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ sessions: data });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createSupabaseServerClient();
  const body = await request.json();
  const { sessionIndex, date, expired, note } = body ?? {};

  if (!sessionIndex || !date) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "회차와 날짜는 필수입니다." } },
      { status: 422 }
    );
  }

  const { data: usedCount, error: sessionError } = await supabase.rpc("record_solo_session_atomic", {
    p_cycle_id: cycleId,
    p_session_index: sessionIndex,
    p_date: date,
    p_expired: Boolean(expired),
    p_note: note ?? null
  });
  if (sessionError) {
    // idx_sessions_no_duplicate_date UNIQUE 위반 → 같은 날짜에 이미 다른 회차가 기록된 경우
    const isDuplicate = sessionError.message.includes("duplicate") || sessionError.code === "23505";
    const isNotFound = sessionError.code === "P0002";
    const isValidation = sessionError.code === "22023";
    return NextResponse.json(
      {
        error: {
          code: isDuplicate ? "DUPLICATE_RECORD" : isNotFound ? "NOT_FOUND" : isValidation ? "VALIDATION_ERROR" : "DB_ERROR",
          message: isDuplicate ? "같은 날짜에 이미 기록된 회차가 있습니다." : sessionError.message
        }
      },
      { status: isDuplicate ? 409 : isNotFound ? 404 : isValidation ? 422 : 500 }
    );
  }

  return NextResponse.json({ usedCount });
}
