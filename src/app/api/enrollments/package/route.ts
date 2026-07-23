// src/app/api/enrollments/package/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createStarterPackage } from "@/lib/enrollment-service";

/**
 * 스타터 패키지(개인레슨 2회 + 단체레슨 4회) 신규 구매.
 * 재등록(만료 후 재결제)은 이번 범위에 포함하지 않는다 — 항상 신규 생성만 지원.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const body = await request.json();
  const { memberId, className, scheduleIds, payment } = body ?? {};

  if (!memberId || !className || !Array.isArray(scheduleIds) || scheduleIds.length === 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "회원, 반, 요일을 확인해주세요." } },
      { status: 422 }
    );
  }
  if (!payment) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "결제 정보(금액/수단/결제일)를 입력해주세요." } },
      { status: 422 }
    );
  }

  const result = await createStarterPackage(supabase, memberId, { className, scheduleIds, payment });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  }

  return NextResponse.json(
    {
      packageId: result.packageId,
      soloEnrollmentId: result.soloEnrollmentId,
      soloCycleId: result.soloCycleId,
      groupEnrollmentId: result.groupEnrollmentId,
      groupCycleId: result.groupCycleId
    },
    { status: 201 }
  );
}
