import type { Locale } from "./content";

export const COMPANY_CAPACITY_MW = "3.1 MW";

export type CompanyLocale = "en" | "zh";

export type CompanyContent = {
  kicker: string;
  title: string;
  lead: string;
  record: {
    heading: string;
    name: string;
    directoryQualification: string;
  };
  announcement: {
    heading: string;
    dateTime: string;
    date: string;
    summary: string;
  };
  capacity: {
    title: string;
    initialLabel: string;
    initialMw: string;
    initialReservation: string;
    depositLabel: string;
    depositContext: string;
    expansionLabel: string;
    expansion: string;
    potentialValue: string;
    qualification: string;
  };
  services: {
    title: string;
    lead: string;
    items: { title: string; description: string }[];
  };
  gpuPlatforms: {
    title: string;
    lead: string;
    headers: { category: string; platform: string; useCase: string };
    rows: { category: string; platform: string; useCase: string }[];
    note: string;
  };
  deploymentModels: {
    title: string;
    lead: string;
    items: { title: string; description: string }[];
  };
  contact: {
    title: string;
    addressLabel: string;
    address: string;
    phoneLabel: string;
    phone: string;
    emailLabel: string;
    email: string;
    apiLabel: string;
    apiLink: string;
  };
  identity: {
    title: string;
    founded: string;
    websiteBy: string;
  };
  partners: {
    title: string;
    items: { name: string; description: string; phone: string; email: string; href: string }[];
  };
  home: {
    heading: string;
    context: string;
    linkLabel: string;
  };
  sources: {
    title: string;
    typeLabel: string;
  };
  related: {
    title: string;
    infrastructureLink: string;
    deploymentReviewLink: string;
  };
  disclosure: string;
};

export const COMPANY_SOURCES = [
  {
    id: "azio-sec-exhibit",
    href: "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986209.htm",
    dateTime: "2026-07-09",
    copy: {
      en: {
        label: "Azio AI Holdings, Exhibit 99.1",
        kind: "Counterparty SEC-filed disclosure",
        dateLabel: "Publication date",
        date: "July 9, 2026",
      },
      zh: {
        label: "Azio AI Holdings，附件 99.1",
        kind: "交易對手向 SEC 提交的揭露",
        dateLabel: "發布日期",
        date: "2026 年 7 月 9 日",
      },
    },
  },
  {
    id: "bvi-directory",
    href: "https://i-bvi.com/company/power-champion-investment-limited_391718",
    dateTime: "2018-07-03",
    copy: {
      en: {
        label: "i-BVI public company-directory listing",
        kind: "Third-party public directory",
        dateLabel: "Registration date shown by directory",
        date: "July 3, 2018",
      },
      zh: {
        label: "i-BVI 公開公司目錄列表",
        kind: "第三方公開公司目錄",
        dateLabel: "目錄所列登記日期",
        date: "2018 年 7 月 3 日",
      },
    },
  },
] as const;

export const COMPANY_CONTENT: Record<CompanyLocale, CompanyContent> & Record<Locale, CompanyContent> = {
  en: {
    kicker: "Public company context",
    title: "Infrastructure, made accountable.",
    lead: "A bounded public record of company context and an AI infrastructure agreement announced by the counterparty.",
    record: {
      heading: "Company record",
      name: "Power Champion Investment Limited",
      directoryQualification: "Referenced in an i-BVI public company-directory listing. This third-party listing is not an official registry and does not establish regulatory approval, ownership, leadership, an office address, or good standing.",
    },
    announcement: {
      heading: "Counterparty infrastructure announcement",
      dateTime: "2026-07-09",
      date: "July 9, 2026",
      summary: "Azio AI Holdings announced the agreement in its SEC-filed Exhibit 99.1. The counterparty-reported information describes expected hosting capacity and potential expansion; it does not state that Power Champion has completed deployment or owns a data centre.",
    },
    capacity: {
      title: "Capacity context",
      initialLabel: "Counterparty-reported expected initial capacity and reservation context",
      initialMw: `Approximately ${COMPANY_CAPACITY_MW}`,
      initialReservation: "Approximately US$27.9M over the initial contract term",
      depositLabel: "Counterparty-reported initial deposit context",
      depositContext: "The counterparty reported receiving an initial deposit; this is not a statement that Power Champion received revenue.",
      expansionLabel: "Counterparty-reported expansion context",
      expansion: "Up to 12 MW if expansion rights are exercised",
      potentialValue: "Approximately US$100M potential total contract value",
      qualification: "Counterparty-reported expectations and estimates; expansion is subject to future customer requirements, site availability, infrastructure readiness, and the agreement terms. No assurance can be given that expansion rights will be exercised or additional capacity deployed.",
    },
    services: {
      title: "What we do",
      lead: "From serverless GPU compute to dedicated bare-metal clusters — infrastructure built for AI workloads at every scale.",
      items: [
        { title: "Serverless GPU Compute", description: "Scale GPU workers from 0 to 1000+ in seconds. Pay per use, no lock-in. Built for inference, training, and batch processing." },
        { title: "Always-On GPUs", description: "Dedicated GPU instances for uninterrupted execution. Ideal for production APIs, long-running training, and real-time inference." },
        { title: "S3-Compatible Storage", description: "Run full AI pipelines — data ingestion to deployment — without egress fees. High-throughput object storage integrated with compute." },
        { title: "Model Training", description: "Distributed training for trillion-parameter models with optimal GPU-to-GPU communication via InfiniBand fabric." },
        { title: "Enterprise Clusters", description: "Dedicated NVIDIA HGX clusters with flexible deployment options for large-scale AI training, inference, and HPC workloads." },
      ],
    },
    gpuPlatforms: {
      title: "GPU platforms",
      lead: "A comprehensive portfolio of NVIDIA data center GPUs to meet different performance, memory, and cost requirements.",
      headers: { category: "Category", platform: "Platform", useCase: "Best for" },
      rows: [
        { category: "Enterprise AI Training", platform: "NVIDIA H100 / H200", useCase: "Large-scale LLM training, multi-node inference" },
        { category: "Memory-Intensive AI & HPC", platform: "NVIDIA HGX H200", useCase: "Large context windows, memory-bound workloads" },
        { category: "Cost-Efficient AI Workloads", platform: "NVIDIA L40S / A100", useCase: "Inference, fine-tuning, cost-optimized pipelines" },
      ],
      note: "All GPU clusters are built on NVIDIA HGX reference architecture with 400G/800G InfiniBand networking, ensuring optimal GPU-to-GPU communication, system stability, and scalability.",
    },
    deploymentModels: {
      title: "Deployment models",
      lead: "Flexible deployment and commercial models tailored to enterprise requirements.",
      items: [
        { title: "Bare-Metal Deployment", description: "Single-tenant dedicated infrastructure with physical isolation for predictable performance." },
        { title: "Isolated Enterprise Clusters", description: "Dedicated clusters for enterprise projects with full performance isolation and security." },
        { title: "Custom IDC Deployment", description: "Deploy in customer-specified data centers or co-location facilities with full control." },
      ],
    },
    contact: {
      title: "Contact",
      addressLabel: "Address",
      address: "7F, No. 38-1, Section 1, Ren'ai Rd, Zhongzheng District, Taipei City 100, Taiwan",
      phoneLabel: "Tel",
      phone: "+886 2 2396 0605",
      emailLabel: "Email",
      email: "info@powerchampion.org",
      apiLabel: "API",
      apiLink: "b300.powerchampion.ai",
    },
    identity: {
      title: "Company identity",
      founded: "Founded 2018 · Taipei City, Taiwan",
      websiteBy: "Website by 一點子創意工作室 (CatchATW)",
    },
    partners: {
      title: "Technology partners",
      items: [
        { name: "Albatron Technology Co. Ltd.", description: "Supermicro servers, NVIDIA GPU systems, and Micron storage solutions.", phone: "+886-2-8227-3277", email: "sales@albatron.com.tw", href: "https://www.albatron.com.tw" },
      ],
    },
    home: {
      heading: "Infrastructure context from counterparty disclosure",
      context: "Counterparty-reported expected contracted hosting capacity; not live or completed deployment.",
      linkLabel: "View company context",
    },
    sources: {
      title: "Sources and disclosures",
      typeLabel: "Source type",
    },
    related: {
      title: "Related enterprise paths",
      infrastructureLink: "Review infrastructure",
      deploymentReviewLink: "Start deployment review",
    },
    disclosure: "This information is based on public third-party reporting. It is not an offer of securities, investment advice, performance guidance, or a promise of capacity or service.",
  },
  zh: {
    kicker: "公開公司脈絡",
    title: "基礎設施，以可查證資訊呈現。",
    lead: "此為範圍受限的公開公司脈絡，以及由交易對手公告的 AI 基礎設施協議資訊。",
    record: {
      heading: "公司記錄",
      name: "Power Champion Investment Limited",
      directoryQualification: "該公司見於 i-BVI 公開公司目錄列表。此第三方列表並非官方登記機構，亦不代表監管核准、所有權、領導階層、辦公地址或良好存續狀態。",
    },
    announcement: {
      heading: "交易對手的基礎設施公告",
      dateTime: "2026-07-09",
      date: "2026 年 7 月 9 日",
      summary: "Azio AI Holdings 在其向 SEC 提交的附件 99.1 中公告了該協議。交易對手所報告的資訊描述預期託管容量及潛在擴充；並不表示 Power Champion 已完成部署或擁有資料中心。",
    },
    capacity: {
      title: "容量脈絡",
      initialLabel: "交易對手報告的預期初始容量及預留脈絡",
      initialMw: `約 ${COMPANY_CAPACITY_MW}`,
      initialReservation: "初始合約期間約 US$27.9M",
      depositLabel: "交易對手報告的初始訂金脈絡",
      depositContext: "交易對手表示已收到初始訂金；這並非表示 Power Champion 已取得營收。",
      expansionLabel: "交易對手報告的擴充脈絡",
      expansion: "若行使擴充權，最高可達 12 MW",
      potentialValue: "潛在合約總值約 US$100M",
      qualification: "以上為交易對手報告的預期與估算；擴充須視未來客戶需求、場地可用性、基礎設施就緒程度及協議條款而定；不保證擴充權會被行使或增加容量。",
    },
    services: {
      title: "業務概覽",
      lead: "從 Serverless GPU 運算到專屬裸機叢集——為各種規模的 AI 工作負載打造的基礎設施。",
      items: [
        { title: "Serverless GPU 運算", description: "數秒內將 GPU 工作節點從 0 擴展到 1000+。按量計費，無綁定。適用於推論、訓練與批次處理。" },
        { title: "常駐 GPU", description: "專屬 GPU 實例，確保不間斷執行。適用於正式 API、長時間訓練與即時推論。" },
        { title: "S3 相容儲存", description: "從資料擷取到部署，完整 AI 管線無出口流量費。與運算整合的高吞吐物件儲存。" },
        { title: "模型訓練", description: "透過 InfiniBand 架構實現最佳 GPU 間通訊，支援兆級參數模型的分散式訓練。" },
        { title: "企業叢集", description: "專屬 NVIDIA HGX 叢集，提供大規模 AI 訓練、推論與 HPC 工作負載的彈性部署方案。" },
      ],
    },
    gpuPlatforms: {
      title: "GPU 平台",
      lead: "涵蓋各種效能、記憶體與成本需求的 NVIDIA 資料中心 GPU 產品組合。",
      headers: { category: "類別", platform: "平台", useCase: "適用場景" },
      rows: [
        { category: "企業 AI 訓練", platform: "NVIDIA H100 / H200", useCase: "大規模 LLM 訓練、多節點推論" },
        { category: "記憶體密集 AI 與 HPC", platform: "NVIDIA HGX H200", useCase: "大型上下文視窗、記憶體受限工作負載" },
        { category: "成本效率 AI 工作負載", platform: "NVIDIA L40S / A100", useCase: "推論、微調、成本最佳化管線" },
      ],
      note: "所有 GPU 叢集基於 NVIDIA HGX 參考架構，配備 400G/800G InfiniBand 網路，確保最佳 GPU 間通訊、系統穩定性與擴充性。",
    },
    deploymentModels: {
      title: "部署模式",
      lead: "依企業需求量身打造的彈性部署與商業模式。",
      items: [
        { title: "裸機部署", description: "單租戶專屬基礎設施，實體隔離，效能可預測。" },
        { title: "企業隔離叢集", description: "為企業專案提供專屬叢集，完整效能隔離與安全性。" },
        { title: "客製 IDC 部署", description: "在客戶指定的資料中心或共置設施部署，完全掌控。" },
      ],
    },
    contact: {
      title: "聯絡資訊",
      addressLabel: "地址",
      address: "100 台北市中正區仁愛路一段 38-1 號 7 樓",
      phoneLabel: "電話",
      phone: "+886 2 2396 0605",
      emailLabel: "Email",
      email: "info@powerchampion.org",
      apiLabel: "API",
      apiLink: "b300.powerchampion.ai",
    },
    identity: {
      title: "公司資訊",
      founded: "成立於 2018 · 台灣台北市",
      websiteBy: "網站由一點子創意工作室（CatchATW）製作",
    },
    partners: {
      title: "技術合作夥伴",
      items: [
        { name: "Albatron Technology Co. Ltd.", description: "Supermicro 伺服器、NVIDIA GPU 系統與 Micron 儲存方案。", phone: "+886-2-8227-3277", email: "sales@albatron.com.tw", href: "https://www.albatron.com.tw" },
      ],
    },
    home: {
      heading: "交易對手揭露的基礎設施脈絡",
      context: "交易對手報告的預期合約託管容量；並非即時或已完成部署的容量。",
      linkLabel: "查看公司脈絡",
    },
    sources: {
      title: "資料來源與揭露",
      typeLabel: "來源類型",
    },
    related: {
      title: "相關企業路徑",
      infrastructureLink: "檢視基礎設施",
      deploymentReviewLink: "開始部署審查",
    },
    disclosure: "本資訊依據公開的第三方報告；並非證券要約、投資建議、績效指引，亦非容量或服務的承諾。",
  },
};
