import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const month = request.nextUrl.searchParams.get("month");
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const validMonth = month && /^\d{4}-\d{2}$/.test(month);
  if (!validDate && !validMonth) {
    return NextResponse.json({ error: { message: "조회 날짜를 확인해주세요." } }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("solo_booking_blocks")
    .select("id,block_date,start_minute,end_minute")
    .order("block_date")
    .order("start_minute");

  if (validDate) {
    query = query.eq("block_date", date);
  } else {
    const [year, monthNumber] = month!.split("-").map(Number);
    const nextMonth = monthNumber === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;
    query = query.gte("block_date", `${month}-01`).lt("block_date", nextMonth);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to load booking blocks", error.code);
    return NextResponse.json({ error: { message: "차단 일정을 불러오지 못했습니다." } }, { status: 500 });
  }
  return NextResponse.json({
    blocks: (data ?? []).map((row) => ({
      id: row.id,
      blockDate: row.block_date,
      startMinute: row.start_minute,
      endMinute: row.end_minute
    }))
  });
}

export async function POST(request: NextRequest) {
  const { date, startMinute, endMinute } = await request.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
    return NextResponse.json({ error: { message: "차단 날짜와 시간을 확인해주세요." } }, { status: 422 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_solo_booking_block_atomic", {
    p_date: date,
    p_start_minute: startMinute,
    p_end_minute: endMinute,
    p_reason: ""
  });
  if (error) {
    const conflict = error.message.includes("BLOCK_BOOKING_CONFLICT");
    const overlap = error.message.includes("BLOCK_OVERLAP") || error.code === "23P01";
    return NextResponse.json({ error: { message: conflict
      ? "해당 시간과 겹치는 기존 예약이 있습니다. 예약을 먼저 확인해주세요."
      : overlap
        ? "이미 차단된 시간과 겹칩니다."
        : "차단 날짜와 시간을 확인해주세요." } }, { status: conflict || overlap ? 409 : 422 });
  }
  return NextResponse.json({ id: data }, { status: 201 });
}
