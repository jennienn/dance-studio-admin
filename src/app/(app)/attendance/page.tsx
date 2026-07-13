// src/app/(app)/attendance/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

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

interface AttendanceItem {
  cycleId: string;
  memberId: number;
  memberName: string;
  remain: number;
  total: number;
  scheduleIds: number[];
  attendanceLogId: number | null;
  attended: boolean;
  needsPayment: boolean;
}

export default function AttendancePage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [className, setClassName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const [todaySchedule, setTodaySchedule] = useState<ClassSchedule | null>(null);
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ classes: ClassItem[] }>("/api/classes")
      .then((res) => {
        setClasses(res.classes);
        if (res.classes.length > 0) setClassName(res.classes[0].name);
      })
      .catch(() => setClasses([]));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    if (!className) return;
    setLoading(true);
    setError(null);
    try {
      const cls = classes.find((c) => c.name === className);
      const weekday = new Date(date).getDay();

      const schedulesRes = cls
        ? await apiFetch<{ schedules: ClassSchedule[] }>(`/api/classes/${cls.id}/schedules`)
        : { schedules: [] };
      const matched = schedulesRes.schedules.find((s) => s.weekday === weekday) ?? null;
      setTodaySchedule(matched);

      if (!matched) {
        setItems([]);
        setChecked(new Set());
        return;
      }

      const res = await apiFetch<{ items: AttendanceItem[] }>(
        `/api/attendance?className=${encodeURIComponent(className)}&date=${date}`
      );
      const filtered = res.items.filter((i) => i.scheduleIds.includes(matched.id));
      setItems(filtered);
      setChecked(new Set(filtered.filter((i) => i.attended).map((i) => i.cycleId)));
    } catch (e: any) {
      setError(e.message ?? "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [className, date, classes]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(cycleId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(cycleId)) next.delete(cycleId);
      else next.add(cycleId);
      return next;
    });
  }

  function toggleAll() {
    const allChecked = items.length > 0 && items.every((i) => checked.has(i.cycleId));
    setChecked(allChecked ? new Set() : new Set(items.map((i) => i.cycleId)));
  }

  async function handleSubmit() {
    if (!todaySchedule || items.length === 0) return;
    setSubmitting(true);
    try {
      const records = items.map((i) => ({
        cycleId: i.cycleId,
        scheduleId: todaySchedule.id,
        attended: checked.has(i.cycleId)
      }));
      await apiFetch("/api/attendance", { method: "PUT", body: JSON.stringify({ date, records }) });
      const count = checked.size;
      await load();
      setToast(`${count}명의 출석이 저장되었습니다.`);
    } catch (e: any) {
      alert(e.message ?? "저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const allChecked = items.length > 0 && items.every((i) => checked.has(i.cycleId));

  return (
    <div>
      <h1 className="page-title">단체 출석</h1>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <select value={className} onChange={(e) => setClassName(e.target.value)} style={{ width: "auto" }}>
            {classes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
          {items.length > 0 && (
            <label className="checkbox-inline" style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              전체 선택
            </label>
          )}
        </div>
      </div>

      <div className="panel">
        {loading ? (
          <p className="state-message">불러오는 중...</p>
        ) : error ? (
          <p className="state-message error">{error}</p>
        ) : !todaySchedule ? (
          <p className="state-message">선택한 날짜에는 예정된 수업이 없습니다.</p>
        ) : items.length === 0 ? (
          <p className="state-message">해당 요일 수강 회원이 없습니다.</p>
        ) : (
          <ul className="daily-list">
            {items.map((item) => (
              <li key={item.cycleId} className="daily-row">
                <label className="checkbox-inline">
                  <input type="checkbox" checked={checked.has(item.cycleId)} onChange={() => toggle(item.cycleId)} />
                  {item.memberName}
                </label>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {item.needsPayment && (
                    <span className="badge danger" style={{ fontSize: 11, padding: "2px 8px" }}>
                      결제 필요
                    </span>
                  )}
                  <span style={{ color: "var(--text-sub)" }}>잔여 {item.remain}회</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        style={{ width: "auto", padding: "10px 18px" }}
        onClick={handleSubmit}
        disabled={items.length === 0 || submitting}
      >
        {submitting ? "처리 중..." : `선택한 ${checked.size}명 출석 처리`}
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
