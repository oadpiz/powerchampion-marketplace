"use client";

import { useState } from "react";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { asRecord, pick, text } from "./admin-gateway-panels";
import { ResourceState, dateLabel, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";
import { useJobPoll } from "./use-job-poll";

type Capacity = { mode?: string; sellable_cap?: number; physical_cap?: number; reason?: string; observed_at?: number | string | null };
type Workflow = { id?: string; kind?: string; state?: string; phase?: string; reason?: string; updated_at?: number | string | null };
type FleetStatus = {
  model_id: string;
  enabled?: boolean;
  draining?: boolean;
  frozen?: boolean;
  capacity?: Capacity | null;
  workflow?: Workflow | null;
};
type Timeline = { model_id: string; events: unknown[] };
type FleetAction = "freeze" | "resume" | "candidate" | "approve" | "drain" | "rollback";

const ACTIONS: FleetAction[] = ["freeze", "resume", "candidate", "approve", "drain", "rollback"];
const ACTION_LABEL: Record<FleetAction, [string, string]> = {
  freeze: ["Freeze", "凍結"],
  resume: ["Resume", "恢復"],
  candidate: ["Start candidate", "準備候選版本"],
  approve: ["Approve", "核准切換"],
  drain: ["Drain", "排空"],
  rollback: ["Roll back", "回滾"],
};
const ACTION_EFFECT: Record<FleetAction, [string, string]> = {
  freeze: ["Capacity adjustments pause at the current value.", "容量調整暫停在目前值。"],
  resume: ["Automatic capacity adjustment resumes.", "恢復自動容量調整。"],
  candidate: [
    "Downloads, validates and warms up the candidate version, then waits for approval.",
    "開始下載、驗證與預熱候選版本，就緒後等待核准。",
  ],
  approve: ["Scales down the current version and switches to the candidate.", "降低現行版本並切換到候選版本。"],
  drain: ["Drains this model's traffic.", "排空此模型的流量。"],
  rollback: ["Returns to the previous serving state.", "回到前一個 serving 狀態。"],
};

const flag = (value: boolean | undefined, zh: boolean) => (value === undefined ? "—" : value ? (zh ? "是" : "Yes") : zh ? "否" : "No");
const timeOf = (value: unknown) => (typeof value === "number" || typeof value === "string" ? value : null);

function actionAllowed(action: FleetAction, status: FleetStatus) {
  if (action === "freeze") return !status.frozen;
  if (action === "resume") return Boolean(status.frozen);
  if (action === "approve") return status.workflow?.state === "awaiting_approval" && status.workflow?.phase === "ready";
  // The gateway refuses conflicting requests with 409 and a reason, which is shown.
  return true;
}

export function FleetPanel({ modelId, onClose }: { modelId: string; onClose: () => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const base = `/admin/gateway/fleet/${encodeURIComponent(modelId)}`;
  const status = usePortalResource<FleetStatus>(`${base}/status`);
  const timeline = usePortalResource<Timeline>(`${base}/timeline`);
  const [confirm, setConfirm] = useState<FleetAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const reload = () => {
    status.refresh();
    timeline.refresh();
  };
  const poll = useJobPoll(jobId === null ? null : `/admin/gateway/control/jobs/${encodeURIComponent(jobId)}`, { onSettled: reload });

  async function run(action: FleetAction) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await portalRequest<{ job_id?: string }>(`${base}/${action}`, { method: "POST" });
      setConfirm(null);
      if (typeof result.job_id === "string") setJobId(result.job_id);
      else reload();
    } catch (reason: unknown) {
      setConfirm(null);
      setMessage(portalErrorText(reason, locale));
    } finally {
      setBusy(false);
    }
  }

  const unmanaged = status.error instanceof PortalError && status.error.code === "fleet_not_managed";
  const data = status.data;
  return (
    <section className="portal-panel" aria-label={zh ? `${modelId} 的 fleet 控制` : `Fleet controls for ${modelId}`}>
      <div className="portal-actions">
        <h2>{zh ? `Fleet：${modelId}` : `Fleet: ${modelId}`}</h2>
        <button type="button" className="portal-button-secondary" onClick={onClose}>
          {zh ? "關閉" : "Close"}
        </button>
      </div>
      {unmanaged ? (
        <p className="portal-note" role="status">
          {zh
            ? "此模型不由 fleet 控制器管理（control_managed 未開啟）。"
            : "This model is not managed by the fleet controller (control_managed is off)."}
        </p>
      ) : (
        <ResourceState {...status}>
          {data && (
            <>
              {message !== null && (
                <p className="portal-error" role="alert">{message}</p>
              )}
              <dl className="portal-meta">
                <dt>{zh ? "啟用" : "Enabled"}</dt>
                <dd>{flag(data.enabled, zh)}</dd>
                <dt>{zh ? "排空中" : "Draining"}</dt>
                <dd>{flag(data.draining, zh)}</dd>
                <dt>{zh ? "已凍結" : "Frozen"}</dt>
                <dd>{flag(data.frozen, zh)}</dd>
                <dt>{zh ? "容量" : "Capacity"}</dt>
                <dd>
                  {data.capacity
                    ? `${text(data.capacity.mode)} · ${text(data.capacity.sellable_cap)} / ${text(data.capacity.physical_cap)}${data.capacity.reason ? ` · ${data.capacity.reason}` : ""} · ${dateLabel(timeOf(data.capacity.observed_at), zh)}`
                    : "—"}
                </dd>
                <dt>{zh ? "工作流程" : "Workflow"}</dt>
                <dd>
                  {data.workflow
                    ? `${text(data.workflow.kind)} · ${text(data.workflow.state)} · ${text(data.workflow.phase)}${data.workflow.reason ? ` · ${data.workflow.reason}` : ""} · ${dateLabel(timeOf(data.workflow.updated_at), zh)}`
                    : "—"}
                </dd>
              </dl>
              <div className="portal-actions">
                {ACTIONS.map((action) => (
                  <button key={action} type="button" className="portal-button-secondary" disabled={busy || !actionAllowed(action, data)} onClick={() => setConfirm(action)}>
                    {ACTION_LABEL[action][zh ? 1 : 0]}
                  </button>
                ))}
              </div>
              {jobId !== null && (
                <p className="portal-note" role="status">
                  {zh ? `工作 ${jobId}：` : `Job ${jobId}: `}
                  {poll.job ? `${text(poll.job.state)} · ${text(poll.job.phase)}` : zh ? "等待第一次更新…" : "Waiting for the first update…"}
                  {poll.stopped && (zh ? "（已停止自動更新，請重新整理）" : " (Automatic updates stopped. Refresh to check again.)")}
                </p>
              )}
            </>
          )}
        </ResourceState>
      )}
      {!unmanaged && (
        <ResourceState {...timeline}>
          {timeline.data && (
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption>{zh ? "工作流程時間軸" : "Workflow timeline"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "時間" : "Time"}</th>
                    <th scope="col">{zh ? "事件" : "Event"}</th>
                    <th scope="col">{zh ? "狀態變化" : "State change"}</th>
                    <th scope="col">{zh ? "操作者" : "Actor"}</th>
                    <th scope="col">{zh ? "原因" : "Reason"}</th>
                    <th scope="col">{zh ? "結果" : "Result"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(timeline.data.events) ? timeline.data.events : []).map((raw, index) => {
                    const event = asRecord(raw) ?? {};
                    return (
                      <tr key={index}>
                        <td>{dateLabel(timeOf(pick(event, ["created_at", "ts", "at", "observed_at"])), zh)}</td>
                        <td>{text(event.event_type)}</td>
                        <td>{`${text(event.old_state)} → ${text(event.new_state)}`}</td>
                        <td>{text(event.actor)}</td>
                        <td>{text(event.reason)}</td>
                        <td>{text(event.result)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ResourceState>
      )}
      {confirm !== null && (
        <AdminDialog
          title={zh ? `對 ${modelId} 執行${ACTION_LABEL[confirm][1]}？` : `${ACTION_LABEL[confirm][0]} ${modelId}?`}
          confirmLabel={ACTION_LABEL[confirm][zh ? 1 : 0]}
          cancelLabel={zh ? "取消" : "Cancel"}
          onConfirm={() => run(confirm)}
          onClose={() => setConfirm(null)}
          inFlight={busy}
          danger={confirm === "drain" || confirm === "rollback" || confirm === "approve"}
        >
          <p>{ACTION_EFFECT[confirm][zh ? 1 : 0]}</p>
        </AdminDialog>
      )}
    </section>
  );
}

type FleetEventList = { events: unknown[] };

function FleetEventTable({ modelId }: { modelId: string }) {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<FleetEventList>(
    `/admin/gateway/fleet/events?limit=100${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ""}`,
  );
  const events = resource.data && Array.isArray(resource.data.events) ? resource.data.events : [];
  return (
    <ResourceState {...resource}>
      {resource.data && (
        events.length === 0 ? (
          <p className="portal-empty">{zh ? "沒有 fleet 事件。" : "No fleet events."}</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <caption className="sr-only">{zh ? "Fleet 容量事件" : "Fleet capacity events"}</caption>
              <thead>
                <tr>
                  <th scope="col">{zh ? "時間" : "Time"}</th>
                  <th scope="col">{zh ? "模型" : "Model"}</th>
                  <th scope="col">Mode</th>
                  <th scope="col">{zh ? "容量" : "Capacity"}</th>
                  <th scope="col">{zh ? "原因" : "Reason"}</th>
                  <th scope="col">Policy</th>
                  <th scope="col">Event</th>
                </tr>
              </thead>
              <tbody>
                {events.map((raw, index) => {
                  const event = asRecord(raw) ?? {};
                  return (
                    <tr key={index}>
                      <td>{dateLabel(timeOf(event.observed_at), zh)}</td>
                      <td>{text(event.model_id)}</td>
                      <td>{text(event.mode)}</td>
                      <td>{`${text(event.previous_cap)} → ${text(event.sellable_cap)} / ${text(event.physical_cap)}`}</td>
                      <td>{text(event.reason)}</td>
                      <td>{text(event.policy_version)}</td>
                      <td>{text(event.event_id)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </ResourceState>
  );
}

/** Capacity events across the fleet (FleetEvent, not the per-workflow timeline); loaded only when opened. */
export function FleetEvents({ models }: { models: string[] }) {
  const zh = useLocale().locale === "zh";
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  return (
    <section className="portal-panel">
      <button type="button" className="portal-button-secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? (zh ? "隱藏 fleet 事件" : "Hide fleet events") : zh ? "顯示 fleet 事件" : "Show fleet events"}
      </button>
      {open && (
        <>
          <label className="portal-field">
            {zh ? "模型篩選" : "Model filter"}
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              <option value="">{zh ? "全部模型" : "All models"}</option>
              {models.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
          <FleetEventTable key={modelId} modelId={modelId} />
        </>
      )}
    </section>
  );
}
