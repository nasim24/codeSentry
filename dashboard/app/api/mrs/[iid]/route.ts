import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { getMRByIid, getIssuesByIid } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Ask the Flask server whether this MR is being reviewed right now.
 * Fails safe to false — an unreachable backend means we cannot claim
 * a review is in progress, so the UI must not show a spinner forever.
 */
async function isReviewing(mr_iid: number): Promise<boolean> {
  const port = getSetting("WEBHOOK_PORT") || "8001";
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`http://localhost:${port}/reviewing`, {
        signal: controller.signal,
        cache:  "no-store",
      });
      if (!res.ok) return false;
      const data = await res.json();
      return Array.isArray(data.reviewing) && data.reviewing.includes(mr_iid);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    const { iid } = await params;
    const mr_iid  = parseInt(iid);

    const mr     = getMRByIid(mr_iid);
    const issues = getIssuesByIid(mr_iid);

    if (!mr) {
      return NextResponse.json({ error: "MR not found" }, { status: 404 });
    }

    const reviewing = await isReviewing(mr_iid);

    return NextResponse.json({ mr, issues, reviewing });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
