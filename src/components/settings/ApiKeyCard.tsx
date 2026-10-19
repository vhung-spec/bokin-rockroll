"use client";

import { useEffect, useState } from "react";
import { Card, ErrorBox, Spinner } from "@/components/ui";
import { api } from "@/lib/client";

interface KeyInfo {
  hasKey: boolean;
  masked: string | null;
  source: "env.local" | "env" | null;
}

export default function ApiKeyCard({ onChanged }: { onChanged: () => void }) {
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<string | null>(null);

  useEffect(() => {
    api<KeyInfo>("/api/apikey").then(setInfo).catch(() => {});
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setTest(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      setInfo(await api<KeyInfo>("/api/apikey", { method: "PUT", json: { key } }));
      setKey("");
      onChanged();
      const r = await api<{ ok: boolean; model?: string; error?: string }>("/api/apikey/test", { method: "POST" });
      setTest(r.ok ? `✓ Kết nối được — model ${r.model}.` : `✗ ${r.error}`);
    });

  const check = () =>
    run("test", async () => {
      const r = await api<{ ok: boolean; model?: string; error?: string }>("/api/apikey/test", { method: "POST" });
      setTest(r.ok ? `✓ Kết nối được — model ${r.model}.` : `✗ ${r.error}`);
    });

  const remove = () =>
    run("remove", async () => {
      if (!window.confirm("Xoá API key khỏi máy này?")) return;
      setInfo(await api<KeyInfo>("/api/apikey", { method: "DELETE" }));
      onChanged();
    });

  return (
    <Card title="API key của Claude">
      <div className="mb-3 rounded-lg border border-ink/20 bg-cream/60 p-3 text-sm">
        {info?.hasKey ? (
          <span>
            ✓ Đã có key <code>{info.masked}</code>
            {info.source === "env" && <span className="text-muted"> (đọc từ file .env)</span>}
          </span>
        ) : (
          <span className="text-amber-800">
            Chưa có API key. Không có key vẫn dùng được chế độ <b>claude.ai (copy – dán)</b>.
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="input min-w-64 flex-1 font-mono"
          type="password"
          autoComplete="off"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="btn-primary" disabled={!key.trim() || busy !== null} onClick={save}>
          {busy === "save" && <Spinner />} Lưu key
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn-ghost btn-sm" disabled={!info?.hasKey || busy !== null} onClick={check}>
          {busy === "test" && <Spinner />} Kiểm tra kết nối
        </button>
        {info?.source === "env.local" && (
          <button className="btn-ghost btn-sm" disabled={busy !== null} onClick={remove}>
            Xoá key
          </button>
        )}
        <a className="text-sm text-cherry underline" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
          Lấy API key ↗
        </a>
        {test && <span className={`text-sm ${test.startsWith("✓") ? "text-mint-dark" : "text-cherry"}`}>{test}</span>}
      </div>
      <p className="mt-2 text-xs text-muted">
        Key được lưu trong file <code>.env.local</code> trên máy bạn (không đưa lên GitHub), áp dụng ngay không cần khởi động lại. API key trả phí theo
        mức dùng, riêng với gói claude.ai.
      </p>
      <div className="mt-2">
        <ErrorBox error={error} />
      </div>
    </Card>
  );
}
