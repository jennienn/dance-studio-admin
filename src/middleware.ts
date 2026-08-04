// src/middleware.ts
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 요구사항명세서 4장: "인증 - 운영자 로그인 필수. 비로그인 상태에서는 어떤 데이터도 조회 불가"
export async function middleware(request: NextRequest) {
  if (request.nextUrl.hostname === "www.elanoracademy.com") {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.hostname = "elanoracademy.com";
    return NextResponse.redirect(canonicalUrl, 308);
  }

  const response = NextResponse.next();

  // 내부 스케줄러 엔드포인트는 별도 시크릿으로 보호하므로 세션 인증에서 제외
  if (request.nextUrl.pathname.startsWith("/api/internal")) {
    return response;
  }
  if (
    request.nextUrl.pathname === "/booking" ||
    request.nextUrl.pathname === "/api/booking" ||
    request.nextUrl.pathname.startsWith("/api/booking/")
  ) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          response.cookies.set({ name, value: "", ...options });
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/login";
  const isPublicAuthPage = isLoginPage || request.nextUrl.pathname === "/reset-password";

  if (!user && !isPublicAuthPage) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "로그인이 필요합니다." } },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
