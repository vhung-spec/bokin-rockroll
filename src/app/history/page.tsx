"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CopyButton, ErrorBox, IssueBadge, Spinner } from "@/components/ui";
import { api, exportUrl } from "@/lib/client";
import { formatMoney } from "@/lib/cost";
import type { MVSummary } from "@/lib/types";
import { useStatus } from "@/lib/useStatus";

const FORMATS = [
  ["xlsx", "XLSX"],
  ["csv", "CSV"],
  ["md", "MD"],
  ["txt", "TXT"],
  ["json", "JSON"],
  ["prompts-spaced", "File prompt (cách 1 dòng)"],
  ["prompts", "Prompt (mỗi dòng 1)"],
] as const;

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase();
}

export default function HistoryPage() {
  const [items, setItems] = useState<MVSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [series, setSeries] = useState("__all__");
  const [theme, setTheme] = useState("__all__");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [promptsText, setPromptsText] = useState<string>("");
  const { status } = useStatus();
  const rate = status?.usdToVnd ?? 26000;
  const costOf = (list: MVSummary[]) => list.reduce((a, i) => a + (i.cost_usd ?? 0), 0);

  const load = () =>
    api<MVSummary[]>("/api/mv")
      .then(setItems)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const seriesList = useMemo(() => [...new Set((items ?? []).map((i) => i.series))].sort(), [items]);
  const themeList = useMemo(() => [...new Set((items ?? []).map((i) => i.theme_code))].sort(), [items]);

  const filtered = useMemo(() => {
    const nq = norm(q.trim());
    return (items ?? []).filter((i) => {
      if (series !== "__all__" && i.series !== series) return false;
      if (theme !== "__all__" && i.theme_code !== theme) return false;
      if (!nq) return true;
      return norm(`${i.song_title} ${i.world_location} ${i.series} ${i.theme_code} ${i.theme_name} ${i.idea_id}`).includes(nq);
    });
  }, [items, q, series, theme]);

  const groups = useMemo(() => {
    const map = new Map<string, MVSummary[]>();
    for (const i of filtered) {
      const list = map.get(i.series) ?? [];
      list.push(i);
      map.set(i.series, list);
    }
    for (const list of map.values()) list.sort((a, b) => (Number(a.idea_id) || 0) - (Number(b.idea_id) || 0) || b.created_at.localeCompare(a.created_at));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const ids = [...selected];
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function remove(id: string) {
    if (!window.confirm("Xoá MV này?")) return;
    await api(`/api/mv/${id}`, { method: "DELETE" });
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    load();
  }

  async function importJson(file: File | null) {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      await api("/api/import", { method: "POST", body: await file.text(), headers: { "Content-Type": "application/json" } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  async function loadPrompts() {
    const res = await fetch(exportUrl("prompts", { ids }));
    setPromptsText(res.ok ? await res.text() : "");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-3xl uppercase">Lịch sử</h1>
          <p className="text-sm text-muted">Tất cả MV đã tạo, lưu trong data/history/. Tìm theo tên bài, địa điểm, series, chủ đề.</p>
        </div>
        <label className="btn-ghost ml-auto cursor-pointer">
          {importing && <Spinner />} Nhập lại file JSON
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => importJson(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <ErrorBox error={error} />

      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <input className="input md:col-span-2" placeholder="Tìm: Hollywood, drive-in, T01, Ferris…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" value={series} onChange={(e) => setSeries(e.target.value)}>
            <option value="__all__">Tất cả series</option>
            {seriesList.map((s) => (
              <option key={s} value={s}>
                {s || "(không có series)"}
              </option>
            ))}
          </select>
          <select className="input" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="__all__">Tất cả chủ đề</option>
            {themeList.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {ids.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/15 pt-3">
            <span className="text-sm font-semibold">
              Đã chọn {ids.length} MV
              {costOf((items ?? []).filter((i) => selected.has(i.id))) > 0 &&
                ` · chi phí ${formatMoney(costOf((items ?? []).filter((i) => selected.has(i.id))), rate)}`}{" "}
              — xuất:
            </span>
            {FORMATS.map(([f, label]) => (
              <a key={f} className={f === "xlsx" ? "btn-primary btn-sm" : "btn-ghost btn-sm"} href={exportUrl(f, { ids })}>
                {label}
              </a>
            ))}
            <button className="btn-mint btn-sm" onClick={loadPrompts}>
              Lấy tất cả prompt
            </button>
            {promptsText && <CopyButton text={promptsText} label={`Copy ${promptsText.split("\n").length} prompt`} className="btn-mint btn-sm" />}
            <button
              className="btn-ghost btn-sm"
              title="Dựng video lần lượt cho các MV đã chọn với thiết lập dựng chung"
              onClick={async () => {
                try {
                  const r = await api<{ added: number }>("/api/render-queue", { method: "POST", json: { action: "add", ids } });
                  setQueued(`Đã thêm ${r.added} MV vào hàng chờ dựng${r.added < ids.length ? ` (${ids.length - r.added} MV đã có sẵn trong hàng chờ)` : ""}.`);
                } catch (e) {
                  setQueued((e as Error).message);
                }
              }}
            >
              🎬 Thêm vào hàng chờ dựng
            </button>
            {queued && (
              <Link href="/render-queue" className="text-xs text-cherry underline">
                {queued} Mở hàng chờ →
              </Link>
            )}
            <button className="btn-ghost btn-sm ml-auto" onClick={() => setSelected(new Set())}>
              Bỏ chọn
            </button>
          </div>
        )}
      </Card>

      {!items && (
        <p className="text-sm text-muted">
          <Spinner /> Đang tải…
        </p>
      )}
      {items && !filtered.length && <p className="text-sm text-muted">Chưa có MV nào{items.length ? " khớp bộ lọc" : ""}.</p>}

      {groups.map(([name, list]) => (
        <Card
          key={name || "__none"}
          title={
            <>
              {name || "Không có series"}
              <span className="ml-2 text-xs font-normal normal-case text-muted">
                {list.length} MV{costOf(list) > 0 && ` · chi phí API ${formatMoney(costOf(list), rate)}`}
              </span>
            </>
          }
          actions={
            <>
              <button
                className="btn-ghost btn-sm"
                onClick={() =>
                  setSelected((s) => {
                    const n = new Set(s);
                    const all = list.every((i) => n.has(i.id));
                    list.forEach((i) => (all ? n.delete(i.id) : n.add(i.id)));
                    return n;
                  })
                }
              >
                Chọn cả nhóm
              </button>
              <a className="btn-primary btn-sm" href={exportUrl("xlsx", { series: name })} title="Bản mới nhất của mỗi bài, mỗi MV một sheet">
                XLSX cả series
              </a>
              <a className="btn-mint btn-sm" href={exportUrl("prompts-spaced", { series: name })} title="Tất cả prompt của series, mỗi prompt cách nhau một dòng trống">
                File prompt cả series
              </a>
            </>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="border-b border-ink/10 align-middle last:border-0">
                    <td className="w-8 p-2">
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                    </td>
                    <td className="w-12 p-2 font-bold text-cherry">#{i.idea_id}</td>
                    <td className="p-2">
                      <Link href={`/mv/${i.id}`} className="font-semibold hover:text-cherry hover:underline">
                        {i.song_title || i.world_location}
                      </Link>
                      {i.song_title && <div className="text-xs text-muted">{i.world_location}</div>}
                    </td>
                    <td className="p-2 text-xs">
                      {i.theme_code} · {i.theme_name}
                    </td>
                    <td className="p-2 text-xs">{i.shot_count} cảnh</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        <IssueBadge severity="error" count={i.error_count} />
                        <IssueBadge severity="warning" count={i.warning_count} />
                        {i.generator === "mock" && <span className="badge border-amber-500 bg-amber-100">demo</span>}
                        {i.generator === "manual" && <span className="badge border-sky-400 bg-sky-50">claude.ai</span>}
                        {i.cost_usd > 0 && <span className="badge">{formatMoney(i.cost_usd, rate)}</span>}
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted">{new Date(i.created_at).toLocaleString("vi-VN")}</td>
                    <td className="p-2 text-right">
                      <button className="btn-ghost btn-sm" onClick={() => remove(i.id)} title="Xoá">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
