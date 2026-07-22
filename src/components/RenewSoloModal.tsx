// src/components/RenewSoloModal.tsx
"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { apiFetch } from "@/lib/api-client";

const PLANS = [4, 8, 12] as const;

export function RenewSoloModal({
  open,
  onClose,
  onSuccess,
  enrollmentId,
  memberName,
  currentRemain
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  enrollmentId: string;
  memberName: string;
  currentRemain: number;
}) {
  const [plan, setPlan] = useState<(typeof PLANS)[number] | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"card" | "transfer" | "cash">("card");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [sendNotification, setSendNotification] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!plan) {
      setError("이용권을 선택해주세요.");
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
      await apiFetch(`/api/enrollments/${enrollmentId}/cycles`, {
        method: "POST",
        body: JSON.stringify({
          plan,
          payment: { amount: Number(amount), method, paymentDate },
          sendNotification
        })
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "처리에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={memberName}>
      <p style={{ fontSize: 13, color: "var(--text-sub)", margin: 0 }}>현재 잔여 {currentRemain}회</p>

      <label style={labelStyle}>
        새 이용권 <span style={requiredStyle}>*</span>
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        {PLANS.map((p) => (
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

      {plan && (
        <p style={{ fontSize: 13, color: "var(--text-sub)", margin: "10px 0 0" }}>
          기존 잔여 {currentRemain}회 이월 → 등록 후 잔여 <strong>{plan + currentRemain}회</strong>
        </p>
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={sendNotification}
          onChange={(e) => setSendNotification(e.target.checked)}
          style={{ width: "auto" }}
        />
        <span>결제 완료 알림톡 자동 발송</span>
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button className="secondary" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
          취소
        </button>
        <button style={{ flex: 1 }} onClick={handleSubmit} disabled={submitting || !plan}>
          {submitting ? "처리 중..." : plan ? `${plan}회권 결제 확인 완료` : "이용권을 선택하세요"}
        </button>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--text-sub)", margin: "12px 0 4px" };
const requiredStyle: React.CSSProperties = { color: "var(--danger)" };
const inputStyle: React.CSSProperties = { width: "100%" };
