"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setError("비밀번호는 8자 이상 입력해주세요.");
    if (password !== confirmation) return setError("비밀번호가 서로 일치하지 않습니다.");
    setLoading(true);
    setError(null);
    const result = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (result.error) {
      setError("재설정 링크가 만료되었거나 올바르지 않습니다. 새 링크를 요청해주세요.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: "0 20px" }}>
      <h1 className="page-title">비밀번호 재설정</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="new-password">새 비밀번호</label>
        <input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} style={{ width: "100%", margin: "6px 0 12px" }} />
        <label htmlFor="confirm-password">새 비밀번호 확인</label>
        <input id="confirm-password" type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={{ width: "100%", margin: "6px 0 12px" }} />
        {error && <p role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%" }}>{loading ? "변경 중..." : "비밀번호 변경"}</button>
      </form>
    </main>
  );
}
