import type { Locale } from "./content";
import { COMPANY_CAPACITY_MW } from "./company";
import type { GatewayStatus } from "./gateway-status";

export type ReadinessState =
  | "ready"
  | "degraded"
  | "unknown"
  | "preview"
  | "preparation"
  | "not-ready";

export type ServiceReadiness = {
  website: ReadinessState;
  manifest: ReadinessState;
  inference: ReadinessState;
  usageAccounting: ReadinessState;
  payments: ReadinessState;
  enterpriseReview: ReadinessState;
};

/**
 * Static baseline: only what THIS site can vouch for without asking the
 * gateway. Backend-facing rows default to "unknown" and are replaced at
 * render time by deriveGatewayReadiness() from the live /status.json feed —
 * a static "ready" here would keep claiming readiness through an outage.
 */
export const SERVICE_READINESS: ServiceReadiness = {
  website: "ready",
  manifest: "unknown",
  inference: "unknown",
  usageAccounting: "unknown",
  payments: "unknown",
  enterpriseReview: "preparation",
};

/**
 * Derive backend readiness from the gateway's live status payload.
 *
 * - inference follows the gateway's own status field (ok→ready,
 *   warn→degraded, down→not-ready, unreachable→unknown).
 * - usage accounting / payments / manifest have no probe in /status.json;
 *   they stay "unknown" (unverified from this site) rather than "ready".
 */
export function deriveGatewayReadiness(
  gateway: GatewayStatus | null,
): Pick<ServiceReadiness, "manifest" | "inference" | "usageAccounting" | "payments"> {
  if (!gateway) {
    return {
      manifest: "unknown",
      inference: "unknown",
      usageAccounting: "unknown",
      payments: "unknown",
    };
  }
  const inference: ReadinessState =
    gateway.status === "ok" ? "ready"
      : gateway.status === "warn" ? "degraded"
        : "not-ready";
  return {
    manifest: "unknown",
    inference,
    usageAccounting: "unknown",
    payments: "unknown",
  };
}

export function isReady(state: ReadinessState | undefined): boolean {
  return state === "ready";
}

export type EditorialSection = {
  id: string;
  title: string;
  body: string[];
};

export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  href?: string;
  linkLabel?: string;
};

export type PolicyLocaleContent = {
  privacy: { kicker: string; title: string; lead: string; sections: EditorialSection[] };
  terms: { kicker: string; title: string; lead: string; sections: EditorialSection[] };
  faq: FaqEntry[];
};

export type TrustLocaleContent = {
  kicker: string;
  title: string;
  lead: string;
  releaseBoundary: string;
  sections: EditorialSection[];
  infrastructure: {
    kicker: string;
    title: string;
    lead: string;
    capacityStage: string;
    servingStage: string;
    deliveryStage: string;
    checklistTitle: string;
    checklist: string[];
  };
  status: {
    kicker: string;
    title: string;
    lead: string;
    labels: Record<keyof ServiceReadiness, string>;
    states: Record<ReadinessState, string>;
  };
  deploymentReview: string;
};

export const TRUST_CONTENT: Record<Locale, TrustLocaleContent> = {
  en: {
    kicker: "Enterprise review",
    title: "Evidence before promises.",
    lead: "Review the public boundaries, sources, and release state behind Power Champion access.",
    releaseBoundary: "This marketing site provides public context. The live, transactional API service operates at b300.powerchampion.ai with pay-per-use billing from your prepaid balance.",
    sections: [
      { id: "data", title: "Current data behavior", body: ["Comparison, estimates, and generated integration code run locally. Balance lookups and playground requests use this site’s server to contact the Power Champion gateway. API keys are held in page memory, not saved in browser storage. Email enquiries open a draft for you to send."] },
      { id: "provenance", title: "Model provenance", body: ["Every catalog entry requires model-license, serving-authorization, and deployment review before release."] },
      { id: "controls", title: "Release controls", body: ["Inference readiness is derived from the gateway's live status feed. Usage accounting and payments are not independently verified by this site and display as unverified until measured."] },
      { id: "policies", title: "Policies and sources", body: ["Privacy, Terms, Status, and Company pages define the current public boundary and cited context."] },
    ],
    infrastructure: {
      kicker: "Infrastructure review",
      title: "From qualified capacity context to live delivery.",
      lead: "Separate counterparty-reported capacity from the serving and delivery controls that are now live.",
      capacityStage: "Counterparty-reported expected hosting capacity; not live or completed deployment.",
      servingStage: "Model serving availability is measured live by the b300 gateway; this site reports it as-is and does not pre-claim readiness it cannot observe.",
      deliveryStage: "The unified API is deployed at b300.powerchampion.ai with pay-per-use billing from prepaid balance; current availability is shown on the status page.",
      checklistTitle: "Deployment review inputs",
      checklist: ["Workload", "Model requirements", "Usage profile", "Deployment region", "Data handling", "Service-readiness gates"],
    },
    status: {
      kicker: "Public status",
      title: "Service status",
      lead: "Website and live service readiness are reported separately.",
      labels: { website: "Website", manifest: "Provider manifest", inference: "Inference API", usageAccounting: "Usage accounting", payments: "Payments", enterpriseReview: "Enterprise review" },
      states: { ready: "Ready", degraded: "Degraded", unknown: "Not verified", preview: "Preview", preparation: "In preparation", "not-ready": "Not ready" },
    },
    deploymentReview: "Deployment review",
  },
  zh: {
    kicker: "企業審查",
    title: "先看證據，再談承諾。",
    lead: "檢視 Power Champion 存取服務背後的公開邊界、來源與發布狀態。",
    releaseBoundary: "此行銷網站提供公開脈絡。即時交易性 API 服務運作於 b300.powerchampion.ai，從預付餘額按量計費。",
    sections: [
      { id: "data", title: "目前的資料行為", body: ["模型比較、費用試算與串接程式碼在瀏覽器執行。餘額查詢與模型測試透過本站伺服器連接 Power Champion 閘道。API 金鑰僅保留在頁面記憶體，不存入瀏覽器儲存空間。Email 洽詢會開啟草稿，由你決定寄送。"] },
      { id: "provenance", title: "模型來源", body: ["每筆模型目錄項目都必須在發布前完成模型授權、服務授權與部署審查。"] },
      { id: "controls", title: "發布控制", body: ["推論就緒狀態由閘道的即時狀態資料推導。用量計算與付款未經本站獨立驗證，在實測前以「未驗證」標示。"] },
      { id: "policies", title: "政策與來源", body: ["隱私權、條款、狀態與公司頁面界定目前的公開邊界及引用脈絡。"] },
    ],
    infrastructure: {
      kicker: "基礎設施審查",
      title: "從受限定的容量脈絡，到即時交付。",
      lead: "將交易對手報告的容量，與目前已上線的服務及交付控制清楚分開。",
      capacityStage: "交易對手報告的預期託管容量；並非即時或已完成部署。",
      servingStage: "模型服務可用性由 b300 閘道即時量測；本站如實呈現，不預先宣稱無法觀測的就緒狀態。",
      deliveryStage: "統一 API 已部署於 b300.powerchampion.ai，採預付餘額按量計費；目前可用性請見狀態頁。",
      checklistTitle: "部署審查輸入",
      checklist: ["工作負載", "模型需求", "用量輪廓", "部署區域", "資料處理", "服務就緒門檻"],
    },
    status: {
      kicker: "公開狀態",
      title: "服務狀態",
      lead: "網站與即時服務的就緒狀態分開呈現。",
      labels: { website: "網站", manifest: "供應商 Manifest", inference: "推論 API", usageAccounting: "用量計算", payments: "付款", enterpriseReview: "企業審查" },
      states: { ready: "已就緒", degraded: "部分可用", unknown: "未驗證", preview: "預覽", preparation: "準備中", "not-ready": "尚未就緒" },
    },
    deploymentReview: "部署審查",
  },
};

export const POLICY_CONTENT: Record<Locale, PolicyLocaleContent> = {
  en: {
    privacy: {
      kicker: "Privacy",
      title: "Privacy boundary",
      lead: "How the website, developer tools, and API requests handle data.",
      sections: [
        { id: "current-interactions", title: "What this site processes", body: ["Comparison, pricing estimates, and integration configuration run in your browser. API keys and request inputs are forwarded through this site’s server to the fixed Power Champion gateway when you explicitly check a balance or send a playground request. These tools hold keys in page memory and do not save them in browser storage; the proxy code does not log request bodies or API keys. Playground responses and token counts remain in page memory until navigation or reload."] },
        { id: "api-usage-data", title: "API usage data", body: ["Requests to the API itself are metered by the b300 gateway for billing (tokens, timestamps, model). This is operational billing data for the service you call — see the data-retention policy at b300.powerchampion.ai/data-retention."] },
        { id: "future-changes", title: "Future changes", body: ["If a future release changes data handling, the public privacy notice and the relevant service controls will be updated before that release."] },
      ],
    },
    terms: {
      kicker: "Terms",
      title: "Site terms",
      lead: "This site describes the service and links to the live API; commercial terms for API usage are formed when a key is issued.",
      sections: [
        { id: "informational-site", title: "Site scope", body: ["Marketing pages provide public context. The API service at b300.powerchampion.ai is a live, transactional service billed on measured usage."] },
        { id: "api-access", title: "API access", body: ["API keys and redeem-code top-ups are issued manually by email. Usage is billed per the live published rates from your prepaid balance; failed requests are not billed."] },
        { id: "external-sources", title: "External sources", body: ["Company and capacity context is qualified by the cited external sources and does not create a promise of deployment, capacity, or service."] },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "Can I buy tokens now?", answer: "Yes. Keys are prepaid with a balance in nano-USD; top up by requesting a redeem code via email, then POST /v1/redeem with your key." },
      { id: "rates-final", question: "Are the displayed rates final?", answer: "Yes. The listed rates are the live chargeable rates the meter bills from — input and output priced separately, per million tokens (or per image/minute for media models)." },
      { id: "api-live", question: "Is the API live?", answer: "The OpenAI-compatible endpoint is deployed at b300.powerchampion.ai — text, vision, image, speech, embeddings, and reranking behind one key. Whether models are currently serving is shown live on the status page; this site does not claim availability it cannot observe." },
      { id: "entered-information", question: "What happens to information entered here?", answer: "The balance checker sends your key only to the b300 gateway (POST /api/balance) to look up your balance; it is never stored or logged by this site." },
      { id: "capacity-deployed", question: `Is ${COMPANY_CAPACITY_MW} already deployed?`, answer: "No. The figure is counterparty-reported expected capacity, not completed deployment.", href: "/company", linkLabel: "Read company context" },
      { id: "deployment-review", question: "What is a deployment review?", answer: "It is a non-binding channel for discussing deployment inputs; it does not reserve capacity or create a service commitment." },
      { id: "launch-access", question: "How do I request launch access?", answer: "Click “Get API access” — it opens a prefilled email to request your key. Keys and redeem-code top-ups are issued manually." },
    ],
  },
  zh: {
    privacy: {
      kicker: "隱私權",
      title: "隱私權邊界",
      lead: "本上線站處理什麼，以及 API 計費記錄什麼。",
      sections: [
        { id: "current-interactions", title: "本站處理的資料", body: ["模型比較、費用試算與串接設定在瀏覽器執行。當你主動查詢餘額或傳送模型測試請求時，API 金鑰與請求內容會經由本站伺服器轉送至固定的 Power Champion 閘道。這些工具僅將金鑰留在頁面記憶體，不存入瀏覽器儲存空間；代理程式不記錄請求內容或金鑰。模型測試的回覆與 Token 數留在頁面記憶體，直到離開或重新整理。"] },
        { id: "api-usage-data", title: "API 用量資料", body: ["對 API 本身的請求會由 b300 閘道計量以供計費（Token 數、時間、模型）。這是你所呼叫服務的營運計費資料 — 詳見 b300.powerchampion.ai/data-retention。"] },
        { id: "future-changes", title: "未來變更", body: ["若未來版本變更資料處理方式，會在發布前更新公開隱私權聲明與相關服務控制。"] },
      ],
    },
    terms: {
      kicker: "條款",
      title: "網站條款",
      lead: "本網站說明服務並連結至即時 API；API 使用的商業條款於金鑰發放時成立。",
      sections: [
        { id: "informational-site", title: "網站範圍", body: ["行銷頁面提供公開脈絡。b300.powerchampion.ai 的 API 服務是即時、交易性的服務，依實際用量計費。"] },
        { id: "api-access", title: "API 存取", body: ["API 金鑰與儲值碼以 email 人工發放。用量依公布之即時費率從預付餘額扣款；失敗的請求不計費。"] },
        { id: "external-sources", title: "外部來源", body: ["公司與容量脈絡受引用外部來源的限定，並不構成部署、容量或服務的承諾。"] },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "我現在可以購買 Token 嗎？", answer: "可以。金鑰以 nano-USD 預付餘額運作；透過 email 申請儲值碼後，用金鑰 POST /v1/redeem 即可加值。" },
      { id: "rates-final", question: "顯示的費率是最終價格嗎？", answer: "是。表列費率即為計費表實際扣款的即時費率 — 輸入與輸出分開計價，以每百萬 Token 計（媒體模型以每張圖/每分鐘計）。" },
      { id: "api-live", question: "API 已經上線了嗎？", answer: "OpenAI 相容端點已部署於 b300.powerchampion.ai — 文字、視覺、圖像、語音、嵌入與重排序，一把金鑰全部搞定。模型目前是否正在服務，以狀態頁即時呈現為準；本站不宣稱無法觀測的可用性。" },
      { id: "entered-information", question: "我在這裡輸入的資訊會怎麼處理？", answer: "餘額查詢只會把你的金鑰送到 b300 閘道（POST /api/balance）查詢餘額；本站不會儲存或記錄金鑰。" },
      { id: "capacity-deployed", question: `${COMPANY_CAPACITY_MW} 已經部署了嗎？`, answer: "沒有。該數字是交易對手報告的預期容量，並非已完成部署。", href: "/company", linkLabel: "閱讀公司脈絡" },
      { id: "deployment-review", question: "什麼是部署審查？", answer: "這是非約束性的洽談管道，用於討論部署輸入；不會預留容量或形成服務承諾。" },
      { id: "launch-access", question: "如何申請啟動存取？", answer: "點擊「取得 API 存取」— 會開啟預填 email 申請金鑰。金鑰與儲值碼以人工發放。" },
    ],
  },
};
