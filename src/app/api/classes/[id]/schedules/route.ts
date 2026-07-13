// src/app/api/classes/[id]/schedules/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { id } = await params;
  const { data, error } = await supabase
    .from("class_schedules")
    .select("*")
    .eq("class_id", id)
    .order("weekday");
  if (error) {
    return NextResponse.json({ error: { code: "DB_ERROR", message: error.message } }, { status: 500 });
  }
  return NextResponse.json({ schedules: data });
}
