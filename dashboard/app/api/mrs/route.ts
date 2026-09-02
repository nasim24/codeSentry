import { NextResponse } from "next/server";
import { getOpenMRs } from "@/lib/db";

export async function GET() {
  try {
    const mrs = getOpenMRs();
    return NextResponse.json(mrs);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}