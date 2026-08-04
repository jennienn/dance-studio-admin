import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readBookingToken } from "@/lib/booking-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = readBookingToken((await cookies()).get("booking_session")?.value);
  if (!auth) return NextResponse.json({ error: { message: "다시 로그인해주세요." } }, { status: 401 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("cancel_solo_booking_atomic", {
    p_booking_id: id,
    p_member_id: auth.memberId
  });
  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 500 });
  return NextResponse.json({ ok: true, charged: data });
}
