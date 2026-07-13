// src/components/EditMemberModal.tsx
"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { apiFetch } from "@/lib/api-client";

export function EditMemberModal({
  open,
  onClose,
  onSuccess,
  memberId,
  initialName,
  initialPhone
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  memberId: number;
  initialName: string;
  initialPhone: string;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim() || !phone.trim()) {
      setError("이름과 연락처를 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/api/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() })
      });
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "수정에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="회원정보 수정">
      <label style={labelStyle}>이름</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>연락처</label>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />

      {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button className="secondary" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
          취소
        </button>
        <button style={{ flex: 1 }} onClick={handleSubmit} disabled={submitting}>
          {submitting ? "저장 중..." : "저장"}
        </button>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, color: "var(--text-sub)", margin: "12px 0 4px" };
const inputStyle: React.CSSProperties = { width: "100%" };
