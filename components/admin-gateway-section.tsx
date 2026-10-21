"use client";

import { useRef, useState } from "react";
import { portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import {
  ACTION_ZH,
  BlockError,
  ConfirmNodeDialog,
  GpuPanel,
  JobStatus,
  MaintenanceDialog,
  NODE_ACTIONS,
  text,
  type GatewayModel,
  type GatewayOverview,
  type Job,
} from "./admin-gateway-panels";
import { GatewayNotConnected, ResourceState, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

/** The gateway treats a missing or null flag as enabled, so only an explicit false is "disabled". */
const isEnabled = (model: GatewayModel) => model.enabled !== false;

export function AdminGatewaySection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<GatewayOverview>("/admin/gateway");
  const [maintenance, setMaintenance] = useState<GatewayModel | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<GatewayModel | null>(null);
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
      await portalRequest(`/admin/gateway/models/${encodeURIComponent(model.id)}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: !isEnabled(model) }),
      });
      resource.refresh();
    } catch (reason: unknown) {
      setError(reason);
    } finally {
      setBusy(false);
      setConfirmDisable(null);
    }
  }

  function startToggle(model: GatewayModel) {
    // Disabling cuts customers off, so it is confirmed; enabling stays one click.
    if (isEnabled(model)) setConfirmDisable(model);
    else void toggleModel(model);
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
                            <td>{isEnabled(model) ? (zh ? "啟用" : "Enabled") : zh ? "停用" : "Disabled"}</td>
                            <td>{model.maintenance_message || "—"}</td>
                            <td>{text(model.node)}</td>
                            <td>
                              <div className="portal-actions">
                                <button type="button" className="portal-text-button" disabled={busy} aria-label={`${isEnabled(model) ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"} ${model.id}`} onClick={() => startToggle(model)}>
                                  {isEnabled(model) ? (zh ? "停用" : "Disable") : zh ? "啟用" : "Enable"}
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
      {confirmDisable && (
        <AdminDialog
          title={zh ? `停用模型 ${confirmDisable.id}？` : `Disable model ${confirmDisable.id}?`}
          confirmLabel={zh ? "停用模型" : "Disable model"}
          cancelLabel={zh ? "取消" : "Cancel"}
          onConfirm={() => toggleModel(confirmDisable)}
          onClose={() => setConfirmDisable(null)}
          inFlight={busy}
          danger
        >
          <p className="portal-note">
            {zh
              ? "停用後客戶會收到 404，直到重新啟用此模型。"
              : "Customers will receive 404 for this model until it is enabled again."}
          </p>
        </AdminDialog>
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
