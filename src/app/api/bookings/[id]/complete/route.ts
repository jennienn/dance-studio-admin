import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sessionIndex } = await request.json().catch(() => ({}));
  if (!Number.isInteger(sessionIndex) || sessionIndex < 1) {
    return NextResponse.json({ error: { message: "처리할 회차를 확인해주세요." } }, { status: 422 });
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("complete_solo_booking_atomic", {
    p_booking_id: id,
    p_session_index: sessionIndex
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" || error.code === "23505" ? 422 : 500;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
  return NextResponse.json({ usedCount: data });
}
