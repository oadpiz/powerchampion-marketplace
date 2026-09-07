"use client";

import { SERVICE_READINESS, deriveGatewayReadiness, isReady } from "../lib/trust";
import { useLocale } from "./locale-provider";
import type { GatewayStatus } from "../lib/gateway-status";

type Props = {
  gateway: GatewayStatus | null;
  fetchedAt: number;
};

function fmtUptime(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(2)}%`;
}

function fmtContext(v: number | null, id: string): string {
  // Image models report generation resolution (512) in this field — that is
  // not a context window, so show an em dash instead of a misleading number.
  if (!v || (v < 1000 && (id.includes("flux") || id.includes("chroma")))) return "—";
  return v >= 1000 ? `${Math.round(v / 1000)}K` : String(v);
}

/**
 * Live status ledger: the website row reflects this site itself; backend rows
 * (manifest/inference/usage/payments) are derived from the gateway's live
 * /status.json — never statically claimed ready. Gateway unreachable →
 * backend rows show "Not verified" and the model table renders an offline
 * note rather than pretending nothing serves.
 */
export function LiveStatusContent({ gateway, fetchedAt }: Props) {
  const { locale } = useLocale();
  const trust = locale === "zh" ? ZH : EN;
  const derived = deriveGatewayReadiness(gateway);
  const rows = [
    [trust.labels.website, SERVICE_READINESS.website],
    [trust.labels.manifest, derived.manifest],
    [trust.labels.inference, derived.inference],
    [trust.labels.usageAccounting, derived.usageAccounting],
    [trust.labels.payments, derived.payments],
    [trust.labels.enterpriseReview, SERVICE_READINESS.enterpriseReview],
  ] as const;

  const updated = new Date(fetchedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return (
    <main className="status-page" id="main-content">
      <header aria-labelledby="status-title" className="status-hero">
        <p className="eyebrow">{trust.kicker}</p>
        <h1 id="status-title">{trust.title}</h1>
        <p>{trust.lead}</p>
      </header>

      <ul className="status-ledger">
        {rows.map(([label, state]) => (
          <li data-ready={isReady(state)} key={label}>
            <span>{label}</span>
            <strong>{trust.states[state]}</strong>
          </li>
        ))}
      </ul>

      {gateway ? (
        <section className="status-models" aria-labelledby="live-models-title">
          <h2 id="live-models-title">{trust.liveTitle}</h2>
          <p>
            {gateway.summary} · {trust.measured.replace(
              "{days}",
              String(gateway.uptime_window_days),
            )} · {updated}
          </p>
          <table>
            <thead>
              <tr>
                <th>{trust.colModel}</th>
                <th>{trust.colContext}</th>
                <th>{trust.colUptime}</th>
                <th>{trust.colState}</th>
              </tr>
            </thead>
            <tbody>
              {gateway.models.map((m) => (
                <tr key={m.id} data-ready={m.ready}>
                  <td>
                    <code>{m.id}</code>
                  </td>
                  <td>{fmtContext(m.context_length, m.id)}</td>
                  <td>{fmtUptime(m.uptime)}</td>
                  <td>
                    <strong>{m.ready ? trust.ready : trust.unavailable}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <a href="https://b300.powerchampion.ai/status.json" rel="noreferrer">
              {trust.machineReadable}
            </a>
          </p>
        </section>
      ) : (
        <section className="status-models" aria-labelledby="live-models-title">
          <h2 id="live-models-title">{trust.liveTitle}</h2>
          <p>{trust.unreachable}</p>
        </section>
      )}
    </main>
  );
}

const EN = {
  kicker: "Public status",
  title: "Service status",
  lead: "Release readiness and live model availability, reported separately.",
  labels: {
    website: "Website",
    manifest: "Provider manifest",
    inference: "Inference API",
    usageAccounting: "Usage accounting",
    payments: "Payments",
    enterpriseReview: "Enterprise review",
  },
  states: {
    ready: "Ready",
    degraded: "Degraded",
    unknown: "Not verified",
    preview: "Preview",
    preparation: "In preparation",
    "not-ready": "Not ready",
  } as Record<string, string>,
  liveTitle: "Live models (b300 gateway)",
  measured: "uptime measured over up to {days} days",
  colModel: "Model",
  colContext: "Context",
  colUptime: "Uptime",
  colState: "Status",
  ready: "Operational",
  unavailable: "Unavailable",
  machineReadable: "Machine-readable status (status.json)",
  unreachable:
    "The API gateway status endpoint is currently unreachable — see b300.powerchampion.ai/status for the gateway's own page.",
};

const ZH = {
  kicker: "公開狀態",
  title: "服務狀態",
  lead: "上線準備與即時模型可用性分別呈現。",
  labels: {
    website: "網站",
    manifest: "供應商清單",
    inference: "推論 API",
    usageAccounting: "用量統計",
    payments: "支付",
    enterpriseReview: "企業審查",
  },
  states: {
    ready: "已就緒",
    degraded: "部分可用",
    unknown: "未驗證",
    preview: "預覽",
    preparation: "準備中",
    "not-ready": "未就緒",
  } as Record<string, string>,
  liveTitle: "即時模型（b300 閘道）",
  measured: "可用率觀測上限 {days} 天",
  colModel: "模型",
  colContext: "上下文",
  colUptime: "可用率",
  colState: "狀態",
  ready: "正常",
  unavailable: "離線",
  machineReadable: "機器可讀狀態（status.json）",
  unreachable:
    "目前無法連上 API 閘道的狀態端點 — 請至 b300.powerchampion.ai/status 查看閘道頁面。",
};
