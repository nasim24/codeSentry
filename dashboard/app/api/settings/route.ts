import { NextResponse } from "next/server";
import { describeSettings, saveSettings, clearSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ settings: describeSettings() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body    = await req.json();
    const written = saveSettings(body?.values ?? {});
    return NextResponse.json({
      success:  true,
      written,
      settings: describeSettings(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key") ?? "";
    if (!clearSetting(key)) {
      return NextResponse.json(
        { success: false, error: `Unknown setting: ${key}` },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, settings: describeSettings() });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
