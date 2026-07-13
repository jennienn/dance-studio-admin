// src/app/(app)/members/withdrawn/page.tsx
"use client";

import { MembersListView } from "@/components/MembersListView";

export default function WithdrawnMembersPage() {
  return (
    <MembersListView
      title="탈퇴 회원"
      statusFilter="withdrawn"
      emptyMessage="탈퇴한 회원이 없습니다."
    />
  );
}
