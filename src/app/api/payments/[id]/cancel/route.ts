// src/app/api/payments/[id]/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// 잘못 입력했거나 즉시 무효가 된 결제 처리. 레코드는 삭제하지 않고 상태만 바꾼다.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("payments").update({ status: "cancelled" }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
