import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readBookingToken } from "@/lib/booking-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = readBookingToken((await cookies()).get("booking_session")?.value);
  if (!auth) return NextResponse.json({ error: { message: "다시 로그인해주세요." } }, { status: 401 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("solo_bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("cycle_id", auth.cycleId)
    .eq("member_id", auth.memberId)
    .eq("status", "confirmed")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 500 });
  if (!data) return NextResponse.json({ error: { message: "취소 가능한 예약이 없습니다." } }, { status: 404 });
  return NextResponse.json({ ok: true });
}
