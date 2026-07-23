import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildNotificationMessage, type CycleLike } from "./business-rules";
import { sendSolapiAlimtalk } from "./solapi";

export type NotificationTrigger = "auto" | "registration" | "manual_renew" | "manual_resend";
export type NotificationDeliveryResult =
  | { status: "sent"; providerMessageId: string | null }
  | { status: "failed"; code: string; message: string }
  | { status: "skipped"; reason: string };

interface NotificationCycleRow {
  id: string;
  status: "active" | "completed" | "expired";
  plan: 4 | 8 | 12 | null;
  total_count: number;
  used_count: number;
  valid_end_date: string | null;
  next_due_date: string | null;
  enrollments: {
    kind: "solo" | "group";
    status: "active" | "ended";
    package_id: string | null;
    members: { name: string; phone: string };
    classes: { name: string } | null;
  };
}

function templateIdFor(row: NotificationCycleRow, trigger: NotificationTrigger): string {
  const kind = row.enrollments.kind === "solo" ? "SOLO" : "GROUP";
  const purpose = trigger === "auto" ? "DUE" : "COMPLETED";
  return (
    process.env[`KAKAO_${purpose}_${kind}_TEMPLATE_ID`]?.trim() ??
    process.env.KAKAO_TEMPLATE_ID?.trim() ??
    ""
  );
}

function messageFor(row: NotificationCycleRow, trigger: NotificationTrigger) {
  const className = row.enrollments.classes?.name ?? "단체레슨";
  if (trigger === "auto") {
    const like: CycleLike = {
      kind: row.enrollments.kind,
      enrollmentStatus: row.enrollments.status,
      cycleStatus: row.status,
      plan: row.plan,
      totalCount: row.total_count,
      usedCount: row.used_count,
      validEndDate: row.valid_end_date,
      nextDueDate: row.next_due_date,
      isFixedTerm: row.enrollments.package_id != null
    };
    return buildNotificationMessage({ ...like, className });
  }
  return row.enrollments.kind === "solo"
    ? `개인레슨 ${row.total_count}회 등록 및 결제가 완료되었습니다.`
    : `${className} 등록 및 결제가 완료되었습니다.`;
}

function variablesFor(row: NotificationCycleRow): Record<string, string> {
  return row.enrollments.kind === "solo"
    ? { "#{총횟수}": String(row.total_count) }
    : { "#{수업명}": row.enrollments.classes?.name ?? "단체레슨" };
}

async function deliverCycleNotificationInternal(
  supabase: SupabaseClient,
  cycleId: string,
  trigger: NotificationTrigger
): Promise<NotificationDeliveryResult> {
  const { data: existing } = await supabase
    .from("notifications")
    .select("status, provider_message_id")
    .eq("cycle_id", cycleId)
    .eq("trigger_type", trigger)
    .maybeSingle();
  if (existing?.status === "sent") {
    return { status: "skipped", reason: "이미 접수된 알림입니다." };
  }

  const { data, error } = await supabase
    .from("enrollment_cycles")
    .select(
      "id, status, plan, total_count, used_count, valid_end_date, next_due_date, enrollments!inner(kind, status, package_id, members(name, phone), classes(name))"
    )
    .eq("id", cycleId)
    .single();
  if (error || !data) {
    return { status: "failed", code: "CYCLE_NOT_FOUND", message: error?.message ?? "수강 주기를 찾을 수 없습니다." };
  }

  const row = data as unknown as NotificationCycleRow;
  const message = messageFor(row, trigger);
  const result = await sendSolapiAlimtalk({
    to: row.enrollments.members.phone,
    text: message,
    templateId: templateIdFor(row, trigger),
    variables: variablesFor(row)
  });
  const now = new Date().toISOString();

  await supabase.from("notifications").upsert(
    {
      cycle_id: cycleId,
      status: result.ok ? "sent" : "failed",
      trigger_type: trigger,
      message,
      fail_reason: result.ok ? null : result.message,
      provider: "solapi",
      provider_group_id: result.ok ? result.groupId : null,
      provider_message_id: result.ok ? result.messageId : null,
      error_code: result.ok ? null : result.code,
      sent_at: now
    },
    { onConflict: "cycle_id,trigger_type" }
  );

  return result.ok
    ? { status: "sent", providerMessageId: result.messageId }
    : { status: "failed", code: result.code, message: result.message };
}

export async function deliverCycleNotification(
  supabase: SupabaseClient,
  cycleId: string,
  trigger: NotificationTrigger
): Promise<NotificationDeliveryResult> {
  try {
    return await deliverCycleNotificationInternal(supabase, cycleId, trigger);
  } catch {
    return {
      status: "failed",
      code: "NOTIFICATION_INTERNAL_ERROR",
      message: "알림 처리 중 내부 오류가 발생했습니다."
    };
  }
}
