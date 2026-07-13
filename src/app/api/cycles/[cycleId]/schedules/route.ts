// src/app/api/cycles/[cycleId]/schedules/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// 기존 요일 조합을 새 조합으로 완전히 교체한다 (정원 검증은 DB 트리거가 insert 시점에 수행)
export async function POST(request: NextRequest, { params }: { params: { cycleId: string } }) {
  const supabase = createSupabaseServerClient();
  const body = await request.json();
  const scheduleIds: number[] = body.scheduleIds ?? [];

  await supabase.from("cycle_schedules").delete().eq("cycle_id", params.cycleId);

  if (scheduleIds.length) {
    const rows = scheduleIds.map((scheduleId) => ({ cycle_id: params.cycleId, schedule_id: scheduleId }));
    const { error } = await supabase.from("cycle_schedules").insert(rows);
    if (error) {
      const isCapacity = error.message.includes("CLASS_CAPACITY_EXCEEDED");
      return NextResponse.json(
        { error: { code: isCapacity ? "CLASS_CAPACITY_EXCEEDED" : "DB_ERROR", message: error.message } },
        { status: isCapacity ? 409 : 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
