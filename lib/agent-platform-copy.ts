import type { HomeLanguage } from "./home-copy";

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
  heroVisual: {
    label: string;
    brief: string;
    plan: string;
    material: string;
    deliverable: string;
    review: string;
  };
  capabilitiesEyebrow: string;
  capabilitiesTitle: string;
  capabilitiesLead: string;
  capabilities: Array<{ title: string; body: string }>;
  fileLabel: string;
  fileNote: string;
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
    title: ["Give your work", "a way forward."],
    lead: "Bring a question, a brief, or a set of figures. Let an agent work through the material and prepare something you can review, refine, and use.",
    taskCta: "Open Tasks",
    buildCta: "Create your agent",
    galleryCta: "Explore use cases",
    contactCta: "Discuss a custom agent",
    requirement: "Tasks require a signed-in account and your own customer API key. Check Tasks for current service availability.",
    pause: "Pause page motion",
    resume: "Resume page motion",
    heroVisual: {
      label: "Illustrative workflow",
      brief: "Prepare a decision brief",
      plan: "Read. Compare. Draft.",
      material: "Selected references + CSV",
      deliverable: "Decision brief",
      review: "Your review. Your next step.",
    },
    capabilitiesEyebrow: "BUILT AROUND THE WORK",
    capabilitiesTitle: "A useful result starts here.",
    capabilitiesLead: "Read the context. Find the pattern. Shape the deliverable. Follow the work as it takes form.",
    capabilities: [
      { title: "Make sense of your references", body: "Read selected reference material and bring the relevant details into focus." },
      { title: "Find the story in your CSV", body: "Analyze CSV data to help answer the question behind the numbers." },
      { title: "Read approved web sources", body: "Bring in information through limited reads of approved HTTPS sources." },
      { title: "See the plan take shape", body: "Follow the proposed steps and visible progress as the task moves forward." },
      { title: "Keep a hand on the direction", body: "Pause, add guidance, or cancel when the work needs a different course." },
      { title: "Take the result with you", body: "Review the output and download files you can use in your next step." },
    ],
    fileLabel: "FILES YOU CAN TAKE AWAY",
    fileNote: "Output formats: TXT, MD, CSV, JSON, and DOCX. Review the content before using or sharing it.",
    workflowEyebrow: "YOUR FIRST TASK",
    workflowTitle: "A clear path to something useful.",
    workflow: [
      { title: "Create your agent", body: "Open the agent builder. Define its purpose and the work you want it to help with." },
      { title: "Give it a task", body: "Open Tasks, check availability, and start with a clear brief. Follow progress and guide the work." },
      { title: "Review and take it forward", body: "Check the result, refine what needs attention, and download the files you need." },
    ],
    serviceEyebrow: "CUSTOM AGENT DEVELOPMENT",
    serviceTitle: "Built around your business.",
    serviceLead: "For work that depends on your company’s data and processes, we offer a separately scoped agent development service.",
    serviceItems: ["Define the job and the intended result", "Scope company data, connections, and permissions", "Agree on deployment and delivery"],
    serviceNote: "Data access, connections, permissions, and deployment are assessed and agreed for each project.",
    faqEyebrow: "A FEW THINGS TO KNOW",
    faqTitle: "Before your first task.",
    faqs: [
      { question: "What do I need to run a task?", answer: "Sign in to your account and use your own customer API key. Create an agent in the builder, then open Tasks to check current service availability and start your task." },
      { question: "What can an agent do today?", answer: "Read reference material, analyze CSV data, read approved HTTPS sources within defined limits, and prepare file outputs. Plans and progress are visible, and you can pause, steer, or cancel. Web access is limited reading; it does not provide general browser automation." },
      { question: "Can I download the results?", answer: "Yes. Tasks can produce downloadable TXT, MD, CSV, JSON, and DOCX files. These are output formats. Review the generated content before relying on it or sharing it." },
      { question: "Can you build an agent for our company?", answer: "Yes. Custom agent development is a separate service. We work with you to define the use case and agree on company data, connections, permissions, deployment, and delivery scope." },
    ],
    closingTitle: "Give your next task a direction.",
    closingLead: "Create an agent for the work ahead, or talk with us about one built for your business.",
  },
  "zh-Hant": {
    eyebrow: "POWER CHAMPION 智能體",
    title: ["讓手上的工作，", "有下一步。"],
    lead: "帶著問題、需求或一份數據開始。讓智能體梳理資料，準備一份你能審閱、修改並接著使用的成果。",
    taskCta: "開啟任務工作台",
    buildCta: "建立你的智能體",
    galleryCta: "探索應用情境",
    contactCta: "洽詢智能體客製服務",
    requirement: "執行任務需登入帳號，並使用自己的客戶 API 金鑰。服務目前是否可用，請查看任務工作台。",
    pause: "暫停頁面動態",
    resume: "繼續頁面動態",
    heroVisual: {
      label: "工作流程示意",
      brief: "準備一份決策摘要",
      plan: "閱讀、比較、起草",
      material: "選定的參考資料 + CSV",
      deliverable: "決策摘要",
      review: "由你審閱，由你決定下一步。",
    },
    capabilitiesEyebrow: "圍繞真正的工作",
    capabilitiesTitle: "從資料，到用得上的成果。",
    capabilitiesLead: "讀懂脈絡，找出重點，整理成文件。每一步，都能看見工作的進展。",
    capabilities: [
      { title: "梳理參考資料", body: "閱讀選定的參考內容，整理與任務相關的資訊。" },
      { title: "讀出 CSV 裡的線索", body: "分析 CSV 數據，協助回答數字背後的問題。" },
      { title: "閱讀核准的網頁來源", body: "在限定範圍內，讀取核准的 HTTPS 來源作為參考。" },
      { title: "看見計畫與進度", body: "查看規劃步驟與執行進展，掌握工作如何推進。" },
      { title: "隨時調整方向", body: "需要改變方向時，可以暫停、補充指示或取消任務。" },
      { title: "帶走可用的成果", body: "審閱結果、下載檔案，接著完成你手上的工作。" },
    ],
    fileLabel: "可以帶走的檔案",
    fileNote: "輸出格式：TXT、MD、CSV、JSON、DOCX。使用或分享前，請先審閱內容。",
    workflowEyebrow: "從第一個任務開始",
    workflowTitle: "讓成果，一步步成形。",
    workflow: [
      { title: "建立你的智能體", body: "開啟智能體建立頁，定義它的用途與要協助的工作。" },
      { title: "交付一個明確任務", body: "前往任務工作台，確認服務可用後提出需求，查看進度並適時補充指示。" },
      { title: "審閱、下載、接著用", body: "檢查結果，調整需要留意的內容，下載工作所需的檔案。" },
    ],
    serviceEyebrow: "智能體客製開發",
    serviceTitle: "從你的企業需求出發。",
    serviceLead: "當工作涉及公司資料與內部流程，我們提供另行規劃的智能體開發服務。",
    serviceItems: ["釐清工作目標與預期成果", "界定公司資料、串接與權限範圍", "確認部署與交付方式"],
    serviceNote: "資料存取、系統串接、權限與部署條件，皆依各專案評估並確認。",
    faqEyebrow: "開始前，先了解",
    faqTitle: "關於你的第一個任務。",
    faqs: [
      { question: "執行任務需要準備什麼？", answer: "需登入帳號，並使用自己的客戶 API 金鑰。先在建立頁設定智能體，再前往任務工作台確認目前的服務可用狀態並啟動任務。" },
      { question: "目前智能體可以做哪些工作？", answer: "可閱讀參考資料、分析 CSV、在限定範圍內讀取核准的 HTTPS 來源，並產出檔案。計畫與進度可見，也能暫停、補充指示或取消。網頁存取僅限讀取內容，不提供通用瀏覽器自動操作。" },
      { question: "完成的結果可以下載嗎？", answer: "可以。任務可產出 TXT、MD、CSV、JSON 與 DOCX 檔案供下載；這些是輸出格式。採用或分享產出內容前，請先審閱確認。" },
      { question: "可以為公司客製智能體嗎？", answer: "可以。客製開發為另行規劃的服務。我們會一起釐清應用需求，確認公司資料、系統串接、權限、部署方式與交付範圍。" },
    ],
    closingTitle: "讓下一份工作，有明確方向。",
    closingLead: "建立協助你工作的智能體，或與我們討論企業專屬的開發需求。",
  },
  "zh-Hans": {
    eyebrow: "POWER CHAMPION 智能体",
    title: ["让手上的工作，", "有下一步。"],
    lead: "带着问题、需求或一份数据开始。让智能体梳理资料，准备一份你能审阅、修改并继续使用的成果。",
    taskCta: "打开任务工作台",
    buildCta: "创建你的智能体",
    galleryCta: "探索应用场景",
    contactCta: "咨询智能体定制服务",
    requirement: "执行任务需登录账号，并使用自己的客户 API 密钥。服务当前是否可用，请查看任务工作台。",
    pause: "暂停页面动态",
    resume: "继续页面动态",
    heroVisual: {
      label: "工作流程示意",
      brief: "准备一份决策摘要",
      plan: "阅读、比较、起草",
      material: "选定的参考资料 + CSV",
      deliverable: "决策摘要",
      review: "由你审阅，由你决定下一步。",
    },
    capabilitiesEyebrow: "围绕真正的工作",
    capabilitiesTitle: "从资料，到用得上的成果。",
    capabilitiesLead: "读懂背景，找出重点，整理成文档。每一步，都能看见工作的进展。",
    capabilities: [
      { title: "梳理参考资料", body: "阅读选定的参考内容，整理与任务相关的信息。" },
      { title: "读出 CSV 里的线索", body: "分析 CSV 数据，帮助回答数字背后的问题。" },
      { title: "阅读获准的网页来源", body: "在限定范围内，读取获准的 HTTPS 来源作为参考。" },
      { title: "看见计划与进度", body: "查看规划步骤与执行进展，掌握工作如何推进。" },
      { title: "随时调整方向", body: "需要改变方向时，可以暂停、补充指示或取消任务。" },
      { title: "带走可用的成果", body: "审阅结果、下载文件，接着完成你手上的工作。" },
    ],
    fileLabel: "可以带走的文件",
    fileNote: "输出格式：TXT、MD、CSV、JSON、DOCX。使用或分享前，请先审阅内容。",
    workflowEyebrow: "从第一个任务开始",
    workflowTitle: "让成果，一步步成形。",
    workflow: [
      { title: "创建你的智能体", body: "打开智能体创建页，定义它的用途与要协助的工作。" },
      { title: "交付一个明确任务", body: "前往任务工作台，确认服务可用后提出需求，查看进度并适时补充指示。" },
      { title: "审阅、下载、接着用", body: "检查结果，调整需要留意的内容，下载工作所需的文件。" },
    ],
    serviceEyebrow: "智能体定制开发",
    serviceTitle: "从你的企业需求出发。",
    serviceLead: "当工作涉及公司数据与内部流程，我们提供单独规划的智能体开发服务。",
    serviceItems: ["明确工作目标与预期成果", "界定公司数据、系统连接与权限范围", "确认部署与交付方式"],
    serviceNote: "数据访问、系统连接、权限与部署条件，均按项目评估并确认。",
    faqEyebrow: "开始前，先了解",
    faqTitle: "关于你的第一个任务。",
    faqs: [
      { question: "执行任务需要准备什么？", answer: "需登录账号，并使用自己的客户 API 密钥。先在创建页设置智能体，再前往任务工作台确认当前的服务可用状态并启动任务。" },
      { question: "目前智能体可以做哪些工作？", answer: "可阅读参考资料、分析 CSV、在限定范围内读取获准的 HTTPS 来源，并生成文件。计划与进度可见，也能暂停、补充指示或取消。网页访问仅限读取内容，不提供通用浏览器自动操作。" },
      { question: "完成的结果可以下载吗？", answer: "可以。任务可生成 TXT、MD、CSV、JSON 与 DOCX 文件供下载；这些是输出格式。采用或分享生成的内容前，请先审阅确认。" },
      { question: "可以为公司定制智能体吗？", answer: "可以。定制开发是单独规划的服务。我们会一起明确应用需求，确认公司数据、系统连接、权限、部署方式与交付范围。" },
    ],
    closingTitle: "让下一份工作，有明确方向。",
    closingLead: "创建协助你工作的智能体，或与我们讨论企业专属的开发需求。",
  },
  ja: {
    eyebrow: "POWER CHAMPION AGENTS",
    title: ["その仕事に、", "次の一歩を。"],
    lead: "問いや要件、手元のデータから。エージェントが資料を読み解き、確認し、磨き、次に使える成果物へと整えます。",
    taskCta: "タスク画面を開く",
    buildCta: "エージェントを作成",
    galleryCta: "活用シーンを見る",
    contactCta: "カスタム開発を相談",
    requirement: "タスクの実行には、アカウントへのログインとご自身の顧客用 API キーが必要です。現在の提供状況はタスク画面で確認できます。",
    pause: "ページの動きを停止",
    resume: "ページの動きを再開",
    heroVisual: {
      label: "ワークフローのイメージ",
      brief: "意思決定のための要約を作成",
      plan: "読む。比較する。まとめる。",
      material: "選んだ参考資料 + CSV",
      deliverable: "検討用要約",
      review: "確認も、次の一歩も、あなたが。",
    },
    capabilitiesEyebrow: "日々の仕事のために",
    capabilitiesTitle: "役立つ成果は、ここから。",
    capabilitiesLead: "背景を読み、手がかりを見つけ、成果物にまとめる。その過程を、確かめながら進められます。",
    capabilities: [
      { title: "参考資料の要点をつかむ", body: "選んだ参考資料を読み、タスクに関わる情報を整理します。" },
      { title: "CSV から手がかりを探す", body: "CSV データを分析し、数字の背後にある問いを考える手助けをします。" },
      { title: "許可された情報源を読む", body: "許可された HTTPS の情報源を、定められた範囲で読み取ります。" },
      { title: "計画と進捗を確かめる", body: "作業の手順と進捗を見ながら、タスクの流れを把握できます。" },
      { title: "途中で方向を調整する", body: "必要に応じて、一時停止、指示の追加、キャンセルができます。" },
      { title: "成果を次の仕事へ", body: "結果を確認し、次の作業に使うファイルをダウンロードできます。" },
    ],
    fileLabel: "持ち帰れる成果物",
    fileNote: "出力形式：TXT、MD、CSV、JSON、DOCX。使用や共有の前に内容をご確認ください。",
    workflowEyebrow: "最初のタスクへ",
    workflowTitle: "成果までの道筋を、明確に。",
    workflow: [
      { title: "エージェントを作成する", body: "作成画面で、エージェントの目的と任せたい仕事を定めます。" },
      { title: "タスクを依頼する", body: "タスク画面で提供状況を確認し、要件を伝えて開始。進捗を見ながら指示を加えられます。" },
      { title: "確認して、次へつなげる", body: "結果を確かめ、必要な内容を整えて、使いたいファイルをダウンロードします。" },
    ],
    serviceEyebrow: "エージェントのカスタム開発",
    serviceTitle: "あなたの業務に合わせて。",
    serviceLead: "社内データや業務プロセスに関わる仕事には、個別に範囲を定めるエージェント開発サービスをご用意しています。",
    serviceItems: ["仕事の目的と期待する成果を整理", "社内データ、接続先、権限の範囲を検討", "導入方法と納品内容を合意"],
    serviceNote: "データへのアクセス、外部接続、権限、導入条件は、案件ごとに評価し合意します。",
    faqEyebrow: "はじめに知っておきたいこと",
    faqTitle: "最初のタスクの前に。",
    faqs: [
      { question: "タスクの実行には何が必要ですか？", answer: "アカウントへのログインと、ご自身の顧客用 API キーが必要です。作成画面でエージェントを用意し、タスク画面で現在の提供状況を確認してから開始してください。" },
      { question: "現在、どのような仕事ができますか？", answer: "参考資料の読み取り、CSV の分析、許可された HTTPS 情報源の限定的な読み取り、ファイルの作成に対応しています。計画と進捗を確認でき、一時停止、指示の追加、キャンセルも可能です。ウェブへのアクセスは読み取りに限られ、汎用的なブラウザー操作の自動化には対応していません。" },
      { question: "成果物はダウンロードできますか？", answer: "はい。TXT、MD、CSV、JSON、DOCX のファイルを作成し、ダウンロードできます。これらは出力形式です。内容を利用、共有する前にご確認ください。" },
      { question: "自社向けのエージェントを開発できますか？", answer: "はい。カスタム開発は別途ご相談いただくサービスです。用途を整理し、社内データ、接続先、権限、導入方法、納品範囲を個別に合意します。" },
    ],
    closingTitle: "次の仕事に、進む方向を。",
    closingLead: "仕事を支えるエージェントを作る。自社に合った開発について、私たちと話す。ここから始められます。",
  },
  ko: {
    eyebrow: "POWER CHAMPION AGENTS",
    title: ["지금 하는 일에,", "다음 한 걸음을."],
    lead: "질문이나 요구사항, 손에 든 데이터로 시작하세요. 에이전트가 자료를 살펴보고, 직접 검토하고 다듬어 활용할 수 있는 결과를 준비합니다.",
    taskCta: "작업 화면 열기",
    buildCta: "에이전트 만들기",
    galleryCta: "활용 사례 살펴보기",
    contactCta: "맞춤 에이전트 상담",
    requirement: "작업을 실행하려면 계정에 로그인하고 본인의 고객용 API 키를 사용해야 합니다. 현재 서비스 이용 가능 여부는 작업 화면에서 확인하세요.",
    pause: "페이지 움직임 일시 정지",
    resume: "페이지 움직임 다시 시작",
    heroVisual: {
      label: "설명을 위한 작업 흐름",
      brief: "의사결정을 위한 요약 작성",
      plan: "읽고, 비교하고, 정리하기",
      material: "선택한 참고 자료 + CSV",
      deliverable: "검토용 요약",
      review: "검토도, 다음 단계도 직접.",
    },
    capabilitiesEyebrow: "실제 업무를 중심으로",
    capabilitiesTitle: "쓸 수 있는 결과는 여기서부터.",
    capabilitiesLead: "맥락을 읽고, 단서를 찾고, 결과물로 정리합니다. 만들어지는 과정을 보며 함께 방향을 잡으세요.",
    capabilities: [
      { title: "참고 자료의 핵심 파악", body: "선택한 참고 자료를 읽고 작업에 필요한 정보를 정리합니다." },
      { title: "CSV에서 단서 찾기", body: "CSV 데이터를 분석해 숫자 뒤에 있는 질문에 답하도록 돕습니다." },
      { title: "승인된 웹 자료 읽기", body: "승인된 HTTPS 자료를 정해진 범위 안에서 읽어 참고합니다." },
      { title: "계획과 진행 상황 확인", body: "계획된 단계와 진행 상황을 보며 작업의 흐름을 파악할 수 있습니다." },
      { title: "필요할 때 방향 조정", body: "작업을 일시 정지하거나 지시를 추가하고, 취소할 수 있습니다." },
      { title: "결과를 다음 업무로", body: "결과를 검토하고 다음 단계에 필요한 파일을 다운로드하세요." },
    ],
    fileLabel: "가져갈 수 있는 결과물",
    fileNote: "출력 형식: TXT, MD, CSV, JSON, DOCX. 사용하거나 공유하기 전에 내용을 검토하세요.",
    workflowEyebrow: "첫 작업 시작하기",
    workflowTitle: "유용한 결과까지, 한 단계씩.",
    workflow: [
      { title: "에이전트 만들기", body: "에이전트 만들기 화면에서 목적과 도움받고 싶은 업무를 정하세요." },
      { title: "명확한 작업 맡기기", body: "작업 화면에서 서비스 이용 가능 여부를 확인하고 요구사항을 전달하세요. 진행 상황을 보며 방향을 안내할 수 있습니다." },
      { title: "검토하고 다음 단계로", body: "결과를 확인하고 필요한 부분을 다듬은 뒤, 사용할 파일을 다운로드하세요." },
    ],
    serviceEyebrow: "맞춤 에이전트 개발",
    serviceTitle: "당신의 업무에 맞추어.",
    serviceLead: "회사 데이터와 내부 업무 절차를 다루는 일에는, 범위를 별도로 협의하는 에이전트 개발 서비스를 제공합니다.",
    serviceItems: ["업무 목표와 기대하는 결과 정의", "회사 데이터, 연결, 권한 범위 검토", "배포 방식과 제공 범위 협의"],
    serviceNote: "데이터 접근, 시스템 연결, 권한, 배포 조건은 프로젝트마다 검토하고 합의합니다.",
    faqEyebrow: "시작하기 전에",
    faqTitle: "첫 작업을 위한 안내.",
    faqs: [
      { question: "작업을 실행하려면 무엇이 필요한가요?", answer: "계정에 로그인하고 본인의 고객용 API 키를 사용해야 합니다. 만들기 화면에서 에이전트를 생성한 뒤, 작업 화면에서 현재 서비스 이용 가능 여부를 확인하고 시작하세요." },
      { question: "현재 어떤 업무를 할 수 있나요?", answer: "참고 자료 읽기, CSV 분석, 승인된 HTTPS 자료의 제한적인 읽기, 파일 생성이 가능합니다. 계획과 진행 상황을 확인하고 일시 정지, 지시 추가, 취소를 할 수 있습니다. 웹 접근은 자료 읽기로 한정되며, 범용 브라우저 자동화는 제공하지 않습니다." },
      { question: "결과를 다운로드할 수 있나요?", answer: "네. 작업에서 TXT, MD, CSV, JSON, DOCX 파일을 생성하고 다운로드할 수 있습니다. 이 목록은 출력 형식입니다. 결과를 사용하거나 공유하기 전에 내용을 검토하세요." },
      { question: "회사에 맞는 에이전트도 개발할 수 있나요?", answer: "네. 맞춤 개발은 별도로 협의하는 서비스입니다. 활용 목적을 정하고 회사 데이터, 시스템 연결, 권한, 배포 방식, 제공 범위를 함께 합의합니다." },
    ],
    closingTitle: "다음 업무에 방향을 더하세요.",
    closingLead: "업무를 도울 에이전트를 만들거나, 회사에 맞춘 개발을 함께 논의하세요.",
  },
};
