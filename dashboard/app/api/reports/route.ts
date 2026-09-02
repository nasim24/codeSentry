import { NextResponse } from "next/server";
import { getDailyReport, getDateRangeReport } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const from  = searchParams.get("from");
    const to    = searchParams.get("to");
    const date  = searchParams.get("date");

    if (from && to) {
      const report = getDateRangeReport(from, to);
      return NextResponse.json({ from, to, ...report });
    }

    const singleDate = date || new Date().toISOString().split("T")[0];
    const report     = getDailyReport(singleDate);
    return NextResponse.json({ date: singleDate, ...report });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}