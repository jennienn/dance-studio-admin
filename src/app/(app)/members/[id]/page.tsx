// src/app/(app)/members/[id]/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { CardMenu } from "@/components/CardMenu";
import { EditMemberModal } from "@/components/EditMemberModal";
import { AddEnrollmentModal } from "@/components/AddEnrollmentModal";
import { AddSessionModal } from "@/components/AddSessionModal";
import { EditGroupScheduleModal } from "@/components/EditGroupScheduleModal";
import { RenewSoloModal } from "@/components/RenewSoloModal";
import { RenewGroupModal } from "@/components/RenewGroupModal";
import { soloStatusText, groupStatusText, type CycleLike } from "@/lib/business-rules";

interface Payment {
  id: number;
  amount: number;
  method: "card" | "transfer" | "cash" | "other";
  payment_date: string;
  status: string;
}

interface CycleScheduleLink {
  schedule_id: number;
}

interface AttendanceLog {
  date: string;
  attended: boolean;
}

interface Cycle {
  id: string;
  enrollment_id: string;
  plan: 4 | 8 | 12 | null;
  total_count: number;
  used_count: number;
  first_class_date: string | null;
  valid_end_date: string | null;
  next_due_date: string | null;
  payment_date: string;
  status: "active" | "completed" | "expired";
  notify_status: "pending" | "sent" | "skipped" | "failed" | "not_required";
  payments: Payment[];
  cycle_schedules: CycleScheduleLink[];
  attendance_logs: AttendanceLog[];
}

interface Enrollment {
  id: string;
  member_id: number;
  kind: "solo" | "group";
  class_id: number | null;
  status: "active" | "ended";
  classes: { name: string } | null;
  enrollment_cycles: Cycle[];
}

interface MemberDetail {
  id: number;
  name: string;
  phone: string;
  enrollments: Enrollment[];
}

interface SessionRow {
  session_index: number;
  status: "pending" | "done" | "auto";
  date: string | null;
}

function getActiveCycle(enrollment: Enrollment): Cycle | undefined {
  return enrollment.enrollment_cycles.find((c) => c.status === "active");
}

function toCycleLike(enrollment: Enrollment, cycle: Cycle): CycleLike {
  return {
    kind: enrollment.kind,
    enrollmentStatus: enrollment.status,
    cycleStatus: cycle.status,
    plan: cycle.plan,
    totalCount: cycle.total_count,
    usedCount: cycle.used_count,
    validEndDate: cycle.valid_end_date,
    nextDueDate: cycle.next_due_date
  };
}

function NotiBadge({ status }: { status: Cycle["notify_status"] }) {
  if (status === "sent") return <span className="noti sent">✓ 발송됨</span>;
  if (status === "failed") return <span className="noti failed">⚠ 발송 실패</span>;
  if (status === "pending") return <span className="noti none">발송 대기</span>;
  return <span className="noti none">-</span>;
}

function SoloEnrollmentCard({
  enrollment,
  cycle,
  reload,
  onAddSession,
  onRenew,
  onEnd
}: {
  enrollment: Enrollment;
  cycle: Cycle;
  reload: () => void;
  onAddSession: () => void;
  onRenew: () => void;
  onEnd: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoadingSessions(true);
    apiFetch<{ sessions: SessionRow[] }>(`/api/cycles/${cycle.id}/sessions`)
      .then((res) => setSessions(res.sessions))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false));
  }, [cycle.id, cycle.used_count]);

  async function handleCancel(sessionIndex: number) {
    if (!confirm(`${sessionIndex}회차 기록을 취소할까요?`)) return;
    try {
      await apiFetch(`/api/cycles/${cycle.id}/sessions/${sessionIndex}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message ?? "취소에 실패했습니다.");
    }
  }

  const status = soloStatusText(toCycleLike(enrollment, cycle));
  const toneColor =
    status.tone === "danger" ? "var(--danger)" : status.tone === "warning" ? "var(--warning)" : "var(--success)";
  const remain = cycle.total_count - cycle.used_count;
  const recorded = sessions
    .filter((s) => s.status !== "pending")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const visible = showAll ? recorded : recorded.slice(0, 3);

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span className={`badge plan-${cycle.plan ?? 4}`}>개인 {cycle.plan}회권</span>
          {enrollment.status === "ended" && (
            <span className="badge mute" style={{ marginLeft: 6 }}>
              종료됨
            </span>
          )}
          <p style={{ margin: "10px 0 0", fontSize: 13 }}>
            잔여 <strong>{remain}</strong>/{cycle.total_count}회 ·{" "}
            <span style={{ color: toneColor, fontWeight: 500 }}>
              유효기간 {cycle.valid_end_date ?? "첫 수업 전"}
            </span>
          </p>
        </div>
        {enrollment.status === "active" && (
          <CardMenu items={[{ label: "수강 종료", danger: true, onClick: onEnd }]} />
        )}
      </div>

      <div className="info-grid" style={{ marginTop: 14 }}>
        <div className="info-box">
          <p className="info-label">첫 수업일</p>
          <p className="info-value">{cycle.first_class_date ?? "첫 수업 전"}</p>
        </div>
        <div className="info-box">
          <p className="info-label">마지막 결제일</p>
          <p className="info-value">{cycle.payment_date}</p>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "0 0 6px" }}>최근 수업 기록</p>
        {loadingSessions ? (
          <p className="state-message" style={{ padding: "8px 0" }}>
            불러오는 중...
          </p>
        ) : recorded.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-mute)", margin: 0 }}>아직 기록된 수업이 없습니다.</p>
        ) : (
          <>
            <ul className="record-list">
              {visible.map((s) => (
                <li key={s.session_index} className="record-row">
                  <span>
                    {s.session_index}회차 · {s.date}
                    {s.status === "auto" && <span style={{ color: "var(--text-mute)" }}> (만료 처리)</span>}
                  </span>
                  <button
                    className="secondary"
                    style={{ width: "auto", padding: "3px 9px", fontSize: 11 }}
                    onClick={() => handleCancel(s.session_index)}
                  >
                    취소
                  </button>
                </li>
              ))}
            </ul>
            {recorded.length > 3 && (
              <button type="button" className="link-btn" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "최근 기록만 보기" : `전체 기록 보기 (${recorded.length}건)`}
              </button>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="secondary" style={{ width: "auto", padding: "7px 12px", fontSize: 12 }} onClick={onAddSession}>
          + 수업 기록 추가
        </button>
        <button style={{ width: "auto", padding: "7px 12px", fontSize: 12 }} onClick={onRenew}>
          결제 확인
        </button>
      </div>
    </div>
  );
}

function GroupEnrollmentCard({
  enrollment,
  cycle,
  onRenew,
  onEditSchedule,
  onEnd
}: {
  enrollment: Enrollment;
  cycle: Cycle;
  onRenew: () => void;
  onEditSchedule: () => void;
  onEnd: () => void;
}) {
  const status = groupStatusText(toCycleLike(enrollment, cycle));
  const toneColor =
    status.tone === "danger" ? "var(--danger)" : status.tone === "warning" ? "var(--warning)" : "var(--success)";
  const attendedDates = cycle.attendance_logs
    .filter((a) => a.attended)
    .map((a) => a.date)
    .sort();
  const lastAttendance = attendedDates.length ? attendedDates[attendedDates.length - 1] : null;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <span className="badge type-group">단체 {enrollment.classes?.name ?? "-"}</span>
          {enrollment.status === "ended" && (
            <span className="badge mute" style={{ marginLeft: 6 }}>
              종료됨
            </span>
          )}
          <p style={{ margin: "10px 0 0", fontSize: 13 }}>
            다음 결제 예정일{" "}
            <strong style={{ color: toneColor }}>
              {cycle.next_due_date ?? "-"} ({status.text})
            </strong>
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13 }}>
            알림톡 <NotiBadge status={cycle.notify_status} />
          </p>
        </div>
        {enrollment.status === "active" && (
          <CardMenu
            items={[
              { label: "요일 변경", onClick: onEditSchedule },
              { label: "수강 종료", danger: true, onClick: onEnd }
            ]}
          />
        )}
      </div>

      <div className="info-grid" style={{ marginTop: 14 }}>
        <div className="info-box">
          <p className="info-label">최근 출석일</p>
          <p className="info-value">{lastAttendance ?? "-"}</p>
        </div>
        <div className="info-box">
          <p className="info-label">마지막 결제일</p>
          <p className="info-value">{cycle.payment_date}</p>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button style={{ width: "auto", padding: "7px 12px", fontSize: 12 }} onClick={onRenew}>
          결제 확인
        </button>
      </div>
    </div>
  );
}

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const memberId = Number(params.id);

  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editMemberOpen, setEditMemberOpen] = useState(false);
  const [addEnrollmentOpen, setAddEnrollmentOpen] = useState(false);
  const [addSessionCycleId, setAddSessionCycleId] = useState<string | null>(null);
  const [editScheduleTarget, setEditScheduleTarget] = useState<{ enrollment: Enrollment; cycle: Cycle } | null>(null);
  const [renewTarget, setRenewTarget] = useState<{ enrollment: Enrollment; cycle: Cycle } | null>(null);

  const loadMember = useCallback(async () => {
    try {
      const data = await apiFetch<MemberDetail>(`/api/members/${memberId}`);
      setMember(data);
    } catch (e: any) {
      setError(e.message ?? "회원 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    loadMember();
  }, [loadMember]);

  async function handleEnd(enrollment: Enrollment) {
    if (!confirm("이 수강을 종료 처리할까요?")) return;
    try {
      await apiFetch(`/api/enrollments/${enrollment.id}/end`, { method: "POST", body: JSON.stringify({}) });
      loadMember();
    } catch (e: any) {
      alert(e.message ?? "처리에 실패했습니다.");
    }
  }

  if (loading) return <p className="state-message">불러오는 중...</p>;
  if (error || !member) return <p className="state-message error">{error ?? "회원을 찾을 수 없습니다."}</p>;

  return (
    <div>
      <button
        className="secondary"
        style={{ width: "auto", padding: "6px 12px", fontSize: 12, marginBottom: 14 }}
        onClick={() => router.push("/members")}
      >
        ← 회원 목록
      </button>

      <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>
            {member.name}
          </h1>
          <p style={{ margin: 0, color: "var(--text-sub)", fontSize: 13 }}>{member.phone}</p>
        </div>
        <button className="secondary" style={{ width: "auto", padding: "8px 14px" }} onClick={() => setEditMemberOpen(true)}>
          회원정보 수정
        </button>
      </div>

      {member.enrollments.length === 0 ? (
        <p className="state-message">등록된 수강권이 없습니다.</p>
      ) : (
        member.enrollments.map((enrollment) => {
          const cycle = getActiveCycle(enrollment);
          if (!cycle) return null;
          return enrollment.kind === "solo" ? (
            <SoloEnrollmentCard
              key={enrollment.id}
              enrollment={enrollment}
              cycle={cycle}
              reload={loadMember}
              onAddSession={() => setAddSessionCycleId(cycle.id)}
              onRenew={() => setRenewTarget({ enrollment, cycle })}
              onEnd={() => handleEnd(enrollment)}
            />
          ) : (
            <GroupEnrollmentCard
              key={enrollment.id}
              enrollment={enrollment}
              cycle={cycle}
              onRenew={() => setRenewTarget({ enrollment, cycle })}
              onEditSchedule={() => setEditScheduleTarget({ enrollment, cycle })}
              onEnd={() => handleEnd(enrollment)}
            />
          );
        })
      )}

      <button style={{ width: "auto", padding: "9px 16px" }} onClick={() => setAddEnrollmentOpen(true)}>
        + 수강권/반 추가
      </button>

      {editMemberOpen && (
        <EditMemberModal
          open
          onClose={() => setEditMemberOpen(false)}
          onSuccess={loadMember}
          memberId={member.id}
          initialName={member.name}
          initialPhone={member.phone}
        />
      )}

      {addEnrollmentOpen && (
        <AddEnrollmentModal open onClose={() => setAddEnrollmentOpen(false)} onSuccess={loadMember} memberId={member.id} />
      )}

      {addSessionCycleId && (
        <AddSessionModal
          open
          onClose={() => setAddSessionCycleId(null)}
          onSuccess={loadMember}
          cycleId={addSessionCycleId}
        />
      )}

      {editScheduleTarget && (
        <EditGroupScheduleModal
          open
          onClose={() => setEditScheduleTarget(null)}
          onSuccess={loadMember}
          cycleId={editScheduleTarget.cycle.id}
          classId={editScheduleTarget.enrollment.class_id!}
          className={editScheduleTarget.enrollment.classes?.name ?? ""}
          currentScheduleIds={editScheduleTarget.cycle.cycle_schedules.map((cs) => cs.schedule_id)}
        />
      )}

      {renewTarget && renewTarget.enrollment.kind === "solo" && (
        <RenewSoloModal
          open
          onClose={() => setRenewTarget(null)}
          onSuccess={loadMember}
          enrollmentId={renewTarget.enrollment.id}
          memberName={member.name}
          currentRemain={renewTarget.cycle.total_count - renewTarget.cycle.used_count}
        />
      )}
      {renewTarget && renewTarget.enrollment.kind === "group" && (
        <RenewGroupModal
          open
          onClose={() => setRenewTarget(null)}
          onSuccess={loadMember}
          enrollmentId={renewTarget.enrollment.id}
          memberName={member.name}
          className={renewTarget.enrollment.classes?.name ?? ""}
        />
      )}
    </div>
  );
}
