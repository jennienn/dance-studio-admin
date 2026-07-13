// src/app/(app)/daily/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

const PLANS = [4, 8, 12] as const;

interface MemberCycle {
  id: string;
  status: "active" | "completed" | "expired";
  plan: 4 | 8 | 12 | null;
  total_count: number;
  used_count: number;
}

interface MemberEnrollment {
  id: string;
  kind: "solo" | "group";
  status: "active" | "ended";
  enrollment_cycles: MemberCycle[];
}

interface MemberItem {
  id: number;
  name: string;
  enrollments: MemberEnrollment[];
}

interface SessionRow {
  session_index: number;
  status: "pending" | "done" | "auto";
  date: string | null;
}

interface DailyItem {
  cycleId: string;
  memberId: number;
  memberName: string;
  plan: 4 | 8 | 12;
  remain: number;
}

export default function DailyPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [items, setItems] = useState<DailyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind: "solo", pageSize: "500" });
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await apiFetch<{ items: MemberItem[] }>(`/api/members?${params.toString()}`);
      const candidates: DailyItem[] = [];
      for (const member of res.items) {
        const enrollment = member.enrollments.find((e) => e.kind === "solo" && e.status === "active");
        const cycle = enrollment?.enrollment_cycles.find((c) => c.status === "active");
        if (!enrollment || !cycle || !cycle.plan) continue;
        const remain = cycle.total_count - cycle.used_count;
        if (remain <= 0) continue;
        candidates.push({ cycleId: cycle.id, memberId: member.id, memberName: member.name, plan: cycle.plan, remain });
      }

      // 선택한 날짜에 이미 기록(done/auto)된 회차가 있는 cycle은 후보에서 제외 —
      // 그렇지 않으면 이미 다녀간 사람이 목록에 남아 중복 처리를 시도하게 된다.
      const alreadyRecordedFlags = await Promise.all(
        candidates.map(async (item) => {
          const { sessions } = await apiFetch<{ sessions: SessionRow[] }>(`/api/cycles/${item.cycleId}/sessions`);
          return sessions.some((s) => s.date === date && s.status !== "pending");
        })
      );
      const list = candidates.filter((_, i) => !alreadyRecordedFlags[i]);

      setItems(list);
      setSelectedIds(new Set());
    } catch (e: any) {
      setError(e.message ?? "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, date]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(cycleId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cycleId)) next.delete(cycleId);
      else next.add(cycleId);
      return next;
    });
  }

  function toggleGroup(plan: (typeof PLANS)[number], groupItems: DailyItem[]) {
    const allSelected = groupItems.every((i) => selectedIds.has(i.cycleId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const i of groupItems) {
        if (allSelected) next.delete(i.cycleId);
        else next.add(i.cycleId);
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    const targets = items.filter((i) => selectedIds.has(i.cycleId));

    const results = await Promise.allSettled(
      targets.map(async (item) => {
        const { sessions } = await apiFetch<{ sessions: SessionRow[] }>(`/api/cycles/${item.cycleId}/sessions`);
        const nextPending = sessions
          .filter((s) => s.status === "pending")
          .sort((a, b) => a.session_index - b.session_index)[0];
        if (!nextPending) throw new Error(`${item.memberName}: 남은 회차가 없습니다.`);
        await apiFetch(`/api/cycles/${item.cycleId}/sessions`, {
          method: "POST",
          body: JSON.stringify({ sessionIndex: nextPending.session_index, date, expired: false })
        });
      })
    );

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    setSubmitting(false);
    await load();

    if (successCount > 0) setToast(`${successCount}명의 수업 기록이 저장되었습니다.`);
    if (failed.length > 0) {
      alert(`${failed.length}건 처리에 실패했습니다.\n` + failed.map((f) => f.reason?.message ?? "알 수 없는 오류").join("\n"));
    }
  }

  const grouped = PLANS.map((plan) => ({
    plan,
    list: items.filter((i) => i.plan === plan)
  }));

  return (
    <div>
      <h1 className="page-title">오늘 수업</h1>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="회원 이름으로 검색"
            style={{ flex: "1 1 220px", minWidth: 180 }}
          />
        </div>
      </div>

      {loading ? (
        <p className="state-message">불러오는 중...</p>
      ) : error ? (
        <p className="state-message error">{error}</p>
      ) : items.length === 0 ? (
        <p className="state-message">잔여 회차가 있는 개인레슨 회원이 없습니다.</p>
      ) : (
        grouped.map(
          ({ plan, list }) =>
            list.length > 0 && (
              <div className="panel" key={plan}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span className={`badge plan-${plan}`}>{plan}회권</span>
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={list.every((i) => selectedIds.has(i.cycleId))}
                      onChange={() => toggleGroup(plan, list)}
                    />
                    전체 선택
                  </label>
                </div>
                <ul className="daily-list">
                  {list.map((item) => (
                    <li key={item.cycleId} className="daily-row">
                      <label className="checkbox-inline">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.cycleId)}
                          onChange={() => toggle(item.cycleId)}
                        />
                        {item.memberName}
                      </label>
                      <span style={{ color: "var(--text-sub)" }}>잔여 {item.remain}회</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
        )
      )}

      <button style={{ width: "auto", padding: "10px 18px" }} onClick={handleSubmit} disabled={selectedIds.size === 0 || submitting}>
        {submitting ? "처리 중..." : `선택한 ${selectedIds.size}명 수업 완료 처리`}
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
