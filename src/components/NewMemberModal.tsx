// src/components/NewMemberModal.tsx
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

export function NewMemberModal({
  open,
  onClose,
  onSuccess
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (memberId: number) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<"solo" | "group">("solo");

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
    if (kind !== "group") return;
    apiFetch<{ classes: ClassItem[] }>("/api/classes")
      .then((res) => setClasses(res.classes))
      .catch(() => setClasses([]));
  }, [kind]);

  useEffect(() => {
    setScheduleIds([]);
    if (kind !== "group" || !classId) {
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
    if (!name.trim() || !phone.trim()) {
      setError("이름과 연락처를 입력해주세요.");
      return;
    }
    if (kind === "solo" && !plan) {
      setError("회차를 선택해주세요.");
      return;
    }
    if (kind === "group" && !classId) {
      setError("반을 선택해주세요.");
      return;
    }
    if (kind === "group" && scheduleIds.length === 0) {
      setError("요일을 하나 이상 선택해주세요.");
      return;
    }
    if (!amount || !paymentDate) {
      setError("결제 금액과 결제일을 입력해주세요.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const className = classes.find((c) => c.id === classId)?.name;
      const res = await apiFetch<{ memberId: number }>("/api/members", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          enrollment: {
            kind,
            ...(kind === "solo" ? { plan } : { className, scheduleIds }),
            payment: { amount: Number(amount), method, paymentDate },
            sendNotification
          }
        })
      });
      onSuccess(res.memberId);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "등록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="회원 등록">
      <label style={labelStyle}>이름</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" style={inputStyle} />

      <label style={labelStyle}>연락처</label>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" style={inputStyle} />

      <label style={labelStyle}>수강 종류</label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className={kind === "solo" ? "" : "secondary"}
          style={{ flex: 1 }}
          onClick={() => setKind("solo")}
        >
          개인레슨
        </button>
        <button
          type="button"
          className={kind === "group" ? "" : "secondary"}
          style={{ flex: 1 }}
          onClick={() => setKind("group")}
        >
          단체레슨
        </button>
      </div>

      {kind === "solo" ? (
        <>
          <label style={labelStyle}>회차</label>
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
          <label style={labelStyle}>반</label>
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
              <label style={labelStyle}>요일</label>
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

      <label style={labelStyle}>결제 금액</label>
      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="370000" style={inputStyle} />

      <label style={labelStyle}>결제 수단</label>
      <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} style={inputStyle}>
        <option value="card">카드</option>
        <option value="transfer">계좌이체</option>
        <option value="cash">현금</option>
      </select>

      <label style={labelStyle}>결제일</label>
      <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} style={inputStyle} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={sendNotification}
          onChange={(e) => setSendNotification(e.target.checked)}
          style={{ width: "auto" }}
        />
        <span>알림톡 발송 (결제/재등록 안내 자동발송 대상에 포함)</span>
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
        <button className="secondary" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
          취소
        </button>
        <button style={{ flex: 1 }} onClick={handleSubmit} disabled={submitting}>
          {submitting ? "등록 중..." : "회원 등록"}
        </button>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--text-sub)", margin: "14px 0 4px" };
const inputStyle: React.CSSProperties = { width: "100%" };
