import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { zSettings } from "@/lib/schemas";
import { readSettings, writeSettings } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function PUT(req: Request) {
  try {
    const settings = zSettings.parse(await readJsonBody(req));
    await writeSettings(settings);
    return NextResponse.json(await readSettings());
  } catch (err) {
    return errorResponse(err);
  }
}
