import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { readBookingToken } from "@/lib/booking-session";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

async function getSession() {
  return readBookingToken((await cookies()).get("booking_session")?.value);
}

function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function todayInKorea() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export async function GET(request: NextRequest) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: { message: "다시 로그인해주세요." } }, { status: 401 });

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("enrollment_cycles")
    .select("id,plan,total_count,used_count,payment_date,valid_end_date,status,enrollments!inner(member_id,status,members!inner(name))")
    .eq("id", auth.cycleId)
    .eq("status", "active")
    .single();
  if (error || !data) return NextResponse.json({ error: { message: "수강권을 찾을 수 없습니다." } }, { status: 404 });

  const enrollment = data.enrollments as unknown as { member_id: number; status: string; members: { name: string } };
  if (enrollment.member_id !== auth.memberId || enrollment.status !== "active") {
    return NextResponse.json({ error: { message: "수강권 접근 권한이 없습니다." } }, { status: 403 });
  }

  const duration = data.plan === 4 ? 35 : data.plan === 8 ? 63 : 84;
  const validEndDate = data.valid_end_date ?? addDays(data.payment_date, duration);
  const firstBookableDate = [todayInKorea(), data.payment_date].sort().at(-1)!;
  const date = request.nextUrl.searchParams.get("date");
  let unavailable: number[] = [];

  if (date) {
    const { data: rows } = await db
      .from("solo_bookings")
      .select("start_minute")
      .eq("booking_date", date)
      .eq("status", "confirmed");
    unavailable = (rows ?? []).flatMap((row) => [row.start_minute - 30, row.start_minute, row.start_minute + 30]);
    const day = new Date(`${date}T12:00:00+09:00`).getDay();
    if (day >= 1 && day <= 4) unavailable.push(1170, 1200, 1230);
    if (day === 2 || day === 4) unavailable.push(630, 660, 690);
  }

  const { data: bookings } = await db
    .from("solo_bookings")
    .select("id,booking_date,start_minute,status")
    .eq("cycle_id", auth.cycleId)
    .order("booking_date")
    .order("start_minute");

  return NextResponse.json({
    member: { name: enrollment.members.name },
    cycle: {
      plan: data.plan,
      payment_date: data.payment_date,
      valid_end_date: validEndDate,
      first_bookable_date: firstBookableDate,
      remain: data.total_count - data.used_count
    },
    unavailable: [...new Set(unavailable)],
    bookings: bookings ?? []
  });
}

export async function POST(request: NextRequest) {
  const auth = await getSession();
  if (!auth) return NextResponse.json({ error: { message: "다시 로그인해주세요." } }, { status: 401 });
  const { date, startMinute } = await request.json().catch(() => ({}));
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(startMinute)) {
    return NextResponse.json({ error: { message: "예약 날짜와 시간을 확인해주세요." } }, { status: 422 });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("create_solo_booking_atomic", {
    p_cycle_id: auth.cycleId,
    p_date: date,
    p_start_minute: startMinute
  });
  if (error) {
    const conflict = error.message.includes("CONFLICT") || error.message.includes("OVERLAP") || error.code === "23P01";
    return NextResponse.json(
      { error: { message: conflict ? "이미 예약된 시간이거나 단체수업과 겹칩니다." : error.message } },
      { status: conflict ? 409 : 422 }
    );
  }
  return NextResponse.json({ id: data }, { status: 201 });
}
