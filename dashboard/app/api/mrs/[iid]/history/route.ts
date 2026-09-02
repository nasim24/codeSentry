import { NextResponse } from "next/server";
import { getMRReviewHistory } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    const { iid } = await params;
    const history  = getMRReviewHistory(parseInt(iid));
    return NextResponse.json(history);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}