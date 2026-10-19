import { NextResponse } from "next/server";
import { errorResponse, readJsonBody } from "@/lib/http";
import { LIBRARY_SCHEMAS, invalidPatterns } from "@/lib/schemas";
import { LIBRARY_FILES, readLibrary, writeLibrary, type LibraryName } from "@/lib/store";
import type { EraRules, Libraries, LocationLibrary } from "@/lib/types";

type Ctx = { params: Promise<{ name: string }> };

function libName(name: string): LibraryName | null {
  return name in LIBRARY_FILES ? (name as LibraryName) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const name = libName((await params).name);
  if (!name) return NextResponse.json({ error: "Không có thư viện này." }, { status: 404 });
  return NextResponse.json(await readLibrary(name));
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const name = libName((await params).name);
    if (!name) return NextResponse.json({ error: "Không có thư viện này." }, { status: 404 });
    const data = LIBRARY_SCHEMAS[name].parse(await readJsonBody(req)) as Libraries[typeof name];
    if (!Object.keys(data as object).length && name !== "locations") {
      return NextResponse.json({ error: "Thư viện không được để trống." }, { status: 400 });
    }
    const patterns: string[] = [];
    if (name === "eraRules") {
      const rules = data as EraRules;
      for (const t of rules.global_forbidden) patterns.push(...(t.patterns ?? []));
      for (const t of rules.introduced) patterns.push(...t.patterns);
      patterns.push(...rules.on_screen_text_patterns);
    }
    if (name === "locations") {
      for (const loc of Object.values(data as LocationLibrary)) for (const f of loc.forbidden ?? []) patterns.push(...(f.patterns ?? []));
    }
    const bad = invalidPatterns(patterns);
    if (bad.length) return NextResponse.json({ error: `Biểu thức regex không hợp lệ: ${bad.join(", ")}` }, { status: 400 });
    await writeLibrary(name, data);
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
