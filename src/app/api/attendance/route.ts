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
  const month = searchParams.get("month");

  if (!className || (!date && !month)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "className과 date 또는 month는 필수입니다." } },
      { status: 422 }
    );
  }
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "month 형식을 확인해주세요." } }, { status: 422 });
  }

  const { data: cls } = await supabase.from("classes").select("id").eq("name", className).single();
  if (!cls) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "반을 찾을 수 없습니다." } }, { status: 404 });
  }

  if (month) {
    const [{ data: schedules, error: schedulesError }, { data: monthCycles, error: cyclesError }] = await Promise.all([
      supabase.from("class_schedules").select("id,weekday").eq("class_id", cls.id),
      supabase
        .from("enrollment_cycles")
        .select("cycle_schedules(schedule_id), enrollments!inner(status,class_id)")
        .eq("status", "active")
        .eq("enrollments.status", "active")
        .eq("enrollments.class_id", cls.id)
    ]);
    if (schedulesError || cyclesError) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: schedulesError?.message ?? cyclesError?.message } },
        { status: 500 }
      );
    }
    const scheduleIdsByWeekday = new Map<number, Set<number>>();
    for (const schedule of schedules ?? []) {
      const ids = scheduleIdsByWeekday.get(schedule.weekday) ?? new Set<number>();
      ids.add(schedule.id);
      scheduleIdsByWeekday.set(schedule.weekday, ids);
    }
    const cycleScheduleIds = (monthCycles ?? []).map((cycle) =>
      new Set((cycle.cycle_schedules as { schedule_id: number }[]).map((item) => item.schedule_id))
    );
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const dateCounts: Record<string, number> = {};
    for (let day = 1; day <= lastDay; day += 1) {
      const weekday = new Date(year, monthNumber - 1, day).getDay();
      const scheduleIds = scheduleIdsByWeekday.get(weekday);
      if (!scheduleIds) continue;
      const key = `${month}-${String(day).padStart(2, "0")}`;
      dateCounts[key] = cycleScheduleIds.filter((ids) => [...scheduleIds].some((id) => ids.has(id))).length;
    }
    return NextResponse.json({ dateCounts });
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
