import type { Locale } from "./content";

type ServiceLink = { label: string; href: string };
type ServiceItem = {
  id: string;
  title: string;
  audience: string;
  description: string;
  deliverables: string[];
  access: string;
  link: ServiceLink;
};
type Workload = {
  id: string;
  title: string;
  audience: string;
  description: string;
  modelIds: string[];
};
type ServiceContent = {
  company: { kicker: string; title: string; lead: string; statement: string };
  infrastructure: {
    kicker: string;
    title: string;
    lead: string;
    overviewTitle: string;
    overviewLead: string;
    overviewNote: string;
    workloadTitle: string;
    workloads: { title: string; description: string; questions: string[] }[];
    workloadHint: string;
    questionsTitle: string;
    processTitle: string;
    processLead: string;
    process: { title: string; description: string }[];
    inputLead: string;
    inputs: string[];
    evidenceLead: string;
  };
  heroLinks: ServiceLink[];
  serviceTitle: string;
  serviceLead: string;
  deliverablesLabel: string;
  accessLabel: string;
  services: ServiceItem[];
  workloadTitle: string;
  workloadLead: string;
  modelLabel: string;
  workloads: Workload[];
  catalogNote: string;
  catalogLink: string;
  platformNote: string;
  nextGenerationPlatform: { category: string; platform: string; useCase: string };
  approachTitle: string;
  approachLead: string;
  approach: { title: string; description: string }[];
};

export const SERVICE_CONTENT: Record<Locale, ServiceContent> = {
  en: {
    company: {
      kicker: "Power Champion / Company & services",
      title: "AI models to build with. Infrastructure to grow on.",
      lead: "Power Champion connects model access with infrastructure planning. Start with an API for text, vision, image, audio, and retrieval workloads; discuss dedicated GPU capacity when your project needs a deployment of its own.",
      statement: "For product builders, engineering teams, and enterprises turning AI experiments into working applications.",
    },
    infrastructure: {
      kicker: "Power Champion / GPU infrastructure",
      title: "Compute, shaped around your workload.",
      lead: "Define the model, data, and performance requirements first. Explore dedicated GPUs, enterprise clusters, and custom data-centre deployment through a scoped infrastructure review.",
      overviewTitle: "Choose a GPU platform for the job.",
      overviewLead: "Use the platform families below as a starting point for a configuration discussion. Model size, memory needs, concurrency, and interconnect requirements determine the appropriate system.",
      overviewNote: "GPU allocation, memory, node count, network, storage, region, pricing, and delivery timing require a project-specific proposal. Platform listings are discussion options and do not represent immediately reservable inventory.",
      workloadTitle: "What the infrastructure needs to support",
      workloadHint: "Select a workload to see the requirements worth preparing.",
      questionsTitle: "Bring these details to the discussion",
      workloads: [
        { title: "Production inference", description: "Discuss model loading, peak concurrency, context length, and response-time targets for application APIs and agent workloads.", questions: ["Which models and precision will you serve?", "What are the typical and peak concurrent requests?", "What context length and latency targets must the service meet?"] },
        { title: "Training & fine-tuning", description: "Scope dataset size, checkpoint storage, framework compatibility, and GPU-to-GPU communication for your training approach.", questions: ["Are you pretraining, fine-tuning, or adapting an existing model?", "Which framework, dataset size, and precision will you use?", "How long should a training run take, and how often must checkpoints be saved?"] },
        { title: "Multimodal pipelines", description: "Plan compute for document understanding, image generation, transcription, and other workloads with different memory and processing profiles.", questions: ["Which image, document, or audio stages are in the pipeline?", "What input sizes and daily processing volumes do you expect?", "Which steps need real-time responses, and which can run in batches?"] },
        { title: "Batch processing & HPC", description: "Define job duration, scheduling, data movement, and numerical-computing requirements before choosing nodes and storage.", questions: ["Which applications and numerical precision do your jobs need?", "How large is each job, and what is the completion deadline?", "How much data must move between storage, nodes, and external systems?"] },
      ],
      processTitle: "From workload brief to deployment scope",
      processLead: "Each stage turns a requirement into something that can be reviewed. Capacity, service terms, and acceptance criteria are agreed for the specific project.",
      process: [
        { title: "Define the workload", description: "Share models, datasets, usage patterns, timing, and the constraints your team needs to meet." },
        { title: "Review the configuration", description: "Discuss GPU family, node count, memory, storage, connectivity, and the intended deployment location." },
        { title: "Agree on the scope", description: "Confirm availability, commercial terms, responsibilities, data handling, and measurable acceptance criteria in the proposal." },
        { title: "Plan validation & handover", description: "Set out workload checks, access arrangements, operating responsibilities, and the steps required before production use." },
      ],
      inputLead: "A short technical brief helps turn an initial conversation into a useful configuration discussion. Include the following where available.",
      inputs: [
        "Use case, framework, and expected outputs; distinguish inference, training, and batch jobs.",
        "Model names, parameter sizes, precision, context length, and any licensing constraints.",
        "Expected concurrency, requests or jobs per day, traffic peaks, and target latency.",
        "Preferred region or facility, networking needs, and data transfer constraints.",
        "Dataset volume, storage, retention, access controls, and any sensitive-data requirements.",
        "Target start date, budget range, validation criteria, and your team's operating responsibilities.",
      ],
      evidenceLead: "The public record below provides company and capacity context. Current API availability is reported separately from dedicated infrastructure proposals.",
    },
    heroLinks: [
      { label: "Explore the model catalog", href: "/models" },
      { label: "Discuss your project", href: "/contact" },
    ],
    serviceTitle: "Three ways to work with Power Champion",
    serviceLead: "Choose the access path that matches your application and operating model.",
    deliverablesLabel: "What to work with",
    accessLabel: "Access path",
    services: [
      {
        id: "model-api", title: "Model API", audience: "For application & AI teams",
        description: "Connect your product to models for reasoning, vision, images, speech, and retrieval through the Power Champion gateway.",
        deliverables: ["A model catalog with IDs and capabilities", "API documentation and request examples", "Published pricing and a separate service-status view"],
        access: "Compare models and integration examples, then follow the access instructions for b300.powerchampion.ai.",
        link: { label: "Read API documentation", href: "/docs" },
      },
      {
        id: "dedicated-gpu", title: "Dedicated GPU", audience: "For teams operating their own workloads",
        description: "Discuss dedicated compute for a model stack, training job, or inference service with its own resource requirements.",
        deliverables: ["Workload and GPU configuration review", "A scoped compute, network, and storage proposal", "Access and acceptance criteria defined for the project"],
        access: "Share a workload brief. Configuration, availability, and commercial terms are confirmed through review.",
        link: { label: "Explore GPU infrastructure", href: "/infrastructure" },
      },
      {
        id: "custom-deployment", title: "Custom deployment", audience: "For enterprise & infrastructure teams",
        description: "Plan a deployment around a specified facility, network, operating model, and data-handling requirements.",
        deliverables: ["Facility and integration requirements review", "A proposed deployment architecture and responsibilities", "A project-specific validation and handover plan"],
        access: "Start a deployment discussion with the technical constraints, preferred location, and timeline.",
        link: { label: "Discuss a custom deployment", href: "/contact" },
      },
    ],
    workloadTitle: "Start with what you want to build.",
    workloadLead: "These application patterns map to models in the Power Champion catalog. Combine capabilities to fit your workflow.",
    modelLabel: "Models to explore",
    workloads: [
      { id: "applications", title: "AI applications & agents", audience: "Product & engineering", description: "Build assistants, coding tools, and multi-step workflows using reasoning, tool calls, and structured responses.", modelIds: ["glm-5.2-fp8"] },
      { id: "documents", title: "Document intelligence", audience: "Operations & knowledge teams", description: "Read images, charts, and scanned pages to extract information for review and downstream workflows.", modelIds: ["qwen3-vl-30b"] },
      { id: "creative", title: "Creative & audio workflows", audience: "Content & media teams", description: "Generate visual concepts, transcribe recordings, and produce speech from text using the appropriate image or audio model.", modelIds: ["flux-schnell", "chroma1-hd", "whisper-large-v3", "indextts2"] },
      { id: "retrieval", title: "Search & retrieval-augmented generation", audience: "Data & platform teams", description: "Create multilingual embeddings and rerank retrieved documents as building blocks for semantic search and RAG applications.", modelIds: ["bge-m3", "bge-reranker-v2-m3"] },
    ],
    catalogNote: "Examples describe catalog capabilities. Check the model details, API documentation, and service status for the current integration requirements and availability.",
    catalogLink: "View all model capabilities",
    nextGenerationPlatform: { category: "Advanced AI workloads", platform: "NVIDIA HGX B300 / B200", useCase: "Large-model training and inference; configuration subject to project review" },
    platformNote: "GPU selection, memory, network, storage, and deployment availability are confirmed for each project. The platform overview is a starting point for review, not a capacity commitment.",
    approachTitle: "A practical path from idea to integration",
    approachLead: "Start with the application requirement, then choose the model and infrastructure scope that support it.",
    approach: [
      { title: "Match the capability", description: "Use the catalog to compare the task, input type, context window, and model features your application needs." },
      { title: "Plan the integration", description: "Review API examples and pricing. Define expected usage, data handling, and the checks that will make your pilot useful." },
      { title: "Scope dedicated resources", description: "When your requirements call for dedicated compute or custom deployment, bring the workload brief into an infrastructure discussion." },
    ],
  },
  zh: {
    company: {
      kicker: "Power Champion / 公司與服務",
      title: "以模型打造應用，以算力支撐成長。",
      lead: "Power Champion 串連模型存取與基礎設施規劃。從文字、視覺、圖像、音訊與檢索 API 開始；當專案需要自己的部署環境，再進一步討論專屬 GPU 資源。",
      statement: "為產品開發者、工程團隊與企業，將 AI 實驗推進到實際應用。",
    },
    infrastructure: {
      kicker: "Power Champion / GPU 基礎設施",
      title: "從工作負載出發，規劃合適算力。",
      lead: "先釐清模型、資料與效能需求，再透過具體的基礎設施審查，評估專屬 GPU、企業叢集與客製資料中心部署。",
      overviewTitle: "依工作需求，選擇 GPU 平台。",
      overviewLead: "以下平台系列可作為配置討論的起點。模型大小、記憶體需求、併發量與互連需求，將決定適合的系統組合。",
      overviewNote: "GPU 配置、記憶體、節點數、網路、儲存、區域、價格與交付時程，皆須依專案提案確認。平台列表僅供方案討論，不代表可立即預訂的庫存。",
      workloadTitle: "基礎設施需要支援哪些工作",
      workloadHint: "選擇工作負載，查看適合先準備的需求資訊。",
      questionsTitle: "帶著這些資訊開始討論",
      workloads: [
        { title: "正式環境推論", description: "為應用 API 與代理工作負載，討論模型載入、尖峰併發量、上下文長度與回應時間目標。", questions: ["預計提供哪些模型與運算精度？", "一般與尖峰時段的同時請求數是多少？", "服務需要滿足多大的上下文長度與延遲目標？"] },
        { title: "訓練與微調", description: "依訓練方式，釐清資料集規模、檢查點儲存、框架相容性與 GPU 間通訊需求。", questions: ["是預訓練、微調，還是調整既有模型？", "將使用哪些框架、資料集規模與運算精度？", "預期訓練多久完成，以及多久儲存一次檢查點？"] },
        { title: "多模態處理流程", description: "為文件理解、圖像生成、音訊轉錄等不同的記憶體與運算需求，規劃適合的資源。", questions: ["流程包含哪些圖像、文件或音訊處理階段？", "預期的輸入大小與每日處理量是多少？", "哪些步驟需要即時回應，哪些可採批次處理？"] },
        { title: "批次處理與 HPC", description: "先定義作業時間、排程、資料搬移與科學運算需求，再選擇運算節點及儲存配置。", questions: ["作業需要哪些應用程式與運算精度？", "每個作業的規模與完成期限是什麼？", "儲存、節點及外部系統間需要搬移多少資料？"] },
      ],
      processTitle: "從工作負載簡報，到具體部署範圍",
      processLead: "每個階段都將需求轉為可檢視的內容。容量、服務條件與驗收標準，皆依個別專案確認。",
      process: [
        { title: "釐清工作負載", description: "提供模型、資料集、使用模式、時程，以及團隊必須滿足的限制條件。" },
        { title: "檢視系統配置", description: "討論 GPU 系列、節點數、記憶體、儲存、連線方式與預計部署地點。" },
        { title: "確認專案範圍", description: "在提案中確認供應情況、商業條款、責任分工、資料處理方式與可量測的驗收標準。" },
        { title: "規劃驗證與交接", description: "列出工作負載測試、存取安排、維運責任，以及進入正式使用前需要完成的步驟。" },
      ],
      inputLead: "一份簡短的技術需求說明，能讓初次討論更快聚焦到配置。請盡可能準備以下資訊。",
      inputs: [
        "應用場景、使用框架與預期輸出，並區分推論、訓練或批次作業。",
        "模型名稱、參數規模、精度、上下文長度與授權限制。",
        "預期併發量、每日請求或作業數、尖峰流量與延遲目標。",
        "偏好區域或機房、網路連線需求與資料傳輸限制。",
        "資料集規模、儲存、保留期限、存取控制與敏感資料需求。",
        "預計開始日期、預算範圍、驗收標準與團隊的維運責任。",
      ],
      evidenceLead: "下方公開記錄提供公司與容量脈絡。目前 API 可用性與專屬基礎設施提案分別呈現。",
    },
    heroLinks: [
      { label: "探索模型目錄", href: "/models" },
      { label: "討論您的專案", href: "/contact" },
    ],
    serviceTitle: "三種服務，對應不同階段的需求",
    serviceLead: "依應用需求與維運方式，選擇合適的服務入口。",
    deliverablesLabel: "可檢視的內容",
    accessLabel: "如何開始",
    services: [
      {
        id: "model-api", title: "模型 API", audience: "適合應用開發與 AI 團隊",
        description: "透過 Power Champion 閘道，讓產品串接推理、視覺、圖像、語音與檢索模型。",
        deliverables: ["包含模型 ID 與能力的模型目錄", "API 文件與請求範例", "公開定價與獨立的服務狀態頁"],
        access: "先比較模型與串接範例，再依文件所列方式存取 b300.powerchampion.ai。",
        link: { label: "閱讀 API 文件", href: "/docs" },
      },
      {
        id: "dedicated-gpu", title: "專屬 GPU", audience: "適合自行維運工作負載的團隊",
        description: "為需要獨立資源的模型服務、訓練作業或推論系統，討論專屬運算配置。",
        deliverables: ["工作負載與 GPU 配置評估", "明確範圍的運算、網路與儲存提案", "依專案定義的存取方式與驗收標準"],
        access: "提供工作負載需求，由審查流程確認配置、可用性與商業條件。",
        link: { label: "探索 GPU 基礎設施", href: "/infrastructure" },
      },
      {
        id: "custom-deployment", title: "客製部署", audience: "適合企業與基礎設施團隊",
        description: "依指定機房、網路、維運方式與資料處理要求，規劃部署方案。",
        deliverables: ["機房條件與整合需求評估", "建議部署架構與責任分工", "依專案訂定的驗證與交接計畫"],
        access: "提供技術限制、偏好地點與時程，開始部署方案討論。",
        link: { label: "討論客製部署", href: "/contact" },
      },
    ],
    workloadTitle: "先決定，您想打造什麼。",
    workloadLead: "從實際應用情境出發，對應 Power Champion 目錄中的模型，再組合成適合您的工作流程。",
    modelLabel: "可探索的模型",
    workloads: [
      { id: "applications", title: "AI 應用與代理", audience: "產品與工程團隊", description: "運用推理、工具呼叫與結構化回應，打造助理、程式開發工具與多步驟工作流程。", modelIds: ["glm-5.2-fp8"] },
      { id: "documents", title: "智慧文件處理", audience: "營運與知識管理團隊", description: "理解圖片、圖表與掃描頁面，擷取資訊供後續審閱與流程使用。", modelIds: ["qwen3-vl-30b"] },
      { id: "creative", title: "創意與音訊工作流程", audience: "內容與媒體團隊", description: "以適合的圖像或音訊模型產生視覺概念、轉錄錄音，並將文字轉為語音。", modelIds: ["flux-schnell", "chroma1-hd", "whisper-large-v3", "indextts2"] },
      { id: "retrieval", title: "搜尋與檢索增強生成", audience: "資料與平台團隊", description: "產生多語言嵌入向量，並為檢索結果重新排序，作為語意搜尋與 RAG 應用的基礎。", modelIds: ["bge-m3", "bge-reranker-v2-m3"] },
    ],
    catalogNote: "以上為目錄能力對應的應用範例。實際串接需求與目前可用性，請參閱模型詳情、API 文件與服務狀態。",
    catalogLink: "查看全部模型能力",
    nextGenerationPlatform: { category: "進階 AI 工作負載", platform: "NVIDIA HGX B300 / B200", useCase: "大型模型訓練與推論；實際配置依專案審查確認" },
    platformNote: "GPU 選型、記憶體、網路、儲存與部署可用性，皆依個別專案確認。平台概覽供評估討論使用，不構成容量承諾。",
    approachTitle: "從構想到串接，循序落實",
    approachLead: "從應用需求開始，再選擇能支援需求的模型與基礎設施範圍。",
    approach: [
      { title: "找到所需能力", description: "透過模型目錄，比較應用需要的任務、輸入類型、上下文視窗與模型功能。" },
      { title: "規劃串接方式", description: "檢視 API 範例與定價，定義預期用量、資料處理方式，以及先導測試需要確認的項目。" },
      { title: "評估專屬資源", description: "當需求需要專屬運算或客製部署時，將工作負載說明帶入基礎設施方案討論。" },
    ],
  },
};
