import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ iid: string }> }
) {
  try {
    const { iid }  = await params;
    const port     = getSetting("WEBHOOK_PORT") || "8001";
    const baseUrl  = `http://localhost:${port}`;

    // Call the Python server to trigger a re-review
    const res = await fetch(`${baseUrl}/review/${iid}`, {
      method: "POST",
      headers: {
        "Content-Type":       "application/json",
        // Flask requires this on trigger routes; ngrok forwards to
        // localhost so a loopback check alone would protect nothing.
        "X-CodeSentry-Token": getSetting("WEBHOOK_SECRET"),
      },
    });

    if (res.ok) {
      return NextResponse.json({
        success: true,
        message: `Re-review queued for MR !${iid}`,
      });
    }

    return NextResponse.json(
      { success: false, error: "Failed to queue review" },
      { status: 500 }
    );

  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}