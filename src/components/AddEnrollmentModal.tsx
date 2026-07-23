// src/components/AddEnrollmentModal.tsx
"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { apiFetch } from "@/lib/api-client";

const SOLO_PLANS = [4, 8, 12] as const;
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

interface ClassItem {
  id: number;
  name: string;
}

interface ClassSchedule {
  id: number;
  weekday: number;
  start_time: string | null;
  curriculum_group: string | null;
}

export function AddEnrollmentModal({
  open,
  onClose,
  onSuccess,
  memberId
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  memberId: number;
}) {
  const [kind, setKind] = useState<"solo" | "group" | "package">("solo");
  const [plan, setPlan] = useState<(typeof SOLO_PLANS)[number] | null>(null);

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<ClassSchedule[]>([]);
  const [scheduleIds, setScheduleIds] = useState<number[]>([]);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"card" | "transfer" | "cash">("card");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sendNotification, setSendNotification] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind === "solo") return;
    apiFetch<{ classes: ClassItem[] }>("/api/classes")
      .then((res) => setClasses(res.classes))
      .catch(() => setClasses([]));
  }, [kind]);

  useEffect(() => {
    setScheduleIds([]);
    if (kind === "solo" || !classId) {
      setSchedules([]);
      return;
    }
    apiFetch<{ schedules: ClassSchedule[] }>(`/api/classes/${classId}/schedules`)
      .then((res) => setSchedules(res.schedules))
      .catch(() => setSchedules([]));
  }, [kind, classId]);

  function toggleSchedule(id: number) {
    setScheduleIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (kind === "solo" && !plan) {
      setError("회차를 선택해주세요.");
      return;
    }
    if (kind !== "solo" && !classId) {
      setError("반을 선택해주세요.");
      return;
    }
    if (kind !== "solo" && scheduleIds.length === 0) {
      setError("요일을 하나 이상 선택해주세요.");
      return;
    }
    if (!amount.trim()) {
      setError("결제 금액을 입력해주세요.");
      return;
    }
    if (!paymentDate) {
      setError("결제일을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const className = classes.find((c) => c.id === classId)?.name;
      if (kind === "package") {
        await apiFetch("/api/enrollments/package", {
          method: "POST",
          body: JSON.stringify({
            memberId,
            className,
            scheduleIds,
            payment: { amount: Number(amount), method, paymentDate }
          })
        });
      } else {
        await apiFetch("/api/enrollments", {
          method: "POST",
          body: JSON.stringify({
            memberId,
            kind,
            ...(kind === "solo" ? { plan } : { className, scheduleIds }),
            payment: { amount: Number(amount), method, paymentDate },
            sendNotification
          })
        });
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "추가에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="수강권/반 추가">
      <label style={labelStyle}>수강 종류</label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className={kind === "solo" ? "" : "secondary"}
          style={kindButtonStyle}
          onClick={() => setKind("solo")}
        >
          개인레슨
        </button>
        <button
          type="button"
          className={kind === "group" ? "" : "secondary"}
          style={kindButtonStyle}
          onClick={() => setKind("group")}
        >
          단체레슨
        </button>
        <button
          type="button"
          className={kind === "package" ? "" : "secondary"}
          style={kindButtonStyle}
          onClick={() => setKind("package")}
        >
          스타터 패키지
        </button>
      </div>

      {kind === "package" && (
        <p style={{ fontSize: 12, color: "var(--text-sub)", margin: "10px 0 0" }}>
          개인레슨 2회 + 단체레슨(아래에서 선택한 반) 4회로 함께 등록됩니다. 유효기간은 개인/단체 중 먼저 출석한
          날짜로부터 3주 공통 적용됩니다.
        </p>
      )}

      {kind === "solo" ? (
        <>
          <label style={labelStyle}>
            회차 <span style={requiredStyle}>*</span>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            {SOLO_PLANS.map((p) => (
              <button
                key={p}
                type="button"
                className={plan === p ? "" : "secondary"}
                style={{ flex: 1 }}
                onClick={() => setPlan(p)}
              >
                {p}회권
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label style={labelStyle}>
            반 <span style={requiredStyle}>*</span>
          </label>
          <select
            value={classId ?? ""}
            onChange={(e) => setClassId(e.target.value ? Number(e.target.value) : null)}
            style={inputStyle}
          >
            <option value="">반 선택</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {classId && (
            <>
              <label style={labelStyle}>
                요일 <span style={requiredStyle}>*</span>
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {schedules.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={scheduleIds.includes(s.id) ? "" : "secondary"}
                    style={{ padding: "6px 12px" }}
                    onClick={() => toggleSchedule(s.id)}
                  >
                    {WEEKDAY_LABELS[s.weekday]}
                  </button>
                ))}
                {schedules.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--text-mute)", margin: 0 }}>등록된 요일이 없습니다.</p>
                )}
              </div>
            </>
          )}
        </>
      )}

      <label style={labelStyle}>
        결제 금액 <span style={requiredStyle}>*</span>
      </label>
      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="금액을 입력하세요" style={inputStyle} />

      <label style={labelStyle}>결제 수단</label>
      <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} style={inputStyle}>
        <option value="card">카드</option>
        <option value="transfer">계좌이체</option>
        <option value="cash">현금</option>
      </select>

      <label style={labelStyle}>
        결제일 <span style={requiredStyle}>*</span>
      </label>
      <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} style={inputStyle} />

      {kind !== "package" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={sendNotification}
            onChange={(e) => setSendNotification(e.target.checked)}
            style={{ width: "auto" }}
          />
          <span>등록 완료 알림톡 발송</span>
        </div>
      )}

      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
        <button className="secondary" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
          취소
        </button>
        <button style={{ flex: 1 }} onClick={handleSubmit} disabled={submitting}>
          {submitting ? "추가 중..." : "추가"}
        </button>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--text-sub)", margin: "14px 0 4px" };
const requiredStyle: React.CSSProperties = { color: "var(--danger)" };
const inputStyle: React.CSSProperties = { width: "100%" };
const kindButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "10px 6px",
  fontSize: 13,
  whiteSpace: "nowrap"
};
