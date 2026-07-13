// src/app/api/attendance/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();

  const { data: log, error: fetchError } = await supabase
    .from("attendance_logs")
    .select("cycle_id")
    .eq("id", params.id)
    .single();
  if (fetchError || !log) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "출석 기록을 찾을 수 없습니다." } }, { status: 404 });
  }

  await supabase.from("attendance_logs").delete().eq("id", params.id);

  const { data: cycle } = await supabase
    .from("enrollment_cycles")
    .select("used_count")
    .eq("id", log.cycle_id)
    .single();
  await supabase
    .from("enrollment_cycles")
    .update({ used_count: Math.max(0, (cycle?.used_count ?? 1) - 1) })
    .eq("id", log.cycle_id);

  return NextResponse.json({ ok: true });
}
