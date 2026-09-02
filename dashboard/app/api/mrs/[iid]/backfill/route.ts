import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    const { iid } = await params;
    const port    = getSetting("WEBHOOK_PORT") || "8001";

    const res = await fetch(`http://localhost:${port}/backfill/${iid}`, {
      method:  "POST",
      headers: { "X-CodeSentry-Token": getSetting("WEBHOOK_SECRET") },
    });

    if (res.ok) {
      return NextResponse.json({
        success: true,
        message: `Syncing commits for MR !${iid} — check terminal for progress`,
      });
    }

    return NextResponse.json(
      { success: false, error: "Failed to start backfill" },
      { status: 500 }
    );

  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}