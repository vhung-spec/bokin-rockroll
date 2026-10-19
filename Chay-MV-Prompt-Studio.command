#!/bin/bash
# MV Prompt Studio — bấm đúp để chạy (macOS). Trên Linux: ./Chay-MV-Prompt-Studio.command
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Chưa cài Node.js. Hãy cài bản LTS tại https://nodejs.org rồi chạy lại file này."
  (command -v open >/dev/null && open "https://nodejs.org/") || (command -v xdg-open >/dev/null && xdg-open "https://nodejs.org/")
  read -r -p "Nhấn Enter để đóng…"
  exit 1
fi
node scripts/start.mjs
