// src/app/api/members/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("members")
    .select(
      "id, name, phone, enrollments(*, classes(name), enrollment_cycles(*, payments(*), cycle_schedules(schedule_id), attendance_logs(date, attended)))"
    )
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "회원을 찾을 수 없습니다." } }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const body = await request.json();
  const { name, phone } = body ?? {};

  if (!name || !phone) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "이름과 연락처를 입력해주세요." } },
      { status: 422 }
    );
  }

  const { error } = await supabase.from("members").update({ name, phone }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
