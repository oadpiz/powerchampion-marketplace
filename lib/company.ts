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
    date: string;
    summary: string;
  };
  capacity: {
    title: string;
    initialLabel: string;
    initialMw: string;
    initialReservation: string;
    depositContext: string;
    expansionLabel: string;
    expansion: string;
    potentialValue: string;
    qualification: string;
  };
  sourcesTitle: string;
  disclosure: string;
};

export const COMPANY_SOURCES = [
  {
    id: "azio-sec-exhibit",
    label: "Azio AI Holdings, Exhibit 99.2",
    href: "https://www.sec.gov/Archives/edgar/data/1563568/000143774926023245/ex_986809.htm",
    publishedOn: "2026-07-10",
    kind: "Counterparty SEC-filed disclosure",
  },
  {
    id: "bvi-directory",
    label: "i-BVI public company-directory listing",
    href: "https://i-bvi.com/company/power-champion-investment-limited_391718",
    publishedOn: "2018-07-03",
    kind: "Third-party public directory",
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
      date: "July 10, 2026",
      summary: "Azio AI Holdings announced the agreement in its SEC-filed Exhibit 99.2. The counterparty-reported information describes an AI infrastructure agreement and does not state that Power Champion has completed deployment or owns a data centre.",
    },
    capacity: {
      title: "Capacity context",
      initialLabel: "Counterparty-reported initial capacity and reservation context",
      initialMw: "3.1 MW",
      initialReservation: "US$27.9M",
      depositContext: "The counterparty reported receiving an initial deposit; this is not a statement that Power Champion received revenue.",
      expansionLabel: "Counterparty-reported expansion context",
      expansion: "Up to 12 MW",
      potentialValue: "Up to US$100M",
      qualification: "Potential; subject to conditions and not guaranteed.",
    },
    sourcesTitle: "Sources and disclosures",
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
      date: "2026 年 7 月 10 日",
      summary: "Azio AI Holdings 在其向 SEC 提交的 Exhibit 99.2 中公告了該協議。交易對手所報告的資訊描述一項 AI 基礎設施協議，並不表示 Power Champion 已完成部署或擁有資料中心。",
    },
    capacity: {
      title: "容量脈絡",
      initialLabel: "交易對手報告的初始容量及預留脈絡",
      initialMw: "3.1 MW",
      initialReservation: "US$27.9M",
      depositContext: "交易對手表示已收到初始訂金；這並非表示 Power Champion 已取得營收。",
      expansionLabel: "交易對手報告的擴充脈絡",
      expansion: "最高 12 MW",
      potentialValue: "最高 US$100M",
      qualification: "具潛在性；須符合條件，且不予保證。",
    },
    sourcesTitle: "資料來源與揭露",
    disclosure: "本資訊依據公開的第三方報告；並非證券要約、投資建議、績效指引，亦非容量或服務的承諾。",
  },
};
