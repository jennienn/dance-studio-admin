import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { addCalendarDays, koreaDateString, WEEKS_BY_PLAN } from "../src/lib/business-rules";
import { loadAndValidateTestEnvironment } from "../tests/support/test-env";
import type { ManifestRow, RowKey, SeedManifest } from "../tests/support/seed-manifest";

const env = loadAndValidateTestEnvironment({ requireServiceRole: true });
const now = new Date();
const runId = `TEST_${koreaDateString(now).replaceAll("-", "")}_${now
  .toISOString()
  .slice(11, 19)
  .replaceAll(":", "")}_${randomBytes(3).toString("hex")}`;
const artifactDir = path.resolve(process.cwd(), "test-artifacts");
const manifestPath = path.join(artifactDir, `seed-manifest-${runId}.json`);
const manifest: SeedManifest = {
  version: 1,
  runId,
  projectRef: env.projectRef,
  targetUrl: env.url,
  startedAt: now.toISOString(),
  rows: [],
  scenarios: {}
};
const supabase = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
let memberNumber = 0;

async function saveManifest() {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function addScenario(scenario: string, id: string | number) {
  (manifest.scenarios[scenario] ??= []).push(id);
}

async function insertOne(
  table: string,
  row: Record<string, unknown>,
  keyColumns: string[],
  scenario: string
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from(table).insert(row).select("*").single();
  if (error || !data) throw new Error(`${table} insert 실패: ${error?.message ?? "결과 없음"}`);
  const key: RowKey = {};
  for (const column of keyColumns) {
    const value = (data as Record<string, unknown>)[column];
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`${table}.${column} key 누락`);
    key[column] = value;
  }
  const entry: ManifestRow = { sequence: manifest.rows.length + 1, table, key, scenario };
  manifest.rows.push(entry);
  await saveManifest();
  return data as Record<string, unknown>;
}

async function createMember(scenario: string) {
  memberNumber += 1;
  const suffix = String(memberNumber).padStart(3, "0");
  const member = await insertOne(
    "members",
    { name: `테스트회원_${runId}_회원${suffix}`, phone: `000-TEST-${suffix}` },
    ["id"],
    scenario
  );
  const id = member.id as number;
  addScenario(scenario, id);
  return id;
}

async function createPayment(cycleId: string, amount: number, paymentDate: string, scenario: string) {
  await insertOne(
    "payments",
    { cycle_id: cycleId, amount, method: "other", payment_date: paymentDate, status: "completed", note: runId },
    ["id"],
    scenario
  );
}

async function createSoloCycle(
  memberId: number,
  plan: 4 | 8 | 12,
  scenario: string,
  options: { used?: number; firstDate?: string | null; status?: "active" | "completed" | "expired" } = {}
) {
  const enrollment = await insertOne(
    "enrollments",
    { member_id: memberId, kind: "solo", status: options.status === "expired" ? "ended" : "active" },
    ["id"],
    scenario
  );
  const enrollmentId = enrollment.id as string;
  const used = options.used ?? 0;
  const firstDate = options.firstDate ?? null;
  const validEnd = firstDate ? addCalendarDays(firstDate, WEEKS_BY_PLAN[plan] * 7) : null;
  const paymentDate = firstDate ?? koreaDateString();
  const cycle = await insertOne(
    "enrollment_cycles",
    {
      enrollment_id: enrollmentId,
      plan,
      base_count: plan,
      carry_over_count: 0,
      total_count: plan,
      used_count: used,
      first_class_date: firstDate,
      valid_end_date: validEnd,
      payment_date: paymentDate,
      status: options.status ?? "active"
    },
    ["id"],
    scenario
  );
  const cycleId = cycle.id as string;
  for (let index = 1; index <= plan; index += 1) {
    await insertOne(
      "sessions",
      {
        cycle_id: cycleId,
        session_index: index,
        date: index <= used && firstDate ? addCalendarDays(firstDate, index - 1) : null,
        status: index <= used ? "done" : "pending"
      },
      ["id"],
      scenario
    );
  }
  await createPayment(cycleId, plan * 50_000, paymentDate, scenario);
  return { enrollmentId, cycleId };
}

async function createRenewedSolo(memberId: number, scenario: string) {
  const old = await createSoloCycle(memberId, 4, scenario, {
    used: 3,
    firstDate: addCalendarDays(koreaDateString(), -40),
    status: "completed"
  });
  const cycle = await insertOne(
    "enrollment_cycles",
    {
      enrollment_id: old.enrollmentId,
      plan: 4,
      base_count: 4,
      carry_over_count: 1,
      total_count: 5,
      used_count: 0,
      payment_date: koreaDateString(),
      status: "active"
    },
    ["id"],
    scenario
  );
  const cycleId = cycle.id as string;
  for (let index = 1; index <= 5; index += 1) {
    await insertOne("sessions", { cycle_id: cycleId, session_index: index, status: "pending" }, ["id"], scenario);
  }
  await createPayment(cycleId, 200_000, koreaDateString(), scenario);
}

async function createTestClass(name: string, capacity: number, scenario: string) {
  const cls = await insertOne("classes", { name, capacity, active: true }, ["id"], scenario);
  const classId = cls.id as number;
  const monday = await insertOne(
    "class_schedules",
    { class_id: classId, weekday: 1, curriculum_group: "TEST_A" },
    ["id"],
    scenario
  );
  const wednesday = await insertOne(
    "class_schedules",
    { class_id: classId, weekday: 3, curriculum_group: "TEST_B" },
    ["id"],
    scenario
  );
  return { classId, mondayId: monday.id as number, wednesdayId: wednesday.id as number };
}

async function createGroupCycle(
  memberId: number,
  classId: number,
  scheduleIds: number[],
  scenario: string,
  options: { paymentDate?: string; status?: "active" | "expired" } = {}
) {
  const status = options.status ?? "active";
  const enrollment = await insertOne(
    "enrollments",
    { member_id: memberId, kind: "group", class_id: classId, status: status === "expired" ? "ended" : "active" },
    ["id"],
    scenario
  );
  const paymentDate = options.paymentDate ?? koreaDateString();
  const cycle = await insertOne(
    "enrollment_cycles",
    {
      enrollment_id: enrollment.id,
      plan: null,
      base_count: 8,
      carry_over_count: 0,
      total_count: 8,
      used_count: 0,
      next_due_date: addCalendarDays(paymentDate, 35),
      payment_date: paymentDate,
      status
    },
    ["id"],
    scenario
  );
  for (const scheduleId of scheduleIds) {
    await insertOne(
      "cycle_schedules",
      { cycle_id: cycle.id, schedule_id: scheduleId },
      ["cycle_id", "schedule_id"],
      scenario
    );
  }
  await createPayment(cycle.id as string, 160_000, paymentDate, scenario);
}

async function seed(_client: SupabaseClient) {
  await saveManifest();
  for (const plan of [4, 8, 12] as const) {
    for (let index = 0; index < 3; index += 1) {
      const scenario = `solo_${plan}`;
      await createSoloCycle(await createMember(scenario), plan, scenario);
    }
  }
  for (let index = 0; index < 2; index += 1) {
    const scenario = "solo_remaining_one";
    await createSoloCycle(await createMember(scenario), 8, scenario, {
      used: 7,
      firstDate: addCalendarDays(koreaDateString(), -30)
    });
  }
  for (let index = 0; index < 2; index += 1) {
    const scenario = "solo_expired";
    await createSoloCycle(await createMember(scenario), 4, scenario, {
      used: 1,
      firstDate: addCalendarDays(koreaDateString(), -60),
      status: "expired"
    });
  }
  for (let index = 0; index < 2; index += 1) {
    const scenario = "solo_before_first_class";
    await createSoloCycle(await createMember(scenario), 4, scenario);
  }
  for (let index = 0; index < 2; index += 1) {
    const scenario = "solo_renewed";
    await createRenewedSolo(await createMember(scenario), scenario);
  }

  const general = await createTestClass(`테스트회원_${runId}_일반반`, 50, "test_classes");
  for (let index = 0; index < 5; index += 1) {
    const scenario = "group_monday";
    await createGroupCycle(await createMember(scenario), general.classId, [general.mondayId], scenario);
  }
  for (let index = 0; index < 5; index += 1) {
    const scenario = "group_wednesday";
    await createGroupCycle(await createMember(scenario), general.classId, [general.wednesdayId], scenario);
  }
  for (let index = 0; index < 3; index += 1) {
    const scenario = "group_multi_weekday";
    await createGroupCycle(
      await createMember(scenario),
      general.classId,
      [general.mondayId, general.wednesdayId],
      scenario
    );
  }
  for (let index = 0; index < 2; index += 1) {
    const scenario = "group_payment_due";
    await createGroupCycle(await createMember(scenario), general.classId, [general.mondayId], scenario, {
      paymentDate: addCalendarDays(koreaDateString(), -30)
    });
  }
  for (let index = 0; index < 2; index += 1) {
    const scenario = "group_expired";
    await createGroupCycle(await createMember(scenario), general.classId, [general.wednesdayId], scenario, {
      paymentDate: addCalendarDays(koreaDateString(), -60),
      status: "expired"
    });
  }

  const capacity = await createTestClass(`테스트회원_${runId}_정원반`, 10, "capacity_class");
  for (let index = 0; index < 11; index += 1) {
    const scenario = "group_capacity_11";
    const memberId = await createMember(scenario);
    if (index < 10) await createGroupCycle(memberId, capacity.classId, [capacity.mondayId], scenario);
    else addScenario("group_capacity_candidate_11th", memberId);
  }
}

async function main() {
  try {
    await seed(supabase);
    manifest.completedAt = new Date().toISOString();
    await saveManifest();
    console.info(`[test-seed] runId: ${runId}`);
    console.info(`[test-seed] manifest: ${manifestPath}`);
    console.info(`[test-seed] created rows: ${manifest.rows.length}`);
  } catch (error) {
    manifest.failedAt = new Date().toISOString();
    manifest.failure = error instanceof Error ? error.message : String(error);
    await saveManifest();
    console.error(`[test-seed] 실패. 생성된 행은 삭제하지 않았습니다. manifest: ${manifestPath}`);
    throw error;
  }
}

void main();
