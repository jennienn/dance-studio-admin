// src/lib/supabase/server.ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * API 라우트 핸들러 / 서버 컴포넌트에서 사용하는 Supabase 클라이언트.
 * 로그인한 운영자의 쿠키 세션을 그대로 사용하므로, RLS 정책(authenticated_full_access)이
 * 자동으로 적용된다 — 별도의 인증 미들웨어를 API마다 새로 작성할 필요가 없다.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        }
      }
    }
  );
}

/**
 * 서버 전용 관리자 클라이언트 (RLS 우회, service role key 사용).
 * 반드시 서버 코드(API 라우트, 스케줄러)에서만 사용하고 절대 클라이언트로 내려보내지 말 것.
 * 용도: 매일 도는 알림톡 자동발송 배치처럼, 특정 운영자 세션 없이 시스템이 직접 돌리는 작업.
 */
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
