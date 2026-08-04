"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { koreaDateString } from "@/lib/business-rules";
import { Modal } from "@/components/Modal";

interface SessionRow {
  session_index: number;
  status: "pending" | "done" | "auto";
}

interface ReservedLesson {
  id: string;
  cycleId: string;
  startMinute: number;
  status: "confirmed" | "completed";
  plan: 4 | 8 | 12;
  remain: number;
  name: string;
  phone: string;
}

const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export default function DailyPage() {
  const [date, setDate] = useState(koreaDateString());
  const [search, setSearch] = useState("");
  const [bookings, setBookings] = useState<ReservedLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingCompletion, setPendingCompletion] = useState<ReservedLesson | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBookings([]);
    try {
      const result = await apiFetch<{ bookings: ReservedLesson[] }>(`/api/bookings?date=${date}`);
      setBookings(result.bookings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예약 명단을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const filteredBookings = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return bookings;
    return bookings.filter(
      (booking) => booking.name.toLowerCase().includes(keyword) || booking.phone.includes(keyword)
    );
  }, [bookings, search]);

  async function completeReservation(booking: ReservedLesson) {
    setSubmittingId(booking.id);
    setError(null);
    setBookings((current) =>
      current.map((item) => (item.id === booking.id ? { ...item, status: "completed" } : item))
    );
    try {
      const { sessions } = await apiFetch<{ sessions: SessionRow[] }>(`/api/cycles/${booking.cycleId}/sessions`);
      const nextPending = sessions
        .filter((session) => session.status === "pending")
        .sort((a, b) => a.session_index - b.session_index)[0];
      if (!nextPending) throw new Error("남은 회차가 없습니다.");
      await apiFetch(`/api/bookings/${booking.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ sessionIndex: nextPending.session_index })
      });
      setToast(`${booking.name}님의 수업을 완료 처리했습니다.`);
      await load();
    } catch (caught) {
      setBookings((current) =>
        current.map((item) => (item.id === booking.id ? { ...item, status: "confirmed" } : item))
      );
      setError(caught instanceof Error ? caught.message : "예약 처리에 실패했습니다.");
    } finally {
      setSubmittingId(null);
    }
  }

  async function confirmCompletion() {
    if (!pendingCompletion) return;
    const booking = pendingCompletion;
    setPendingCompletion(null);
    await completeReservation(booking);
  }

  return (
    <div>
      <h1 className="page-title">오늘 수업</h1>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: "auto" }} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="예약자 이름 또는 전화번호 검색"
            style={{ flex: "1 1 220px", minWidth: 180 }}
          />
        </div>
      </div>

      <div className="panel">
        {loading ? (
          <p className="state-message">예약 명단을 불러오는 중...</p>
        ) : error ? (
          <p className="state-message error">{error}</p>
        ) : filteredBookings.length === 0 ? (
          <p className="state-message">선택한 날짜의 예약이 없습니다.</p>
        ) : (
          <ul className="daily-list">
            {filteredBookings.map((booking) => (
              <li key={booking.id} className="daily-row booking-admin-row">
                <div>
                  <strong>{formatTime(booking.startMinute)} · {booking.name}</strong>
                  <div style={{ color: "var(--text-sub)", marginTop: 4 }}>
                    {booking.phone} · {booking.plan}회권 · 잔여 {booking.remain}회 · {booking.status === "completed" ? "수업 완료" : "수업 전"}
                  </div>
                </div>
                {booking.status === "completed" ? (
                  <span className="booking-completed-status">✓ 수업 완료</span>
                ) : (
                  <button
                    type="button"
                    className="secondary"
                    disabled={submittingId === booking.id}
                    onClick={() => setPendingCompletion(booking)}
                  >
                    {submittingId === booking.id ? "처리 중..." : "수업 완료 처리"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={pendingCompletion !== null} onClose={() => setPendingCompletion(null)} title="수업 완료 확인">
        {pendingCompletion && (
          <>
            <p style={{ margin: "4px 0 6px" }}>
              <strong>{formatTime(pendingCompletion.startMinute)} · {pendingCompletion.name}</strong>
            </p>
            <p style={{ color: "var(--text-sub)", fontSize: 13, margin: "0 0 20px" }}>
              이 예약을 수업 완료로 처리하고 1회 차감할까요?
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="secondary" style={{ flex: 1 }} onClick={() => setPendingCompletion(null)}>
                취소
              </button>
              <button type="button" style={{ flex: 1 }} onClick={confirmCompletion}>
                완료 처리
              </button>
            </div>
          </>
        )}
      </Modal>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
