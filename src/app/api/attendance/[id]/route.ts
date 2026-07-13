// src/app/api/attendance/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.rpc("delete_attendance_atomic", { p_attendance_id: Number(params.id) });
  if (error?.code === "P0002") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "출석 기록을 찾을 수 없습니다." } }, { status: 404 });
  }
  if (error) return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });

  return NextResponse.json({ ok: true });
}
