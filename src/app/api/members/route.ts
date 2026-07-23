// src/app/api/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapEnrollmentRpcError } from "@/lib/enrollment-service";

// 활성 수강권(enrollment.status='active')이 하나도 없는 회원 id 목록.
// PostgREST 임베드 필터는 "하나라도 일치하는 회원"만 걸러낼 수 있고 "전부 불일치"는 표현할 수 없어서,
// 탈퇴 회원(활성 enrollment 0건) 판정은 별도 조회로 활성 회원 id를 먼저 뽑아 제외하는 방식으로 처리한다.
async function fetchActiveMemberIds(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.from("enrollments").select("member_id").eq("status", "active");
  if (error) return { error };
  return { ids: Array.from(new Set((data ?? []).map((row) => row.member_id))) };
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const kind = searchParams.get("kind"); // 'solo' | 'group'
  const statusFilter = searchParams.get("status") === "withdrawn" ? "withdrawn" : "active"; // 'active' | 'withdrawn'
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "10");
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const isKindFilter = kind === "solo" || kind === "group";
  // enrollments 임베드에 걸리는 .eq() 필터는 !inner를 써야 "일치하는 enrollment가 없는 회원"이
  // 최상위 결과에서도 제외된다 (!inner 없이는 nested 배열만 걸러지고 회원 자체는 그대로 남는다).
  const needsInnerJoin = isKindFilter || statusFilter === "active";
  const enrollmentsSelect = needsInnerJoin
    ? "enrollments!inner(id, kind, status, class_id, package_id, classes(name), enrollment_cycles(*))"
    : "enrollments(id, kind, status, class_id, package_id, classes(name), enrollment_cycles(*))";

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

  if (statusFilter === "active") {
    query = query.eq("enrollments.status", "active");
  } else {
    const activeIds = await fetchActiveMemberIds(supabase);
    if (activeIds.error) {
      return NextResponse.json({ error: { code: "DB_ERROR", message: activeIds.error.message } }, { status: 500 });
    }
    if (activeIds.ids.length > 0) {
      query = query.not("id", "in", `(${activeIds.ids.join(",")})`);
    }
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ items: data, total: count, page, pageSize });
}

/**
 * 신규 회원 등록. 결제 정보(payment)가 함께 오면 일반 수강권 또는 스타터 패키지를
 * 회원과 한 트랜잭션으로 만든다.
 * 개인레슨의 valid_end_date는 여기서 확정하지 않는다 — 첫 수업 기록 시점에 확정된다.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
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

  if (enrollment.kind === "package") {
    const { data, error } = await supabase
      .rpc("create_member_with_starter_package_atomic", {
        p_name: name,
        p_phone: phone,
        p_class_name: enrollment.className ?? null,
        p_schedule_ids: enrollment.scheduleIds ?? [],
        p_amount: enrollment.payment.amount,
        p_method: enrollment.payment.method,
        p_payment_date: enrollment.payment.paymentDate
      })
      .single();
    if (error || !data) {
      const failure = mapEnrollmentRpcError(error ?? { message: "DB_ERROR: 생성 결과가 없습니다." });
      return NextResponse.json({ error: { code: failure.code, message: failure.message } }, { status: failure.status });
    }
    const row = data as {
      member_id: number;
      package_id: string;
      solo_enrollment_id: string;
      solo_cycle_id: string;
      group_enrollment_id: string;
      group_cycle_id: string;
    };
    return NextResponse.json(
      {
        memberId: row.member_id,
        packageId: row.package_id,
        soloEnrollmentId: row.solo_enrollment_id,
        soloCycleId: row.solo_cycle_id,
        groupEnrollmentId: row.group_enrollment_id,
        groupCycleId: row.group_cycle_id
      },
      { status: 201 }
    );
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
