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

export type PolicyLink = {
  href: string;
  label: string;
};

export type PolicyDocument = {
  kicker: string;
  title: string;
  /** Entity and effective date, shown under the heading. */
  meta: string;
  lead: string;
  sections: EditorialSection[];
  related: PolicyLink[];
};

export type PolicyLocaleContent = {
  privacy: PolicyDocument;
  terms: PolicyDocument;
  dataRetention: PolicyDocument;
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

/**
 * The published legal identity. These four values used to be duplicated (and
 * to disagree) across the gateway's inline HTML, this file, and a retired
 * static site. One definition, referenced everywhere, is the whole point.
 */
export const LEGAL_EFFECTIVE_DATE = "2026-09-09";
export const LEGAL_ENTITY = "Power Champion Investment Limited";
export const LEGAL_CONTACT_EMAIL = "info@powerchampion.org";
export const LEGAL_GATEWAY_HOST = "b300.powerchampion.ai";

const EN_META = `${LEGAL_ENTITY} · Effective ${LEGAL_EFFECTIVE_DATE}`;
const ZH_META = `${LEGAL_ENTITY} · 生效日期 ${LEGAL_EFFECTIVE_DATE}`;
const EN_CONTACT = `${LEGAL_ENTITY} — ${LEGAL_CONTACT_EMAIL}`;
const ZH_CONTACT = `${LEGAL_ENTITY} — ${LEGAL_CONTACT_EMAIL}`;

export const POLICY_CONTENT: Record<Locale, PolicyLocaleContent> = {
  en: {
    privacy: {
      kicker: "Privacy",
      title: "Privacy Policy",
      meta: EN_META,
      lead: `This policy describes how ${LEGAL_ENTITY} ("we") handles data for its inference API at ${LEGAL_GATEWAY_HOST}, and what this marketing site itself processes.`,
      sections: [
        {
          id: "current-interactions",
          title: "What this site processes",
          body: ["The pricing estimator runs in your browser. The balance checker and the API playground send your API key to this site’s own server (POST /api/balance, POST /api/playground), which uses it solely to forward that one request to the b300 gateway and relay the answer back. This site does not store or log your key; the browser keeps it in page memory only, and never in browser storage."],
        },
        {
          id: "what-we-process",
          title: "What we process",
          body: ["To serve a request, we transiently process the prompt and parameters you send in order to generate a completion. Inference runs on our own GPU nodes."],
        },
        {
          id: "what-we-log",
          title: "What we log",
          body: ["We log usage metadata only — timestamps, API-key identifiers, model identifiers, measured token or media usage, a billing record identifier, and an operational status note when needed — for billing and reconciliation. We do not store prompt or completion content."],
        },
        {
          id: "no-training",
          title: "No training on your data",
          body: ["We do not use requests, prompts, or completions to train or fine-tune any model."],
        },
        {
          id: "retention",
          title: "Retention",
          body: ["Usage-metadata billing records are retained only as long as needed for billing, accounting, and reconciliation. No conversation content is retained. The specific handling rules are published in our Data Retention Policy."],
        },
        {
          id: "security",
          title: "Security",
          body: ["All traffic is served over HTTPS. GPU nodes are not publicly exposed and are reached only through a private channel. API access requires a bearer key."],
        },
        {
          id: "third-parties",
          title: "Third parties",
          body: ["If you reach our API through a marketplace such as OpenRouter, that provider routes and bills the request under its own policies before it reaches us."],
        },
        {
          id: "future-changes",
          title: "Future changes",
          body: ["If a future release changes data handling, this notice and the relevant service controls will be updated before that release."],
        },
        { id: "contact", title: "Contact", body: [EN_CONTACT] },
      ],
      related: [
        { href: "/data-retention", label: "Data Retention Policy" },
        { href: "/terms", label: "Terms of Service" },
      ],
    },
    terms: {
      kicker: "Terms",
      title: "Terms of Service",
      meta: EN_META,
      lead: `These terms govern use of the inference API at ${LEGAL_GATEWAY_HOST} and of this site.`,
      sections: [
        {
          id: "informational-site",
          title: "Site scope",
          body: ["Marketing pages provide public context. The API service at b300.powerchampion.ai is a live, transactional service billed on measured usage; commercial terms for API usage are formed when a key is issued."],
        },
        {
          id: "service",
          title: "Service",
          body: [`${LEGAL_ENTITY} provides an OpenAI-compatible inference API for hosted open-weight models at ${LEGAL_GATEWAY_HOST}. Access requires a valid API key.`],
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          body: ["You agree not to use the service for unlawful purposes, to comply with the licenses of the underlying models, and not to attempt to disrupt, overload, or gain unauthorized access to the service or its infrastructure."],
        },
        {
          id: "pricing-billing",
          title: "Pricing and billing",
          body: [
            "Usage is billed in USD by the metered unit published on our pricing page and model catalog, either through a marketplace such as OpenRouter or under a direct agreement.",
            "API keys and redeem-code top-ups are issued manually by email. Usage is billed per the live published rates from your prepaid balance; failed requests are not billed.",
          ],
        },
        {
          id: "data-processing",
          title: "Data processing",
          body: ["Our Privacy Policy and Data Retention Policy describe how request data and usage metadata are handled."],
        },
        {
          id: "availability",
          title: "Availability",
          body: ["The service is provided on a best-effort basis. Unless a separate service-level agreement is signed, no specific uptime or latency is guaranteed."],
        },
        {
          id: "warranty-liability",
          title: "Warranty and liability",
          body: [`The service is provided "as is" without warranties of any kind. To the extent permitted by law, ${LEGAL_ENTITY} is not liable for indirect or consequential damages arising from use of the service.`],
        },
        {
          id: "external-sources",
          title: "External sources",
          body: ["Company and capacity context is qualified by the cited external sources and does not create a promise of deployment, capacity, or service."],
        },
        {
          id: "changes",
          title: "Changes",
          body: ["We may update these terms; continued use after an update constitutes acceptance."],
        },
        { id: "contact", title: "Contact", body: [EN_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/data-retention", label: "Data Retention Policy" },
      ],
    },
    dataRetention: {
      kicker: "Data retention",
      title: "Data Retention Policy",
      meta: EN_META,
      lead: "Prompt content is not persisted. The usage metadata that billing needs is retained only as long as necessary, and this policy explains its purpose and scope.",
      sections: [
        {
          id: "scope",
          title: "Scope",
          body: [`This policy supplements our Privacy Policy and describes how data is retained for the inference API at ${LEGAL_GATEWAY_HOST}.`],
        },
        {
          id: "prompt-content",
          title: "Prompt and output content",
          body: ["Prompt content and model output are processed only to complete the inference request. They are released when request processing finishes and are not written to persistent storage. Conversation content is not kept in billing records or operational usage logs."],
        },
        {
          id: "usage-metadata",
          title: "Usage metadata",
          body: ["We retain metering metadata such as timestamps, API-key identifiers, model identifiers, measured token or media usage, a billing record identifier, and an operational status note when needed, only as long as needed for billing and reconciliation purposes. These records do not contain prompt or output content."],
        },
        {
          id: "no-training",
          title: "No training use",
          body: ["Prompt content and model output are not used to train, fine-tune, or evaluate machine-learning models."],
        },
        {
          id: "deletion",
          title: "Deletion and legal obligations",
          body: ["When records are no longer needed for their stated billing, accounting, security, or legal purpose, they are deleted or de-identified. If applicable law requires a record to be preserved, we keep only the minimum required scope for the required period."],
        },
        { id: "contact", title: "Contact", body: [EN_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "Privacy Policy" },
        { href: "/terms", label: "Terms of Service" },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "Can I buy tokens now?", answer: "Yes. Keys are prepaid with a balance in nano-USD; top up by requesting a redeem code via email, then POST /v1/redeem with your key." },
      { id: "rates-final", question: "Are the displayed rates final?", answer: "Yes. The listed rates are the live chargeable rates the meter bills from — input and output priced separately, per million tokens (or per image/minute for media models)." },
      { id: "api-live", question: "Is the API live?", answer: "The OpenAI-compatible endpoint is deployed at b300.powerchampion.ai — text, vision, image, speech, embeddings, and reranking behind one key. Whether models are currently serving is shown live on the status page; this site does not claim availability it cannot observe." },
      { id: "entered-information", question: "What happens to information entered here?", answer: "The balance checker sends your key to this site’s server (POST /api/balance), which forwards it to the b300 gateway for that one lookup and relays the answer; this site does not store or log it." },
      { id: "capacity-deployed", question: `Is ${COMPANY_CAPACITY_MW} already deployed?`, answer: "No. The figure is counterparty-reported expected capacity, not completed deployment.", href: "/company", linkLabel: "Read company context" },
      { id: "deployment-review", question: "What is a deployment review?", answer: "It is a non-binding channel for discussing deployment inputs; it does not reserve capacity or create a service commitment." },
      { id: "launch-access", question: "How do I request launch access?", answer: "Click “Get API access” — it opens a prefilled email to request your key. Keys and redeem-code top-ups are issued manually." },
    ],
  },
  zh: {
    privacy: {
      kicker: "隱私權",
      title: "隱私權政策",
      meta: ZH_META,
      lead: `本政策說明 ${LEGAL_ENTITY} 就其推理 API（${LEGAL_GATEWAY_HOST}）如何處理資料，以及本行銷網站本身處理哪些資料。`,
      sections: [
        {
          id: "current-interactions",
          title: "本站處理的資料",
          body: ["價格估算器在你的瀏覽器中執行。餘額查詢與 API 測試工具會把你的 API 金鑰送至本站伺服器（POST /api/balance、POST /api/playground），本站僅以該金鑰代為向 b300 閘道轉送這一次請求並回傳結果。本站不會儲存或記錄你的金鑰；瀏覽器端僅將金鑰留在頁面記憶體，不存入瀏覽器儲存空間。"],
        },
        {
          id: "what-we-process",
          title: "我們處理什麼",
          body: ["為完成一次請求，我們會暫時處理你所傳送的提示內容與參數，以產生回應。推理運算執行於本公司自有的 GPU 節點。"],
        },
        {
          id: "what-we-log",
          title: "我們記錄什麼",
          body: ["我們僅記錄使用中繼資料 — 時間戳記、API 金鑰識別碼、模型識別碼、實測 Token 或媒體用量、計費紀錄識別碼，以及必要時的營運狀態註記 — 供計費與對帳之用。我們不儲存提示或回應的內容本文。"],
        },
        {
          id: "no-training",
          title: "不以你的資料訓練模型",
          body: ["我們不會將請求、提示內容或回應內容用於訓練或微調任何模型。"],
        },
        {
          id: "retention",
          title: "保存期間",
          body: ["使用中繼資料之計費紀錄，僅於計費、會計與對帳所需期間內保存。對話內容一律不予保存。具體處理規則公布於本公司《資料保存政策》。"],
        },
        {
          id: "security",
          title: "資料安全",
          body: ["所有流量均以 HTTPS 傳輸。GPU 節點不對公網暴露，僅透過私有通道連線。存取 API 須持有 Bearer 金鑰。"],
        },
        {
          id: "third-parties",
          title: "第三方",
          body: ["若你透過 OpenRouter 等市集連線至本服務，該供應商會依其自身政策先行路由與計費，之後請求才會抵達我們。"],
        },
        {
          id: "future-changes",
          title: "未來變更",
          body: ["若未來版本變更資料處理方式，會在發布前更新本聲明與相關服務控制。"],
        },
        { id: "contact", title: "聯絡我們", body: [ZH_CONTACT] },
      ],
      related: [
        { href: "/data-retention", label: "資料保存政策" },
        { href: "/terms", label: "服務條款" },
      ],
    },
    terms: {
      kicker: "條款",
      title: "服務條款",
      meta: ZH_META,
      lead: `本條款規範 ${LEGAL_GATEWAY_HOST} 推理 API 及本網站之使用。`,
      sections: [
        {
          id: "informational-site",
          title: "網站範圍",
          body: ["行銷頁面提供公開脈絡。b300.powerchampion.ai 的 API 服務是即時、交易性的服務，依實際用量計費；API 使用的商業條款於金鑰發放時成立。"],
        },
        {
          id: "service",
          title: "服務說明",
          body: [`${LEGAL_ENTITY} 於 ${LEGAL_GATEWAY_HOST} 提供相容於 OpenAI 規格的推理 API，服務託管之開源權重模型。存取本服務須持有有效的 API 金鑰。`],
        },
        {
          id: "acceptable-use",
          title: "可接受使用",
          body: ["你同意不將本服務用於違法目的，遵守底層模型之授權條款，且不得試圖干擾、超載本服務或其基礎設施，或未經授權存取之。"],
        },
        {
          id: "pricing-billing",
          title: "費用與計費",
          body: [
            "用量以美元計價，依本公司價格頁與模型目錄所公布之計費單位收費，可透過 OpenRouter 等市集或依個別協議進行。",
            "API 金鑰與儲值碼以 email 人工發放。用量依公布之即時費率從預付餘額扣款；失敗的請求不計費。",
          ],
        },
        {
          id: "data-processing",
          title: "資料處理",
          body: ["本公司《隱私權政策》與《資料保存政策》說明請求資料與使用中繼資料之處理方式。"],
        },
        {
          id: "availability",
          title: "服務可用性",
          body: ["本服務以合理努力（best-effort）為基礎提供。除另行簽訂服務水準協議（SLA）外，不保證特定之可用率或延遲。"],
        },
        {
          id: "warranty-liability",
          title: "保證與責任限制",
          body: [`本服務以「現狀」（AS IS）提供，不附任何明示或默示之保證。於法律允許之最大範圍內，${LEGAL_ENTITY} 對因使用本服務所生之間接或衍生性損害不負賠償責任。`],
        },
        {
          id: "external-sources",
          title: "外部來源",
          body: ["公司與容量脈絡受引用外部來源的限定，並不構成部署、容量或服務的承諾。"],
        },
        {
          id: "changes",
          title: "條款修訂",
          body: ["我們可能更新本條款；於更新後繼續使用本服務，即視為接受修訂後之條款。"],
        },
        { id: "contact", title: "聯絡我們", body: [ZH_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "隱私權政策" },
        { href: "/data-retention", label: "資料保存政策" },
      ],
    },
    dataRetention: {
      kicker: "資料保存",
      title: "資料保存政策",
      meta: ZH_META,
      lead: "提示內容不落地保存；計費所需的使用中繼資料則僅於必要期間內保存，本政策說明其目的與範圍。",
      sections: [
        {
          id: "scope",
          title: "政策範圍",
          body: [`本政策為《隱私權政策》之補充，說明推理 API（${LEGAL_GATEWAY_HOST}）之資料保存方式。`],
        },
        {
          id: "prompt-content",
          title: "提示內容與模型輸出",
          body: ["提示內容與模型輸出僅為完成該次推理請求而處理，請求處理完畢後即釋放，不寫入持久化儲存。對話內容不會保留於計費紀錄或營運用量日誌中。"],
        },
        {
          id: "usage-metadata",
          title: "使用中繼資料",
          body: ["我們保存計量中繼資料，例如時間戳記、API 金鑰識別碼、模型識別碼、實測 Token 或媒體用量、計費紀錄識別碼，以及必要時的營運狀態註記，且僅於計費與對帳所需期間內保存。這些紀錄不含提示或輸出內容。"],
        },
        {
          id: "no-training",
          title: "不用於訓練",
          body: ["提示內容與模型輸出不會被用於訓練、微調或評估任何機器學習模型。"],
        },
        {
          id: "deletion",
          title: "刪除與法定義務",
          body: ["當紀錄已無計費、會計、資安或法律目的之必要時，即予刪除或去識別化。若適用法律要求保存特定紀錄，我們僅於法定最小範圍與期間內保存。"],
        },
        { id: "contact", title: "聯絡我們", body: [ZH_CONTACT] },
      ],
      related: [
        { href: "/privacy", label: "隱私權政策" },
        { href: "/terms", label: "服務條款" },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "我現在可以購買 Token 嗎？", answer: "可以。金鑰以 nano-USD 預付餘額運作；透過 email 申請儲值碼後，用金鑰 POST /v1/redeem 即可加值。" },
      { id: "rates-final", question: "顯示的費率是最終價格嗎？", answer: "是。表列費率即為計費表實際扣款的即時費率 — 輸入與輸出分開計價，以每百萬 Token 計（媒體模型以每張圖/每分鐘計）。" },
      { id: "api-live", question: "API 已經上線了嗎？", answer: "OpenAI 相容端點已部署於 b300.powerchampion.ai — 文字、視覺、圖像、語音、嵌入與重排序，一把金鑰全部搞定。模型目前是否正在服務，以狀態頁即時呈現為準；本站不宣稱無法觀測的可用性。" },
      { id: "entered-information", question: "我在這裡輸入的資訊會怎麼處理？", answer: "餘額查詢會把你的金鑰送至本站伺服器（POST /api/balance），由本站代為向 b300 閘道轉送這一次查詢並回傳結果；本站不會儲存或記錄金鑰。" },
      { id: "capacity-deployed", question: `${COMPANY_CAPACITY_MW} 已經部署了嗎？`, answer: "沒有。該數字是交易對手報告的預期容量，並非已完成部署。", href: "/company", linkLabel: "閱讀公司脈絡" },
      { id: "deployment-review", question: "什麼是部署審查？", answer: "這是非約束性的洽談管道，用於討論部署輸入；不會預留容量或形成服務承諾。" },
      { id: "launch-access", question: "如何申請啟動存取？", answer: "點擊「取得 API 存取」— 會開啟預填 email 申請金鑰。金鑰與儲值碼以人工發放。" },
    ],
  },
};
