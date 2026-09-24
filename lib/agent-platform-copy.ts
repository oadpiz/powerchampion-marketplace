import type { HomeLanguage } from "./home-copy";

export type AgentPlatformOutcome = {
  title: string;
  audience: string;
  input: string;
  output: string;
  benefit: string;
};

export type AgentPlatformCopy = {
  eyebrow: string;
  title: [string, string];
  lead: string;
  taskCta: string;
  buildCta: string;
  galleryCta: string;
  contactCta: string;
  requirement: string;
  pause: string;
  resume: string;
  heroBenefits: string[];
  previewCta: string;
  outcomesEyebrow: string;
  outcomesTitle: string;
  outcomesLead: string;
  inputLabel: string;
  outputLabel: string;
  outcomeCta: string;
  outcomes: AgentPlatformOutcome[];
  heroVisual: {
    label: string;
    brief: string;
    plan: string;
    material: string;
    deliverable: string;
    review: string;
    filename: string;
    sections: Array<{ title: string; body: string }>;
  };
  capabilitiesEyebrow: string;
  capabilitiesTitle: string;
  capabilitiesLead: string;
  capabilities: Array<{ title: string; body: string }>;
  fileLabel: string;
  fileNote: string;
  valueEyebrow: string;
  valueTitle: string;
  valueLead: string;
  values: Array<{ title: string; body: string }>;
  workflowEyebrow: string;
  workflowTitle: string;
  workflow: Array<{ title: string; body: string }>;
  serviceEyebrow: string;
  serviceTitle: string;
  serviceLead: string;
  serviceItems: string[];
  serviceNote: string;
  faqEyebrow: string;
  faqTitle: string;
  faqs: Array<{ question: string; answer: string }>;
  closingTitle: string;
  closingLead: string;
};

export const agentPlatformCopy: Record<HomeLanguage, AgentPlatformCopy> = {
  en: {
    eyebrow: "POWER CHAMPION AGENTS",
    title: [
      "Give AI your data.",
      "Get reports and action lists."
    ],
    lead: "Turn CSVs, proposals, and meeting notes into editable reports and action lists. Guide the work as it runs, then review the files before you use them.",
    taskCta: "Start with a task",
    buildCta: "Create your agent",
    galleryCta: "Explore use cases",
    contactCta: "Discuss a custom agent",
    requirement: "Tasks require a signed-in account and your own customer API key. Check Tasks for current service availability.",
    pause: "Pause page motion",
    resume: "Resume page motion",
    heroVisual: {
      label: "Illustrative deliverable example",
      brief: "Prepare this week’s operations review",
      plan: "Summarize. Check. Plan.",
      material: "Weekly figures + reference notes",
      deliverable: "Weekly operations review",
      review: "A draft for your review.",
      filename: "weekly-review.docx",
      sections: [
        {
          title: "This week’s summary",
          body: "Summarize supplied figures and notable changes."
        },
        {
          title: "Checks to follow up",
          body: "Flag data gaps and changes that need verification."
        },
        {
          title: "Next week’s actions",
          body: "List follow-ups; mark missing owners or dates."
        }
      ]
    },
    capabilitiesEyebrow: "LESS SORTING. MORE TO WORK WITH.",
    capabilitiesTitle: "Let the agent prepare. Keep the decisions.",
    capabilitiesLead: "Bring the source material and define the result. The agent helps organize the work; you can follow, guide, and review it.",
    capabilities: [
      {
        title: "Bring scattered material together",
        body: "Turn selected references into a focused summary for the question you need to answer."
      },
      {
        title: "Make a table easier to discuss",
        body: "Analyze supplied CSV data and prepare findings alongside the figures they describe."
      },
      {
        title: "Add a source when it matters",
        body: "Approve limited reads of HTTPS sources when your task needs external reference material."
      },
      {
        title: "Know where the work stands",
        body: "See the plan and progress, so you can follow the steps behind the result."
      },
      {
        title: "Change course while it works",
        body: "Pause, add guidance, or cancel when the brief or priorities change."
      },
      {
        title: "Keep working in familiar files",
        body: "Download editable documents and data files, then review and refine them in your own tools."
      }
    ],
    fileLabel: "DELIVERABLES YOU CAN KEEP EDITING",
    fileNote: "Download TXT, MD, CSV, JSON, or DOCX outputs. Check the content, make your edits, and share when it is ready.",
    workflowEyebrow: "YOUR FIRST TASK",
    workflowTitle: "Define it. Run it. Review the files.",
    workflow: [
      {
        title: "Choose a task or create an agent",
        body: "Start from a task template, or create a reusable agent for work you repeat."
      },
      {
        title: "Add your material and run the task",
        body: "Add your sources, review the task and service availability, then confirm execution. Follow progress and add guidance when needed."
      },
      {
        title: "Review and take it forward",
        body: "Check the result, refine what needs attention, and download the files you need."
      }
    ],
    serviceEyebrow: "CUSTOM AGENT DEVELOPMENT",
    serviceTitle: "Your recurring work. Your company’s agent.",
    serviceLead: "Turn recurring reports, proposal reviews, or handovers into an agent built around your team. Custom development is a separate service, with the workflow, data access, and deliverables agreed before implementation.",
    serviceItems: [
      "Define the recurring task, expected outputs, and acceptance criteria",
      "Confirm source data, permissions, and any required connections",
      "Agree on deliverables, deployment, and handover"
    ],
    serviceNote: "Company integrations and deployment arrangements are assessed and priced for each project; they are not included automatically with self-service tasks.",
    faqEyebrow: "A FEW THINGS TO KNOW",
    faqTitle: "Before your first task.",
    faqs: [
      {
        question: "What do I need to run a task?",
        answer: "Sign in to your account and provide your own customer API key. You can start directly from a task template in Tasks; choosing a saved agent is optional. Add your material, review the task, and run it when the service is available."
      },
      {
        question: "What can an agent do today?",
        answer: "Read reference material, analyze CSV data, read approved HTTPS sources within defined limits, and prepare file outputs. Plans and progress are visible, and you can pause, steer, or cancel. Web access is limited reading; it does not provide general browser automation."
      },
      {
        question: "Can I download the results?",
        answer: "Yes. Tasks can produce downloadable TXT, MD, CSV, JSON, and DOCX files. These are output formats. Review the generated content before relying on it or sharing it."
      },
      {
        question: "Can you build an agent for our company?",
        answer: "Yes. Custom agent development is a separate service. We work with you to define the use case and agree on company data, connections, permissions, deployment, and delivery scope."
      }
    ],
    closingTitle: "What would you like to take off your desk?",
    closingLead: "Start with a CSV, a set of proposals, or meeting notes. Leave with files you can review and take forward.",
    heroBenefits: [
      "Editable files to download",
      "Visible plans and progress",
      "An agent you can reuse"
    ],
    previewCta: "See example deliverables",
    outcomesEyebrow: "START WITH THE RESULT",
    outcomesTitle: "Your material in. Useful files out.",
    outcomesLead: "Choose a task, supply your own material, and ask for the files you need. These three starting points are available in Tasks.",
    inputLabel: "You provide",
    outputLabel: "You take away",
    outcomeCta: "Start this task",
    outcomes: [
      {
        title: "From CSV to report.",
        audience: "Operations and analysis",
        input: "Your CSV, the metrics that matter, and the question to answer.",
        output: "A summary CSV and Word report with findings, limitations, and next steps.",
        benefit: "Keep the numbers and their explanation together for review."
      },
      {
        title: "Compare before you decide.",
        audience: "Purchasing and project owners",
        input: "Named proposal references with scope, quoted costs, and constraints.",
        output: "A Word decision brief comparing scope, costs, and unanswered questions.",
        benefit: "Review the trade-offs and missing facts in one place."
      },
      {
        title: "Clear notes. Clear next steps.",
        audience: "Project leads and teams",
        input: "Meeting notes with decisions, owners, and dates where known.",
        output: "A Markdown handover brief and action-item CSV with owners and deadlines.",
        benefit: "Make the next steps clear; missing owners or dates stay marked."
      }
    ],
    valueEyebrow: "WHY POWER CHAMPION",
    valueTitle: "One partner for the work ahead.",
    valueLead: "Start with a practical task. Keep a clear path to the models, agent development, and compute your next step may need.",
    values: [
      {
        title: "Models, agents, and GPU infrastructure",
        body: "Discuss model APIs, agent applications, and GPU capacity with one technical partner as your requirements develop."
      },
      {
        title: "A process you can intervene in",
        body: "Visible plans and progress keep you involved. Pause, add direction, or cancel instead of waiting until the end to respond."
      },
      {
        title: "Start yourself. Build further with us.",
        body: "Try a defined workflow with the available tools. Company data access and tailored processes can become a separately scoped development project."
      }
    ]
  },
  "zh-Hant": {
    eyebrow: "POWER CHAMPION 智能體",
    title: [
      "把資料交給 AI，",
      "帶走報告與行動清單。"
    ],
    lead: "把 CSV、提案與會議紀錄，整理成可編輯的報告與行動清單。過程能補充指示，成果由你審閱後使用。",
    taskCta: "從一個任務開始",
    buildCta: "建立你的智能體",
    galleryCta: "探索應用情境",
    contactCta: "洽詢智能體客製服務",
    requirement: "執行任務需登入帳號，並使用自己的客戶 API 金鑰。服務目前是否可用，請查看任務工作台。",
    pause: "暫停頁面動態",
    resume: "繼續頁面動態",
    heroVisual: {
      label: "交付成果示意範例",
      brief: "整理本週營運資料，準備下週行動",
      plan: "彙整、查核、列出下一步",
      material: "本週數據 + 參考紀錄",
      deliverable: "營運週報",
      review: "供你審閱與修改的草稿。",
      filename: "weekly-review.docx",
      sections: [
        {
          title: "本週摘要",
          body: "彙總提供的本週數據與重要變化。"
        },
        {
          title: "待查異常",
          body: "列出需要查核的資料差異與缺漏。"
        },
        {
          title: "下週行動",
          body: "列出下週行動，缺少資訊標示待補。"
        }
      ]
    },
    capabilitiesEyebrow: "把整理工作，變成可用成果",
    capabilitiesTitle: "讓 Agent 整理，由你掌握決策。",
    capabilitiesLead: "提供資料、說清楚想拿到什麼。Agent 協助梳理與產出，你能看進度、補充方向並檢查結果。",
    capabilities: [
      {
        title: "把分散資料，集中成重點",
        body: "依照你要回答的問題，閱讀選定的參考資料並整理相關內容。"
      },
      {
        title: "把表格，變成可討論的結論",
        body: "分析你提供的 CSV，將數據與主要發現一起整理，方便對照。"
      },
      {
        title: "有需要，再補上外部參考",
        body: "任務需要網頁資料時，經你核准後，在限定範圍內讀取 HTTPS 來源。"
      },
      {
        title: "看清楚工作做到哪裡",
        body: "查看計畫與進度，知道目前的步驟與工作如何推進。"
      },
      {
        title: "方向變了，當下調整",
        body: "需求或優先順序改變時，可以暫停、補充指示或取消任務。"
      },
      {
        title: "接回你慣用的工作方式",
        body: "下載可編輯的文件與資料檔，在自己的工具中檢查、修改、接著用。"
      }
    ],
    fileLabel: "可以接著編輯的交付檔案",
    fileNote: "下載 TXT、MD、CSV、JSON 或 DOCX 成果。確認內容、完成修改，再交付或分享。",
    workflowEyebrow: "從第一個任務開始",
    workflowTitle: "設定、執行、帶走檔案。",
    workflow: [
      {
        title: "選任務範本，或建立可重用 Agent",
        body: "直接從任務範本開始；經常重複的工作，也可以先建立自己的 Agent。"
      },
      {
        title: "補上資料，確認後執行",
        body: "加入來源資料，確認任務內容與服務可用狀態後執行。過程能查看進度並補充指示。"
      },
      {
        title: "審閱、下載、接著用",
        body: "檢查結果，調整需要留意的內容，下載工作所需的檔案。"
      }
    ],
    serviceEyebrow: "智能體客製開發",
    serviceTitle: "把重複工作，做成企業自己的 Agent。",
    serviceLead: "從定期彙報、提案審閱或跨團隊交接開始，打造符合團隊流程的智能體。客製開發是另一項服務，實作前先確認工作流程、資料存取與交付成果。",
    serviceItems: [
      "定義重複任務、預期成果與驗收條件",
      "確認資料來源、權限與必要串接範圍",
      "約定交付項目、部署方式與交接內容"
    ],
    serviceNote: "企業系統串接與部署條件需依專案評估、另行報價，不會隨自助任務自動提供。",
    faqEyebrow: "開始前，先了解",
    faqTitle: "關於你的第一個任務。",
    faqs: [
      {
        question: "執行任務需要準備什麼？",
        answer: "需登入帳號，並提供自己的客戶 API 金鑰。可直接在任務工作台從範本開始，選用已儲存的 Agent 是選填。補上資料、確認任務內容，並在服務可用時執行即可。"
      },
      {
        question: "目前智能體可以做哪些工作？",
        answer: "可閱讀參考資料、分析 CSV、在限定範圍內讀取核准的 HTTPS 來源，並產出檔案。計畫與進度可見，也能暫停、補充指示或取消。網頁存取僅限讀取內容，不提供通用瀏覽器自動操作。"
      },
      {
        question: "完成的結果可以下載嗎？",
        answer: "可以。任務可產出 TXT、MD、CSV、JSON 與 DOCX 檔案供下載；這些是輸出格式。採用或分享產出內容前，請先審閱確認。"
      },
      {
        question: "可以為公司客製智能體嗎？",
        answer: "可以。客製開發為另行規劃的服務。我們會一起釐清應用需求，確認公司資料、系統串接、權限、部署方式與交付範圍。"
      }
    ],
    closingTitle: "下一份報告，從你手上的資料開始。",
    closingLead: "帶入 CSV、提案或會議紀錄，取得能審閱、修改並接著使用的檔案。",
    heroBenefits: [
      "可編輯的交付檔案",
      "看得見、能介入的過程",
      "設定一次，重複使用"
    ],
    previewCta: "看交付成果範例",
    outcomesEyebrow: "先看你能帶走什麼",
    outcomesTitle: "交入資料，帶走可用的檔案。",
    outcomesLead: "選一個工作情境，加入自己的資料，指定要交付的成果。這三種起點，都能在任務工作台直接開始。",
    inputLabel: "你提供",
    outputLabel: "你帶走",
    outcomeCta: "用這個情境開始",
    outcomes: [
      {
        title: "數據，變成分析報告。",
        audience: "營運與資料分析",
        input: "一份 CSV、關心的欄位或指標，以及這次要回答的問題。",
        output: "摘要 CSV，以及包含發現、限制與下一步的 Word 分析報告。",
        benefit: "數字與解讀放在一起，方便檢查，也方便拿來討論。"
      },
      {
        title: "提案，變成決策摘要。",
        audience: "採購與專案負責人",
        input: "具名的提案參考資料，包含工作範圍、報價與限制。",
        output: "比較成本、範圍與待釐清問題的 Word 決策摘要。",
        benefit: "一次看見方案取捨與缺少的資訊，再決定下一步。"
      },
      {
        title: "紀錄，變成行動清單。",
        audience: "專案管理與團隊交接",
        input: "會議紀錄，以及其中已確認的決議、負責人與日期。",
        output: "Markdown 交接摘要，以及含負責人、期限的 CSV 待辦清單。",
        benefit: "把已定事項和下一步分開；缺少的負責人與日期保留待補。"
      }
    ],
    valueEyebrow: "為什麼選擇 POWER CHAMPION",
    valueTitle: "從第一個任務，到下一階段需求。",
    valueLead: "先把一件具體工作做起來。後續需要模型、智能體開發或 GPU 算力，也有同一個團隊可以討論。",
    values: [
      {
        title: "模型、Agent、GPU，同一個技術夥伴",
        body: "從模型 API、智能體應用到 GPU 算力，可向同一團隊討論需求與後續擴充。"
      },
      {
        title: "工作過程，你可以介入",
        body: "計畫與進度看得見；有新資訊時能暫停、補充方向或取消，不必等到最後才回應。"
      },
      {
        title: "先自己開始，再走向企業客製",
        body: "先用現有工具驗證一項工作；需要公司資料權限與專屬流程時，再另案規劃開發。"
      }
    ]
  },
  "zh-Hans": {
    eyebrow: "POWER CHAMPION 智能体",
    title: [
      "把资料交给 AI，",
      "带走报告与行动清单。"
    ],
    lead: "把 CSV、提案与会议记录，整理成可编辑的报告与行动清单。过程中能补充指示，成果由你审阅后使用。",
    taskCta: "从一个任务开始",
    buildCta: "创建你的智能体",
    galleryCta: "探索应用场景",
    contactCta: "咨询智能体定制服务",
    requirement: "执行任务需登录账号，并使用自己的客户 API 密钥。服务当前是否可用，请查看任务工作台。",
    pause: "暂停页面动态",
    resume: "继续页面动态",
    heroVisual: {
      label: "交付成果示意",
      brief: "整理本周运营资料，准备下周行动",
      plan: "汇总、核查、列出下一步",
      material: "本周数据 + 参考记录",
      deliverable: "运营周报",
      review: "供你审阅与修改的草稿。",
      filename: "weekly-review.docx",
      sections: [
        {
          title: "本周摘要",
          body: "汇总提供的本周数据与重要变化。"
        },
        {
          title: "待查异常",
          body: "列出需要核查的数据差异与缺失。"
        },
        {
          title: "下周行动",
          body: "列出下周行动，缺少信息标为待补。"
        }
      ]
    },
    capabilitiesEyebrow: "把整理工作，变成可用成果",
    capabilitiesTitle: "让 Agent 整理，由你掌握决策。",
    capabilitiesLead: "提供资料、说清楚想拿到什么。Agent 帮助梳理并生成成果，你能看进度、补充方向并检查结果。",
    capabilities: [
      {
        title: "把分散资料，集中成重点",
        body: "按照你要回答的问题，阅读选定的参考资料并整理相关内容。"
      },
      {
        title: "把表格，变成可讨论的结论",
        body: "分析你提供的 CSV，将数据与主要发现一起整理，方便对照。"
      },
      {
        title: "有需要，再补上外部参考",
        body: "任务需要网页资料时，经你批准后，在限定范围内读取 HTTPS 来源。"
      },
      {
        title: "看清楚工作做到哪里",
        body: "查看计划与进度，知道当前步骤与工作如何推进。"
      },
      {
        title: "方向变了，当下调整",
        body: "需求或优先级改变时，可以暂停、补充指示或取消任务。"
      },
      {
        title: "接回你惯用的工作方式",
        body: "下载可编辑的文档与数据文件，在自己的工具中检查、修改、继续用。"
      }
    ],
    fileLabel: "可以继续编辑的交付文件",
    fileNote: "下载 TXT、MD、CSV、JSON 或 DOCX 成果。确认内容、完成修改，再交付或分享。",
    workflowEyebrow: "从第一个任务开始",
    workflowTitle: "设置、执行、带走文件。",
    workflow: [
      {
        title: "选任务模板，或创建可复用 Agent",
        body: "直接从任务模板开始；经常重复的工作，也可以先创建自己的 Agent。"
      },
      {
        title: "补上资料，确认后执行",
        body: "加入来源资料，确认任务内容与服务可用状态后执行。过程中能查看进度并补充指示。"
      },
      {
        title: "审阅、下载、接着用",
        body: "检查结果，调整需要留意的内容，下载工作所需的文件。"
      }
    ],
    serviceEyebrow: "智能体定制开发",
    serviceTitle: "把重复工作，做成企业自己的 Agent。",
    serviceLead: "从定期汇报、提案审阅或跨团队交接开始，打造符合团队流程的智能体。定制开发是另一项服务，实施前先确认工作流程、数据访问与交付成果。",
    serviceItems: [
      "定义重复任务、预期成果与验收条件",
      "确认数据来源、权限与必要的连接范围",
      "约定交付项目、部署方式与交接内容"
    ],
    serviceNote: "企业系统连接与部署条件需按项目评估、单独报价，不会随自助任务自动提供。",
    faqEyebrow: "开始前，先了解",
    faqTitle: "关于你的第一个任务。",
    faqs: [
      {
        question: "执行任务需要准备什么？",
        answer: "需登录账号，并提供自己的客户 API 密钥。可直接在任务工作台从模板开始，选择已保存的 Agent 是可选项。补上资料、确认任务内容，并在服务可用时执行即可。"
      },
      {
        question: "目前智能体可以做哪些工作？",
        answer: "可阅读参考资料、分析 CSV、在限定范围内读取获准的 HTTPS 来源，并生成文件。计划与进度可见，也能暂停、补充指示或取消。网页访问仅限读取内容，不提供通用浏览器自动操作。"
      },
      {
        question: "完成的结果可以下载吗？",
        answer: "可以。任务可生成 TXT、MD、CSV、JSON 与 DOCX 文件供下载；这些是输出格式。采用或分享生成的内容前，请先审阅确认。"
      },
      {
        question: "可以为公司定制智能体吗？",
        answer: "可以。定制开发是单独规划的服务。我们会一起明确应用需求，确认公司数据、系统连接、权限、部署方式与交付范围。"
      }
    ],
    closingTitle: "下一份报告，从你手上的资料开始。",
    closingLead: "带入 CSV、提案或会议记录，取得能审阅、修改并继续使用的文件。",
    heroBenefits: [
      "可编辑的交付文件",
      "看得见、能介入的过程",
      "设置一次，重复使用"
    ],
    previewCta: "看交付成果示例",
    outcomesEyebrow: "先看你能带走什么",
    outcomesTitle: "交入资料，带走可用的文件。",
    outcomesLead: "选一个工作场景，加入自己的资料，指定要交付的成果。这三种起点，都能在任务工作台直接开始。",
    inputLabel: "你提供",
    outputLabel: "你带走",
    outcomeCta: "从这个场景开始",
    outcomes: [
      {
        title: "数据，变成分析报告。",
        audience: "运营与数据分析",
        input: "一份 CSV、关注的字段或指标，以及这次要回答的问题。",
        output: "摘要 CSV，以及包含发现、限制与下一步的 Word 分析报告。",
        benefit: "数字与解读放在一起，方便检查，也方便拿来讨论。"
      },
      {
        title: "提案，变成决策摘要。",
        audience: "采购与项目负责人",
        input: "具名的提案参考资料，包含工作范围、报价与限制。",
        output: "比较成本、范围与待确认问题的 Word 决策摘要。",
        benefit: "一起看清方案取舍与缺少的信息，再决定下一步。"
      },
      {
        title: "记录，变成行动清单。",
        audience: "项目管理与团队交接",
        input: "会议记录，以及其中已确认的决定、负责人和日期。",
        output: "Markdown 交接摘要，以及含负责人、期限的 CSV 待办清单。",
        benefit: "把已定事项和下一步分开；缺少的负责人和日期保留待补。"
      }
    ],
    valueEyebrow: "为什么选择 POWER CHAMPION",
    valueTitle: "从第一个任务，到下一阶段需求。",
    valueLead: "先把一件具体工作做起来。后续需要模型、智能体开发或 GPU 算力，也有同一个团队可以讨论。",
    values: [
      {
        title: "模型、Agent、GPU，同一个技术伙伴",
        body: "从模型 API、智能体应用到 GPU 算力，可以向同一团队讨论需求与后续扩展。"
      },
      {
        title: "工作过程，你可以介入",
        body: "计划与进度看得见；有新信息时能暂停、补充方向或取消，不必等到最后才回应。"
      },
      {
        title: "先自己开始，再走向企业定制",
        body: "先用现有工具验证一项工作；需要公司数据权限与专属流程时，再单独规划开发。"
      }
    ]
  },
  ja: {
    eyebrow: "POWER CHAMPION AGENTS",
    title: [
      "資料を AI に渡して、",
      "レポートと行動リストを手元に。"
    ],
    lead: "CSV、提案書、会議メモを、編集できるレポートと行動リストに。途中で指示を加え、内容を確認してから使えます。",
    taskCta: "タスクから始める",
    buildCta: "エージェントを作成",
    galleryCta: "活用シーンを見る",
    contactCta: "カスタム開発を相談",
    requirement: "タスクの実行には、アカウントへのログインとご自身の顧客用 API キーが必要です。現在の提供状況はタスク画面で確認できます。",
    pause: "ページの動きを停止",
    resume: "ページの動きを再開",
    heroVisual: {
      label: "成果物の構成例",
      brief: "今週の業務を振り返り、来週の行動を整理",
      plan: "まとめる。確かめる。計画する。",
      material: "今週のデータ ＋ 参考メモ",
      deliverable: "業務週報",
      review: "確認・編集用の下書き。",
      filename: "weekly-review.docx",
      sections: [
        {
          title: "今週の要約",
          body: "提供された数値と主な変化をまとめる。"
        },
        {
          title: "確認が必要な点",
          body: "検証が必要な差異やデータの欠落を挙げる。"
        },
        {
          title: "来週の行動",
          body: "次の行動と、未定の担当者・期限を記載。"
        }
      ]
    },
    capabilitiesEyebrow: "整理する時間を、次の検討へ",
    capabilitiesTitle: "準備はエージェントに。判断はあなたに。",
    capabilitiesLead: "資料と欲しい成果物を伝えれば、エージェントが整理を支援。過程を確認し、方向を調整しながら進められます。",
    capabilities: [
      {
        title: "散らばった資料を要点にまとめる",
        body: "選んだ参考資料を読み、答えたい問いに関係する情報を整理します。"
      },
      {
        title: "表を、話し合える分析結果へ",
        body: "提供された CSV を分析し、数値と主な発見を並べて確認できる形にします。"
      },
      {
        title: "必要なときに外部資料を加える",
        body: "タスクに外部資料が必要な場合、承認後に HTTPS の情報源を限定的に読み取ります。"
      },
      {
        title: "作業がどこまで進んだか分かる",
        body: "計画と進捗を見ながら、結果に至る手順を確認できます。"
      },
      {
        title: "途中で変わった要件にも指示を",
        body: "要件や優先順位が変わったら、一時停止、指示の追加、キャンセルができます。"
      },
      {
        title: "いつものツールで続きを進める",
        body: "編集できる文書やデータをダウンロードし、ご自身のツールで確認・修正できます。"
      }
    ],
    fileLabel: "引き続き編集できる成果物",
    fileNote: "TXT、MD、CSV、JSON、DOCX をダウンロード。内容を確認・修正し、準備ができてから共有できます。",
    workflowEyebrow: "最初のタスクへ",
    workflowTitle: "設定して、実行して、ファイルを確認。",
    workflow: [
      {
        title: "タスクを選ぶ、またはエージェントを作る",
        body: "タスクのテンプレートから直接開始。繰り返す仕事には、再利用できるエージェントも作れます。"
      },
      {
        title: "資料を追加し、確認して実行",
        body: "資料を追加し、タスクの内容と提供状況を確認して実行します。進捗を見ながら指示を加えられます。"
      },
      {
        title: "確認して、次へつなげる",
        body: "結果を確かめ、必要な内容を整えて、使いたいファイルをダウンロードします。"
      }
    ],
    serviceEyebrow: "エージェントのカスタム開発",
    serviceTitle: "繰り返す仕事を、自社のエージェントに。",
    serviceLead: "定期レポート、提案の検討、部署間の引き継ぎなど、チームの手順に合わせたエージェントを開発します。カスタム開発は別サービスとして、実装前に業務手順、データへのアクセス、成果物を合意します。",
    serviceItems: [
      "繰り返す仕事、期待する成果物、受入条件を定義",
      "データ源、権限、必要な接続の範囲を確認",
      "納品物、導入方法、引き継ぎ内容を合意"
    ],
    serviceNote: "社内システムへの接続や導入条件は、案件ごとに評価・見積もりを行います。セルフサービスのタスクに自動で含まれるものではありません。",
    faqEyebrow: "はじめに知っておきたいこと",
    faqTitle: "最初のタスクの前に。",
    faqs: [
      {
        question: "タスクの実行には何が必要ですか？",
        answer: "アカウントにログインし、ご自身の顧客用 API キーを用意してください。タスク画面のテンプレートから直接開始でき、保存済みエージェントの選択は任意です。資料を追加し、内容と提供状況を確認して実行してください。"
      },
      {
        question: "現在、どのような仕事ができますか？",
        answer: "参考資料の読み取り、CSV の分析、許可された HTTPS 情報源の限定的な読み取り、ファイルの作成に対応しています。計画と進捗を確認でき、一時停止、指示の追加、キャンセルも可能です。ウェブへのアクセスは読み取りに限られ、汎用的なブラウザー操作の自動化には対応していません。"
      },
      {
        question: "成果物はダウンロードできますか？",
        answer: "はい。TXT、MD、CSV、JSON、DOCX のファイルを作成し、ダウンロードできます。これらは出力形式です。内容を利用、共有する前にご確認ください。"
      },
      {
        question: "自社向けのエージェントを開発できますか？",
        answer: "はい。カスタム開発は別途ご相談いただくサービスです。用途を整理し、社内データ、接続先、権限、導入方法、納品範囲を個別に合意します。"
      }
    ],
    closingTitle: "次のレポートは、手元の資料から。",
    closingLead: "CSV、提案書、会議メモから、確認・編集して次の仕事に使えるファイルへ。",
    heroBenefits: [
      "編集できるファイル",
      "計画と進捗が見える",
      "繰り返し使えるエージェント"
    ],
    previewCta: "成果物の例を見る",
    outcomesEyebrow: "受け取れる成果物から選ぶ",
    outcomesTitle: "手元の資料を、使えるファイルへ。",
    outcomesLead: "仕事を選び、ご自身の資料と欲しい成果物を伝えてください。この 3 つのタスクは、タスク画面から始められます。",
    inputLabel: "用意するもの",
    outputLabel: "受け取るもの",
    outcomeCta: "このタスクを始める",
    outcomes: [
      {
        title: "データから分析レポートへ。",
        audience: "集計・報告を担当する方",
        input: "分析する CSV、注目する指標、答えを知りたい問い。",
        output: "集計 CSV と、分析結果・限界・次の手順をまとめた Word レポート。",
        benefit: "集計結果とその解釈を、合わせて確認・検討できます。"
      },
      {
        title: "提案から判断用の要約へ。",
        audience: "購買・プロジェクトの責任者",
        input: "対象範囲、見積金額、制約を含む、出典名付きの提案資料。",
        output: "費用・対象範囲・未確認事項を比較する Word の判断用サマリー。",
        benefit: "選択肢の違いと、追加で確認する点を一か所で把握できます。"
      },
      {
        title: "メモから行動リストへ。",
        audience: "会議後の共有・引き継ぎを担う方",
        input: "決定事項や、判明している担当者・日付を含む会議メモ。",
        output: "Markdown の引き継ぎ要約と、担当者・期限を含むアクション一覧 CSV。",
        benefit: "決定事項と次の行動を分け、不明な担当者や日付は未確認として残します。"
      }
    ],
    valueEyebrow: "POWER CHAMPION を選ぶ理由",
    valueTitle: "最初のタスクから、その先の要件まで。",
    valueLead: "まずは具体的な仕事から。次に必要になるモデル、エージェント開発、GPU 基盤も、同じチームに相談できます。",
    values: [
      {
        title: "モデル・エージェント・GPU を一つの窓口で",
        body: "モデル API、エージェントの活用、GPU の計算資源まで、要件の変化に合わせて同じ技術パートナーと検討できます。"
      },
      {
        title: "途中で関われる作業プロセス",
        body: "計画と進捗を確認し、新しい情報があれば一時停止、追加指示、キャンセル。最後まで待たずに方向を伝えられます。"
      },
      {
        title: "自分で始めて、個別開発へ広げる",
        body: "既存のツールで一つの仕事を試し、社内データへのアクセスや独自の手順が必要になれば、別途開発を相談できます。"
      }
    ]
  },
  ko: {
    eyebrow: "POWER CHAMPION AGENTS",
    title: [
      "자료를 AI에 맡기고,",
      "보고서와 할 일 목록을 받으세요."
    ],
    lead: "CSV, 제안서, 회의 메모를 편집 가능한 보고서와 할 일 목록으로 정리하세요. 진행 중 지시를 더하고, 결과를 검토한 뒤 활용할 수 있습니다.",
    taskCta: "작업부터 시작하기",
    buildCta: "에이전트 만들기",
    galleryCta: "활용 사례 살펴보기",
    contactCta: "맞춤 에이전트 상담",
    requirement: "작업을 실행하려면 계정에 로그인하고 본인의 고객용 API 키를 사용해야 합니다. 현재 서비스 이용 가능 여부는 작업 화면에서 확인하세요.",
    pause: "페이지 움직임 일시 정지",
    resume: "페이지 움직임 다시 시작",
    heroVisual: {
      label: "결과물 구성 예시",
      brief: "이번 주 운영 자료와 다음 주 할 일 정리",
      plan: "요약하고, 확인하고, 계획하기",
      material: "주간 데이터 + 참고 메모",
      deliverable: "주간 운영 보고서",
      review: "검토하고 수정할 초안.",
      filename: "weekly-review.docx",
      sections: [
        {
          title: "이번 주 요약",
          body: "제공된 데이터와 주요 변화를 정리합니다."
        },
        {
          title: "확인이 필요한 사항",
          body: "검증할 데이터 차이와 누락을 표시합니다."
        },
        {
          title: "다음 주 할 일",
          body: "다음 행동과 미정인 담당자·기한을 표시합니다."
        }
      ]
    },
    capabilitiesEyebrow: "자료 정리에서 활용할 결과로",
    capabilitiesTitle: "준비는 에이전트와. 판단은 직접.",
    capabilitiesLead: "자료와 원하는 결과를 알려주세요. 에이전트의 정리 과정을 확인하고 방향을 안내하며 결과를 검토할 수 있습니다.",
    capabilities: [
      {
        title: "흩어진 자료를 핵심으로 모으기",
        body: "선택한 참고 자료를 읽고 답을 찾고 싶은 질문에 필요한 내용을 정리합니다."
      },
      {
        title: "표를 논의할 수 있는 분석으로",
        body: "제공한 CSV를 분석하고 수치와 주요 발견을 함께 검토할 수 있도록 준비합니다."
      },
      {
        title: "필요할 때 외부 참고 자료 추가",
        body: "작업에 웹 자료가 필요하면 승인 후 정해진 범위에서 HTTPS 자료를 읽습니다."
      },
      {
        title: "업무가 어디까지 왔는지 확인",
        body: "계획과 진행 상황을 보며 결과에 이르는 단계를 따라갈 수 있습니다."
      },
      {
        title: "방향이 바뀌면 바로 조정",
        body: "요구사항이나 우선순위가 바뀌면 일시 정지, 지시 추가, 취소가 가능합니다."
      },
      {
        title: "익숙한 도구에서 계속 작업",
        body: "편집 가능한 문서와 데이터 파일을 내려받아 자신의 도구에서 검토하고 수정하세요."
      }
    ],
    fileLabel: "계속 편집할 수 있는 결과물",
    fileNote: "TXT, MD, CSV, JSON, DOCX를 다운로드하세요. 내용을 검토하고 수정한 뒤 준비되면 공유할 수 있습니다.",
    workflowEyebrow: "첫 작업 시작하기",
    workflowTitle: "설정하고, 실행하고, 파일을 검토하세요.",
    workflow: [
      {
        title: "작업 템플릿 선택 또는 에이전트 만들기",
        body: "작업 템플릿에서 바로 시작하세요. 반복하는 업무에는 다시 쓸 수 있는 에이전트도 만들 수 있습니다."
      },
      {
        title: "자료를 추가하고 확인 후 실행",
        body: "자료를 추가하고 작업 내용과 서비스 이용 가능 여부를 확인한 뒤 실행하세요. 진행 상황을 보며 지시를 더할 수 있습니다."
      },
      {
        title: "검토하고 다음 단계로",
        body: "결과를 확인하고 필요한 부분을 다듬은 뒤, 사용할 파일을 다운로드하세요."
      }
    ],
    serviceEyebrow: "맞춤 에이전트 개발",
    serviceTitle: "반복 업무를 우리 회사의 에이전트로.",
    serviceLead: "정기 보고, 제안 검토, 팀 간 인수인계를 팀의 절차에 맞는 에이전트로 만드세요. 맞춤 개발은 별도 서비스이며, 구현 전에 업무 흐름, 데이터 접근, 결과물을 협의합니다.",
    serviceItems: [
      "반복 업무, 기대 결과물, 검수 기준 정의",
      "자료 출처, 권한, 필요한 연결 범위 확인",
      "제공 결과물, 배포 방식, 인수인계 내용 합의"
    ],
    serviceNote: "사내 시스템 연결과 배포 조건은 프로젝트마다 검토하고 별도로 견적을 산정합니다. 셀프서비스 작업에 자동으로 포함되지 않습니다.",
    faqEyebrow: "시작하기 전에",
    faqTitle: "첫 작업을 위한 안내.",
    faqs: [
      {
        question: "작업을 실행하려면 무엇이 필요한가요?",
        answer: "계정에 로그인하고 본인의 고객용 API 키를 제공하세요. 작업 화면의 템플릿에서 바로 시작할 수 있으며, 저장한 에이전트 선택은 선택 사항입니다. 자료를 추가하고 작업 내용을 검토한 뒤 서비스 이용이 가능하면 실행하세요."
      },
      {
        question: "현재 어떤 업무를 할 수 있나요?",
        answer: "참고 자료 읽기, CSV 분석, 승인된 HTTPS 자료의 제한적인 읽기, 파일 생성이 가능합니다. 계획과 진행 상황을 확인하고 일시 정지, 지시 추가, 취소를 할 수 있습니다. 웹 접근은 자료 읽기로 한정되며, 범용 브라우저 자동화는 제공하지 않습니다."
      },
      {
        question: "결과를 다운로드할 수 있나요?",
        answer: "네. 작업에서 TXT, MD, CSV, JSON, DOCX 파일을 생성하고 다운로드할 수 있습니다. 이 목록은 출력 형식입니다. 결과를 사용하거나 공유하기 전에 내용을 검토하세요."
      },
      {
        question: "회사에 맞는 에이전트도 개발할 수 있나요?",
        answer: "네. 맞춤 개발은 별도로 협의하는 서비스입니다. 활용 목적을 정하고 회사 데이터, 시스템 연결, 권한, 배포 방식, 제공 범위를 함께 합의합니다."
      }
    ],
    closingTitle: "다음 보고서는 내 자료에서 시작하세요.",
    closingLead: "CSV, 제안서, 회의 메모를 검토하고 수정해 다음 업무에 쓸 수 있는 파일로 정리하세요.",
    heroBenefits: [
      "편집 가능한 파일",
      "계획과 진행 상황 확인",
      "다시 쓰는 내 에이전트"
    ],
    previewCta: "결과물 예시 보기",
    outcomesEyebrow: "받고 싶은 결과부터",
    outcomesTitle: "내 자료를, 쓸 수 있는 파일로.",
    outcomesLead: "업무를 선택하고 직접 자료를 제공한 뒤 필요한 결과물을 요청하세요. 이 세 가지 작업은 작업 화면에서 시작할 수 있습니다.",
    inputLabel: "제공할 자료",
    outputLabel: "받을 결과물",
    outcomeCta: "이 작업 시작하기",
    outcomes: [
      {
        title: "데이터를 분석 보고서로.",
        audience: "운영 및 데이터 분석 담당자",
        input: "분석할 CSV, 관심 있는 지표, 답을 찾고 싶은 질문.",
        output: "요약 CSV와 분석 결과·한계·다음 단계를 담은 Word 보고서.",
        benefit: "집계 결과와 해석을 함께 검토하고 논의할 수 있습니다."
      },
      {
        title: "제안을 의사결정 요약으로.",
        audience: "구매 및 프로젝트 책임자",
        input: "범위, 견적 비용, 제약 사항을 담은 출처 이름이 있는 제안 자료.",
        output: "비용·범위·확인할 질문을 비교한 Word 의사결정 요약서.",
        benefit: "선택지의 차이와 추가로 확인할 정보를 한곳에서 살펴보세요."
      },
      {
        title: "메모를 할 일 목록으로.",
        audience: "프로젝트 관리 및 팀 인수인계 담당자",
        input: "결정 사항과 확인된 담당자·날짜가 담긴 회의 메모.",
        output: "Markdown 인수인계 요약과 담당자·기한을 포함한 CSV 할 일 목록.",
        benefit: "결정과 다음 할 일을 구분하고, 없는 담당자나 날짜는 미정으로 남깁니다."
      }
    ],
    valueEyebrow: "POWER CHAMPION을 선택하는 이유",
    valueTitle: "첫 작업부터 다음 단계의 요구까지.",
    valueLead: "구체적인 업무부터 시작하세요. 이후 필요한 모델, 에이전트 개발, GPU 인프라도 같은 팀과 논의할 수 있습니다.",
    values: [
      {
        title: "모델·에이전트·GPU를 한 기술 파트너와",
        body: "모델 API, 에이전트 활용, GPU 자원까지 요구사항이 발전하는 과정에서 같은 팀과 검토할 수 있습니다."
      },
      {
        title: "직접 개입할 수 있는 작업 과정",
        body: "계획과 진행 상황을 확인하고, 새 정보가 생기면 일시 정지하거나 지시를 더하고 취소할 수 있습니다."
      },
      {
        title: "직접 시작하고 맞춤 개발로 확장",
        body: "기존 도구로 한 가지 업무를 검토한 뒤, 회사 데이터 권한이나 고유한 절차가 필요하면 별도 개발을 논의할 수 있습니다."
      }
    ]
  }
};
