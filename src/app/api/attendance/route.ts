// src/app/api/attendance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cycleStatus, type CycleLike } from "@/lib/business-rules";

// 반+날짜 기준으로 해당 반 소속 회원(active cycle) 목록과, 그날 이미 체크된 출석 여부를 함께 내려준다.
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { searchParams } = new URL(request.url);
  const className = searchParams.get("className");
  const date = searchParams.get("date");

  if (!className || !date) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "className, date는 필수입니다." } },
      { status: 422 }
    );
  }

  const { data: cls } = await supabase.from("classes").select("id").eq("name", className).single();
  if (!cls) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "반을 찾을 수 없습니다." } }, { status: 404 });
  }

  const { data: cycles, error } = await supabase
    .from("enrollment_cycles")
    .select(
      "*, enrollments!inner(id, status, class_id, package_id, members(id, name)), cycle_schedules(schedule_id), attendance_logs(id, schedule_id, date, attended)"
    )
    .eq("status", "active")
    .eq("enrollments.status", "active")
    .eq("enrollments.class_id", cls.id);

  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }

  const items = (cycles ?? []).map((c: any) => {
    const scheduleIds: number[] = c.cycle_schedules.map((cs: any) => cs.schedule_id);
    const todayLog = c.attendance_logs.find((a: any) => a.date === date);
    const like: CycleLike = {
      kind: "group",
      enrollmentStatus: c.enrollments.status,
      cycleStatus: c.status,
      totalCount: c.total_count,
      usedCount: c.used_count,
      validEndDate: c.valid_end_date,
      nextDueDate: c.next_due_date,
      isFixedTerm: c.enrollments.package_id != null
    };
    return {
      cycleId: c.id,
      memberId: c.enrollments.members.id,
      memberName: c.enrollments.members.name,
      remain: c.total_count - c.used_count,
      total: c.total_count,
      scheduleIds,
      attendanceLogId: todayLog?.id ?? null,
      attended: todayLog?.attended ?? false,
      needsPayment: cycleStatus(like) === "danger"
    };
  });

  return NextResponse.json({ items });
}

/**
 * 출석 일괄 저장. records: [{ cycleId, scheduleId, attended }]
 * attended=true로 새로 체크되면 잔여 회차 1 차감, attended=false로 되돌리면 복원.
 * (cycle_id, schedule_id, date) UNIQUE라서 같은 날 중복 출석은 DB가 자체적으로 막아준다.
 */
export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const body = await request.json();
  const { date, records } = body ?? {};

  if (!date || !Array.isArray(records)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "date, records는 필수입니다." } },
      { status: 422 }
    );
  }

  const { data: processed, error } = await supabase.rpc("save_attendance_atomic", {
    p_date: date,
    p_records: records
  });
  if (error) {
    const isValidation = error.code === "22023" || error.message.includes("VALIDATION_ERROR");
    return NextResponse.json(
      { error: { code: isValidation ? "VALIDATION_ERROR" : "DB_ERROR", message: error.message } },
      { status: isValidation ? 422 : 500 }
    );
  }
  return NextResponse.json({ processedCount: processed });
}
