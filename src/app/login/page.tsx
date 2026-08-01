// src/app/login/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      setError("비밀번호를 재설정할 이메일을 입력해주세요.");
      return;
    }
    setResetting(true);
    setError(null);
    setNotice(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`
    });
    setResetting(false);
    if (error) {
      setError("재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setNotice("계정이 존재하면 비밀번호 재설정 메일이 발송됩니다.");
  }

  return (
    <main style={{ maxWidth: 320, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 20 }}>운영자 로그인</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        {error && <p role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}
        {notice && <p role="status" style={{ color: "var(--success)", fontSize: 13 }}>{notice}</p>}
        <button type="submit" disabled={loading} style={{ width: "100%", padding: 10 }}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
        <button type="button" className="secondary" disabled={loading || resetting} onClick={handleResetPassword} style={{ width: "100%", padding: 10, marginTop: 8 }}>
          {resetting ? "메일 발송 중..." : "비밀번호 재설정"}
        </button>
      </form>
    </main>
  );
}
