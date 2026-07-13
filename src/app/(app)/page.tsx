// src/app/(app)/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { RenewSoloModal } from "@/components/RenewSoloModal";
import { RenewGroupModal } from "@/components/RenewGroupModal";

type Tone = "danger" | "warning" | "muted";
type CardFilter = "unpaid" | "unsent";
type TypeFilter = "전체" | "개인" | "단체";

interface EnrollmentListItem {
  cycleId: string;
  enrollmentId: string;
  memberId: number;
  memberName: string;
  kind: "solo" | "group";
  className: string | null;
  label: string;
  statusText: string;
  tone: Tone;
  remain: number;
  total: number;
  notifyStatus: "pending" | "sent" | "skipped" | "failed" | "not_required";
  notifyDate: string | null;
}

const PAGE_SIZE = 8;

function toneColor(tone: Tone) {
  if (tone === "danger") return "var(--danger)";
  if (tone === "warning") return "var(--warning)";
  return "var(--text-sub)";
}

function NotiBadge({ status }: { status: EnrollmentListItem["notifyStatus"] }) {
  if (status === "sent") return <span className="noti sent">✓ 발송됨</span>;
  if (status === "failed") return <span className="noti failed">⚠ 발송 실패</span>;
  if (status === "pending") return <span className="noti none">발송 대기</span>;
  return <span className="noti none">-</span>;
}

async function fetchTodayGroupCount(): Promise<number> {
  try {
    const { classes } = await apiFetch<{ classes: { id: number; name: string }[] }>("/api/classes");
    const todayWeekday = new Date().getDay();
    const todayStr = new Date().toISOString().slice(0, 10);
    let count = 0;

    for (const cls of classes) {
      const { schedules } = await apiFetch<{ schedules: { id: number; weekday: number }[] }>(
        `/api/classes/${cls.id}/schedules`
      );
      const todaySchedule = schedules.find((s) => s.weekday === todayWeekday);
      if (!todaySchedule) continue;

      const { items } = await apiFetch<{ items: { scheduleIds: number[] }[] }>(
        `/api/attendance?className=${encodeURIComponent(cls.name)}&date=${todayStr}`
      );
      count += items.filter((i) => i.scheduleIds.includes(todaySchedule.id)).length;
    }
    return count;
  } catch {
    return 0;
  }
}

export default function HomePage() {
  const [cardFilter, setCardFilter] = useState<CardFilter>("unpaid");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("전체");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<EnrollmentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unpaidCount, setUnpaidCount] = useState<number | null>(null);
  const [unsentCount, setUnsentCount] = useState<number | null>(null);
  const [todayGroupCount, setTodayGroupCount] = useState<number | null>(null);
  const [totalMembers, setTotalMembers] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [renewSolo, setRenewSolo] = useState<EnrollmentListItem | null>(null);
  const [renewGroup, setRenewGroup] = useState<EnrollmentListItem | null>(null);

  const typeParam = typeFilter === "전체" ? "" : typeFilter === "개인" ? "solo" : "group";

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: cardFilter,
        page: String(page),
        pageSize: String(PAGE_SIZE)
      });
      if (typeParam) params.set("type", typeParam);

      const res = await apiFetch<{ items: EnrollmentListItem[]; total: number }>(
        `/api/enrollments?${params.toString()}`
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message ?? "목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [cardFilter, typeParam, page]);

  const loadMetrics = useCallback(async () => {
    try {
      const [unpaid, unsent, todayCount, members] = await Promise.all([
        apiFetch<{ total: number }>("/api/enrollments?status=unpaid&pageSize=1"),
        apiFetch<{ total: number }>("/api/enrollments?status=unsent&pageSize=1"),
        fetchTodayGroupCount(),
        apiFetch<{ total: number }>("/api/members?pageSize=1")
      ]);
      setUnpaidCount(unpaid.total);
      setUnsentCount(unsent.total);
      setTodayGroupCount(todayCount);
      setTotalMembers(members.total);
    } catch {
      // 메트릭 실패는 화면 전체를 막지 않는다 — 카드에 '-'만 남는다
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  function refreshAll() {
    loadList();
    loadMetrics();
  }

  async function handleEnd(item: EnrollmentListItem) {
    if (!confirm(`${item.memberName}님의 "${item.label}" 수강을 종료 처리할까요?`)) return;
    try {
      await apiFetch(`/api/enrollments/${item.enrollmentId}/end`, { method: "POST", body: JSON.stringify({}) });
      refreshAll();
    } catch (e: any) {
      alert(e.message ?? "처리에 실패했습니다.");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>
          홈
        </h1>
        <span style={{ fontSize: 13, color: "var(--text-sub)" }}>
          오늘 {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })}
        </span>
      </div>

      <div className="metrics">
        <div
          className={`metric-card clickable${cardFilter === "unpaid" ? " selected" : ""}`}
          onClick={() => {
            setCardFilter("unpaid");
            setPage(1);
          }}
        >
          <p className="metric-label">결제 확인 필요</p>
          <p className="metric-value">{unpaidCount ?? "-"}건</p>
        </div>
        <div
          className={`metric-card clickable${cardFilter === "unsent" ? " selected" : ""}`}
          onClick={() => {
            setCardFilter("unsent");
            setPage(1);
          }}
        >
          <p className="metric-label">알림톡 미발송</p>
          <p className="metric-value">{unsentCount ?? "-"}건</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">오늘 수업 예정</p>
          <p className="metric-value">{todayGroupCount ?? "-"}명</p>
        </div>
      </div>
      <p className="meta-line">전체 회원 {totalMembers ?? "-"}명</p>

      <div className="panel">
        <div className="filter-tabs" style={{ marginBottom: 14 }}>
          {(["전체", "개인", "단체"] as TypeFilter[]).map((t) => (
            <button
              key={t}
              className={`filter-tab${typeFilter === t ? " active" : ""}`}
              onClick={() => {
                setTypeFilter(t);
                setPage(1);
              }}
            >
              {t === "전체" ? "전체" : t === "개인" ? "개인레슨" : "단체레슨"}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="state-message">불러오는 중...</p>
        ) : error ? (
          <p className="state-message error">{error}</p>
        ) : items.length === 0 ? (
          <p className="state-message">해당하는 항목이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>회원</th>
                <th>수강권</th>
                <th>결제 상태</th>
                <th>알림톡</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.cycleId}>
                  <td>{item.memberName}</td>
                  <td>
                    <span className={`badge ${item.kind === "solo" ? `plan-${item.total}` : "type-group"}`}>
                      {item.kind === "solo" ? `${item.total}회` : "단체"}
                    </span>
                  </td>
                  <td>
                    <span className="badge danger" style={{ marginRight: 6 }}>
                      결제 필요
                    </span>
                    <span style={{ color: toneColor(item.tone), fontWeight: 500 }}>{item.statusText}</span>
                  </td>
                  <td>
                    <NotiBadge status={item.notifyStatus} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      style={{ width: "auto", padding: "6px 12px", fontSize: 12 }}
                      onClick={() => (item.kind === "solo" ? setRenewSolo(item) : setRenewGroup(item))}
                    >
                      결제 확인
                    </button>{" "}
                    <button
                      className="secondary"
                      style={{ width: "auto", padding: "6px 10px", fontSize: 12, color: "var(--danger)" }}
                      onClick={() => handleEnd(item)}
                    >
                      종료
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="list-footer">
          <p>
            총 {total}건 · {page}/{totalPages}페이지
          </p>
          <div className="btns">
            <button className="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              이전
            </button>
            <button className="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              다음
            </button>
          </div>
        </div>
      </div>

      {renewSolo && (
        <RenewSoloModal
          open
          onClose={() => setRenewSolo(null)}
          onSuccess={refreshAll}
          enrollmentId={renewSolo.enrollmentId}
          memberName={renewSolo.memberName}
          currentRemain={renewSolo.remain}
        />
      )}
      {renewGroup && (
        <RenewGroupModal
          open
          onClose={() => setRenewGroup(null)}
          onSuccess={refreshAll}
          enrollmentId={renewGroup.enrollmentId}
          memberName={renewGroup.memberName}
          className={renewGroup.className ?? ""}
        />
      )}
    </div>
  );
}
