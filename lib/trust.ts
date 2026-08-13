import type { Locale } from "./content";

export type ReadinessState = "ready" | "preview" | "preparation" | "not-ready";

export type ServiceReadiness = {
  website: ReadinessState;
  manifest: ReadinessState;
  inference: ReadinessState;
  payments: ReadinessState;
  enterpriseReview: ReadinessState;
};

export const SERVICE_READINESS: ServiceReadiness = {
  website: "preview",
  manifest: "not-ready",
  inference: "not-ready",
  payments: "not-ready",
  enterpriseReview: "preparation",
};

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
    lead: "Review the public boundaries, sources, and release gates behind future Power Champion access.",
    releaseBoundary: "This launch site does not represent a live inference, payment, account, or reserved-capacity service.",
    sections: [
      { id: "data", title: "Current data behavior", body: ["The current enquiry, estimator, console, and launch-access interactions stay in this browser and are not transmitted or persisted."] },
      { id: "provenance", title: "Model provenance", body: ["Every catalog entry requires model-license, serving-authorization, and deployment review before release."] },
      { id: "controls", title: "Release controls", body: ["Manifest, inference, usage accounting, payment, and operational status remain separate release gates."] },
      { id: "policies", title: "Policies and sources", body: ["Privacy, Terms, Status, and Company pages define the current public boundary and cited context."] },
    ],
    infrastructure: {
      kicker: "Infrastructure review",
      title: "From qualified capacity context to future delivery.",
      lead: "Separate counterparty-reported capacity from the serving and delivery controls required for release.",
      capacityStage: "Counterparty-reported expected hosting capacity; not live or completed deployment.",
      servingStage: "Model serving remains release-gated until deployment, authorization, and runtime evidence are verified.",
      deliveryStage: "The unified API is a public integration preview, not a currently available inference endpoint.",
      checklistTitle: "Deployment review inputs",
      checklist: ["Workload", "Model requirements", "Usage profile", "Deployment region", "Data handling", "Service-readiness gates"],
    },
    status: {
      kicker: "Public status",
      title: "Launch preparation",
      lead: "Website preview and future service readiness are reported separately.",
      labels: { website: "Website", manifest: "Provider manifest", inference: "Inference API", payments: "Payments", enterpriseReview: "Enterprise review" },
      states: { ready: "Ready", preview: "Preview", preparation: "In preparation", "not-ready": "Not ready" },
    },
    deploymentReview: "Deployment review",
  },
  zh: {
    kicker: "企業審查",
    title: "先看證據，再談承諾。",
    lead: "檢視 Power Champion 未來存取服務背後的公開邊界、來源與發布門檻。",
    releaseBoundary: "此啟動網站不代表已提供即時推論、付款、帳戶或容量預留服務。",
    sections: [
      { id: "data", title: "目前的資料行為", body: ["目前的洽詢、估算器、控制台與啟動存取互動僅保留在此瀏覽器，不會傳送或持久保存。"] },
      { id: "provenance", title: "模型來源", body: ["每筆模型目錄項目都必須在發布前完成模型授權、服務授權與部署審查。"] },
      { id: "controls", title: "發布控制", body: ["Manifest、推論、用量計算、付款與營運狀態分別屬於獨立發布門檻。"] },
      { id: "policies", title: "政策與來源", body: ["隱私權、條款、狀態與公司頁面界定目前的公開邊界及引用脈絡。"] },
    ],
    infrastructure: {
      kicker: "基礎設施審查",
      title: "從受限定的容量脈絡，到未來交付。",
      lead: "將交易對手報告的容量，與發布所需的服務及交付控制清楚分開。",
      capacityStage: "交易對手報告的預期託管容量；並非即時或已完成部署。",
      servingStage: "模型服務在部署、授權與執行證據完成驗證前，仍受發布門檻限制。",
      deliveryStage: "統一 API 僅為公開整合預覽，並非目前可用的推論端點。",
      checklistTitle: "部署審查輸入",
      checklist: ["工作負載", "模型需求", "用量輪廓", "部署區域", "資料處理", "服務就緒門檻"],
    },
    status: {
      kicker: "公開狀態",
      title: "啟動準備中",
      lead: "網站預覽與未來服務就緒狀態會分開呈現。",
      labels: { website: "網站", manifest: "供應商 Manifest", inference: "推論 API", payments: "付款", enterpriseReview: "企業審查" },
      states: { ready: "已就緒", preview: "預覽", preparation: "準備中", "not-ready": "尚未就緒" },
    },
    deploymentReview: "部署審查",
  },
};

export const POLICY_CONTENT: Record<Locale, PolicyLocaleContent> = {
  en: {
    privacy: {
      kicker: "Privacy",
      title: "Current privacy boundary",
      lead: "This launch site does not transmit or persist the current enquiry and preview interactions.",
      sections: [
        { id: "current-interactions", title: "Current interactions", body: ["The current enquiry, estimator, console, and launch-access interactions stay in your browser and are not transmitted or persisted."] },
        { id: "features-not-enabled", title: "Features not enabled", body: ["Accounts, payment processing, live inference, API credentials, usage accounting, and capacity reservation are not enabled on this launch site."] },
        { id: "future-changes", title: "Future changes", body: ["If a future release changes data handling, the public privacy notice and the relevant service controls will be updated before that release."] },
      ],
    },
    terms: {
      kicker: "Terms",
      title: "Current site terms",
      lead: "This launch site is informational and does not form a commercial service relationship.",
      sections: [
        { id: "informational-site", title: "Informational site", body: ["This site provides public context and illustrative planning information only."] },
        { id: "non-transactional-access", title: "Non-transactional access", body: ["No purchase, reservation, account, API access, SLA, or service commitment is formed through this launch site or its local interactions."] },
        { id: "external-sources", title: "External sources", body: ["Company and capacity context is qualified by the cited external sources and does not create a promise of deployment, capacity, or service."] },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "Can I buy tokens now?", answer: "No. Payments are not enabled, and no payment can be made through this launch site." },
      { id: "rates-final", question: "Are the displayed rates final?", answer: "No. Displayed rates are illustrative and are not a final offer or chargeable rate." },
      { id: "api-live", question: "Is the API live?", answer: "No. There is no live inference endpoint or usable API access at this time." },
      { id: "entered-information", question: "What happens to information entered here?", answer: "Current interactions are not transmitted or persisted; they remain in this browser." },
      { id: "capacity-deployed", question: "Is 3.1 MW already deployed?", answer: "No. The figure is counterparty-reported expected capacity, not completed deployment.", href: "/company", linkLabel: "Read company context" },
      { id: "deployment-review", question: "What is a deployment review?", answer: "It is a local, non-binding planning flow for discussing future deployment inputs; it does not reserve capacity or create a service commitment." },
      { id: "launch-access", question: "How do I request launch access?", answer: "A local request creates no reservation or account. It is only a planning interaction in this browser." },
    ],
  },
  zh: {
    privacy: {
      kicker: "隱私權",
      title: "目前的隱私權邊界",
      lead: "此啟動網站不會傳送或持久保存目前的洽詢與預覽互動。",
      sections: [
        { id: "current-interactions", title: "目前互動", body: ["目前的洽詢、估算器、控制台與啟動存取互動會保留在你的瀏覽器中，不會傳送或持久保存。"] },
        { id: "features-not-enabled", title: "尚未啟用的功能", body: ["帳戶、付款處理、即時推論、API 憑證、用量計算與容量預留均未在此啟動網站啟用。"] },
        { id: "future-changes", title: "未來變更", body: ["若未來版本變更資料處理方式，會在發布前更新公開隱私權聲明與相關服務控制。"] },
      ],
    },
    terms: {
      kicker: "條款",
      title: "目前網站條款",
      lead: "此啟動網站僅供資訊參考，不會形成商業服務關係。",
      sections: [
        { id: "informational-site", title: "資訊網站", body: ["本網站僅提供公開脈絡與示意性的規劃資訊。"] },
        { id: "non-transactional-access", title: "非交易性存取", body: ["透過此啟動網站或其本機互動，不會形成購買、預留、帳戶、API 存取、SLA 或服務承諾。"] },
        { id: "external-sources", title: "外部來源", body: ["公司與容量脈絡受引用外部來源的限定，並不構成部署、容量或服務的承諾。"] },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "我現在可以購買 Token 嗎？", answer: "不可以。付款尚未啟用，無法透過此啟動網站付款。" },
      { id: "rates-final", question: "顯示的費率是最終價格嗎？", answer: "不是。顯示的費率僅供示意，不是最終報價或可收費費率。" },
      { id: "api-live", question: "API 已經上線了嗎？", answer: "沒有。目前沒有即時推論端點或可用的 API 存取。" },
      { id: "entered-information", question: "我在這裡輸入的資訊會怎麼處理？", answer: "目前互動不會傳送或持久保存，僅保留在此瀏覽器中。" },
      { id: "capacity-deployed", question: "3.1 MW 已經部署了嗎？", answer: "沒有。該數字是交易對手報告的預期容量，並非已完成部署。", href: "/company", linkLabel: "閱讀公司脈絡" },
      { id: "deployment-review", question: "什麼是部署審查？", answer: "這是本機、非約束性的規劃流程，用於討論未來部署輸入；不會預留容量或形成服務承諾。" },
      { id: "launch-access", question: "如何申請啟動存取？", answer: "本機請求不會建立預留或帳戶，只是此瀏覽器中的規劃互動。" },
    ],
  },
};
