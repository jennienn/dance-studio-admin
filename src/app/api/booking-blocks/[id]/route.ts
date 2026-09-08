import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: { message: "올바른 차단 일정 ID가 아닙니다." } }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("solo_booking_blocks")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) {
    console.error("Failed to delete booking block", error.code);
    return NextResponse.json({ error: { message: "차단 일정을 삭제하지 못했습니다." } }, { status: 500 });
  }
  if (!count) return NextResponse.json({ error: { message: "차단 일정을 찾을 수 없습니다." } }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
