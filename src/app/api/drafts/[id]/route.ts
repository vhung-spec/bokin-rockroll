import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/http";
import { deleteDraft } from "@/lib/store";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await deleteDraft((await params).id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
