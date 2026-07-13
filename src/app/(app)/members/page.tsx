// src/app/(app)/members/page.tsx
"use client";

import { MembersListView } from "@/components/MembersListView";

export default function MembersPage() {
  return (
    <MembersListView
      title="회원"
      statusFilter="active"
      showAddButton
      emptyMessage="해당하는 회원이 없습니다."
    />
  );
}
