import { NextRequest, NextResponse } from "next/server";
import { createBookingToken } from "@/lib/booking-session";
import { isValidMemberPhone } from "@/lib/phone";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type Cycle = {
  id: string;
  plan: number;
  total_count: number;
  used_count: number;
  payment_date: string;
  valid_end_date: string | null;
  status: string;
};

export async function POST(request: NextRequest) {
  const { name, phone } = await request.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim() || !isValidMemberPhone(phone)) {
    return NextResponse.json({ error: { message: "이름과 연락처를 확인해주세요." } }, { status: 422 });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("members")
    .select("id,enrollments(id,kind,status,enrollment_cycles(id,plan,total_count,used_count,payment_date,valid_end_date,status))")
    .eq("name", name.trim())
    .eq("phone", phone)
    .maybeSingle();
  if (error) return NextResponse.json({ error: { message: "회원 정보를 확인하지 못했습니다." } }, { status: 500 });

  const enrollments = (data?.enrollments ?? []) as unknown as { kind: string; status: string; enrollment_cycles: Cycle[] }[];
  const cycle = enrollments
    .filter((enrollment) => enrollment.kind === "solo" && enrollment.status === "active")
    .flatMap((enrollment) => enrollment.enrollment_cycles)
    .find((candidate) => candidate.status === "active" && candidate.total_count > candidate.used_count);
  if (!data || !cycle) {
    return NextResponse.json({ error: { message: "이용 중인 개인레슨 수강권을 찾을 수 없습니다." } }, { status: 401 });
  }

  let token: string;
  try {
    token = createBookingToken(data.id, cycle.id);
  } catch {
    return NextResponse.json({ error: { message: "예약 서비스 설정을 확인해주세요." } }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("booking_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 43_200
  });
  return response;
}
