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
      lead: "How the website, accounts, AI workspace, and model requests handle data.",
      sections: [
        { id: "current-interactions", title: "What this site processes", body: ["Comparison, pricing estimates, and integration configuration run in your browser. API keys and request inputs are forwarded through this site’s server to the fixed Power Champion gateway when you explicitly check a balance, send a playground request, or send a chat message. These tools hold keys in page memory and do not save them in browser storage; the proxy code does not log request bodies or API keys. Playground responses, chat history, and token counts remain in page memory until navigation or reload. Chat history and customer API keys entered into these tools are not saved to the account database. Sending a chat includes its conversation history and any selected agent instructions or reference text; the model gateway processes that content. Choosing Export chat downloads a copy to your device."] },
        { id: "agent-drafts", title: "Agent drafts and test transfers", body: ["Editing an agent does not automatically save it. Choosing Save draft stores its name, purpose, selected model, instructions, tone, reference text, and sample prompt in this browser’s localStorage until you delete the saved draft or clear site data. Choosing Test in chat writes a separate copy to this tab’s sessionStorage; the application accepts that transfer for 30 minutes. Expiry prevents reloading the transfer but does not erase a draft already loaded into page memory, and the stored copy may remain until the tab closes or site data is cleared. Deleting a saved draft does not clear an active conversation or its separate test transfer. Copying instructions or exporting JSON creates a copy under your control."] },
        { id: "public-trial", title: "Optional public trial", body: ["Public trial is disabled by default. It becomes available only when an operator enables it, configures a server-side trial API key, and sets a positive site-wide daily request cap. If enabled, opening the workspace can set an essential HttpOnly trial cookie lasting up to seven days. The account service stores a hash of that trial token, session creation and expiry times, and request identifiers, UTC dates, reservation and completion timestamps, and outcomes to enforce daily limits for the session and the site. A request consumes a trial slot before the gateway is called; failed or cancelled requests also count. These trial records do not contain prompts, conversation history, model responses, or API keys. The gateway still receives and processes the model request."] },
        { id: "site-measurement", title: "Site measurement", body: ["Public pages may load Cloudflare Web Analytics when the operator enables it for the deployment. It sets no cookie, stores no identifier in your browser, and does not follow you across sites; it reports aggregate page views, referrers, country, and page performance. Signed-in areas — the account workspace, administration, sign-in and registration — never load it, and neither do preview deployments. Nothing measured here is joined to an account, an API key, or a request you send to a model."] },
        { id: "account-data", title: "Account and session data", body: ["When you register, the account service stores your name, email address, account role, and a salted scrypt password hash. It does not store your password in plain text. An essential HttpOnly cookie keeps you signed in, with a default lifetime of 12 hours; the server stores a hash of its session token, the account association, and creation and expiry times. Signing out invalidates that session. Account activity and authentication-protection records are retained by the account service."] },
        { id: "account-records", title: "Key ownership and credit requests", body: ["The account service stores the ownership, label, visible prefix, status, and timestamps of API keys managed through the workspace. It also stores credit-request amounts, reference text, review decisions and notes, reviewer identifiers, timestamps, and audit events. A credit request is a record for manual review: submitting or approving it does not process a payment or automatically add funds to the inference gateway."] },
        { id: "account-recovery", title: "Account support", body: ["For account recovery or questions about account records, contact info@powerchampion.org. Recovery is handled by an operator after checking the request; there is no self-service password-reset email flow. An operator password reset revokes existing account sessions. Do not send your password or a complete API key by email."] },
        { id: "api-usage-data", title: "API usage data", body: ["Requests to the API itself are metered by the b300 gateway for billing (tokens, timestamps, model). This is operational billing data for the service you call — see the data-retention policy at b300.powerchampion.ai/data-retention."] },
        { id: "future-changes", title: "Future changes", body: ["If a future release changes data handling, the public privacy notice and the relevant service controls will be updated before that release."] },
      ],
    },
    terms: {
      kicker: "Terms",
      title: "Site terms",
      lead: "This site provides an AI workspace and service information; commercial terms for API usage are formed when a key is issued.",
      sections: [
        { id: "informational-site", title: "Site scope", body: ["The website provides interactive tools and public service information. Requests sent to the API gateway at b300.powerchampion.ai depend on current model availability and are subject to measured usage billing. An interface or a pre-written example does not establish that a live request has succeeded."] },
        { id: "api-access", title: "API access", body: ["The workspace supports account registration and credit requests for manual review. API key provisioning and usage retrieval require a configured gateway connection; contact info@powerchampion.org when these services are unavailable. Published catalog rates and estimates describe the listed pricing, not a live reading of the gateway meter. Credit-request approval does not process payment or automatically fund gateway usage."] },
        { id: "external-sources", title: "External sources", body: ["Company and capacity context is qualified by the cited external sources and does not create a promise of deployment, capacity, or service."] },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "Can I buy tokens now?", answer: "Create an account and submit a credit request from your workspace, including the amount and reference information. The team reviews requests manually. Submission or approval does not charge you or automatically increase your API balance. Contact info@powerchampion.org to arrange access and confirm funding details." },
      { id: "rates-final", question: "Are the displayed rates final?", answer: "These are published catalog rates, and the calculator uses them for estimates. They are not fetched live from the gateway billing configuration. Text models list input and output pricing separately; other models may charge per image, audio minute, or input tokens. Confirm applicable pricing and model availability before using the API." },
      { id: "api-live", question: "Is the API live?", answer: "The OpenAI-compatible endpoint is deployed at b300.powerchampion.ai — text, vision, image, speech, embeddings, and reranking behind one key. Whether models are currently serving is shown live on the status page; this site does not claim availability it cannot observe." },
      { id: "entered-information", question: "What happens to information entered here?", answer: "Account registration stores your name, email, and a password hash. The account service also stores session records, managed-key ownership, credit requests, and audit events. Balance, playground, and chat tools send the key and request through this site’s server to the Power Champion gateway; these tools keep entered keys and chat history in page memory. Agent drafts are stored locally only when you choose to save or transfer them for testing. If public trial is enabled, a separate cookie and daily request records enforce its allowance. Read the privacy notice for each data flow." },
      { id: "capacity-deployed", question: `Is ${COMPANY_CAPACITY_MW} already deployed?`, answer: "No. The figure is counterparty-reported expected capacity, not completed deployment.", href: "/company", linkLabel: "Read company context" },
      { id: "deployment-review", question: "What is a deployment review?", answer: "It is a non-binding channel for discussing deployment inputs; it does not reserve capacity or create a service commitment." },
      { id: "agent-tools", question: "Can an agent act in my other applications?", answer: "The current agents are configured through instructions and the reference text you provide. They do not have connected browsing, private databases, email, or other external tools, and cannot execute actions in those systems. Custom integrations and deployment services require a separate project scope.", href: "/contact", linkLabel: "Discuss a custom agent" },
      { id: "trial-access", question: "Can I chat without my own API key?", answer: "You can explore clearly labelled pre-written examples without making a model request. Public trial chat is optional and disabled by default; when enabled, it has session and site-wide daily limits. Otherwise, connect your own API key. A successful live response depends on the gateway and the selected model’s current availability." },
      { id: "launch-access", question: "How do I request launch access?", answer: "Create an account, then open the workspace to manage API keys and credit requests. Key creation and usage data become available when the gateway connection is configured. If the workspace reports that provisioning is not connected, contact info@powerchampion.org for manual access. Registering an account does not itself provide API credit." },
    ],
  },
  zh: {
    privacy: {
      kicker: "隱私權",
      title: "隱私權邊界",
      lead: "網站、帳號、AI 工作區與模型請求如何處理資料。",
      sections: [
        { id: "current-interactions", title: "本站處理的資料", body: ["模型比較、費用試算與串接設定在瀏覽器執行。當你主動查詢餘額、傳送模型測試請求或聊天訊息時，API 金鑰與請求內容會經由本站伺服器轉送至固定的 Power Champion 閘道。這些工具僅將金鑰留在頁面記憶體，不存入瀏覽器儲存空間；代理程式不記錄請求內容或金鑰。模型測試回覆、對話紀錄與 Token 數留在頁面記憶體，直到離開或重新整理；這些工具的對話紀錄與客戶輸入的 API 金鑰不會存入帳號資料庫。傳送聊天訊息時，會一併送出對話歷史、所選智能體的指令與參考文字，交由模型閘道處理。選擇匯出對話，會在你的裝置下載一份副本。"] },
        { id: "agent-drafts", title: "智能體草稿與測試移交", body: ["編輯智能體不會自動儲存。選擇儲存草稿，會將名稱、用途、所選模型、指令、語氣、參考文字與範例問題存入此瀏覽器的 localStorage，直到你刪除已存草稿或清除網站資料。選擇在對話中測試，會在目前分頁的 sessionStorage 寫入另一份副本，應用程式可在 30 分鐘內載入此設定。到期後不能重新載入該份測試設定，但不會清除已載入頁面記憶體的內容；儲存的副本可能保留到分頁關閉或網站資料清除為止。刪除已存草稿不會清除正在進行的對話或另一份測試設定。複製指令或匯出 JSON，則會產生由你管理的副本。"] },
        { id: "public-trial", title: "選用的公開試用", body: ["公開試用預設關閉。管理人員必須啟用試用、設定伺服器端試用 API 金鑰，並設定大於零的全站每日請求上限，才會開放。啟用後，開啟工作區可能會設定最長七天的必要 HttpOnly 試用 Cookie。帳號服務會儲存該試用憑證的雜湊、建立與到期時間，以及請求識別碼、UTC 日期、名額保留與完成時間、結果，用來管理單一試用階段及全站每日名額。請求會在呼叫閘道前占用名額，失敗或取消也會計入。這些試用紀錄不含提示詞、對話歷史、模型回覆或 API 金鑰；模型閘道仍會接收並處理請求內容。"] },
        { id: "site-measurement", title: "網站流量統計", body: ["公開頁面在管理人員為該部署啟用時，會載入 Cloudflare Web Analytics。它不設定 Cookie、不在瀏覽器存放識別碼，也不會跨網站追蹤你，只回報彙總後的頁面瀏覽次數、來源、國別與頁面效能。登入後的區域 —— 客戶工作區、管理後台、登入與註冊頁 —— 不會載入，預覽環境也不會。這裡量測到的資料不會與帳號、API 金鑰或你送給模型的請求連結。"] },
        { id: "account-data", title: "帳號與登入工作階段資料", body: ["註冊時，帳號服務會儲存姓名、電子郵件、帳號角色，以及使用隨機鹽值的 scrypt 密碼雜湊，不會以明文儲存密碼。必要的 HttpOnly Cookie 用來維持登入，預設有效期限為 12 小時；伺服器會儲存登入憑證的雜湊、所屬帳號、建立與到期時間。登出會使該次登入失效。帳號服務也會保留帳號操作及登入防護紀錄。"] },
        { id: "account-records", title: "金鑰歸屬與儲值申請", body: ["帳號服務會儲存工作區所管理 API 金鑰的歸屬、標籤、可見前綴、狀態與時間紀錄，也會儲存儲值申請金額、參考資訊、審核決定與備註、審核者識別碼、時間及稽核事件。儲值申請是供人工審核的紀錄；送出或核准申請，不會處理付款，也不會自動增加推論閘道的餘額。"] },
        { id: "account-recovery", title: "帳號協助", body: ["如需帳號復原或詢問帳號資料，請聯絡 info@powerchampion.org。復原由管理人員確認申請後處理，目前沒有自助寄送密碼重設信的流程。管理人員重設密碼後，既有登入工作階段會全部失效。請勿透過電子郵件傳送密碼或完整 API 金鑰。"] },
        { id: "api-usage-data", title: "API 用量資料", body: ["對 API 本身的請求會由 b300 閘道計量以供計費（Token 數、時間、模型）。這是你所呼叫服務的營運計費資料 — 詳見 b300.powerchampion.ai/data-retention。"] },
        { id: "future-changes", title: "未來變更", body: ["若未來版本變更資料處理方式，會在發布前更新公開隱私權聲明與相關服務控制。"] },
      ],
    },
    terms: {
      kicker: "條款",
      title: "網站條款",
      lead: "本網站提供 AI 工作區與服務資訊；API 使用的商業條款於金鑰發放時成立。",
      sections: [
        { id: "informational-site", title: "網站範圍", body: ["網站提供互動工具與公開服務資訊。送往 b300.powerchampion.ai API 閘道的請求，依模型當前供應狀態處理，並適用按用量計費。介面或預寫範例不代表已成功完成即時請求。"] },
        { id: "api-access", title: "API 存取", body: ["工作區提供帳號註冊及人工審核的儲值申請。API 金鑰發放與用量查詢需要已設定的閘道連線；服務無法使用時，請聯絡 info@powerchampion.org。目錄費率與試算依刊登價格呈現，不是即時讀取閘道計費設定。核准儲值申請不會處理付款，也不會自動增加閘道的可用餘額。"] },
        { id: "external-sources", title: "外部來源", body: ["公司與容量脈絡受引用外部來源的限定，並不構成部署、容量或服務的承諾。"] },
      ],
    },
    faq: [
      { id: "buy-tokens", question: "我現在可以購買 Token 嗎？", answer: "建立帳號後，可在工作區填寫金額與參考資訊，提出儲值申請，由團隊人工審核。送出或核准申請，不會向你扣款，也不會自動增加 API 餘額。請聯絡 info@powerchampion.org 安排使用權限並確認加值細節。" },
      { id: "rates-final", question: "顯示的費率是最終價格嗎？", answer: "這些是已刊登的模型目錄費率，試算工具依此估算，並非即時讀取閘道計費設定。文字模型的輸入與輸出分開計價；其他模型可能依每張圖片、音訊分鐘或輸入 Token 計費。使用 API 前，請先確認適用價格與模型供應狀態。" },
      { id: "api-live", question: "API 已經上線了嗎？", answer: "OpenAI 相容端點已部署於 b300.powerchampion.ai — 文字、視覺、圖像、語音、嵌入與重排序，一把金鑰全部搞定。模型目前是否正在服務，以狀態頁即時呈現為準；本站不宣稱無法觀測的可用性。" },
      { id: "entered-information", question: "我在這裡輸入的資訊會怎麼處理？", answer: "註冊會儲存姓名、電子郵件與密碼雜湊；帳號服務也會儲存登入紀錄、所管理金鑰的歸屬、儲值申請及稽核事件。餘額查詢、模型測試與聊天工具會經由本站伺服器，把金鑰及請求轉送到 Power Champion 閘道；這些工具將輸入的金鑰與對話留在頁面記憶體。智能體草稿僅在你選擇儲存或移交測試時存入瀏覽器。若公開試用已啟用，另外的 Cookie 與每日請求紀錄會用於管理名額。各項資料流程請參閱隱私權說明。" },
      { id: "capacity-deployed", question: `${COMPANY_CAPACITY_MW} 已經部署了嗎？`, answer: "沒有。該數字是交易對手報告的預期容量，並非已完成部署。", href: "/company", linkLabel: "閱讀公司脈絡" },
      { id: "deployment-review", question: "什麼是部署審查？", answer: "這是非約束性的洽談管道，用於討論部署輸入；不會預留容量或形成服務承諾。" },
      { id: "agent-tools", question: "智能體能操作我的其他應用程式嗎？", answer: "目前智能體透過指令與你提供的參考文字設定，未連接網路搜尋、私人資料庫、電子郵件或其他外部工具，無法在這些系統執行動作。客製串接與部署服務需要另外確認專案範圍。", href: "/contact", linkLabel: "討論客製智能體" },
      { id: "trial-access", question: "沒有自己的 API 金鑰，可以聊天嗎？", answer: "你可以先探索清楚標示的預寫範例，不會發出模型請求。公開聊天試用是選用功能，預設關閉；啟用後設有單一試用階段與全站每日名額。其他情況請連接自己的 API 金鑰。能否成功取得即時回覆，取決於閘道與所選模型當前的供應狀態。" },
      { id: "launch-access", question: "如何申請啟動存取？", answer: "先建立帳號，再進入工作區管理 API 金鑰與儲值申請。金鑰建立與用量資料需要已設定的閘道連線；若工作區顯示尚未連接發放服務，請聯絡 info@powerchampion.org 以人工方式安排存取。註冊帳號本身不會提供 API 額度。" },
    ],
  },
};
