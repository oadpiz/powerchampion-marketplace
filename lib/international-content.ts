import type { InternationalLanguage, InternationalSection } from "./languages";

type Story = { title: string; body: string };
type InternationalContent = {
  nav: Record<InternationalSection, string>;
  navigation: string;
  languages: string;
  skip: string;
  pages: Record<
    InternationalSection,
    { eyebrow: string; title: string; description: string }
  >;
  actions: {
    models: string;
    platform: string;
    contact: string;
    integrations: string;
    status: string;
    details: string;
    pricing: string;
  };
  platformNote: string;
  footerNote: string;
  legalNote: string;
  footer: {
    company: string;
    resources: string;
    contact: string;
    docs: string;
    privacy: string;
    terms: string;
    trust: string;
  };
  modelDescriptions: Record<string, string>;
  catalog: {
    title: string;
    lead: string;
    note: string;
    model: string;
    capability: string;
    pricing: string;
    context: string;
    input: string;
    output: string;
    million: string;
    image: string;
    minute: string;
    detailNote: string;
  };
  workflows: { title: string; lead: string; items: Story[] };
  services: { title: string; items: Story[] };
  onboarding: { title: string; lead: string; steps: Story[] };
  pricing: {
    title: string;
    lead: string;
    packs: string[];
    credit: string;
    bonus: string;
    purchase: string;
    note: string;
    exampleTitle: string;
    exampleBody: string;
    exampleUnit: string;
  };
  infrastructure: {
    title: string;
    lead: string;
    options: Story[];
    note: string;
    requirementsTitle: string;
    requirements: string[];
    processTitle: string;
    process: Story[];
  };
  company: {
    title: string;
    body: string;
    approach: Story[];
    address: string;
    evidenceTitle: string;
    evidence: string;
    evidenceLink: string;
  };
  agents: {
    eyebrow: string;
    title: string;
    lead: string;
    steps: string[];
    explore: string;
    build: string;
    note: string;
  };
  closing: { title: string; body: string };
};

export const INTERNATIONAL_CONTENT: Record<
  InternationalLanguage,
  InternationalContent
> = {
  "zh-Hant": {
    nav: {
      "agent-platform": "智能體",
      "": "首頁",
      models: "模型目錄",
      pricing: "價格",
      infrastructure: "GPU 算力",
      company: "關於我們",
    },
    navigation: "主要導覽",
    languages: "網站語言",
    skip: "跳至主要內容",
    pages: {
      "agent-platform": { eyebrow: "POWER CHAMPION / AGENTS", title: "AI 智能體：從需求到可交付成果", description: "讓智能體分析資料、執行任務並交付實用檔案。追蹤進度、核准網頁讀取，也能為企業規劃專屬 Agent。" },
      "": {
        eyebrow: "模型 API · 專屬 GPU",
        title: "讓好模型，成為好產品。",
        description:
          "透過 Power Champion 串接文字、視覺、圖像、語音與檢索模型。從第一個 API 請求，到企業專屬 GPU 部署，以符合工作負載的方式開始。",
      },
      models: {
        eyebrow: "模型目錄",
        title: "為每個任務，找到合適模型。",
        description:
          "比較推理、程式開發、文件理解、圖像生成、語音與搜尋模型。先了解能力與計費單位，再選擇適合應用的 API。",
      },
      pricing: {
        eyebrow: "清楚的用量計費",
        title: "掌握每一次呼叫的成本。",
        description:
          "模型 API 以預付餘額按用量計費。文字、圖像與語音採用不同計費單位，讓你在串接前就能評估預算。",
      },
      infrastructure: {
        eyebrow: "專屬 GPU 與企業部署",
        title: "為你的工作負載，規劃算力。",
        description:
          "從模型尺寸、記憶體與併發需求出發，討論 NVIDIA HGX 平台、單租戶裸機與客戶指定資料中心部署。",
      },
      company: {
        eyebrow: "關於 POWER CHAMPION",
        title: "模型服務與算力，連成一條路。",
        description:
          "Power Champion 結合模型 API 與企業 GPU 部署規劃，協助開發者、產品團隊與企業把 AI 需求落實為可運作的應用。",
      },
    },
    actions: {
      models: "探索模型",
      platform: "開啟模型平台",
      contact: "洽談需求",
      integrations: "設定 API 串接",
      status: "查看服務狀態",
      details: "模型詳情",
      pricing: "查看價格",
    },
    platformNote: "模型平台、串接工具與模型詳情提供英文及繁體中文。",
    footerNote: "從模型探索到算力部署，讓下一個 AI 產品有清楚的起點。",
    legalNote: "技術文件、服務狀態與政策頁提供英文及繁體中文。",
    footer: {
      company: "公司與服務",
      resources: "資源",
      contact: "聯絡我們",
      docs: "技術文件",
      privacy: "隱私政策",
      terms: "使用條款",
      trust: "信任與服務說明",
    },
    modelDescriptions: {
      "glm-5.2-fp8": "對話、推理與程式開發，適合文字助理及開發工作流程。",
      "qwen3-vl-30b": "圖片、圖表與文件理解，可用於 OCR 與視覺問答。",
      "flux-schnell": "快速文生圖，適合創意探索與行銷素材初稿。",
      "chroma1-hd": "高解析度圖像生成，適合需要豐富細節的視覺內容。",
      "whisper-large-v3": "將音訊轉為文字，用於逐字稿、字幕與可搜尋紀錄。",
      indextts2: "搭配有權使用的參考音檔，產生文字轉語音內容。",
      "bge-m3": "建立多語言嵌入向量，支援語意搜尋與檢索增強生成。",
      "bge-reranker-v2-m3": "依查詢重新排序文件，改善檢索結果的相關性。",
    },
    catalog: {
      title: "一個目錄，多種模型能力。",
      lead: "依照輸入、預期輸出與成本選擇模型。目錄與即時服務狀態分開呈現。",
      note: "以下為刊登規格與價格；可用性請以服務狀態及實際 API 回應為準。",
      model: "模型",
      capability: "用途",
      pricing: "刊登單價（美元）",
      context: "上下文",
      input: "輸入",
      output: "輸出",
      million: "每百萬詞元",
      image: "每張圖像",
      minute: "每分鐘音訊",
      detailNote: "完整模型規格與程式碼範例提供英文及繁體中文。",
    },
    workflows: {
      title: "從你要完成的事開始。",
      lead: "讓模型成為產品流程的一部分，選擇真正需要的能力。",
      items: [
        {
          title: "文字助理與程式開發",
          body: "以 GLM 5.2 FP8 建立對話流程、整理資訊或輔助撰寫程式，依任務評估上下文與輸出長度。",
        },
        {
          title: "文件與視覺理解",
          body: "以 Qwen3-VL 30B 理解掃描文件、圖片與圖表，將視覺資訊帶入內部工具。",
        },
        {
          title: "圖像與語音內容",
          body: "結合 Flux、Chroma、Whisper 與 IndexTTS2，規劃素材生成、音訊轉錄與語音輸出的不同階段。",
        },
        {
          title: "企業知識搜尋",
          body: "以 BGE-M3 建立向量、搭配 BGE Reranker 重排，為知識庫與 RAG 流程準備相關資料。",
        },
      ],
    },
    services: {
      title: "依產品階段，選擇服務方式。",
      items: [
        {
          title: "模型 API",
          body: "使用已刊登模型及 API 範例，從預付用量開始驗證應用，不必先規劃自己的 GPU 叢集。",
        },
        {
          title: "專屬 GPU",
          body: "為自有模型、持續推論或訓練工作，討論獨立算力、節點配置與運作責任。",
        },
        {
          title: "客製部署",
          body: "依據指定機房、資料處理與網路需求，確認配置、交付範圍與驗收方式。",
        },
      ],
    },
    onboarding: {
      title: "從需求，到第一個 API 請求。",
      lead: "存取權限與儲值依目前服務流程確認，技術工具協助你完成串接。",
      steps: [
        {
          title: "確認模型與存取需求",
          body: "瀏覽模型目錄，向團隊確認 API 金鑰的申請方式及適用服務。",
        },
        {
          title: "安排預付餘額",
          body: "確認儲值方案與付款方式；取得兌換碼後，依指引加入 API 餘額。",
        },
        {
          title: "產生串接範例",
          body: "選擇模型與開發語言，使用串接工具產生請求設定，再於自己的應用中加入金鑰。",
        },
        {
          title: "驗證並持續觀察",
          body: "以測試台查看實際回應，檢查剩餘餘額與服務狀態，再逐步調整用量。",
        },
      ],
    },
    pricing: {
      title: "從適合的預付額度開始。",
      lead: "儲值方案以美元計價，模型使用量從 API 餘額扣除。",
      packs: ["初次試用", "產品開發", "擴大用量"],
      credit: "API 餘額",
      bonus: "額外額度",
      purchase: "洽詢儲值",
      note: "購買、付款與兌換方式請向團隊確認；此頁不直接處理付款。專屬 GPU 與客製部署另行報價。",
      exampleTitle: "把用量換成可理解的數字。",
      exampleBody:
        "以 GLM 5.2 FP8 刊登單價計算：100 萬輸入詞元與 25 萬輸出詞元，預估費用為下列金額。這是用量示例，實際扣款依 API 計費紀錄為準。",
      exampleUnit: "示例預估費用 · 美元",
    },
    infrastructure: {
      title: "配置由需求決定。",
      lead: "GPU 系列是配置討論的起點；模型、精度與資料流決定合適的記憶體、節點數及互連。",
      options: [
        {
          title: "NVIDIA HGX B300 / B200",
          body: "討論新一代模型推論與訓練需求，依模型尺寸、記憶體和交付條件評估配置。",
        },
        {
          title: "NVIDIA H200 / H100 / A100",
          body: "依推論、微調與計算負載，比較記憶體需求、系統配置與專案預算。",
        },
        {
          title: "單租戶與指定機房",
          body: "討論裸機、專屬叢集、客戶指定 IDC 或共置，以及網路、儲存與存取責任。",
        },
      ],
      note: "平台清單為可討論的方案，不代表即時庫存。GPU、地區、400G／800G InfiniBand、儲存、價格與時程，均須以專案提案確認。",
      requirementsTitle: "洽談前，準備這些資訊。",
      requirements: [
        "模型、參數量、精度、上下文與開發框架",
        "每日工作量、尖峰併發、延遲或完成時間目標",
        "資料量、儲存、存取權限與地區限制",
        "開始日期、預算範圍、操作責任與驗收條件",
      ],
      processTitle: "把需求轉成可驗收的交付範圍。",
      process: [
        { title: "定義工作負載", body: "確認模型、資料、使用模式及必要限制。" },
        {
          title: "評估系統配置",
          body: "比較 GPU、節點、網路、儲存與機房條件。",
        },
        {
          title: "確認提案與責任",
          body: "約定可用性、商務條件、資料處理及驗收標準。",
        },
        {
          title: "規劃驗證與交付",
          body: "安排工作負載驗證、權限交接與正式使用前的檢查。",
        },
      ],
    },
    company: {
      title: "從實際應用出發。",
      body: "Power Champion Investment Limited 的服務涵蓋模型 API 與企業 GPU 規劃。產品團隊可以先比較模型並驗證串接；需要獨立算力的企業，則依自己的模型、資料與營運需求討論部署。",
      approach: [
        {
          title: "需求先於配置",
          body: "先釐清要處理的資料、預期輸出與使用模式，再選擇模型或硬體。",
        },
        {
          title: "成本與範圍可比較",
          body: "模型依刊登計費單位比較，企業部署則以專案配置與交付範圍報價。",
        },
        {
          title: "驗證有明確依據",
          body: "將模型目錄、即時服務狀態與專案提案分開，讓每一步都有可確認的資訊。",
        },
      ],
      address: "台灣台北市中正區仁愛路一段 38-1 號 7 樓",
      evidenceTitle: "公開公司與基礎設施資訊",
      evidence:
        "2026 年 7 月 9 日，交易對手 Azio AI Holdings 於 SEC 附件揭露相關協議，描述約 3.1 MW 的預期初期託管容量，以及附帶條件的擴充可能。這些資訊屬交易對手預期與估計，不代表已完成部署、即時可售容量或 Power Champion 已收到營收。",
      evidenceLink: "閱讀交易對手 SEC 揭露",
    },
    agents: {
      eyebrow: "為公司打造 AI 代理",
      title: "把你的工作流程，交給合適的助手。",
      lead: "先從客服、研究、內容或程式助手開始試用，再依團隊需求規劃專屬 AI 代理。公司知識、系統串接與可執行的動作，會在專案中逐項確認。",
      steps: [
        "釐清使用者、重複任務與預期改善",
        "整理知識來源、存取權限與更新責任",
        "規劃系統串接、可用動作與人工審核",
        "共同測試代表性問題、失敗情境與驗收標準",
        "確認部署、交接、監測與後續支援",
      ],
      explore: "探索 AI 助手",
      build: "自訂你的助手",
      note: "助手工作區與建構工具提供英文及繁體中文。範本以指示引導模型；網路搜尋、公司知識與外部系統操作須另外串接。",
    },
    closing: {
      title: "下一步，讓模型為你的產品工作。",
      body: "先探索模型與刊登價格，或帶著工作負載需求，與我們討論專屬算力。",
    },
  },
  "zh-Hans": {
    nav: {
      "agent-platform": "智能体",
      "": "首页",
      models: "模型目录",
      pricing: "价格",
      infrastructure: "GPU 算力",
      company: "关于我们",
    },
    navigation: "主导航",
    languages: "网站语言",
    skip: "跳至主要内容",
    pages: {
      "agent-platform": { eyebrow: "POWER CHAMPION / AGENTS", title: "AI 智能体：从需求到可交付成果", description: "让智能体分析资料、执行任务并交付实用文件。追踪进度、批准网页读取，也能为企业规划专属 Agent。" },
      "": {
        eyebrow: "模型 API · 专属 GPU",
        title: "让好模型，成为好产品。",
        description:
          "通过 Power Champion 接入文本、视觉、图像、语音与检索模型。从第一个 API 请求，到企业专属 GPU 部署，以适合工作负载的方式开始。",
      },
      models: {
        eyebrow: "模型目录",
        title: "为每个任务，找到合适模型。",
        description:
          "比较推理、编程、文档理解、图像生成、语音与搜索模型。先了解能力与计费单位，再选择适合应用的 API。",
      },
      pricing: {
        eyebrow: "清晰的用量计费",
        title: "掌握每一次调用的成本。",
        description:
          "模型 API 使用预付余额按用量计费。文本、图像与语音采用不同计费单位，便于在接入前评估预算。",
      },
      infrastructure: {
        eyebrow: "专属 GPU 与企业部署",
        title: "为你的工作负载，规划算力。",
        description:
          "从模型大小、显存与并发需求出发，讨论 NVIDIA HGX 平台、单租户裸机与客户指定数据中心部署。",
      },
      company: {
        eyebrow: "关于 POWER CHAMPION",
        title: "模型服务与算力，连成一条路。",
        description:
          "Power Champion 结合模型 API 与企业 GPU 部署规划，帮助开发者、产品团队与企业把 AI 需求落实为可运行的应用。",
      },
    },
    actions: {
      models: "探索模型",
      platform: "打开模型平台",
      contact: "咨询需求",
      integrations: "配置 API 接入",
      status: "查看服务状态",
      details: "模型详情",
      pricing: "查看价格",
    },
    platformNote: "模型平台、接入工具与模型详情提供英语及繁体中文。",
    footerNote: "从模型探索到算力部署，让下一个 AI 产品有清晰的起点。",
    legalNote: "技术文档、服务状态与政策页面提供英语及繁体中文。",
    footer: {
      company: "公司与服务",
      resources: "资源",
      contact: "联系我们",
      docs: "技术文档",
      privacy: "隐私政策",
      terms: "使用条款",
      trust: "信任与服务说明",
    },
    modelDescriptions: {
      "glm-5.2-fp8": "对话、推理与编程，适合文本助手及开发工作流。",
      "qwen3-vl-30b": "图片、图表与文档理解，可用于 OCR 与视觉问答。",
      "flux-schnell": "快速文生图，适合创意探索与营销素材初稿。",
      "chroma1-hd": "高分辨率图像生成，适合需要丰富细节的视觉内容。",
      "whisper-large-v3": "将音频转为文本，用于转录、字幕与可搜索记录。",
      indextts2: "搭配有权使用的参考音频，生成文本转语音内容。",
      "bge-m3": "建立多语言嵌入向量，支持语义搜索与检索增强生成。",
      "bge-reranker-v2-m3": "根据查询重新排列文档，改善检索结果的相关性。",
    },
    catalog: {
      title: "一个目录，多种模型能力。",
      lead: "根据输入、预期输出与成本选择模型。目录与实时服务状态分别展示。",
      note: "以下为公布的规格与价格；可用性以服务状态及实际 API 响应为准。",
      model: "模型",
      capability: "用途",
      pricing: "公布单价（美元）",
      context: "上下文",
      input: "输入",
      output: "输出",
      million: "每百万词元",
      image: "每张图像",
      minute: "每分钟音频",
      detailNote: "完整模型规格与代码示例提供英语及繁体中文。",
    },
    workflows: {
      title: "从你要完成的事开始。",
      lead: "让模型成为产品流程的一部分，选择真正需要的能力。",
      items: [
        {
          title: "文本助手与编程",
          body: "使用 GLM 5.2 FP8 构建对话流程、整理信息或辅助编程，根据任务评估上下文与输出长度。",
        },
        {
          title: "文档与视觉理解",
          body: "使用 Qwen3-VL 30B 理解扫描文档、图片与图表，将视觉信息带入内部工具。",
        },
        {
          title: "图像与语音内容",
          body: "结合 Flux、Chroma、Whisper 与 IndexTTS2，规划素材生成、音频转录与语音输出的不同阶段。",
        },
        {
          title: "企业知识搜索",
          body: "使用 BGE-M3 建立向量、搭配 BGE Reranker 重排，为知识库与 RAG 流程准备相关资料。",
        },
      ],
    },
    services: {
      title: "根据产品阶段，选择服务方式。",
      items: [
        {
          title: "模型 API",
          body: "使用目录中的模型及 API 示例，从预付用量开始验证应用，无需先规划自己的 GPU 集群。",
        },
        {
          title: "专属 GPU",
          body: "为自有模型、持续推理或训练任务，讨论独立算力、节点配置与运行责任。",
        },
        {
          title: "定制部署",
          body: "根据指定机房、数据处理与网络需求，确认配置、交付范围与验收方式。",
        },
      ],
    },
    onboarding: {
      title: "从需求，到第一个 API 请求。",
      lead: "访问权限与充值按当前服务流程确认，技术工具帮助你完成接入。",
      steps: [
        {
          title: "确认模型与访问需求",
          body: "浏览模型目录，向团队确认 API 密钥申请方式及适用服务。",
        },
        {
          title: "安排预付余额",
          body: "确认充值方案与付款方式；取得兑换码后，按指引加入 API 余额。",
        },
        {
          title: "生成接入示例",
          body: "选择模型与开发语言，使用接入工具生成请求配置，再在自己的应用中加入密钥。",
        },
        {
          title: "验证并持续观察",
          body: "通过测试台查看实际响应，检查剩余余额与服务状态，再逐步调整用量。",
        },
      ],
    },
    pricing: {
      title: "从适合的预付额度开始。",
      lead: "充值方案以美元计价，模型使用量从 API 余额扣除。",
      packs: ["初次体验", "产品开发", "扩大用量"],
      credit: "API 余额",
      bonus: "额外额度",
      purchase: "咨询充值",
      note: "购买、付款与兑换方式请向团队确认；此页面不直接处理付款。专属 GPU 与定制部署另行报价。",
      exampleTitle: "把用量换成可理解的数字。",
      exampleBody:
        "按 GLM 5.2 FP8 公布单价计算：100 万输入词元与 25 万输出词元，预估费用为下列金额。这是用量示例，实际扣费以 API 计费记录为准。",
      exampleUnit: "示例预估费用 · 美元",
    },
    infrastructure: {
      title: "配置由需求决定。",
      lead: "GPU 系列是配置讨论的起点；模型、精度与数据流决定合适的显存、节点数及互连。",
      options: [
        {
          title: "NVIDIA HGX B300 / B200",
          body: "讨论新一代模型推理与训练需求，根据模型大小、显存和交付条件评估配置。",
        },
        {
          title: "NVIDIA H200 / H100 / A100",
          body: "根据推理、微调与计算负载，比较显存需求、系统配置与项目预算。",
        },
        {
          title: "单租户与指定机房",
          body: "讨论裸机、专属集群、客户指定 IDC 或托管，以及网络、存储与访问责任。",
        },
      ],
      note: "平台清单为可讨论的方案，不代表实时库存。GPU、地区、400G／800G InfiniBand、存储、价格与时间安排，均须通过项目提案确认。",
      requirementsTitle: "咨询前，准备这些信息。",
      requirements: [
        "模型、参数量、精度、上下文与开发框架",
        "每日工作量、峰值并发、延迟或完成时间目标",
        "数据量、存储、访问权限与地区限制",
        "开始日期、预算范围、操作责任与验收条件",
      ],
      processTitle: "把需求转成可验收的交付范围。",
      process: [
        { title: "定义工作负载", body: "确认模型、数据、使用模式及必要限制。" },
        {
          title: "评估系统配置",
          body: "比较 GPU、节点、网络、存储与机房条件。",
        },
        {
          title: "确认提案与责任",
          body: "约定可用性、商务条件、数据处理及验收标准。",
        },
        {
          title: "规划验证与交付",
          body: "安排工作负载验证、权限交接与正式使用前的检查。",
        },
      ],
    },
    company: {
      title: "从实际应用出发。",
      body: "Power Champion Investment Limited 的服务涵盖模型 API 与企业 GPU 规划。产品团队可以先比较模型并验证接入；需要独立算力的企业，则根据自己的模型、数据与运营需求讨论部署。",
      approach: [
        {
          title: "需求先于配置",
          body: "先明确要处理的数据、预期输出与使用模式，再选择模型或硬件。",
        },
        {
          title: "成本与范围可比较",
          body: "模型按公布的计费单位比较，企业部署则按项目配置与交付范围报价。",
        },
        {
          title: "验证有明确依据",
          body: "将模型目录、实时服务状态与项目提案分开，让每一步都有可确认的信息。",
        },
      ],
      address: "台湾台北市中正区仁爱路一段 38-1 号 7 楼",
      evidenceTitle: "公开公司与基础设施信息",
      evidence:
        "2026 年 7 月 9 日，交易对手 Azio AI Holdings 在 SEC 附件中披露相关协议，描述约 3.1 MW 的预期初期托管容量，以及附带条件的扩展可能。这些信息属于交易对手的预期与估计，不代表已完成部署、实时可售容量或 Power Champion 已收到营收。",
      evidenceLink: "阅读交易对手 SEC 披露",
    },
    agents: {
      eyebrow: "为公司打造 AI 代理",
      title: "让合适的助手融入你的工作流程。",
      lead: "先体验客服、研究、内容或编程助手，再根据团队需求规划专属 AI 代理。公司知识、系统接入与可执行的操作，会在项目中逐项确认。",
      steps: [
        "明确用户、重复任务与预期改善",
        "整理知识来源、访问权限与更新责任",
        "规划系统接入、可用操作与人工审核",
        "共同测试代表性问题、失败场景与验收标准",
        "确认部署、交接、监测与后续支持",
      ],
      explore: "探索 AI 助手",
      build: "自定义你的助手",
      note: "助手工作区与构建工具提供英语及繁体中文。模板通过指令引导模型；网络搜索、公司知识与外部系统操作需要另外接入。",
    },
    closing: {
      title: "下一步，让模型为你的产品工作。",
      body: "先探索模型与公布价格，或带着工作负载需求，与我们讨论专属算力。",
    },
  },
  ja: {
    nav: {
      "agent-platform": "エージェント",
      "": "ホーム",
      models: "モデル一覧",
      pricing: "料金",
      infrastructure: "GPU インフラ",
      company: "企業情報",
    },
    navigation: "メインナビゲーション",
    languages: "表示言語",
    skip: "本文へ移動",
    pages: {
      "agent-platform": { eyebrow: "POWER CHAMPION / AGENTS", title: "AIエージェント：依頼から成果物まで", description: "資料を分析し、タスクを進め、実用的なファイルを作成するAIエージェント。進捗の確認、Webページの読み取り承認、企業向けエージェントの構築に対応。" },
      "": {
        eyebrow: "モデル API · 専用 GPU",
        title: "優れたモデルを、使える製品へ。",
        description:
          "テキスト、画像理解、画像生成、音声、検索を支える Power Champion のモデル API。最初の API リクエストから専用 GPU の導入まで、用途に合う構成を選べます。",
      },
      models: {
        eyebrow: "モデル一覧",
        title: "そのタスクに、合うモデルを。",
        description:
          "推論、コード生成、文書理解、画像、音声、検索のモデルを比較。機能と課金単位を確認し、アプリケーションに必要な API を選べます。",
      },
      pricing: {
        eyebrow: "使用量に応じた料金",
        title: "API のコストを、使う前に。",
        description:
          "モデル API はプリペイド残高から使用量に応じて課金されます。トークン数、画像数、音声の長さで異なる料金を確認し、予算を計画できます。",
      },
      infrastructure: {
        eyebrow: "専用 GPU と企業向け導入",
        title: "用途から考える、GPU 構成。",
        description:
          "モデルのサイズ、メモリ、同時実行数をもとに、NVIDIA HGX、シングルテナントのベアメタル、お客様指定のデータセンターへの導入をご相談いただけます。",
      },
      company: {
        eyebrow: "POWER CHAMPION について",
        title: "モデルとインフラを、ひとつの道筋に。",
        description:
          "Power Champion はモデル API と企業向け GPU の導入計画を通じて、開発者、製品チーム、企業の AI 活用を支えます。",
      },
    },
    actions: {
      models: "モデルを探す",
      platform: "モデルプラットフォームへ",
      contact: "相談する",
      integrations: "API 接続を設定",
      status: "サービス状況を確認",
      details: "モデルの詳細",
      pricing: "料金を見る",
    },
    platformNote:
      "モデルプラットフォーム、接続ツール、モデル詳細は英語と繁体字中国語に対応しています。",
    footerNote:
      "モデルの比較から GPU 導入まで。次の AI 製品に、確かな出発点を。",
    legalNote:
      "技術ドキュメント、サービス状況、ポリシーのページは英語と繁体字中国語で提供しています。",
    footer: {
      company: "企業・サービス",
      resources: "リソース",
      contact: "お問い合わせ",
      docs: "技術ドキュメント",
      privacy: "プライバシー",
      terms: "利用規約",
      trust: "サービスに関する情報",
    },
    modelDescriptions: {
      "glm-5.2-fp8":
        "会話、推論、コード生成。テキストアシスタントや開発ワークフローに。",
      "qwen3-vl-30b":
        "画像、グラフ、文書の理解。OCR や画像に関する質問への回答に。",
      "flux-schnell":
        "高速なテキストからの画像生成。アイデアの検討や制作素材の下書きに。",
      "chroma1-hd": "高解像度の画像生成。細部の表現が必要なビジュアル制作に。",
      "whisper-large-v3":
        "音声をテキストに変換。文字起こし、字幕、検索可能な記録に。",
      indextts2: "使用権限のある参照音声を使い、テキストから音声を生成。",
      "bge-m3": "多言語の埋め込みベクトルを生成。意味検索や RAG の検索処理に。",
      "bge-reranker-v2-m3":
        "クエリに応じて文書を再ランキングし、検索結果の関連性を改善。",
    },
    catalog: {
      title: "ひとつの一覧から、多様な機能へ。",
      lead: "入力、必要な出力、コストからモデルを選択。掲載情報と実際の稼働状況は分けて確認できます。",
      note: "以下は掲載仕様と料金です。利用可否はサービス状況と実際の API 応答をご確認ください。",
      model: "モデル",
      capability: "用途",
      pricing: "掲載単価（米ドル）",
      context: "コンテキスト",
      input: "入力",
      output: "出力",
      million: "100 万トークンあたり",
      image: "画像 1 枚あたり",
      minute: "音声 1 分あたり",
      detailNote:
        "詳細なモデル仕様とコード例は英語と繁体字中国語で提供しています。",
    },
    workflows: {
      title: "実現したいことから、選ぶ。",
      lead: "製品のワークフローに必要なモデル機能を組み込みます。",
      items: [
        {
          title: "テキスト処理とコード生成",
          body: "GLM 5.2 FP8 で会話、情報整理、コード作成を支援。タスクに合わせてコンテキストと出力の長さを検討します。",
        },
        {
          title: "文書・画像の理解",
          body: "Qwen3-VL 30B でスキャン文書、画像、グラフを読み取り、社内ツールに視覚情報を取り込みます。",
        },
        {
          title: "画像・音声の制作",
          body: "Flux と Chroma の画像生成、Whisper の文字起こし、IndexTTS2 の音声生成を工程に合わせて選べます。",
        },
        {
          title: "社内ナレッジの検索",
          body: "BGE-M3 の埋め込みと BGE Reranker の再ランキングで、ナレッジベースや RAG に必要な情報を探します。",
        },
      ],
    },
    services: {
      title: "製品の段階に合わせた利用方法。",
      items: [
        {
          title: "モデル API",
          body: "掲載モデルと API のサンプルを使い、プリペイド残高でアプリケーションを検証。まず自前の GPU クラスタを構築する必要はありません。",
        },
        {
          title: "専用 GPU",
          body: "独自モデル、継続的な推論、学習ジョブに必要な専用リソース、ノード構成、運用分担を相談できます。",
        },
        {
          title: "個別の導入計画",
          body: "指定施設、データ処理、ネットワークの要件に応じて、構成、提供範囲、受入基準を確認します。",
        },
      ],
    },
    onboarding: {
      title: "要件の確認から、最初の API 呼び出しへ。",
      lead: "アクセス権とチャージは現在のサービス手順に沿って確認し、開発ツールで接続を進めます。",
      steps: [
        {
          title: "モデルと利用用途を確認",
          body: "モデル一覧を確認し、担当者に API キーの申請方法と対象サービスをご相談ください。",
        },
        {
          title: "クレジットを追加",
          body: "チャージプランと支払い方法を確認。引き換えコードを受け取り、案内に沿って API 残高に反映します。",
        },
        {
          title: "接続コードを生成",
          body: "モデルと開発言語を選択し、接続ツールでリクエスト設定を生成。ご自身のアプリケーションにキーを設定します。",
        },
        {
          title: "応答と残高を確認",
          body: "テストツールで実際の応答を確認し、残高とサービス状況を見ながら使用量を調整します。",
        },
      ],
    },
    pricing: {
      title: "必要なクレジットから始める。",
      lead: "チャージ料金は米ドル建て。モデルの使用料は API 残高から差し引かれます。",
      packs: ["導入・検証", "製品開発", "利用拡大"],
      credit: "API クレジット",
      bonus: "追加クレジット",
      purchase: "チャージを相談",
      note: "購入、支払い、引き換えの方法は担当者にご確認ください。このページでは決済を行いません。専用 GPU と個別導入は別途お見積もりします。",
      exampleTitle: "使用量を、具体的な金額に。",
      exampleBody:
        "GLM 5.2 FP8 の掲載単価で、入力 100 万トークンと出力 25 万トークンを計算した例です。実際の請求額は API の課金記録によります。",
      exampleUnit: "使用例の概算 · 米ドル",
    },
    infrastructure: {
      title: "要件が、構成を決める。",
      lead: "GPU ファミリーは構成検討の出発点。モデル、精度、データの流れから、メモリ、ノード数、相互接続を検討します。",
      options: [
        {
          title: "NVIDIA HGX B300 / B200",
          body: "新世代モデルの推論・学習に向けて、モデルサイズ、メモリ、提供条件をもとに構成を検討します。",
        },
        {
          title: "NVIDIA H200 / H100 / A100",
          body: "推論、ファインチューニング、計算処理に応じ、メモリ要件、システム構成、予算を比較します。",
        },
        {
          title: "専用環境と指定施設",
          body: "ベアメタル、専用クラスタ、指定 IDC やコロケーションについて、ネットワーク、ストレージ、アクセスの責任範囲を確認します。",
        },
      ],
      note: "掲載プラットフォームは検討可能な選択肢で、即時利用できる在庫を示すものではありません。GPU、地域、400G／800G InfiniBand、ストレージ、料金、提供時期は個別提案で確認します。",
      requirementsTitle: "ご相談の前に、用意したい情報。",
      requirements: [
        "モデル、パラメータ数、精度、コンテキスト、開発フレームワーク",
        "日々の処理量、ピーク時の同時実行数、応答時間や完了期限",
        "データ量、ストレージ、アクセス権、地域の制約",
        "開始希望日、予算、運用分担、受入条件",
      ],
      processTitle: "要件を、確認できる提供範囲へ。",
      process: [
        {
          title: "用途を定義",
          body: "モデル、データ、利用パターンと必要な制約を整理します。",
        },
        {
          title: "構成を検討",
          body: "GPU、ノード、ネットワーク、ストレージ、施設条件を比較します。",
        },
        {
          title: "提案と役割を合意",
          body: "提供条件、商務条件、データ処理、受入基準を確認します。",
        },
        {
          title: "検証と引き渡しを計画",
          body: "ワークロードの検証、権限の受け渡し、本番利用前の確認を進めます。",
        },
      ],
    },
    company: {
      title: "実際に使う場面から、考える。",
      body: "Power Champion Investment Limited は、モデル API と企業向け GPU の計画を支援します。製品チームはモデルの比較と接続の検証から、専用リソースが必要な企業はモデル、データ、運用条件に合わせた導入の相談から始められます。",
      approach: [
        {
          title: "要件を先に",
          body: "扱うデータ、必要な出力、利用パターンを明らかにしてから、モデルやハードウェアを選びます。",
        },
        {
          title: "比較できる費用と範囲",
          body: "モデルは掲載された課金単位で比較し、企業向け導入は構成と提供範囲に基づき見積もります。",
        },
        {
          title: "確認できる情報",
          body: "モデル一覧、実際のサービス状況、個別提案を区別し、各段階で確認すべき情報を示します。",
        },
      ],
      address: "台湾 台北市中正区仁愛路一段 38-1 号 7 階",
      evidenceTitle: "企業・インフラに関する公開情報",
      evidence:
        "2026 年 7 月 9 日、取引相手の Azio AI Holdings は SEC 提出資料で関連契約を公表し、初期の予定ホスティング容量約 3.1 MW と条件付きの拡張可能性を説明しました。これは取引相手による見通しと見積もりであり、導入完了、即時販売可能な容量、Power Champion の収益受領を示しません。",
      evidenceLink: "取引相手の SEC 開示資料を読む",
    },
    agents: {
      eyebrow: "企業に合わせた AI エージェント",
      title: "いつもの業務に、合うアシスタントを。",
      lead: "サポート、調査、コンテンツ、コード作成のアシスタントを試し、チームに合う専用エージェントを検討できます。社内ナレッジ、システム連携、実行可能な操作は、プロジェクトごとに確認します。",
      steps: [
        "利用者、繰り返す業務、改善したい結果を整理",
        "知識の出典、アクセス権、更新の担当を確認",
        "システム連携、許可する操作、人による承認を設計",
        "代表的な質問、失敗時の対応、受入基準を共同で検証",
        "導入、引き渡し、監視、継続的な支援を計画",
      ],
      explore: "AI アシスタントを探す",
      build: "アシスタントを作成",
      note: "アシスタントのワークスペースと作成ツールは英語と繁体字中国語に対応しています。テンプレートは指示でモデルを導きます。ウェブ検索、社内ナレッジ、外部システムの操作には別途連携が必要です。",
    },
    closing: {
      title: "次は、あなたの製品で。",
      body: "モデルと掲載料金を確認するか、ワークロードの要件をもとに専用 GPU をご相談ください。",
    },
  },
  ko: {
    nav: {
      "agent-platform": "에이전트",
      "": "홈",
      models: "모델 카탈로그",
      pricing: "요금",
      infrastructure: "GPU 인프라",
      company: "회사 소개",
    },
    navigation: "주요 메뉴",
    languages: "언어 선택",
    skip: "본문으로 이동",
    pages: {
      "agent-platform": { eyebrow: "POWER CHAMPION / AGENTS", title: "AI 에이전트: 요청에서 결과물까지", description: "자료를 분석하고 작업을 진행해 활용할 수 있는 파일을 만드는 AI 에이전트. 진행 상황 확인, 웹 읽기 승인, 기업 맞춤 에이전트 구축을 지원합니다." },
      "": {
        eyebrow: "모델 API · 전용 GPU",
        title: "좋은 모델을, 쓸모 있는 제품으로.",
        description:
          "텍스트, 이미지 이해, 이미지 생성, 음성, 검색을 위한 Power Champion 모델 API. 첫 API 요청부터 전용 GPU 도입까지, 워크로드에 맞는 방식으로 시작하세요.",
      },
      models: {
        eyebrow: "모델 카탈로그",
        title: "작업에 맞는 모델을 찾으세요.",
        description:
          "추론, 코드 생성, 문서 이해, 이미지, 음성, 검색 모델을 비교하세요. 기능과 과금 단위를 확인하고 애플리케이션에 필요한 API를 선택할 수 있습니다.",
      },
      pricing: {
        eyebrow: "사용량 기반 요금",
        title: "API 비용을 미리 파악하세요.",
        description:
          "모델 API는 선불 잔액에서 사용량에 따라 과금됩니다. 토큰 수, 이미지 수, 음성 길이에 따른 요금을 확인하고 예산을 계획하세요.",
      },
      infrastructure: {
        eyebrow: "전용 GPU와 기업 구축",
        title: "워크로드에서 시작하는 GPU 설계.",
        description:
          "모델 크기, 메모리, 동시 처리량을 바탕으로 NVIDIA HGX, 단일 고객 전용 베어메탈, 고객 지정 데이터센터 구축을 상담하세요.",
      },
      company: {
        eyebrow: "POWER CHAMPION 소개",
        title: "모델과 인프라를 하나의 여정으로.",
        description:
          "Power Champion은 모델 API와 기업용 GPU 구축 계획을 통해 개발자, 제품 팀, 기업의 AI 활용을 지원합니다.",
      },
    },
    actions: {
      models: "모델 살펴보기",
      platform: "모델 플랫폼 열기",
      contact: "상담하기",
      integrations: "API 연결 설정",
      status: "서비스 상태 확인",
      details: "모델 상세",
      pricing: "요금 확인",
    },
    platformNote:
      "모델 플랫폼, 연동 도구, 모델 상세 페이지는 영어와 번체 중국어를 지원합니다.",
    footerNote:
      "모델 탐색부터 GPU 구축까지, 다음 AI 제품을 위한 명확한 시작점.",
    legalNote:
      "기술 문서, 서비스 상태, 정책 페이지는 영어와 번체 중국어로 제공됩니다.",
    footer: {
      company: "회사 및 서비스",
      resources: "자료",
      contact: "문의",
      docs: "기술 문서",
      privacy: "개인정보 처리방침",
      terms: "이용약관",
      trust: "서비스 안내",
    },
    modelDescriptions: {
      "glm-5.2-fp8":
        "대화, 추론, 코드 생성. 텍스트 도우미와 개발 워크플로에 활용합니다.",
      "qwen3-vl-30b":
        "이미지, 차트, 문서 이해. OCR과 이미지 관련 질의응답에 활용합니다.",
      "flux-schnell":
        "빠른 텍스트 기반 이미지 생성. 아이디어 탐색과 콘텐츠 초안에 적합합니다.",
      "chroma1-hd":
        "고해상도 이미지 생성. 세부 표현이 필요한 시각 콘텐츠에 활용합니다.",
      "whisper-large-v3":
        "음성을 텍스트로 변환. 전사, 자막, 검색 가능한 기록을 만듭니다.",
      indextts2:
        "사용 권한이 있는 참조 음성을 이용해 텍스트를 음성으로 변환합니다.",
      "bge-m3":
        "다국어 임베딩 벡터 생성. 의미 검색과 RAG의 검색 단계에 활용합니다.",
      "bge-reranker-v2-m3":
        "질문에 따라 문서를 다시 정렬해 검색 결과의 관련성을 높입니다.",
    },
    catalog: {
      title: "하나의 카탈로그, 다양한 모델 기능.",
      lead: "입력, 필요한 출력, 비용을 기준으로 모델을 선택하세요. 카탈로그와 실제 서비스 상태를 따로 확인할 수 있습니다.",
      note: "아래는 게시된 사양과 요금입니다. 사용 가능 여부는 서비스 상태와 실제 API 응답을 확인하세요.",
      model: "모델",
      capability: "용도",
      pricing: "게시 단가 · 미국 달러",
      context: "컨텍스트",
      input: "입력",
      output: "출력",
      million: "100만 토큰당",
      image: "이미지 1장당",
      minute: "음성 1분당",
      detailNote:
        "전체 모델 사양과 코드 예제는 영어와 번체 중국어로 제공됩니다.",
    },
    workflows: {
      title: "완성하고 싶은 기능에서 시작하세요.",
      lead: "제품의 워크플로에 필요한 모델 기능을 연결합니다.",
      items: [
        {
          title: "텍스트 도우미와 코드 생성",
          body: "GLM 5.2 FP8로 대화, 정보 정리, 코드 작성을 지원하세요. 작업에 맞게 컨텍스트와 출력 길이를 검토합니다.",
        },
        {
          title: "문서·이미지 이해",
          body: "Qwen3-VL 30B로 스캔 문서, 이미지, 차트를 읽고 사내 도구에 시각 정보를 연결하세요.",
        },
        {
          title: "이미지·음성 제작",
          body: "Flux와 Chroma의 이미지 생성, Whisper의 음성 전사, IndexTTS2의 음성 생성을 제작 단계에 맞게 선택하세요.",
        },
        {
          title: "기업 지식 검색",
          body: "BGE-M3 임베딩과 BGE Reranker 재정렬로 지식베이스와 RAG에 필요한 관련 자료를 찾으세요.",
        },
      ],
    },
    services: {
      title: "제품 단계에 맞는 서비스 방식.",
      items: [
        {
          title: "모델 API",
          body: "게시된 모델과 API 예제를 활용해 선불 잔액으로 애플리케이션을 검증하세요. 먼저 자체 GPU 클러스터를 구성할 필요가 없습니다.",
        },
        {
          title: "전용 GPU",
          body: "자체 모델, 지속적인 추론, 학습 작업에 필요한 전용 자원, 노드 구성, 운영 책임을 상담하세요.",
        },
        {
          title: "맞춤 구축",
          body: "지정 시설, 데이터 처리, 네트워크 요건에 맞춰 구성, 제공 범위, 인수 기준을 확인합니다.",
        },
      ],
    },
    onboarding: {
      title: "요건 확인부터 첫 API 호출까지.",
      lead: "접근 권한과 충전은 현재 서비스 절차에 따라 확인하고, 개발 도구로 연동을 진행합니다.",
      steps: [
        {
          title: "모델과 사용 목적 확인",
          body: "카탈로그를 살펴보고 담당자에게 API 키 신청 방법과 적용 서비스를 확인하세요.",
        },
        {
          title: "크레딧 충전",
          body: "충전 상품과 결제 방법을 확인하세요. 충전 코드를 받은 뒤 안내에 따라 API 잔액에 반영합니다.",
        },
        {
          title: "연동 코드 생성",
          body: "모델과 개발 언어를 선택하고 연동 도구로 요청 설정을 생성하세요. 키는 자신의 애플리케이션에 설정합니다.",
        },
        {
          title: "응답과 잔액 확인",
          body: "테스트 도구에서 실제 응답을 확인하고, 잔액과 서비스 상태를 살피며 사용량을 조절하세요.",
        },
      ],
    },
    pricing: {
      title: "필요한 크레딧부터 시작하세요.",
      lead: "충전 상품은 미국 달러로 표시됩니다. 모델 사용 요금은 API 잔액에서 차감됩니다.",
      packs: ["도입·검증", "제품 개발", "사용 확대"],
      credit: "API 크레딧",
      bonus: "추가 크레딧",
      purchase: "충전 문의",
      note: "구매, 결제, 코드 등록 방법은 담당자에게 확인하세요. 이 페이지에서는 결제를 처리하지 않습니다. 전용 GPU와 맞춤 구축은 별도 견적입니다.",
      exampleTitle: "사용량을 구체적인 금액으로.",
      exampleBody:
        "GLM 5.2 FP8 게시 단가를 기준으로 입력 100만 토큰과 출력 25만 토큰을 계산한 예시입니다. 실제 청구 금액은 API 과금 기록에 따릅니다.",
      exampleUnit: "사용 예시 예상 비용 · 미국 달러",
    },
    infrastructure: {
      title: "요건이 구성을 결정합니다.",
      lead: "GPU 제품군은 구성 논의의 출발점입니다. 모델, 정밀도, 데이터 흐름을 바탕으로 메모리, 노드 수, 상호 연결을 검토합니다.",
      options: [
        {
          title: "NVIDIA HGX B300 / B200",
          body: "차세대 모델 추론과 학습을 위해 모델 크기, 메모리, 제공 조건에 맞는 구성을 검토합니다.",
        },
        {
          title: "NVIDIA H200 / H100 / A100",
          body: "추론, 미세 조정, 계산 작업에 따라 메모리 요건, 시스템 구성, 프로젝트 예산을 비교합니다.",
        },
        {
          title: "전용 환경과 지정 시설",
          body: "베어메탈, 전용 클러스터, 고객 지정 IDC 또는 코로케이션을 검토하고 네트워크, 저장소, 접근 책임을 확인합니다.",
        },
      ],
      note: "플랫폼 목록은 상담 가능한 선택지이며 즉시 이용 가능한 재고를 뜻하지 않습니다. GPU, 지역, 400G／800G InfiniBand, 저장소, 요금, 제공 일정은 개별 제안에서 확인합니다.",
      requirementsTitle: "상담 전에 준비할 정보.",
      requirements: [
        "모델, 매개변수 수, 정밀도, 컨텍스트, 개발 프레임워크",
        "일일 작업량, 최대 동시 처리량, 지연 시간 또는 완료 목표",
        "데이터 규모, 저장소, 접근 권한, 지역 제한",
        "희망 시작일, 예산, 운영 책임, 인수 조건",
      ],
      processTitle: "요건을 확인 가능한 제공 범위로.",
      process: [
        {
          title: "워크로드 정의",
          body: "모델, 데이터, 사용 패턴과 필수 제약을 정리합니다.",
        },
        {
          title: "시스템 구성 검토",
          body: "GPU, 노드, 네트워크, 저장소, 시설 조건을 비교합니다.",
        },
        {
          title: "제안과 책임 합의",
          body: "가용성, 거래 조건, 데이터 처리, 인수 기준을 확인합니다.",
        },
        {
          title: "검증과 인계 계획",
          body: "워크로드 검증, 접근 권한 인계, 운영 전 확인 절차를 준비합니다.",
        },
      ],
    },
    company: {
      title: "실제 활용 장면에서 출발합니다.",
      body: "Power Champion Investment Limited는 모델 API와 기업용 GPU 계획을 지원합니다. 제품 팀은 모델 비교와 연동 검증부터, 전용 자원이 필요한 기업은 모델, 데이터, 운영 요건에 맞는 구축 상담부터 시작할 수 있습니다.",
      approach: [
        {
          title: "요건을 먼저",
          body: "처리할 데이터, 필요한 출력, 사용 패턴을 명확히 한 뒤 모델이나 하드웨어를 선택합니다.",
        },
        {
          title: "비교 가능한 비용과 범위",
          body: "모델은 게시된 과금 단위로 비교하고, 기업 구축은 구성과 제공 범위를 바탕으로 견적을 제안합니다.",
        },
        {
          title: "확인 가능한 정보",
          body: "모델 카탈로그, 실제 서비스 상태, 개별 제안을 구분해 단계별로 확인해야 할 정보를 제시합니다.",
        },
      ],
      address: "대만 타이베이시 중정구 런아이로 1단 38-1호 7층",
      evidenceTitle: "회사·인프라 공개 정보",
      evidence:
        "2026년 7월 9일 거래 상대방 Azio AI Holdings는 SEC 제출 자료에서 관련 계약을 공개하며 약 3.1 MW의 예상 초기 호스팅 용량과 조건부 확장 가능성을 설명했습니다. 이는 거래 상대방의 예상과 추정이며, 구축 완료, 즉시 판매 가능한 용량, Power Champion의 매출 수령을 의미하지 않습니다.",
      evidenceLink: "거래 상대방의 SEC 공시 읽기",
    },
    agents: {
      eyebrow: "기업에 맞춘 AI 에이전트",
      title: "업무 흐름에 맞는 도우미를 찾으세요.",
      lead: "고객 지원, 조사, 콘텐츠, 코드 작성 도우미를 먼저 체험하고 팀에 맞는 전용 에이전트를 계획하세요. 기업 지식, 시스템 연동, 실행 가능한 작업은 프로젝트별로 확인합니다.",
      steps: [
        "사용자, 반복 업무, 개선할 결과를 정리",
        "지식 출처, 접근 권한, 업데이트 책임을 확인",
        "시스템 연동, 허용 작업, 사람의 승인 단계를 설계",
        "대표 질문, 실패 상황, 인수 기준을 함께 검증",
        "구축, 인계, 모니터링, 후속 지원을 계획",
      ],
      explore: "AI 도우미 살펴보기",
      build: "나만의 도우미 만들기",
      note: "도우미 작업 공간과 제작 도구는 영어와 번체 중국어를 지원합니다. 템플릿은 지침으로 모델을 안내하며 웹 검색, 기업 지식, 외부 시스템 작업은 별도 연동이 필요합니다.",
    },
    closing: {
      title: "이제 당신의 제품에 연결하세요.",
      body: "모델과 게시 요금을 살펴보거나, 워크로드 요건을 바탕으로 전용 GPU를 상담하세요.",
    },
  },
};
