// src/app/api/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapEnrollmentRpcError } from "@/lib/enrollment-service";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const kind = searchParams.get("kind"); // 'solo' | 'group'
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "10");
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const isKindFilter = kind === "solo" || kind === "group";
  const enrollmentsSelect = isKindFilter
    ? "enrollments!inner(id, kind, status, class_id, classes(name), enrollment_cycles(*))"
    : "enrollments(id, kind, status, class_id, classes(name), enrollment_cycles(*))";

  let query = supabase
    .from("members")
    .select(`id, name, phone, ${enrollmentsSelect}`, { count: "exact" })
    .order("id", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (isKindFilter) {
    query = query.eq("enrollments.kind", kind);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ items: data, total: count, page, pageSize });
}

/**
 * 신규 회원 등록. 결제 정보(payment)가 함께 오면
 * enrollment(정체성) + enrollment_cycle(1번째 주기) + payment 3건을 한 번에 만든다.
 * 개인레슨의 valid_end_date는 여기서 확정하지 않는다 — 첫 수업 기록 시점에 확정된다.
 */
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient();
  const body = await request.json();
  const { name, phone, enrollment } = body ?? {};

  if (!name || !phone) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "이름과 연락처를 입력해주세요." } },
      { status: 422 }
    );
  }
  if (enrollment && !enrollment.payment) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "결제 정보(금액/수단/결제일)를 입력해주세요." } },
      { status: 422 }
    );
  }

  if (!enrollment) {
    const { data: member, error } = await supabase.from("members").insert({ name, phone }).select("id").single();
    if (error || !member) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: error?.message ?? "회원 생성 실패" } }, { status: 500 });
    }
    return NextResponse.json({ memberId: member.id, enrollmentId: null, cycleId: null }, { status: 201 });
  }

  const { data, error } = await supabase
    .rpc("create_member_with_enrollment_atomic", {
      p_name: name,
      p_phone: phone,
      p_kind: enrollment.kind,
      p_plan: enrollment.kind === "solo" ? enrollment.plan ?? null : null,
      p_class_name: enrollment.kind === "group" ? enrollment.className ?? null : null,
      p_schedule_ids: enrollment.kind === "group" ? enrollment.scheduleIds ?? [] : [],
      p_amount: enrollment.payment.amount,
      p_method: enrollment.payment.method,
      p_payment_date: enrollment.payment.paymentDate
    })
    .single();
  if (error || !data) {
    const failure = mapEnrollmentRpcError(error ?? { message: "DB_ERROR: 생성 결과가 없습니다." });
    return NextResponse.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status });
  }
  const row = data as { member_id: number; enrollment_id: string; cycle_id: string };
  return NextResponse.json(
    { memberId: row.member_id, enrollmentId: row.enrollment_id, cycleId: row.cycle_id },
    { status: 201 }
  );
}
