// src/components/MembersListView.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { NewMemberModal } from "@/components/NewMemberModal";
import { soloStatusText, groupStatusText, type CycleLike } from "@/lib/business-rules";

type KindFilter = "전체" | "개인" | "단체";

interface MemberCycle {
  id: string;
  status: "active" | "completed" | "expired";
  plan: 4 | 8 | 12 | null;
  total_count: number;
  used_count: number;
  valid_end_date: string | null;
  next_due_date: string | null;
}

interface MemberEnrollment {
  id: string;
  kind: "solo" | "group";
  status: "active" | "ended";
  class_id: number | null;
  classes: { name: string } | null;
  enrollment_cycles: MemberCycle[];
}

interface MemberItem {
  id: number;
  name: string;
  phone: string;
  enrollments: MemberEnrollment[];
}

const PAGE_SIZE = 10;

function getActiveEnrollment(member: MemberItem): MemberEnrollment | null {
  return member.enrollments.find((e) => e.status === "active") ?? null;
}

function getActiveCycle(enrollment: MemberEnrollment): MemberCycle | null {
  return enrollment.enrollment_cycles.find((c) => c.status === "active") ?? null;
}

function toCycleLike(enrollment: MemberEnrollment, cycle: MemberCycle): CycleLike {
  return {
    kind: enrollment.kind,
    enrollmentStatus: enrollment.status,
    cycleStatus: cycle.status,
    plan: cycle.plan,
    totalCount: cycle.total_count,
    usedCount: cycle.used_count,
    validEndDate: cycle.valid_end_date,
    nextDueDate: cycle.next_due_date
  };
}

function CurrentEnrollmentCell({ member }: { member: MemberItem }) {
  const enrollment = getActiveEnrollment(member);
  if (!enrollment) return <span style={{ color: "var(--text-mute)" }}>-</span>;

  if (enrollment.kind === "solo") {
    const cycle = getActiveCycle(enrollment);
    return <span className={`badge plan-${cycle?.plan ?? 4}`}>개인 {cycle?.plan ?? "-"}회권</span>;
  }
  return <span className="badge type-group">단체 {enrollment.classes?.name ?? "-"}</span>;
}

function toneBadgeClass(tone: "danger" | "warning" | "muted") {
  if (tone === "danger") return "badge danger";
  if (tone === "warning") return "badge warning";
  return "badge success";
}

function StatusCell({ member }: { member: MemberItem }) {
  const enrollment = getActiveEnrollment(member);
  const cycle = enrollment ? getActiveCycle(enrollment) : null;
  if (!enrollment || !cycle) return <span style={{ color: "var(--text-mute)" }}>수강 없음</span>;

  const like = toCycleLike(enrollment, cycle);
  const status = like.kind === "solo" ? soloStatusText(like) : groupStatusText(like);

  return <span className={toneBadgeClass(status.tone)}>{status.text}</span>;
}

interface MembersListViewProps {
  title: string;
  /** 서버 API의 status 쿼리 파라미터. 'active'=활성 수강권 보유, 'withdrawn'=활성 수강권 없음 */
  statusFilter: "active" | "withdrawn";
  /** 탈퇴 회원 화면은 조회 전용이라 신규 등록 버튼을 숨긴다 */
  showAddButton?: boolean;
  emptyMessage: string;
}

export function MembersListView({ title, statusFilter, showAddButton = false, emptyMessage }: MembersListViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("전체");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<MemberItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const kindParam = kindFilter === "전체" ? "" : kindFilter === "개인" ? "solo" : "group";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: statusFilter, page: String(page), pageSize: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (kindParam) params.set("kind", kindParam);

      const res = await apiFetch<{ items: MemberItem[]; total: number }>(`/api/members?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message ?? "회원 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, kindParam, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <h1 className="page-title">{title}</h1>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 또는 연락처로 검색"
            style={{ flex: "1 1 220px", minWidth: 180 }}
          />

          <div className="filter-tabs">
            {(["전체", "개인", "단체"] as KindFilter[]).map((k) => (
              <button
                key={k}
                className={`filter-tab${kindFilter === k ? " active" : ""}`}
                onClick={() => {
                  setKindFilter(k);
                  setPage(1);
                }}
              >
                {k === "전체" ? "전체" : k === "개인" ? "개인레슨" : "단체레슨"}
              </button>
            ))}
          </div>

          {showAddButton && (
            <button style={{ width: "auto", padding: "8px 16px", marginLeft: "auto" }} onClick={() => setShowAddModal(true)}>
              + 회원 등록
            </button>
          )}
        </div>

        {loading ? (
          <p className="state-message">불러오는 중...</p>
        ) : error ? (
          <p className="state-message error">{error}</p>
        ) : items.length === 0 ? (
          <p className="state-message">{emptyMessage}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>현재수강</th>
                <th>상태</th>
                <th>연락처</th>
              </tr>
            </thead>
            <tbody>
              {items.map((member) => (
                <tr key={member.id} data-clickable="true" onClick={() => router.push(`/members/${member.id}`)}>
                  <td>{member.name}</td>
                  <td>
                    <CurrentEnrollmentCell member={member} />
                  </td>
                  <td>
                    <StatusCell member={member} />
                  </td>
                  <td>{member.phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="list-footer">
          <p>
            총 {total}명 · {page}/{totalPages}페이지
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

      {showAddButton && showAddModal && (
        <NewMemberModal
          open
          onClose={() => setShowAddModal(false)}
          onSuccess={(memberId) => router.push(`/members/${memberId}`)}
        />
      )}
    </div>
  );
}
