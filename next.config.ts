import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs dùng các module Node (stream, zlib) nên chỉ chạy phía server.
  serverExternalPackages: ["exceljs"],
  // Không tự sinh AGENTS.md / CLAUDE.md vào thư mục dự án khi chạy `next dev`.
  agentRules: false,
};

export default nextConfig;
