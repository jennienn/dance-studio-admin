// src/components/AddSessionModal.tsx
"use client";

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { apiFetch } from "@/lib/api-client";

interface SessionRow {
  session_index: number;
  status: "pending" | "done" | "auto";
  date: string | null;
}

export function AddSessionModal({
  open,
  onClose,
  onSuccess,
  cycleId
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  cycleId: string;
}) {
  const [pendingIndexes, setPendingIndexes] = useState<number[]>([]);
  const [sessionIndex, setSessionIndex] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ sessions: SessionRow[] }>(`/api/cycles/${cycleId}/sessions`)
      .then((res) => {
        const pending = res.sessions.filter((s) => s.status === "pending").map((s) => s.session_index);
        setPendingIndexes(pending);
        setSessionIndex(pending[0] ?? null);
      })
      .catch(() => setError("회차 목록을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [cycleId]);

  async function handleSubmit() {
    if (!sessionIndex || !date) {
      setError("회차와 날짜를 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/cycles/${cycleId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ sessionIndex, date, expired })
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "기록에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="수업 기록 추가">
      {loading ? (
        <p className="state-message">불러오는 중...</p>
      ) : error && pendingIndexes.length === 0 ? (
        <p className="state-message error">{error}</p>
      ) : pendingIndexes.length === 0 ? (
        <p className="state-message">기록할 수 있는 남은 회차가 없습니다.</p>
      ) : (
        <>
          <label style={labelStyle}>회차</label>
          <select
            value={sessionIndex ?? ""}
            onChange={(e) => setSessionIndex(Number(e.target.value))}
            style={inputStyle}
          >
            {pendingIndexes.map((idx) => (
              <option key={idx} value={idx}>
                {idx}회차
              </option>
            ))}
          </select>

          <label style={labelStyle}>날짜</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={expired}
              onChange={(e) => setExpired(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span>유효기간 만료로 자동 소진 처리</span>
          </div>

          {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 10 }}>{error}</p>}

          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <button className="secondary" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
              취소
            </button>
            <button style={{ flex: 1 }} onClick={handleSubmit} disabled={submitting}>
              {submitting ? "기록 중..." : "기록 추가"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--text-sub)", margin: "12px 0 4px" };
const inputStyle: React.CSSProperties = { width: "100%" };
