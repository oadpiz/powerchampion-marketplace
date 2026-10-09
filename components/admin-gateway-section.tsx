"use client";

import { useEffect, useRef, useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { GatewayNotConnected } from "./admin-keys-section";
import { ResourceState, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type GatewayModel = {
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
type GatewayOverview = {
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
type Job = { key: number; node: string; action: string; jobId: string };

const NODE_ACTIONS = ["start", "stop", "restart", "check", "backup", "fw-status"];
const ACTION_ZH: Record<string, string> = {
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
const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "—";

function BlockError({ message, code }: { message: string; code: string }) {
  return (
    <p className="portal-error" role="alert">
      {message} <code>{code}</code>
    </p>
  );
}

function JobStatus({ job, onSettled }: { job: Job; onSettled: () => void }) {
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

function MaintenanceDialog({
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

function ConfirmNodeDialog({
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

function GpuPanel({ metrics, zh }: { metrics: NonNullable<GatewayOverview["metrics"]>; zh: boolean }) {
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
                <th scope="col">{zh ? "記憶體（已用 / 總量）" : "Memory (used / total)"}</th>
                <th scope="col">{zh ? "溫度" : "Temp"}</th>
                <th scope="col">{zh ? "功耗" : "Power"}</th>
              </tr>
            </thead>
            <tbody>
              {gpus.map((gpu, index) => {
                const used = pick(gpu, ["mem_used", "memory_used"]);
                const total = pick(gpu, ["mem_total", "memory_total"]);
                return (
                  <tr key={index}>
                    <td>{cell(pick(gpu, ["index"]) ?? index)}</td>
                    <td>{cell(pick(gpu, ["name"]))}</td>
                    <td>{cell(pick(gpu, ["util", "utilization"]), "%")}</td>
                    <td>{used === undefined && total === undefined ? "—" : `${cell(used)} / ${cell(total)}`}</td>
                    <td>{cell(pick(gpu, ["temp", "temperature"]), "°C")}</td>
                    <td>{cell(pick(gpu, ["power"]), " W")}</td>
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

export function AdminGatewaySection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<GatewayOverview>("/admin/gateway");
  const [maintenance, setMaintenance] = useState<GatewayModel | null>(null);
  const [confirmOp, setConfirmOp] = useState<{ node: string; action: string } | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const jobCounter = useRef(0);

  async function toggleModel(model: GatewayModel) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await portalRequest(`/admin/gateway/models/${encodeURIComponent(model.id)}/toggle`, { method: "POST" });
      resource.refresh();
    } catch (reason: unknown) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function runOp(node: string, action: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await portalRequest<{ job_id?: string }>(
        `/admin/gateway/nodes/${encodeURIComponent(node)}/ops/${encodeURIComponent(action)}`,
        { method: "POST" },
      );
      if (result.job_id) {
        jobCounter.current += 1;
        const job = { key: jobCounter.current, node, action, jobId: String(result.job_id) };
        setJobs((current) => [job, ...current].slice(0, 5));
      }
      resource.refresh();
    } catch (reason: unknown) {
      setError(reason);
    } finally {
      setBusy(false);
      setConfirmOp(null);
    }
  }

  function startOp(node: string, action: string) {
    if (action === "stop" || action === "restart") setConfirmOp({ node, action });
    else void runOp(node, action);
  }

  const data = resource.data;
  const models = data?.state?.models ?? [];
  const nodes = data?.nodes?.nodes ?? [];
  const actions = (data?.nodes?.actions ?? []).filter((action) => NODE_ACTIONS.includes(action));
  return (
    <>
      <ResourceState {...resource}>
        {data && !data.gatewayConfigured ? (
          <GatewayNotConnected />
        ) : (
          data && (
            <>
              <div className="portal-actions">
                <button type="button" className="portal-button-secondary" onClick={resource.refresh}>
                  {zh ? "重新整理" : "Refresh"}
                </button>
              </div>
              {error !== null && (
                <p className="portal-error" role="alert">{portalErrorText(error, locale)}</p>
              )}
              <section className="portal-panel">
                <h2>{zh ? "模型" : "Models"}</h2>
                {data.errors.state || !data.state ? (
                  <BlockError message={zh ? "目前無法取得模型狀態。" : "Model state is unavailable right now."} code={data.errors.state ?? "unavailable"} />
                ) : models.length > 0 ? (
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "閘道模型" : "Gateway models"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "模型" : "Model"}</th>
                          <th scope="col">{zh ? "狀態" : "Status"}</th>
                          <th scope="col">{zh ? "維護訊息" : "Maintenance message"}</th>
                          <th scope="col">{zh ? "節點" : "Node"}</th>
                          <th scope="col">{zh ? "動作" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {models.map((model) => (
                          <tr key={model.id}>
                            <td><code>{model.id}</code></td>
                            <td>{model.enabled ? (zh ? "啟用" : "Enabled") : zh ? "停用" : "Disabled"}</td>
                            <td>{model.maintenance_message || "—"}</td>
                            <td>{text(model.node)}</td>
                            <td>
                              <div className="portal-actions">
                                <button type="button" className="portal-text-button" disabled={busy} aria-label={`${model.enabled ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"} ${model.id}`} onClick={() => toggleModel(model)}>
                                  {model.enabled ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"}
                                </button>
                                <button type="button" className="portal-text-button" aria-label={zh ? `${model.id} 的維護訊息` : `Maintenance message for ${model.id}`} onClick={() => setMaintenance(model)}>
                                  {zh ? "維護訊息" : "Maintenance"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="portal-empty">{zh ? "閘道沒有模型。" : "The gateway has no models."}</p>
                )}
              </section>
              <section className="portal-panel">
                <h2>{zh ? "節點" : "Nodes"}</h2>
                {data.errors.nodes || !data.nodes ? (
                  <BlockError message={zh ? "目前無法取得節點資料。" : "Node data is unavailable right now."} code={data.errors.nodes ?? "unavailable"} />
                ) : nodes.length > 0 ? (
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "閘道節點" : "Gateway nodes"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "節點" : "Node"}</th>
                          <th scope="col">{zh ? "角色" : "Role"}</th>
                          <th scope="col">{zh ? "可連線" : "Reachable"}</th>
                          <th scope="col">{zh ? "狀態" : "State"}</th>
                          <th scope="col">{zh ? "模型" : "Models"}</th>
                          <th scope="col">{zh ? "動作" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nodes.map((node) => (
                          <tr key={node.name}>
                            <td><code>{node.name}</code></td>
                            <td>{text(node.role)}</td>
                            <td>{node.reachable === undefined ? "—" : node.reachable ? (zh ? "是" : "Yes") : zh ? "否" : "No"}</td>
                            <td>{text(node.state)}</td>
                            <td>{(node.models ?? []).join(", ") || "—"}</td>
                            <td>
                              <div className="portal-actions">
                                {actions.map((action) => (
                                  <button key={action} type="button" className="portal-text-button" disabled={busy} aria-label={zh ? `在 ${node.name} 執行${ACTION_ZH[action]}` : `Run ${action} on ${node.name}`} onClick={() => startOp(node.name, action)}>
                                    {zh ? ACTION_ZH[action] : action}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="portal-empty">{zh ? "沒有節點。" : "No nodes."}</p>
                )}
              </section>
              <section className="portal-panel">
                <h2>GPU</h2>
                {data.errors.metrics || !data.metrics ? (
                  <BlockError message={zh ? "目前無法取得 GPU 指標。" : "GPU metrics are unavailable right now."} code={data.errors.metrics ?? "unavailable"} />
                ) : (
                  <GpuPanel metrics={data.metrics} zh={zh} />
                )}
              </section>
            </>
          )
        )}
      </ResourceState>
      {jobs.length > 0 && (
        <section className="portal-panel" aria-live="polite">
          <h2>{zh ? "節點工作" : "Node jobs"}</h2>
          <ul>
            {jobs.map((job) => (
              <JobStatus key={job.key} job={job} onSettled={resource.refresh} />
            ))}
          </ul>
        </section>
      )}
      {maintenance && (
        <MaintenanceDialog
          model={maintenance}
          onClose={() => setMaintenance(null)}
          onDone={() => {
            setMaintenance(null);
            resource.refresh();
          }}
        />
      )}
      {confirmOp && (
        <ConfirmNodeDialog
          node={confirmOp.node}
          action={confirmOp.action}
          busy={busy}
          onClose={() => setConfirmOp(null)}
          onConfirm={() => runOp(confirmOp.node, confirmOp.action)}
        />
      )}
    </>
  );
}
