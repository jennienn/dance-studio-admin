import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { addCalendarDays, koreaDateString, WEEKS_BY_PLAN } from "../src/lib/business-rules";

interface DemoEnvironment {
  url: string;
  serviceRoleKey: string;
  hostname: string;
}

interface ClassSchedule {
  id: number;
  weekday: number;
}

interface DemoClass {
  id: number;
  name: string;
  capacity: number;
  class_schedules: ClassSchedule[];
}

interface AtomicEnrollmentRow {
  enrollment_id: string;
  cycle_id: string;
}

interface AtomicPackageRow {
  package_id: string;
  solo_cycle_id: string;
  group_cycle_id: string;
}

const execute = process.argv.includes("--execute");
const today = koreaDateString();
const createdMemberIds: number[] = [];
let memberSequence = 0;

function loadEnvironment(): DemoEnvironment {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const loaded = loadDotenv({ path: envPath, override: true });
  if (loaded.error || !loaded.parsed) throw new Error(".env.local을 읽을 수 없습니다.");

  const url = loaded.parsed.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = loaded.parsed.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceRoleKey) throw new Error("Supabase URL 또는 service role key가 없습니다.");

  const parsed = new URL(url);
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    throw new Error("이 스크립트는 배포용 Supabase 전용입니다. localhost 실행을 중단합니다.");
  }
  if (!parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("supabase.co 프로젝트가 아닌 URL입니다.");
  }
  return { url, serviceRoleKey, hostname: parsed.hostname };
}

function failOnError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function createMember(client: SupabaseClient, scenario: string): Promise<number> {
  memberSequence += 1;
  const phoneSuffix = String(memberSequence).padStart(3, "0");
  const { data, error } = await client
    .from("members")
    .insert({ name: `테스트회원_${scenario}`, phone: `000-DEMO-${phoneSuffix}` })
    .select("id")
    .single();
  failOnError(error, `${scenario} 회원 생성 실패`);
  const memberId = data!.id as number;
  createdMemberIds.push(memberId);
  return memberId;
}

async function createEnrollment(
  client: SupabaseClient,
  memberId: number,
  input:
    | { kind: "solo"; plan: 4 | 8 | 12; paymentDate: string; amount: number }
    | { kind: "group"; className: string; scheduleIds: number[]; paymentDate: string; amount: number }
): Promise<AtomicEnrollmentRow> {
  const { data, error } = await client
    .rpc("create_enrollment_with_cycle_atomic", {
      p_member_id: memberId,
      p_kind: input.kind,
      p_plan: input.kind === "solo" ? input.plan : null,
      p_class_name: input.kind === "group" ? input.className : null,
      p_schedule_ids: input.kind === "group" ? input.scheduleIds : [],
      p_amount: input.amount,
      p_method: "card",
      p_payment_date: input.paymentDate
    })
    .single();
  failOnError(error, "수강 생성 실패");
  return data as AtomicEnrollmentRow;
}

async function recordSoloSessions(
  client: SupabaseClient,
  cycleId: string,
  firstDate: string,
  usedCount: number
) {
  for (let index = 1; index <= usedCount; index += 1) {
    const { error } = await client.rpc("record_solo_session_atomic", {
      p_cycle_id: cycleId,
      p_session_index: index,
      p_date: addCalendarDays(firstDate, index - 1),
      p_expired: false,
      p_note: "데모 데이터"
    });
    failOnError(error, `${index}회차 기록 실패`);
  }
}

async function createSoloScenario(
  client: SupabaseClient,
  scenario: string,
  plan: 4 | 8 | 12,
  options: { firstDate?: string; usedCount?: number; ended?: boolean } = {}
) {
  const memberId = await createMember(client, scenario);
  const paymentDate = options.firstDate ? addCalendarDays(options.firstDate, -7) : today;
  const row = await createEnrollment(client, memberId, {
    kind: "solo",
    plan,
    paymentDate,
    amount: plan * 50_000
  });
  if (options.firstDate && options.usedCount) {
    await recordSoloSessions(client, row.cycle_id, options.firstDate, options.usedCount);
  }
  if (options.ended) {
    failOnError(
      (
        await client
          .from("enrollment_cycles")
          .update({ status: "expired" })
          .eq("id", row.cycle_id)
      ).error,
      "만료 cycle 처리 실패"
    );
    failOnError(
      (
        await client
          .from("enrollments")
          .update({ status: "ended", ended_date: today, end_reason: "데모: 기간 만료" })
          .eq("id", row.enrollment_id)
      ).error,
      "만료 수강 처리 실패"
    );
  }
  return row;
}

async function createRenewedSoloScenario(client: SupabaseClient) {
  const memberId = await createMember(client, "개인_재등록이력_이월1회");
  const oldFirstDate = addCalendarDays(today, -42);
  const old = await createEnrollment(client, memberId, {
    kind: "solo",
    plan: 4,
    paymentDate: addCalendarDays(oldFirstDate, -7),
    amount: 200_000
  });
  await recordSoloSessions(client, old.cycle_id, oldFirstDate, 3);
  const { error } = await client.rpc("renew_enrollment_atomic", {
    p_enrollment_id: old.enrollment_id,
    p_plan: 4,
    p_schedule_ids: [],
    p_amount: 200_000,
    p_method: "transfer",
    p_payment_date: today
  });
  failOnError(error, "개인 재등록 생성 실패");
}

async function createGroupScenario(
  client: SupabaseClient,
  demoClass: DemoClass,
  scenario: string,
  scheduleIds: number[],
  options: { paymentDaysAgo?: number; attendanceCount?: number } = {}
) {
  const memberId = await createMember(client, scenario);
  const paymentDate = addCalendarDays(today, -(options.paymentDaysAgo ?? 0));
  const row = await createEnrollment(client, memberId, {
    kind: "group",
    className: demoClass.name,
    scheduleIds,
    paymentDate,
    amount: 160_000
  });

  const attendanceCount = options.attendanceCount ?? 0;
  for (let index = attendanceCount; index > 0; index -= 1) {
    const scheduleId = scheduleIds[(attendanceCount - index) % scheduleIds.length];
    const { error } = await client.rpc("save_attendance_atomic", {
      p_date: addCalendarDays(today, -(index * 7)),
      p_records: [{ cycleId: row.cycle_id, scheduleId, attended: true }]
    });
    failOnError(error, `${scenario} 출석 생성 실패`);
  }
}

async function createStarterPackageScenario(client: SupabaseClient, demoClass: DemoClass, scheduleId: number) {
  const memberId = await createMember(client, "스타터패키지_개인2회_단체4회");
  const { data, error } = await client
    .rpc("create_starter_package_atomic", {
      p_member_id: memberId,
      p_class_name: demoClass.name,
      p_schedule_ids: [scheduleId],
      p_amount: 250_000,
      p_method: "card",
      p_payment_date: addCalendarDays(today, -7)
    })
    .single();
  failOnError(error, "스타터 패키지 생성 실패");
  const row = data as AtomicPackageRow;
  const { error: attendanceError } = await client.rpc("save_attendance_atomic", {
    p_date: addCalendarDays(today, -5),
    p_records: [{ cycleId: row.group_cycle_id, scheduleId, attended: true }]
  });
  failOnError(attendanceError, "스타터 패키지 출석 생성 실패");
}

async function countRows(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  failOnError(error, `${table} 개수 조회 실패`);
  return count ?? 0;
}

async function cleanupCreatedMembers(client: SupabaseClient) {
  if (createdMemberIds.length === 0) return;
  const { error } = await client.from("members").delete().in("id", createdMemberIds);
  failOnError(error, "실패 후 생성 데이터 정리 실패");
}

async function main() {
  const env = loadEnvironment();
  const client = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
  const [{ data: classes, error: classError }, memberCount, enrollmentCount] = await Promise.all([
    client
      .from("classes")
      .select("id, name, capacity, class_schedules(id, weekday)")
      .eq("active", true)
      .order("id"),
    countRows(client, "members"),
    countRows(client, "enrollments")
  ]);
  failOnError(classError, "반 조회 실패");

  const demoClasses = (classes ?? []) as DemoClass[];
  if (demoClasses.length < 2 || demoClasses.some((item) => item.class_schedules.length < 2)) {
    throw new Error("활성 반 2개와 각 반의 요일 2개 이상이 필요합니다.");
  }

  console.info(`[demo-seed] 대상: ${env.hostname}`);
  console.info(`[demo-seed] 삭제 예정: 회원 ${memberCount}명, 수강 ${enrollmentCount}건`);
  console.info(`[demo-seed] 유지할 반: ${demoClasses.map((item) => `${item.name}(정원 ${item.capacity})`).join(", ")}`);
  if (!execute) {
    console.info("[demo-seed] 미리보기 완료. 실제 실행은 --execute가 필요합니다.");
    return;
  }
  if (process.env.ALLOW_PRODUCTION_DEMO_SEED !== "true") {
    throw new Error("실행하려면 ALLOW_PRODUCTION_DEMO_SEED=true가 필요합니다.");
  }

  const { error: deleteError } = await client.from("members").delete().gte("id", 0);
  failOnError(deleteError, "기존 회원 전체 삭제 실패");
  if ((await countRows(client, "members")) !== 0) throw new Error("기존 회원 삭제 검증 실패");

  const [firstClass, secondClass] = demoClasses;
  const [firstA, firstB] = firstClass.class_schedules;
  const [secondA, secondB] = secondClass.class_schedules;

  try {
    await createSoloScenario(client, "개인4회_첫수업전", 4);
    await createSoloScenario(client, "개인4회_진행중_잔여2회", 4, {
      firstDate: addCalendarDays(today, -14),
      usedCount: 2
    });
    await createSoloScenario(client, "개인8회_잔여1회", 8, {
      firstDate: addCalendarDays(today, -35),
      usedCount: 7
    });
    await createSoloScenario(client, "개인12회_만료5일전", 12, {
      firstDate: addCalendarDays(today, -(WEEKS_BY_PLAN[12] * 7 - 5)),
      usedCount: 4
    });
    await createSoloScenario(client, "개인4회_기간만료_종료", 4, {
      firstDate: addCalendarDays(today, -50),
      usedCount: 2,
      ended: true
    });
    await createRenewedSoloScenario(client);

    await createStarterPackageScenario(client, firstClass, firstA.id);
    await createGroupScenario(client, firstClass, "KPOP_월요일_신규", [firstA.id], { attendanceCount: 1 });
    await createGroupScenario(client, firstClass, "KPOP_수요일_정상", [firstB.id], { attendanceCount: 3 });
    await createGroupScenario(client, firstClass, "KPOP_복수요일_월수", [firstA.id, firstB.id], {
      attendanceCount: 4
    });
    await createGroupScenario(client, firstClass, "KPOP_결제5일전", [firstA.id], {
      paymentDaysAgo: 30,
      attendanceCount: 5
    });
    await createGroupScenario(client, firstClass, "KPOP_결제7일지연", [firstB.id], {
      paymentDaysAgo: 42,
      attendanceCount: 6
    });
    await createGroupScenario(client, firstClass, "KPOP_잔여1회", [firstA.id], { attendanceCount: 7 });
    await createGroupScenario(client, firstClass, "KPOP_복수요일_정원확인", [firstA.id, firstB.id], {
      attendanceCount: 2
    });

    await createGroupScenario(client, secondClass, "다이어트_화요일_신규", [secondA.id], {
      attendanceCount: 1
    });
    await createGroupScenario(client, secondClass, "다이어트_목요일_정상", [secondB.id], {
      attendanceCount: 2
    });
    await createGroupScenario(client, secondClass, "다이어트_복수요일", [secondA.id, secondB.id], {
      attendanceCount: 3
    });
    await createGroupScenario(client, secondClass, "다이어트_결제3일전", [secondA.id], {
      paymentDaysAgo: 32,
      attendanceCount: 4
    });
    await createGroupScenario(client, secondClass, "다이어트_결제10일지연", [secondB.id], {
      paymentDaysAgo: 45,
      attendanceCount: 5
    });
    await createGroupScenario(client, secondClass, "다이어트_잔여1회", [secondA.id], {
      attendanceCount: 7
    });
  } catch (error) {
    await cleanupCreatedMembers(client);
    throw error;
  }

  const [finalMembers, finalEnrollments, finalCycles, finalAttendance] = await Promise.all([
    countRows(client, "members"),
    countRows(client, "enrollments"),
    countRows(client, "enrollment_cycles"),
    countRows(client, "attendance_logs")
  ]);
  console.info(
    `[demo-seed] 완료: 회원 ${finalMembers}명, 수강 ${finalEnrollments}건, 주기 ${finalCycles}건, 출석 ${finalAttendance}건`
  );
}

void main();
