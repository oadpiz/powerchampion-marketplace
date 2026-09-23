"use client";

/* Vinext serves this workspace through root-relative document navigation. */

import { useMemo, useState, type FormEvent } from "react";
import { AGENT_TEMPLATES, type AgentCategory } from "../lib/agents";
import { useLocale } from "./locale-provider";
import { PromoMotionRoot } from "./promo-motion";
import { AgentShowcase } from "./agent-showcase";

type Category = AgentCategory | "all";

const ENDPOINT_EXAMPLE = `curl https://powerchampion.ai/api/agents/<agent-id>/chat \\
  -H "Authorization: Bearer $POWERCHAMPION_API_KEY" \\
  -H "X-PC-Agent-Token: $PC_AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Draft a reply to this customer note."}]}'`;

const COPY = {
  en: {
    eyebrow: "POWER CHAMPION / AI ASSISTANTS",
    title: "An assistant for the way you work.",
    lead: "Start with a focused assistant. Shape its instructions, try a conversation, and build toward an agent that fits your company's workflow.",
    primary: "Find an assistant",
    secondary: "Build with our team",
    tasksLink: "Agent tasks",
    tasksEyebrow: "AGENT TASKS",
    tasksTitle: "From a prompt to a deliverable.",
    tasksLead: "Choose a saved agent, set a goal and execution limits, then review progress, approvals and files in the task console. The console shows whether task execution is enabled.",
    tasksCta: "Open task console",
    tasksBuild: "Create an agent",
    tasksSteps: ["Define the work", "Review each step", "Collect the result"],
    illustration: "From a task to a useful response",
    task: "Your task",
    instructions: "Clear instructions",
    model: "A model you choose",
    response: "A response to review",
    galleryTitle: "A useful starting point.",
    galleryLead: "Four instruction templates, ready to try or make your own.",
    search: "Search assistants",
    placeholder: "Search a task or assistant…",
    categories: {
      all: "All assistants",
      operations: "Operations",
      knowledge: "Knowledge",
      creative: "Content",
      engineering: "Engineering",
    },
    results: "assistants",
    try: "Try assistant",
    customize: "Customize",
    sample: "Try asking",
    inspect: "Preview instructions",
    noResults: "No assistants match this search.",
    reset: "Clear filters",
    templateNote:
      "These assistants use instructions to guide a model. Company knowledge, web search, and actions in other systems require a separate integration.",
    capabilityEyebrow: "WHAT AN ASSISTANT CAN DO",
    capabilityTitle: "Configure it once. Call it from your own application.",
    capabilityLead:
      "Shape an assistant in the builder, save it to your account, and it gets its own endpoint. Your application sends the conversation with your API key; the instructions and reference material stay on our server.",
    capabilityItems: [
      {
        title: "Draft from your own material",
        body: "Give it approved answers, policies or product facts as reference text. It drafts replies that follow them and says when they do not cover the question.",
      },
      {
        title: "Work through supplied documents",
        body: "Paste a contract, a report or meeting notes into the conversation and get findings, open questions and a next step — the material stays in that request.",
      },
      {
        title: "Keep one voice across a team",
        body: "The instructions live in one saved agent, so everyone calling the endpoint gets the same behaviour. Update it and the next call uses the new version.",
      },
      {
        title: "Run inside your product",
        body: "One HTTPS call from your backend returns the answer, the finish reason and token usage. No SDK to adopt, no conversation stored here.",
      },
    ],
    capabilityEndpoint: "Each saved agent answers on its own endpoint:",
    capabilityLimits:
      "This chat endpoint returns a response without running tools. For tool-backed work, open Agent tasks. Connections to company databases and external business systems require a separate integration.",
    capabilityCta: "Build an assistant",
    roadmapEyebrow: "WHAT WE ARE BUILDING",
    roadmapTitle: "Where this is going.",
    roadmapLead:
      "These are the capabilities we are building on our own GPUs. We publish them so you can plan, and we label each one honestly: shipped means you can use it today, in development means it exists and is being tested, planned means the design is settled and the work is scoped. We do not commit to dates on this page — ask us and we will tell you where a specific item stands.",
    roadmapStates: { shipped: "SHIPPED", building: "IN DEVELOPMENT", planned: "PLANNED" },
    roadmapItems: [
      {
        state: "shipped" as const,
        title: "Configured assistants with their own endpoint",
        body: "Build an assistant from instructions and reference material, save it to your account with versions, and call it from your application with your own API key.",
      },
      {
        state: "building" as const,
        title: "Memory that carries across conversations",
        body: "An assistant that remembers the preferences and corrections a team gives it, instead of starting from zero each time. Built on our own infrastructure and tested internally; individual customer facts stay in the memory store and never enter model weights.",
      },
      {
        state: "planned" as const,
        title: "Answers grounded in your documents",
        body: "Upload your material, and answers cite the passage they came from. Chunking, embedding and reranking all run on our own bge-m3 and bge-reranker models — no third-party retrieval service in the path.",
      },
      {
        state: "building" as const,
        title: "Task execution with tools and human approval",
        body: "The task console brings together built-in tools, approvals, progress and deliverables. Execution depends on the deployment's runtime configuration; check availability in the console. External business-system connectors are scoped separately.",
      },
      {
        state: "planned" as const,
        title: "Images and documents as input",
        body: "Send a scan, a form or a screenshot to the same endpoint, handled by our vision model.",
      },
      {
        state: "planned" as const,
        title: "Private deployment",
        body: "The same stack on dedicated nodes, or inside your own facility, for teams whose code or customer data cannot leave a defined boundary.",
      },
    ],
    roadmapNote:
      "Nothing on this page is a delivery commitment. If one of these decides your project, talk to us first: we will tell you its real state, and scope it with you rather than around you.",
    roadmapCta: "Discuss a requirement",
    serviceEyebrow: "BUILT FOR YOUR COMPANY",
    serviceTitle: "From a useful assistant to a working business tool.",
    serviceLead:
      "Bring us the process you want to improve. We can scope an agent around your team's knowledge, systems, permissions, and review requirements.",
    servicePoints: [
      "A defined task and acceptance criteria",
      "Knowledge and system integrations scoped with your team",
      "Human review for consequential actions",
    ],
    process: [
      {
        title: "Discover",
        body: "Map the users, repeated tasks, current process, and the outcome worth measuring.",
      },
      {
        title: "Prepare knowledge",
        body: "Choose source documents, access rules, update ownership, and retrieval requirements.",
      },
      {
        title: "Connect systems",
        body: "Scope the APIs, authentication, allowed actions, and approval steps the agent needs.",
      },
      {
        title: "Test together",
        body: "Evaluate representative questions, failure cases, escalation paths, and agreed acceptance criteria.",
      },
      {
        title: "Plan launch",
        body: "Define deployment, handover, monitoring, operating responsibilities, and ongoing support.",
      },
    ],
    scopeNote:
      "Integrations, hosting, commercial terms, and delivery timing are confirmed in a project proposal. The templates above do not include these connections.",
    briefTitle: "Tell us about the work.",
    briefLead:
      "A few details are enough to prepare an initial conversation. Review the brief before opening your email app.",
    name: "Your name",
    email: "Work email",
    company: "Company",
    optional: "optional",
    objective: "What should the agent help your team do?",
    objectivePlaceholder:
      "Who will use it, what happens today, and what should improve?",
    systems: "Knowledge and systems to connect",
    systemsPlaceholder:
      "For example: product guides, your help desk, an internal API. Describe systems without including credentials.",
    prepare: "Review project brief",
    update: "Update project brief",
    localNote:
      "The draft stays in this page until you choose to open your email app and send it.",
    reviewTitle: "Review your project brief",
    reviewLabel: "Editable email draft",
    reviewNote:
      "Opening the email app prepares a message to info@powerchampion.org. You still review and send it yourself.",
    openEmail: "Open email draft",
    copy: "Copy brief",
    copied: "Brief copied",
    copyError:
      "Copy was unavailable. Select the draft text and copy it manually.",
    subject: "AI agent project inquiry",
    objectiveLabel: "Desired workflow",
    systemsLabel: "Knowledge and integrations",
    absent: "To be discussed",
    emailIntro:
      "Hello Power Champion team,\n\nI would like to discuss a custom AI agent project.",
    emailClose:
      "Please help us review the scope, integrations, and next steps.",
  },
  zh: {
    eyebrow: "POWER CHAMPION / AI 助手",
    title: "找到適合你工作方式的 AI 助手。",
    lead: "從有明確任務的助手開始。調整指示、實際對話，再逐步打造符合公司流程的 AI 代理。",
    primary: "探索 AI 助手",
    secondary: "與我們打造專屬代理",
    tasksLink: "Agent 任務",
    tasksEyebrow: "AGENT 任務",
    tasksTitle: "從一句需求，到一份成果。",
    tasksLead: "選擇已儲存的智能體、設定目標與執行上限，再到任務控制台追蹤進度、審核操作及取得檔案。是否開放任務執行，以控制台顯示為準。",
    tasksCta: "開啟任務控制台",
    tasksBuild: "建立智能體",
    tasksSteps: ["定義工作", "逐步審閱", "取得成果"],
    illustration: "從任務到可使用的回應",
    task: "你的任務",
    instructions: "清楚的指示",
    model: "你選擇的模型",
    response: "可供審閱的回應",
    galleryTitle: "從一個實用的起點開始。",
    galleryLead: "四種指示範本，可以直接試用，也能調整成自己的助手。",
    search: "搜尋助手",
    placeholder: "搜尋任務或助手…",
    categories: {
      all: "全部助手",
      operations: "日常營運",
      knowledge: "知識研究",
      creative: "內容創作",
      engineering: "程式開發",
    },
    results: "個助手",
    try: "試用助手",
    customize: "自訂助手",
    sample: "可以這樣問",
    inspect: "查看助手指示",
    noResults: "沒有符合搜尋條件的助手。",
    reset: "清除篩選",
    templateNote:
      "這些助手透過指示引導模型回應。公司知識、網路搜尋及其他系統的操作，需要另外規劃串接。",
    capabilityEyebrow: "助手能做什麼",
    capabilityTitle: "設定一次，之後由你的程式呼叫。",
    capabilityLead:
      "在建置器裡調好助手、存進帳號，它就會有自己的端點。你的應用程式帶著自己的 API 金鑰送出對話，指令與參考資料留在我們的伺服器上。",
    capabilityItems: [
      {
        title: "依你的資料草擬回覆",
        body: "把確認過的答案、政策或產品資訊放進參考資料。助手會照著擬稿，遇到資料沒涵蓋的問題會直說。",
      },
      {
        title: "處理你丟進來的文件",
        body: "把合約、報告或會議記錄貼進對話，取得重點、待確認事項與下一步；這些內容只留在該次請求裡。",
      },
      {
        title: "讓團隊講同一套話",
        body: "指令只存在一個智能體裡，所有呼叫端點的人得到同樣的行為。更新後，下一次呼叫就會用新版本。",
      },
      {
        title: "直接跑在你的產品裡",
        body: "後端一個 HTTPS 呼叫就拿到回覆、結束原因與 Token 用量。不必導入 SDK，對話也不會留在這裡。",
      },
    ],
    capabilityEndpoint: "每個儲存的智能體都有自己的端點：",
    capabilityLimits:
      "對話端點只回傳回應，不會執行工具。需要工具協助的工作，請開啟 Agent 任務；公司資料庫與外部業務系統仍需另外規劃串接。",
    capabilityCta: "開始建置助手",
    roadmapEyebrow: "我們正在做什麼",
    roadmapTitle: "接下來會長成什麼樣子。",
    roadmapLead:
      "以下是我們在自有 GPU 上建構的能力。公開出來是為了讓你能規劃，每一項都誠實標示狀態：已上線代表現在就能用，開發中代表已經做出來、正在內部測試，規劃中代表設計已定、工作已估。本頁不承諾時程 —— 想知道某一項的實際進度，直接問我們。",
    roadmapStates: { shipped: "已上線", building: "開發中", planned: "規劃中" },
    roadmapItems: [
      {
        state: "shipped" as const,
        title: "可設定的助手與專屬端點",
        body: "用指令與參考資料打造助手，存進帳號並保留版本，由你的應用程式帶著自己的 API 金鑰呼叫。",
      },
      {
        state: "building" as const,
        title: "跨對話累積的記憶",
        body: "讓助手記得團隊給過的偏好與糾正，而不是每次從零開始。建在我們自有的基礎設施上，目前於內部測試；個別客戶的事實只留在記憶庫，永遠不會進入模型權重。",
      },
      {
        state: "planned" as const,
        title: "以你的文件為依據作答",
        body: "上傳資料後，回答會標示引用的段落。切塊、向量與重排全部使用我們自有的 bge-m3 與 bge-reranker，鏈路上沒有第三方檢索服務。",
      },
      {
        state: "building" as const,
        title: "具備工具與人工覆核的任務執行",
        body: "任務控制台整合內建工具、操作審核、執行進度與成果。是否可執行取決於部署環境的設定，請在控制台查看；外部業務系統的連接另行規劃。",
      },
      {
        state: "planned" as const,
        title: "圖片與文件輸入",
        body: "把掃描件、表單或截圖送到同一個端點，由我們的視覺模型處理。",
      },
      {
        state: "planned" as const,
        title: "私有部署",
        body: "同一套系統跑在專屬節點，或直接進到你的機房，適合程式碼與客戶資料不能離開特定邊界的團隊。",
      },
    ],
    roadmapNote:
      "本頁任何一項都不構成交付承諾。如果其中某一項會決定你的專案，先跟我們談：我們會告訴你它真正的狀態，並與你一起界定範圍。",
    roadmapCta: "討論需求",
    serviceEyebrow: "為你的公司打造",
    serviceTitle: "從實用的助手，到能融入營運的工具。",
    serviceLead:
      "帶著你想改善的流程，與我們討論。依據團隊知識、使用系統、權限及審核需求，一起定義專屬 AI 代理的範圍。",
    servicePoints: [
      "明確的任務與驗收標準",
      "與團隊共同規劃知識與系統串接",
      "重要操作保留人工審核",
    ],
    process: [
      {
        title: "釐清需求",
        body: "了解使用者、重複任務、現有流程，以及值得衡量的改善目標。",
      },
      {
        title: "整理知識",
        body: "確認來源文件、存取規則、資料更新責任與檢索需求。",
      },
      {
        title: "串接系統",
        body: "規劃 API、驗證方式、可執行的動作，以及必要的核准步驟。",
      },
      {
        title: "共同驗證",
        body: "測試代表性問題、失敗情境、轉交人工的方式與約定驗收標準。",
      },
      {
        title: "規劃上線",
        body: "確認部署、交接、監測、操作責任及後續支援方式。",
      },
    ],
    scopeNote:
      "系統串接、託管、商務條件與交付時程，均在專案提案中確認。上方助手範本尚未包含這些系統連接。",
    briefTitle: "先說說你想完成的工作。",
    briefLead:
      "提供幾項資訊，就能準備第一次討論。先檢查需求草稿，再開啟郵件程式。",
    name: "你的姓名",
    email: "工作信箱",
    company: "公司名稱",
    optional: "選填",
    objective: "希望代理協助團隊完成什麼？",
    objectivePlaceholder: "誰會使用、目前如何處理，以及希望改善什麼？",
    systems: "需要連接的知識與系統",
    systemsPlaceholder:
      "例如：產品文件、客服系統、內部 API。描述系統即可，請勿填入憑證。",
    prepare: "預覽專案需求",
    update: "更新專案需求",
    localNote: "草稿留在此頁，直到你選擇開啟郵件程式並自行寄出。",
    reviewTitle: "檢查你的專案需求",
    reviewLabel: "可編輯的郵件草稿",
    reviewNote:
      "開啟郵件程式後，會準備一封寄至 info@powerchampion.org 的郵件，仍由你檢查並寄出。",
    openEmail: "開啟郵件草稿",
    copy: "複製需求",
    copied: "已複製需求",
    copyError: "目前無法自動複製，請選取草稿文字並手動複製。",
    subject: "AI 代理專案洽詢",
    objectiveLabel: "預期工作流程",
    systemsLabel: "知識與系統串接",
    absent: "待討論",
    emailIntro: "Power Champion 團隊您好：\n\n我想討論客製 AI 代理專案。",
    emailClose: "希望協助評估專案範圍、系統串接與後續步驟。",
  },
};

const TAGS = {
  support: {
    en: ["Reply drafts", "Policy guidance", "Human handoff"],
    zh: ["回覆草稿", "政策說明", "人工接手"],
  },
  research: {
    en: ["Source analysis", "Comparisons", "Open questions"],
    zh: ["資料分析", "方案比較", "待確認問題"],
  },
  content: {
    en: ["Product copy", "Campaign briefs", "Brand voice"],
    zh: ["產品文案", "宣傳提案", "品牌語氣"],
  },
  coding: {
    en: ["Code review", "Debugging ideas", "Test plans"],
    zh: ["程式檢視", "除錯方向", "驗證規劃"],
  },
};

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export function AgentsGallery() {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const visibleTemplates = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return AGENT_TEMPLATES.filter(
      (template) =>
        (category === "all" || template.category === category) &&
        (!normalized ||
          `${template.name[locale]} ${template.description[locale]} ${TAGS[template.id][locale].join(" ")}`
            .toLocaleLowerCase()
            .includes(normalized)),
    );
  }, [category, locale, query]);

  function prepareBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    const company = value("company");
    setSubject(`${copy.subject}${company ? ` — ${company}` : ""}`);
    setDraft(
      `${copy.emailIntro}\n\n${copy.name}: ${value("name")}\n${copy.email}: ${value("email")}\n${copy.company}: ${company || copy.absent}\n\n${copy.objectiveLabel}:\n${value("objective")}\n\n${copy.systemsLabel}:\n${value("systems") || copy.absent}\n\n${copy.emailClose}`,
    );
    setCopyStatus("idle");
  }

  async function copyBrief() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <PromoMotionRoot>
    <main id="main-content" className="agents-page">
      <section className="agents-hero" aria-labelledby="agents-title">
        <div>
          <p className="agents-eyebrow">{copy.eyebrow}</p>
          <h1 id="agents-title">{copy.title}</h1>
          <p className="agents-lead">{copy.lead}</p>
          <div className="agents-actions">
            <a className="agents-button" href="#assistant-gallery">
              {copy.primary}
              <Arrow />
            </a>
            <a className="agents-text-link" href="#agent-services">
              {copy.secondary}
              <Arrow />
            </a>
            <a className="agents-text-link" href="/tasks">
              {copy.tasksLink}
              <Arrow />
            </a>
          </div>
        </div>
        <div className="agents-flow" role="img" aria-label={copy.illustration}>
          <div className="agents-flow-top">
            <span aria-hidden="true">✳</span>
            <span>{copy.task}</span>
          </div>
          <div className="agents-flow-line" />
          <div className="agents-flow-node">
            <span aria-hidden="true">01</span>
            {copy.instructions}
          </div>
          <div className="agents-flow-line" />
          <div className="agents-flow-node">
            <span aria-hidden="true">02</span>
            {copy.model}
          </div>
          <div className="agents-flow-line" />
          <div className="agents-flow-result">
            <i aria-hidden="true">↳</i>
            {copy.response}
          </div>
        </div>
      </section>
      <section className="agents-task-entry" aria-labelledby="agents-task-title">
        <div>
          <p className="agents-eyebrow">{copy.tasksEyebrow}</p>
          <h2 id="agents-task-title">{copy.tasksTitle}</h2>
          <p className="agents-task-lead">{copy.tasksLead}</p>
          <div className="agents-actions">
            <a className="agents-button" href="/tasks">{copy.tasksCta}<Arrow /></a>
            <a className="agents-text-link" href="/agents/build">{copy.tasksBuild}<Arrow /></a>
          </div>
        </div>
        <ol className="agents-task-steps">
          {copy.tasksSteps.map((step, index) => <li key={step}><span aria-hidden="true">0{index + 1}</span>{step}</li>)}
        </ol>
      </section>
      <AgentShowcase language={locale === "zh" ? "zh-Hant" : "en"} />
      <section
        id="assistant-gallery"
        className="agents-gallery-section"
        aria-labelledby="agents-gallery-title"
      >
        <div className="agents-section-heading">
          <div>
            <p className="agents-eyebrow">01 / {copy.categories.all}</p>
            <h2 id="agents-gallery-title">{copy.galleryTitle}</h2>
            <p>{copy.galleryLead}</p>
          </div>
          <label className="agents-search">
            <span className="sr-only">{copy.search}</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.placeholder}
            />
          </label>
        </div>
        <div className="agents-filter-row">
          <div
            className="agents-filters"
            role="group"
            aria-label={copy.galleryTitle}
          >
            {(Object.keys(copy.categories) as Category[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {copy.categories[item]}
              </button>
            ))}
          </div>
          <span className="agents-result-count" aria-live="polite">
            {visibleTemplates.length} {copy.results}
          </span>
        </div>
        <div className="agents-card-grid">
          {visibleTemplates.map((template) => (
            <article
              className="agents-card"
              key={template.id}
              aria-labelledby={`agent-${template.id}`}
            >
              <div className="agents-card-heading">
                <span className="agents-card-icon" aria-hidden="true">
                  {template.icon}
                </span>
                <span>{copy.categories[template.category]}</span>
              </div>
              <h3 id={`agent-${template.id}`}>{template.name[locale]}</h3>
              <p>{template.description[locale]}</p>
              <ul className="agents-tags">
                {TAGS[template.id][locale].map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
              <div className="agents-starter">
                <span>{copy.sample}</span>
                <p>{template.starter[locale]}</p>
              </div>
              <details className="agents-instructions">
                <summary>{copy.inspect}</summary>
                <p>{template.instructions[locale]}</p>
              </details>
              <div className="agents-card-actions">
                <a
                  className="agents-button"
                  href={`/chat?agent=${template.id}`}
                  aria-label={`${copy.try} — ${template.name[locale]}`}
                >
                  {copy.try}
                  <span className="sr-only"> — {template.name[locale]}</span>
                  <Arrow />
                </a>
                <a
                  className="agents-text-link"
                  href={`/agents/build?template=${template.id}`}
                  aria-label={`${copy.customize} — ${template.name[locale]}`}
                >
                  {copy.customize}
                  <span className="sr-only"> — {template.name[locale]}</span>
                  <span aria-hidden="true">+</span>
                </a>
              </div>
            </article>
          ))}
        </div>
        {visibleTemplates.length === 0 && (
          <div className="agents-empty">
            <p>{copy.noResults}</p>
            <button
              type="button"
              onClick={() => {
                setCategory("all");
                setQuery("");
              }}
            >
              {copy.reset}
            </button>
          </div>
        )}
        <p className="agents-boundary">{copy.templateNote}</p>
      </section>
      <section
        id="agent-capabilities"
        className="agents-capabilities"
        aria-labelledby="agents-capability-title"
      >
        <div className="agents-section-heading">
          <div>
            <p className="agents-eyebrow">02 / {copy.capabilityEyebrow}</p>
            <h2 id="agents-capability-title">{copy.capabilityTitle}</h2>
            <p className="agents-lead">{copy.capabilityLead}</p>
          </div>
          <a className="agents-button" href="/agents/build">
            {copy.capabilityCta}
            <Arrow />
          </a>
        </div>
        <ul className="agents-capability-grid">
          {copy.capabilityItems.map((item) => (
            <li key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
        <div className="agents-capability-endpoint">
          <p>{copy.capabilityEndpoint}</p>
          <pre>
            <code>{ENDPOINT_EXAMPLE}</code>
          </pre>
          <p className="agents-capability-note">{copy.capabilityLimits}</p>
        </div>
      </section>
      <section
        id="agent-roadmap"
        className="agents-roadmap"
        aria-labelledby="agents-roadmap-title"
      >
        <div className="agents-section-heading">
          <div>
            <p className="agents-eyebrow">03 / {copy.roadmapEyebrow}</p>
            <h2 id="agents-roadmap-title">{copy.roadmapTitle}</h2>
            <p className="agents-lead">{copy.roadmapLead}</p>
          </div>
          <a className="agents-text-link" href="/contact">
            {copy.roadmapCta}
            <Arrow />
          </a>
        </div>
        <ul className="agents-roadmap-list">
          {copy.roadmapItems.map((item) => (
            <li key={item.title} data-state={item.state}>
              <p className="agents-roadmap-state">{copy.roadmapStates[item.state]}</p>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="agents-boundary">{copy.roadmapNote}</p>
      </section>
      <section
        id="agent-services"
        className="agents-services"
        aria-labelledby="agents-service-title"
      >

        <div className="agents-service-intro">
          <div>
            <p className="agents-eyebrow">04 / {copy.serviceEyebrow}</p>
            <h2 id="agents-service-title">{copy.serviceTitle}</h2>
            <p>{copy.serviceLead}</p>
            <a className="agents-button" href="#agent-project-brief">
              {copy.secondary}
              <Arrow />
            </a>
          </div>
          <ul>
            {copy.servicePoints.map((point) => (
              <li key={point}>
                <span aria-hidden="true">↗</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <ol className="agents-process">
          {copy.process.map((step, index) => (
            <li key={step.title}>
              <span>0{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="agents-boundary">{copy.scopeNote}</p>
      </section>
      <section
        id="agent-project-brief"
        className="agents-brief"
        aria-labelledby="agents-brief-title"
      >
        <div>
          <p className="agents-eyebrow">05 / POWER CHAMPION</p>
          <h2 id="agents-brief-title">{copy.briefTitle}</h2>
          <p>{copy.briefLead}</p>
          <a href="mailto:info@powerchampion.org">
            info@powerchampion.org
            <Arrow />
          </a>
        </div>
        <div>
          <form onSubmit={prepareBrief} className="agents-brief-form">
            <div className="agents-form-row">
              <label htmlFor="agent-brief-name">
                {copy.name}
                <input
                  id="agent-brief-name"
                  name="name"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </label>
              <label htmlFor="agent-brief-email">
                {copy.email}
                <input
                  id="agent-brief-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                />
              </label>
            </div>
            <label htmlFor="agent-brief-company">
              {copy.company} <span>({copy.optional})</span>
              <input
                id="agent-brief-company"
                name="company"
                autoComplete="organization"
                maxLength={120}
              />
            </label>
            <label htmlFor="agent-brief-objective">
              {copy.objective}
              <textarea
                id="agent-brief-objective"
                name="objective"
                rows={4}
                maxLength={1200}
                required
                placeholder={copy.objectivePlaceholder}
              />
            </label>
            <label htmlFor="agent-brief-systems">
              {copy.systems} <span>({copy.optional})</span>
              <textarea
                id="agent-brief-systems"
                name="systems"
                rows={3}
                maxLength={600}
                placeholder={copy.systemsPlaceholder}
              />
            </label>
            <button className="agents-button" type="submit">
              {draft === null ? copy.prepare : copy.update}
              <Arrow />
            </button>
            <p className="agents-boundary">{copy.localNote}</p>
          </form>
          {draft !== null && (
            <section
              className="agents-draft"
              aria-labelledby="agents-draft-title"
            >
              <h3 id="agents-draft-title">{copy.reviewTitle}</h3>
              <p>{copy.reviewNote}</p>
              <label htmlFor="agent-brief-draft" className="sr-only">
                {copy.reviewLabel}
              </label>
              <textarea
                id="agent-brief-draft"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setCopyStatus("idle");
                }}
                rows={12}
              />
              <div className="agents-actions">
                <a
                  className="agents-button"
                  href={`mailto:info@powerchampion.org?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`}
                >
                  {copy.openEmail}
                  <Arrow />
                </a>
                <button
                  type="button"
                  className="agents-text-link"
                  onClick={copyBrief}
                >
                  {copyStatus === "copied" ? copy.copied : copy.copy}
                </button>
              </div>
              <p role="status" className="agents-copy-status">
                {copyStatus === "error"
                  ? copy.copyError
                  : copyStatus === "copied"
                    ? copy.copied
                    : ""}
              </p>
            </section>
          )}
        </div>
      </section>
    </main>
    </PromoMotionRoot>
  );
}
