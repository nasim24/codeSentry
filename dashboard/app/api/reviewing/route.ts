import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * MR iids the Flask server is reviewing right now.
 * Fails safe to an empty list — if the backend cannot be reached we must
 * not claim reviews are running, or the UI spins forever.
 */
export async function GET() {
  const port = getSetting("WEBHOOK_PORT") || "8001";

  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(`http://localhost:${port}/reviewing`, {
        signal: controller.signal,
        cache:  "no-store",
      });
      if (!res.ok) return NextResponse.json({ reviewing: [] });
      const data = await res.json();
      return NextResponse.json({
        reviewing: Array.isArray(data.reviewing) ? data.reviewing : [],
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return NextResponse.json({ reviewing: [] });
  }
}
