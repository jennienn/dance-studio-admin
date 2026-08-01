"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { apiFetch } from "@/lib/api-client";
import { formatPhoneInput } from "@/lib/phone";

type Booking = { id: string; booking_date: string; start_minute: number; status: "confirmed" | "completed" | "cancelled" };
type Info = {
  member: { name: string };
  cycle: { plan: number; payment_date: string; valid_end_date: string; first_bookable_date: string; remain: number };
  unavailable: number[];
  bookings: Booking[];
};

const times = Array.from({ length: 23 }, (_, index) => 600 + index * 30);
const formatTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const statusLabel = { confirmed: "예약 완료", completed: "수업 완료", cancelled: "취소" };

export default function BookingPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load(selectedDate = "") {
    try {
      const result = await apiFetch<Info>(`/api/booking${selectedDate ? `?date=${selectedDate}` : ""}`);
      setInfo(result);
      setError("");
    } catch {
      setInfo(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/api/booking/login", { method: "POST", body: JSON.stringify({ name, phone }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function reserve() {
    if (!date || time === null) return;
    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/api/booking", { method: "POST", body: JSON.stringify({ date, startMinute: time }) });
      setTime(null);
      await load(date);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예약에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    if (!confirm("이 예약을 취소할까요?")) return;
    try {
      await apiFetch(`/api/booking/${id}`, { method: "DELETE" });
      await load(date);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "예약 취소에 실패했습니다.");
    }
  }

  async function logout() {
    setSubmitting(true);
    try {
      await apiFetch("/api/booking/logout", { method: "POST" });
    } finally {
      setInfo(null);
      setDate("");
      setTime(null);
      setError("");
      setSubmitting(false);
    }
  }

  if (!info) {
    return (
      <main className="booking-shell">
        <div className="booking-login-header">
          <div className="booking-login-brand">
            <Image src="/logo.png" alt="Élanor Dance Academy 로고" width={64} height={64} priority />
            <span>Élanor Dance<br />Academy</span>
          </div>
          <h1>개인레슨 예약</h1>
        </div>
        <form onSubmit={login}>
          <label>이름<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>전화번호<input inputMode="tel" autoComplete="tel" required placeholder="010-0000-0000" value={phone} onChange={(event) => setPhone(formatPhoneInput(event.target.value))} /></label>
          <button disabled={submitting}>{submitting ? "로그인 중..." : "로그인"}</button>
        </form>
        {error && <p className="state-message error" role="alert">{error}</p>}
      </main>
    );
  }

  const confirmedCount = info.bookings.filter((booking) => booking.status === "confirmed").length;
  const noCapacity = confirmedCount >= info.cycle.remain;
  return (
    <main className="booking-shell">
      <div className="booking-heading">
        <h1>{info.member.name}님</h1>
        <button type="button" className="secondary" disabled={submitting} onClick={logout}>로그아웃</button>
      </div>
      <p>개인레슨 {info.cycle.plan}회권 이용 중입니다.</p>
      <div className="info-grid">
        <div className="info-box">결제일<br /><strong>{info.cycle.payment_date}</strong></div>
        <div className="info-box">만료일<br /><strong>{info.cycle.valid_end_date}</strong></div>
        <div className="info-box">남은 횟수<br /><strong>{info.cycle.remain}회</strong></div>
      </div>

      <h2>예약 날짜</h2>
      <input
        aria-label="예약 날짜"
        type="date"
        min={info.cycle.first_bookable_date}
        max={info.cycle.valid_end_date}
        value={date}
        onChange={async (event) => {
          setDate(event.target.value);
          setTime(null);
          await load(event.target.value);
        }}
      />
      <p className="booking-hint">회색 시간은 다른 수업과 겹쳐 예약할 수 없습니다.</p>
      <div className="booking-times" aria-label="예약 시간">
        {times.map((slot) => (
          <button
            key={slot}
            type="button"
            className={time === slot ? "" : "secondary"}
            disabled={!date || noCapacity || info.unavailable.includes(slot)}
            aria-pressed={time === slot}
            onClick={() => setTime(slot)}
          >
            {formatTime(slot)}
          </button>
        ))}
      </div>
      {noCapacity && <p className="state-message">남은 횟수만큼 예약되어 추가 예약할 수 없습니다.</p>}
      <button disabled={time === null || submitting || noCapacity} onClick={reserve}>
        {submitting ? "예약 중..." : "예약 완료"}
      </button>
      {error && <p className="state-message error" role="alert">{error}</p>}

      <h2>내 예약</h2>
      {info.bookings.length === 0 ? <p className="state-message">예약 내역이 없습니다.</p> : (
        <ul className="booking-list">
          {info.bookings.map((booking) => (
            <li key={booking.id}>
              <span>{booking.booking_date} {formatTime(booking.start_minute)} · {statusLabel[booking.status]}</span>
              {booking.status === "confirmed" && <button type="button" className="secondary" onClick={() => cancel(booking.id)}>예약 취소</button>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
