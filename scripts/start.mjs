#!/usr/bin/env node
// Khởi động MV Prompt Studio bằng một lệnh: cài thư viện (nếu cần) → build (nếu mã nguồn đổi) → chạy → mở trình duyệt.
// Được gọi từ "Chay-MV-Prompt-Studio.bat" (Windows) và "Chay-MV-Prompt-Studio.command" (macOS / Linux).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const HOST = "127.0.0.1";

function log(msg) {
  console.log(`\x1b[36m▶\x1b[0m ${msg}`);
}

function fail(msg) {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
  process.exit(1);
}

function run(cmd, args, label) {
  log(label);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: isWin });
  if (res.status !== 0) fail(`${label} thất bại (mã lỗi ${res.status}). Xem thông báo phía trên.`);
}

/** Thời điểm sửa mới nhất của mã nguồn app (để biết có cần build lại không). */
const SOURCES = ["src", "package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"];
function newestMtime(p) {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(p).reduce((m, name) => Math.max(m, newestMtime(path.join(p, name))), st.mtimeMs);
}

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once("error", () => tryPort(port + 1));
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, HOST);
    };
    tryPort(start);
  });
}

function openBrowser(url) {
  const cmd = isWin ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWin ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // không mở được trình duyệt tự động — người dùng tự mở địa chỉ in ra bên dưới
  }
}

async function waitFor(url, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // server chưa sẵn sàng
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// 1. Kiểm tra Node.js
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  fail(`Cần Node.js 20.9 trở lên (máy đang có ${process.versions.node}). Tải bản LTS tại https://nodejs.org rồi chạy lại.`);
}

console.log("\n\x1b[1m🎙️  MV Prompt Studio\x1b[0m\n");

// 2. Cài thư viện lần đầu / khi package-lock thay đổi
const lock = path.join(ROOT, "package-lock.json");
const installed = path.join(ROOT, "node_modules", ".package-lock.json");
if (!existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs) {
  run(npm, ["install", "--no-audit", "--no-fund"], "Đang cài thư viện (lần đầu mất vài phút)…");
}

// 3. Build khi chưa có hoặc mã nguồn đã thay đổi
const buildId = path.join(ROOT, ".next", "BUILD_ID");
if (!existsSync(buildId) || Math.max(...SOURCES.map((f) => newestMtime(path.join(ROOT, f)))) > statSync(buildId).mtimeMs) {
  run(npm, ["run", "build"], "Đang chuẩn bị app (build)…");
}

// 4. Mở Cổng Muse (server riêng ở 127.0.0.1:18700, điều khiển Muse qua Chrome) — tắt app là tắt cổng.
//    Cổng viết bằng TypeScript, Node chạy thẳng (cần Node 22.18 trở lên). NO_MUSE_GATEWAY=1 để không mở.
let gateway = null;
const canRunTs = major > 22 || (major === 22 && minor >= 18);
if (process.env.NO_MUSE_GATEWAY) {
  // người dùng tắt cổng
} else if (!canRunTs) {
  log(`Bỏ qua Cổng Muse: cần Node.js 22.18 trở lên (máy đang có ${process.versions.node}).`);
} else {
  gateway = spawn(process.execPath, [path.join(ROOT, "gateway", "server.ts")], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
  gateway.on("error", (e) => log(`Không mở được Cổng Muse: ${e.message}`));
}

// 5. Chạy và mở trình duyệt
const port = await freePort(Number(process.env.PORT) || 3000);
const url = `http://${HOST}:${port}`;
log(`Đang khởi động tại ${url} …`);
const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-H", HOST, "-p", String(port)], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
server.on("exit", (code) => {
  gateway?.kill();
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    gateway?.kill(sig);
    server.kill(sig);
  });
}

if (await waitFor(`http://${HOST}:${port}/api/status`)) {
  console.log(`\n\x1b[32m✔ Đã sẵn sàng: ${url}\x1b[0m`);
  console.log("  Giữ cửa sổ này mở trong khi dùng app. Đóng cửa sổ (hoặc nhấn Ctrl+C) để tắt.\n");
  if (!process.env.NO_BROWSER) openBrowser(url);
} else {
  console.log(`\nApp chưa phản hồi — hãy thử mở ${url} trong trình duyệt.`);
}
