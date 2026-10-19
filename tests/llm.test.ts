// Kiểm tra đường gọi Claude thật (llm.ts + pipeline) bằng một server giả lập API Anthropic (SSE).
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

interface Captured {
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

const tmp = mkdtempSync(path.join(tmpdir(), "mvps-llm-"));
for (const f of readdirSync("data").filter((f) => f.endsWith(".json"))) cpSync(path.join("data", f), path.join(tmp, f));

let server: Server;
const requests: Captured[] = [];
/** Hàng đợi câu trả lời; mỗi phần tử nhận request và trả về chuỗi text của content block. */
let replies: ((req: Captured) => string)[] = [];

function sse(text: string, stop = "end_turn") {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    ev("message_start", {
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } },
    }),
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    ev("content_block_stop", { type: "content_block_stop", index: 0 }),
    ev("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 500 } }),
    ev("message_stop", { type: "message_stop" }),
  ].join("");
}

/** Câu trả lời "đúng" cho yêu cầu sinh MV: đọc số cảnh từ user prompt. */
function generationReply(req: Captured): string {
  const user = (req.body.messages as { content: string }[])[0].content;
  const n = Number(user.match(/produce exactly (\d+) shots/)![1]);
  const shots = Array.from({ length: n }, (_, i) => ({
    shot_no: i + 1,
    shot_size: ["wide", "medium", "close-up"][i % 3],
    camera: "slow push-in",
    characters_in_shot: ["HE", "SHE"],
    description_vi: `Cảnh ${i + 1}`,
    // Cảnh 2 cố tình rất dài để kích hoạt bước rút gọn; cảnh 1 có [STYLE] cần bị loại bỏ.
    prompt_core:
      i === 1
        ? `Medium shot, {{HE}} and {{SHE}} stroll along the boulevard, ${"past glowing marquees and palm trees, ".repeat(40)}warm light`
        : `${["Wide", "Medium", "Close-up"][i % 3]} shot, {{HE}} smiles at {{SHE}} beside a 1953 Cadillac Eldorado convertible, scene ${i + 1}, gentle dolly, tender [STYLE]`,
    audio: "doo-wop harmonies, street chatter",
    negative_extra: ["neon LED"],
    transition_to_next: "cut on the beat",
    signature_shot: i === 3 || i === 9 ? "eye-contact slow motion" : null,
    is_motion: /chorus/i.test(user.split("\n").find((l) => l.startsWith(`#${i + 1} `)) ?? ""),
  }));
  return JSON.stringify({
    character_bible: [
      { id: "HE", role: "male lead", description: "an early-20s man with a glossy black pompadour, white T-shirt and red varsity jacket" },
      { id: "SHE", role: "female lead", description: "an early-20s woman with platinum victory-roll curls and a mint polka-dot halter dress" },
    ],
    story_arc: [{ section: "Intro", beat_vi: "Mở đầu" }],
    shots,
    thumbnail_prompt: "{{HE}} and {{SHE}} dancing under marquee lights",
    youtube_titles: ["A", "B", "C"],
    youtube_description: "Imagine turning the dial…",
    editing_notes: [{ section: "Chorus 1", note_vi: "Cắt nhanh theo beat" }],
  });
}

function shortenReply(req: Captured): string {
  const user = (req.body.messages as { content: string }[])[0].content;
  const nums = [...user.matchAll(/^#(\d+) \(budget/gm)].map((m) => Number(m[1]));
  return JSON.stringify({ shots: nums.map((n) => ({ shot_no: n, prompt_core: "Medium shot, {{HE}} and {{SHE}} stroll along the boulevard at golden hour, tracking shot, carefree" })) });
}

type Gen = typeof import("@/lib/generate");
type Llm = typeof import("@/lib/llm");
let gen: Gen;
let llm: Llm;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const cap: Captured = { url: req.url ?? "", headers: req.headers, body: JSON.parse(raw || "{}") };
      requests.push(cap);
      const reply = replies.shift();
      if (!reply) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "no reply queued" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sse(reply(cap)));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.MV_DATA_DIR = tmp;
  delete process.env.MOCK_LLM;
  llm = await import("@/lib/llm");
  gen = await import("@/lib/generate");
});

afterAll(() => {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  requests.length = 0;
  replies = [];
});

describe("callStructured", () => {
  it("gửi structured output + fallback và retry một lần khi JSON lỗi", async () => {
    const { z } = await import("zod");
    replies = [() => "{oops", () => JSON.stringify({ ok: true })];
    const res = await llm.callStructured({
      settings: { model: "claude-sonnet-5-5", effort: "medium", useFallback: true },
      system: "sys",
      user: "hello",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      validator: z.object({ ok: z.boolean() }),
    });
    expect(res.data).toEqual({ ok: true });
    expect(res.attempts).toBe(2);
    expect(requests).toHaveLength(2);
    const body = requests[0].body as Record<string, any>;
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.stream).toBe(true);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.effort).toBe("medium");
    expect(body.fallbacks).toBe("default");
    expect(body.thinking).toBeUndefined();
    expect(String(requests[0].headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(requests[0].headers["x-api-key"]).toBe("test-key");
    expect((requests[1].body.messages as any[])[0].content).toContain("REJECTED");
  });

  it("không gửi fallback cho model không hỗ trợ", async () => {
    const { z } = await import("zod");
    replies = [() => JSON.stringify({ ok: true })];
    await llm.callStructured({
      settings: { model: "claude-haiku-5-5", effort: "low", useFallback: true },
      system: "s",
      user: "u",
      schema: { type: "object" },
      validator: z.object({ ok: z.boolean() }),
    });
    expect(requests[0].body.fallbacks).toBeUndefined();
  });
});

describe("generateMV qua Claude (giả lập)", () => {
  it("ghép prompt, bỏ [STYLE], rút gọn prompt quá dài, lưu kết quả", async () => {
    replies = [generationReply, shortenReply];
    const mv = await gen.generateMV({
      id: "1",
      world_location: "Hollywood Boulevard Summer 1954",
      theme_code: "T01",
      outline: "Chàng trai gặp cô gái",
      series: "S",
    });
    expect(mv.generator).toBe("claude");
    expect(requests).toHaveLength(2);
    const sys = (requests[0].body.system as { text: string; cache_control: unknown }[])[0];
    expect(sys.text).toContain("music-video director");
    expect(sys.cache_control).toEqual({ type: "ephemeral" });
    expect((requests[1].body.messages as any[])[0].content).toContain("too long");
    const he = mv.character_bible.characters[0].description;
    for (const s of mv.shots) {
      expect(s.prompt_en).toContain(he);
      expect(s.prompt_en).not.toContain("[STYLE]");
      expect(s.prompt_en.endsWith("Audio: doo-wop harmonies, street chatter.")).toBe(true);
      expect(s.prompt_en.length).toBeLessThanOrEqual(1800);
    }
    expect(mv.shots[1].prompt_core).toContain("golden hour");
    expect(mv.thumbnail_prompt).toContain(he);
    expect(mv.shots[0].negative_prompt).toContain("neon LED");
    expect(mv.usage!.output_tokens).toBeGreaterThan(0);
  });

  it("thiếu cảnh: retry một lần rồi tự vá bằng cảnh mẫu", async () => {
    const fewer = (req: Captured) => {
      const full = JSON.parse(generationReply(req));
      full.shots = full.shots.slice(0, 5).map((s: Record<string, unknown>) => ({ ...s, prompt_core: "Wide shot, {{HE}} waves at {{SHE}}, slow pan, warm" }));
      return JSON.stringify(full);
    };
    replies = [fewer, fewer];
    const mv = await gen.generateMV({ id: "2", world_location: "Santa Monica Pier Summer 1954", theme_code: "T01", outline: "Gặp nhau", series: "S" });
    expect(requests).toHaveLength(2);
    expect((requests[1].body.messages as any[])[0].content).toMatch(/Expected exactly \d+ shots/);
    expect(mv.shots.length).toBe(mv.structure.total_shots);
    expect(mv.generation_notes.some((n) => /bị thiếu/.test(n.message_vi))).toBe(true);
  });

  it("refusal trả lỗi rõ ràng, không retry", async () => {
    replies = [];
    server.removeAllListeners("request");
    server.on("request", (req, res) => {
      req.resume();
      req.on("end", () => {
        requests.push({ url: req.url ?? "", headers: req.headers, body: {} });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(sse("", "refusal"));
      });
    });
    await expect(gen.generateMV({ id: "3", world_location: "Times Square 1955", theme_code: "T03", outline: "x" })).rejects.toThrow(/từ chối/);
    expect(requests).toHaveLength(1);
  });
});
