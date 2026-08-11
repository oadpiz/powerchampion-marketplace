import type { Locale } from "./content";

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
  home: {
    heading: string;
    context: string;
    linkLabel: string;
  };
  sources: {
    title: string;
    typeLabel: string;
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
      initialMw: "Approximately 3.1 MW",
      initialReservation: "Approximately US$27.9M over the initial contract term",
      depositLabel: "Counterparty-reported initial deposit context",
      depositContext: "The counterparty reported receiving an initial deposit; this is not a statement that Power Champion received revenue.",
      expansionLabel: "Counterparty-reported expansion context",
      expansion: "Up to 12 MW if expansion rights are exercised",
      potentialValue: "Approximately US$100M potential total contract value",
      qualification: "Counterparty-reported expectations and estimates; expansion is subject to future customer requirements, site availability, infrastructure readiness, and the agreement terms. No assurance can be given that expansion rights will be exercised or additional capacity deployed.",
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
      initialMw: "約 3.1 MW",
      initialReservation: "初始合約期間約 US$27.9M",
      depositLabel: "交易對手報告的初始訂金脈絡",
      depositContext: "交易對手表示已收到初始訂金；這並非表示 Power Champion 已取得營收。",
      expansionLabel: "交易對手報告的擴充脈絡",
      expansion: "若行使擴充權，最高可達 12 MW",
      potentialValue: "潛在合約總值約 US$100M",
      qualification: "以上為交易對手報告的預期與估算；擴充須視未來客戶需求、場地可用性、基礎設施就緒程度及協議條款而定；不保證擴充權會被行使或增加容量。",
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
    disclosure: "本資訊依據公開的第三方報告；並非證券要約、投資建議、績效指引，亦非容量或服務的承諾。",
  },
};
