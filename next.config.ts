import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs dùng các module Node (stream, zlib); ffmpeg-static trỏ tới file chạy trong node_modules — chỉ dùng phía server.
  serverExternalPackages: ["exceljs", "ffmpeg-static"],
  // Không tự sinh AGENTS.md / CLAUDE.md vào thư mục dự án khi chạy `next dev`.
  agentRules: false,
};

export default nextConfig;
