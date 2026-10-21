"use client";

import { useEffect, useRef, useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { useLocale } from "./locale-provider";

export type GatewayModel = {
  id: string;
  enabled: boolean;
  maintenance_message?: string | null;
  node?: unknown;
};
type GatewayNode = {
  name: string;
  enabled?: boolean;
  role?: string;
  models?: string[];
  reachable?: boolean;
  state?: string;
};
export type GatewayOverview = {
  gatewayConfigured: boolean;
  state: { models?: GatewayModel[] } | null;
  nodes: { nodes?: GatewayNode[]; actions?: string[] } | null;
  metrics: {
    gpu_source_up?: boolean;
    vllm_source_up?: boolean;
    gpus?: unknown[];
    serving?: Record<string, unknown> | null;
  } | null;
  errors: { state: string | null; nodes: string | null; metrics: string | null };
};
export type Job = { key: number; node: string; action: string; jobId: string };

export const NODE_ACTIONS = ["start", "stop", "restart", "check", "backup", "fw-status"];
export const ACTION_ZH: Record<string, string> = {
  start: "啟動",
  stop: "停止",
  restart: "重啟",
  check: "檢查",
  backup: "備份",
  "fw-status": "防火牆狀態",
};
const TERMINAL_STATES = ["done", "error", "failed"];
const POLL_MS = 5000;
const MAX_POLLS = 60;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const pick = (record: Record<string, unknown>, keys: string[]): unknown =>
  keys.map((key) => record[key]).find((value) => value !== undefined && value !== null);
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "—";

export function BlockError({ message, code }: { message: string; code: string }) {
  return (
    <p className="portal-error" role="alert">
      {message} <code>{code}</code>
    </p>
  );
}

export function JobStatus({ job, onSettled }: { job: Job; onSettled: () => void }) {
  const zh = useLocale().locale === "zh";
  const [state, setState] = useState<string>("pending");
  const [failure, setFailure] = useState<unknown>(null);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });
  useEffect(() => {
    let polls = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      polls += 1;
      try {
        const result = await portalRequest<{ state?: string }>(
          `/admin/gateway/nodes/${encodeURIComponent(job.node)}/jobs/${encodeURIComponent(job.jobId)}`,
        );
        if (stopped) return;
        setFailure(null);
        setState(result.state ?? "unknown");
        if (result.state && TERMINAL_STATES.includes(result.state)) {
          stopped = true;
          clearInterval(timer);
          settledRef.current();
          return;
        }
      } catch (reason: unknown) {
        if (stopped) return;
        setFailure(reason);
      }
      if (polls >= MAX_POLLS) {
        stopped = true;
        clearInterval(timer);
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [job.node, job.jobId]);
  const locale = useLocale().locale;
  return (
    <li>
      <code>{job.node}</code> · {zh ? (ACTION_ZH[job.action] ?? job.action) : job.action} ·{" "}
      {zh ? "工作" : "job"} <code>{job.jobId}</code> · {zh ? "狀態：" : "state: "}
      <strong>{state}</strong>
      {failure !== null && (
        <span className="portal-error" role="alert"> {portalErrorText(failure, locale)}</span>
      )}
    </li>
  );
}

export function MaintenanceDialog({
  model,
  onClose,
  onDone,
}: {
  model: GatewayModel;
  onClose: () => void;
  onDone: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [message, setMessage] = useState(model.maintenance_message ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save(next: string) {
    setBusy(true);
    setError(null);
    try {
      await portalRequest(`/admin/gateway/models/${encodeURIComponent(model.id)}/maintenance`, {
        method: "POST",
        body: JSON.stringify({ message: next }),
      });
      onDone();
    } catch (reason: unknown) {
      setError(reason);
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title={zh ? `維護訊息：${model.id}` : `Maintenance message: ${model.id}`}
      confirmLabel={zh ? "儲存" : "Save"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={() => save(message.trim())}
      onClose={onClose}
      inFlight={busy}
      extraActions={
        <button type="button" className="portal-button-secondary" disabled={busy} onClick={() => save("")}>
          {zh ? "清除訊息" : "Clear message"}
        </button>
      }
    >
      <label className="portal-field">
        {zh ? "訊息" : "Message"}
        <textarea rows={3} maxLength={300} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} />
      </label>
      {error !== null && (
        <p className="portal-error" role="alert">{portalErrorText(error, locale)}</p>
      )}
    </AdminDialog>
  );
}

export function ConfirmNodeDialog({
  node,
  action,
  onClose,
  onConfirm,
  busy,
}: {
  node: string;
  action: string;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const zh = useLocale().locale === "zh";
  const restart = action === "restart";
  return (
    <AdminDialog
      title={zh ? `${restart ? "重啟" : "停止"}節點 ${node}？` : `${restart ? "Restart" : "Stop"} node ${node}?`}
      confirmLabel={zh ? (restart ? "重啟節點" : "停止節點") : restart ? "Restart node" : "Stop node"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={onConfirm}
      onClose={onClose}
      inFlight={busy}
      danger
    >
      <p className="portal-note">
        {zh
          ? "此節點上的模型會中斷服務，進行中的請求可能失敗。"
          : "Models on this node stop serving and in-flight requests may fail."}
      </p>
    </AdminDialog>
  );
}

export function GpuPanel({ metrics, zh }: { metrics: NonNullable<GatewayOverview["metrics"]>; zh: boolean }) {
  const gpus = (metrics.gpus ?? []).map(asRecord).filter((gpu) => gpu !== null);
  const serving = asRecord(metrics.serving);
  const running = serving ? finite(serving.running) : null;
  const waiting = serving ? finite(serving.waiting) : null;
  const cell = (value: unknown, suffix = "") => (value === undefined ? "—" : `${text(value)}${suffix}`);
  return (
    <>
      {(metrics.gpu_source_up === false || metrics.vllm_source_up === false) && (
        <p className="portal-note" role="status">
          {zh ? "部分指標來源目前離線。" : "Some metric sources are currently offline."}
        </p>
      )}
      {running !== null || waiting !== null ? (
        <p>
          {zh ? "服務中：" : "Serving: "}
          {zh ? `執行中 ${running ?? "—"}` : `Running ${running ?? "—"}`} ·{" "}
          {zh ? `等待 ${waiting ?? "—"}` : `Waiting ${waiting ?? "—"}`}
        </p>
      ) : null}
      {gpus.length > 0 ? (
        <div className="portal-table-wrap">
          <table className="portal-table">
            <caption className="sr-only">{zh ? "GPU 指標" : "GPU metrics"}</caption>
            <thead>
              <tr>
                <th scope="col">GPU</th>
                <th scope="col">{zh ? "名稱" : "Name"}</th>
                <th scope="col">{zh ? "使用率" : "Utilization"}</th>
                <th scope="col">{zh ? "記憶體（已用 / 總量，GB）" : "Memory (used / total, GB)"}</th>
                <th scope="col">{zh ? "溫度" : "Temp"}</th>
                <th scope="col">{zh ? "功耗" : "Power"}</th>
              </tr>
            </thead>
            <tbody>
              {gpus.map((gpu, index) => {
                // Field names follow the gateway's /api/metrics gpus[] (sell-panel app.py api_metrics).
                const used = pick(gpu, ["mem_used_gb"]);
                const total = pick(gpu, ["mem_total_gb"]);
                return (
                  <tr key={index}>
                    <td>{cell(pick(gpu, ["index"]) ?? index)}</td>
                    <td>{cell(pick(gpu, ["model", "name"]))}</td>
                    <td>{cell(pick(gpu, ["util"]), "%")}</td>
                    <td>{used === undefined && total === undefined ? "—" : `${cell(used)} / ${cell(total)} GB`}</td>
                    <td>{cell(pick(gpu, ["temp_c"]), "°C")}</td>
                    <td>{cell(pick(gpu, ["power_w"]), " W")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="portal-empty">{zh ? "沒有 GPU 資料。" : "No GPU data."}</p>
      )}
    </>
  );
}
