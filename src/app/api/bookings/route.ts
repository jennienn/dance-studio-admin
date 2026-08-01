import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: { message: "조회 날짜를 확인해주세요." } }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("solo_bookings")
    .select("id,booking_date,start_minute,status,cycle_id,enrollment_cycles!inner(plan,total_count,used_count,enrollments!inner(members!inner(name,phone)))")
    .eq("booking_date", date)
    .in("status", ["confirmed", "completed"])
    .order("start_minute");
  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 500 });

  const bookings = (data ?? []).map((row) => {
    const cycle = row.enrollment_cycles as unknown as {
      plan: number;
      total_count: number;
      used_count: number;
      enrollments: { members: { name: string; phone: string } };
    };
    return {
      id: row.id,
      cycleId: row.cycle_id,
      startMinute: row.start_minute,
      status: row.status,
      plan: cycle.plan,
      remain: cycle.total_count - cycle.used_count,
      name: cycle.enrollments.members.name,
      phone: cycle.enrollments.members.phone
    };
  });
  return NextResponse.json({ bookings });
}
