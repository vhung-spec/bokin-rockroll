"use client";

import { useCallback, useEffect, useState } from "react";
import type { Effort, Engine, ModelPrice } from "./types";

export interface AppStatus {
  mode: "claude" | "mock" | "manual";
  engine: Engine;
  hasKey: boolean;
  model: string;
  effort: Effort;
  videoModel: string;
  videoModelName: string;
  clipLen: number;
  minShots: number;
  defaultDuration: number;
  maxShots: number;
  concurrency: number;
  fixedCouple: boolean;
  price: ModelPrice | null;
  usdToVnd: number;
  pendingDrafts: number;
  renderQueue: number;
  renderQueueRunning: boolean;
}

export const MODE_LABEL: Record<AppStatus["mode"], string> = {
  claude: "Claude API",
  manual: "claude.ai (copy – dán)",
  mock: "Demo (mẫu có sẵn)",
};

/** Trạng thái app (chế độ sinh, giá model, tỷ giá…). `deps` thay đổi thì tải lại. */
export function useStatus(deps: unknown[] = []) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const reload = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { status, reload };
}
