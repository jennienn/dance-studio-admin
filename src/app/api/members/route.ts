// src/app/api/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createEnrollmentWithCycle } from "@/lib/enrollment-service";

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

  const { data: member, error: memberError } = await supabase
    .from("members")
    .insert({ name, phone })
    .select()
    .single();
  if (memberError) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: memberError.message } }, { status: 500 });
  }

  let enrollmentId: string | null = null;
  let cycleId: string | null = null;

  if (enrollment) {
    const result = await createEnrollmentWithCycle(supabase, member.id, enrollment);
    if (!result.ok) {
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    }
    enrollmentId = result.enrollmentId;
    cycleId = result.cycleId;

    // TODO: enrollment.sendNotification === true 인 경우 알림톡 발송 (실연동 전까지는 등록 알림은 생략,
    // 결제필요/재등록 알림톡만 자동발송 대상이라는 점을 요구사항명세서에서 재확인할 것)
  }

  return NextResponse.json({ memberId: member.id, enrollmentId, cycleId }, { status: 201 });
}
