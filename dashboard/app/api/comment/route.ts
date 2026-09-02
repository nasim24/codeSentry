import { NextResponse } from "next/server";
import { postCommentToMR } from "@/lib/gitlab";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mr_iid, comment } = body;

    if (!mr_iid || !comment) {
      return NextResponse.json(
        { error: "mr_iid and comment are required" },
        { status: 400 }
      );
    }

    const result = await postCommentToMR(mr_iid, comment);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      note_id: result.note_id,
      message: `Comment posted to MR !${mr_iid}`,
    });

  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}