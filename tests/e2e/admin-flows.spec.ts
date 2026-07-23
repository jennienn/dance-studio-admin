import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { hasTestEnvironmentFile, loadAndValidateTestEnvironment } from "../support/test-env";

const env = hasTestEnvironmentFile() ? loadAndValidateTestEnvironment({ requireServiceRole: true }) : null;
const suffix = `${Date.now()}_${randomBytes(2).toString("hex")}`;
const memberName = `테스트회원_E2E_${suffix}`;
const groupMemberName = `테스트회원_E2E_GROUP_${suffix}`;
const packageMemberName = `테스트회원_E2E_PACKAGE_${suffix}`;
const className = `테스트회원_E2E_CLASS_${suffix}`;
const createdMemberIds: number[] = [];
let classId: number | null = null;
let mondayScheduleId: number | null = null;

test.skip(!env, ".env.test.local의 전용 테스트 DB와 E2E 계정이 필요합니다.");
test.describe.configure({ mode: "serial" });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("이메일").fill(env!.adminEmail!);
  await page.getByPlaceholder("비밀번호").fill(env!.adminPassword!);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

function remainingCount(page: Page, count: number) {
  return page.getByText("남은 회차").locator("..").getByText(`${count}회`, { exact: true });
}

test.beforeAll(async () => {
  if (!env) return;
  if (!env.adminEmail || !env.adminPassword) throw new Error("TEST_ADMIN_EMAIL과 TEST_ADMIN_PASSWORD가 필요합니다.");
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
  const { data: cls, error } = await admin
    .from("classes")
    .insert({ name: className, capacity: 10, active: true })
    .select("id")
    .single();
  if (error || !cls) throw error ?? new Error("E2E class 생성 실패");
  classId = cls.id;
  const schedules = await admin
    .from("class_schedules")
    .insert([
      { class_id: classId, weekday: 1, curriculum_group: "A" },
      { class_id: classId, weekday: 3, curriculum_group: "B" }
    ])
    .select("id, weekday");
  if (schedules.error) throw schedules.error;
  mondayScheduleId = schedules.data!.find((schedule) => schedule.weekday === 1)!.id;
});

test.afterAll(async () => {
  if (!env) return;
  const admin = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
  for (const id of createdMemberIds.reverse()) await admin.from("members").delete().eq("id", id);
  if (classId !== null) await admin.from("classes").delete().eq("id", classId);
});

test("로그인, 회원 목록, 개인레슨 등록, 첫 수업, 잔여 회차, 재등록", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "회원", exact: true }).click();
  await expect(page.getByRole("heading", { name: "회원" })).toBeVisible();
  await page.getByRole("button", { name: "+ 회원 등록" }).click();
  await page.getByPlaceholder("홍길동").fill(memberName);
  await page.getByPlaceholder("010-1234-5678").fill("000-E2E-001");
  await page.getByRole("button", { name: "4회권" }).click();
  await page.getByPlaceholder("금액을 입력하세요").fill("200000");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/members") && response.request().method() === "POST");
  await page.getByRole("button", { name: "등록 완료", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  createdMemberIds.push((await response.json()).memberId);

  await expect(page.getByRole("heading", { name: memberName })).toBeVisible();
  await expect(remainingCount(page, 4)).toBeVisible();
  await page.getByRole("button", { name: "+ 수업 기록 추가" }).click();
  await page.getByRole("button", { name: "기록 추가", exact: true }).click();
  await expect(remainingCount(page, 3)).toBeVisible();

  await page.getByRole("button", { name: "결제 확인", exact: true }).click();
  await page.getByRole("button", { name: "4회권" }).click();
  await page.getByPlaceholder("금액을 입력하세요").fill("200000");
  await page.getByRole("button", { name: "4회권 결제 확인 완료" }).click();
  await expect(remainingCount(page, 7)).toBeVisible();
});

test("단체 회원 복수 요일 등록, 출석 등록과 취소", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "회원", exact: true }).click();
  await page.getByRole("button", { name: "+ 회원 등록" }).click();
  const modal = page.getByRole("heading", { name: "회원 등록" }).locator("..");
  await modal.getByPlaceholder("홍길동").fill(groupMemberName);
  await modal.getByPlaceholder("010-1234-5678").fill("000-E2E-002");
  await modal.getByRole("button", { name: "단체레슨" }).click();
  await modal.locator("select").filter({ has: page.locator(`option[value=\"${classId}\"]`) }).selectOption(String(classId));
  await modal.getByRole("button", { name: "월", exact: true }).click();
  await modal.getByRole("button", { name: "수", exact: true }).click();
  await modal.getByPlaceholder("금액을 입력하세요").fill("160000");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/members") && response.request().method() === "POST");
  await modal.getByRole("button", { name: "등록 완료", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  createdMemberIds.push((await response.json()).memberId);
  await expect(page.getByText(`단체 ${className}`)).toBeVisible();

  await page.getByRole("link", { name: "단체 출석" }).click();
  await page.locator("select").selectOption(className);
  const monday = new Date("2026-07-13T12:00:00+09:00");
  await page.locator('input[type="date"]').fill(monday.toISOString().slice(0, 10));
  const memberCheckbox = page.getByText(groupMemberName).locator("..").getByRole("checkbox");
  await memberCheckbox.check();
  await page.getByRole("button", { name: /선택한 1명 출석 처리/ }).click();
  await expect(page.getByText("1명의 출석이 저장되었습니다.")).toBeVisible();
  await memberCheckbox.uncheck();
  await page.getByRole("button", { name: /선택한 0명 출석 처리/ }).click();
  await expect(page.getByText("0명의 출석이 저장되었습니다.")).toBeVisible();
});

test("신규 회원 등록에서 스타터 패키지를 바로 등록한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "회원", exact: true }).click();
  await page.getByRole("button", { name: "+ 회원 등록" }).click();
  const modal = page.getByRole("heading", { name: "회원 등록" }).locator("..");
  await modal.getByPlaceholder("홍길동").fill(packageMemberName);
  await modal.getByPlaceholder("010-1234-5678").fill("000-E2E-PACKAGE");
  await modal.getByRole("button", { name: "스타터 패키지", exact: true }).click();
  await expect(modal.getByText(/개인레슨 2회와.*단체레슨 4회/)).toBeVisible();
  await modal.locator("select").filter({ has: page.locator(`option[value=\"${classId}\"]`) }).selectOption(String(classId));
  await modal.getByRole("button", { name: "월", exact: true }).click();
  await modal.getByPlaceholder("금액을 입력하세요").fill("250000");
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/members") && response.request().method() === "POST"
  );
  await modal.getByRole("button", { name: "등록 완료", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  createdMemberIds.push((await response.json()).memberId);

  await expect(page.getByRole("heading", { name: packageMemberName })).toBeVisible();
  await expect(page.getByText("개인 2회권")).toBeVisible();
  await expect(page.getByText(`단체 ${className}`)).toBeVisible();
});

test("정원 11번째 회원 등록은 오류를 표시하고 일부 데이터를 남기지 않는다", async ({ page }) => {
  await login(page);
  for (let index = 0; index < 8; index += 1) {
    const response = await page.request.post("/api/members", {
      data: {
        name: `테스트회원_E2E_CAPACITY_${suffix}_${index + 1}`,
        phone: `000-E2E-C${index + 1}`,
        enrollment: {
          kind: "group",
          className,
          scheduleIds: [mondayScheduleId],
          payment: { amount: 160000, method: "card", paymentDate: "2026-07-14" }
        }
      }
    });
    expect(response.status()).toBe(201);
    createdMemberIds.push((await response.json()).memberId);
  }

  await page.getByRole("link", { name: "회원", exact: true }).click();
  await page.getByRole("button", { name: "+ 회원 등록" }).click();
  const modal = page.getByRole("heading", { name: "회원 등록" }).locator("..");
  await modal.getByPlaceholder("홍길동").fill(`테스트회원_E2E_CAPACITY_BLOCKED_${suffix}`);
  await modal.getByPlaceholder("010-1234-5678").fill("000-E2E-BLOCK");
  await modal.getByRole("button", { name: "단체레슨" }).click();
  await modal.locator("select").filter({ has: page.locator(`option[value=\"${classId}\"]`) }).selectOption(String(classId));
  await modal.getByRole("button", { name: "월", exact: true }).click();
  await modal.getByPlaceholder("금액을 입력하세요").fill("160000");
  const blockedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/members") && response.request().method() === "POST"
  );
  await modal.getByRole("button", { name: "등록 완료", exact: true }).click();
  expect((await blockedResponse).status()).toBe(409);
  await expect(page.getByText(/CLASS_CAPACITY_EXCEEDED|반 정원/)).toBeVisible();
});

test("로그아웃 후 보호 페이지와 API 접근이 차단된다", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/members");
  await expect(page).toHaveURL(/\/login$/);
  const response = await page.request.get("/api/members", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
});
