// src/app/api/cycles/[cycleId]/schedules/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// 기존 요일 조합을 새 조합으로 완전히 교체한다.
export async function POST(request: NextRequest, { params }: { params: Promise<{ cycleId: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { cycleId } = await params;
  const body = await request.json();
  const scheduleIds: number[] = body.scheduleIds ?? [];

  const { error } = await supabase.rpc("replace_cycle_schedules_atomic", {
    p_cycle_id: cycleId,
    p_schedule_ids: scheduleIds
  });
  if (error) {
    const isValidation = error.message.includes("VALIDATION_ERROR") || error.code === "22023";
    return NextResponse.json(
      {
        error: {
          code: isValidation ? "VALIDATION_ERROR" : "DB_ERROR",
          message: error.message
        }
      },
      { status: isValidation ? 422 : 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
