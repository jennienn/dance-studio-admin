import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function memberIdFrom(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: value } = await params;
  const id = memberIdFrom(value);
  if (!id) return NextResponse.json({ error: { message: "올바른 회원 ID가 아닙니다." } }, { status: 422 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("members").select("operator_memo").eq("id", id).maybeSingle();
  if (error) {
    console.error("Failed to load member memo", error.code);
    return NextResponse.json({ error: { message: "회원 메모를 불러오지 못했습니다." } }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: { message: "회원을 찾을 수 없습니다." } }, { status: 404 });
  return NextResponse.json({ memo: data.operator_memo ?? "" });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: value } = await params;
  const id = memberIdFrom(value);
  if (!id) return NextResponse.json({ error: { message: "올바른 회원 ID가 아닙니다." } }, { status: 422 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.memo !== "string" || body.memo.length > 2000) {
    return NextResponse.json({ error: { message: "메모는 2,000자 이내로 입력해주세요." } }, { status: 422 });
  }

  const memo = body.memo.trim();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("members")
    .update({ operator_memo: memo || null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("Failed to update member memo", error.code);
    return NextResponse.json({ error: { message: "회원 메모를 저장하지 못했습니다." } }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: { message: "회원을 찾을 수 없습니다." } }, { status: 404 });
  return NextResponse.json({ memo });
}
