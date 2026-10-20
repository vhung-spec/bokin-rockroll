// Lưu API key vào file .env.local của dự án (không commit) và áp dụng ngay, không cần khởi động lại.

import { promises as fs } from "node:fs";
import path from "node:path";

const ENV_FILE = () => path.join(/*turbopackIgnore: true*/ process.cwd(), ".env.local");
const KEY_LINE = /^\s*ANTHROPIC_API_KEY\s*=.*$/m;

export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  return key.length <= 12 ? "••••" : `${key.slice(0, 10)}…${key.slice(-4)}`;
}

async function readEnvFile(): Promise<string> {
  try {
    return await fs.readFile(ENV_FILE(), "utf8");
  } catch {
    return "";
  }
}

export async function saveApiKey(key: string) {
  const clean = key.trim();
  if (!/^[A-Za-z0-9_\-]{20,300}$/.test(clean)) throw new Error("API key không hợp lệ (thường bắt đầu bằng sk-ant-…).");
  const current = await readEnvFile();
  const line = `ANTHROPIC_API_KEY=${clean}`;
  const next = KEY_LINE.test(current) ? current.replace(KEY_LINE, line) : `${current}${current && !current.endsWith("\n") ? "\n" : ""}${line}\n`;
  await fs.writeFile(ENV_FILE(), next, { encoding: "utf8", mode: 0o600 });
  process.env.ANTHROPIC_API_KEY = clean;
}

export async function removeApiKey() {
  const current = await readEnvFile();
  if (KEY_LINE.test(current)) await fs.writeFile(ENV_FILE(), current.replace(KEY_LINE, "").replace(/\n{2,}/g, "\n"), "utf8");
  delete process.env.ANTHROPIC_API_KEY;
}

export async function keySource(): Promise<"env.local" | "env" | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return KEY_LINE.test(await readEnvFile()) ? "env.local" : "env";
}
