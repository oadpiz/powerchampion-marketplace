import type { InternationalLanguage } from "./languages";

export type StoryLanguage = InternationalLanguage | "en";
export const APPLICATION_METADATA = [
  { id: "assistants", symbol: "↗", models: ["glm-5.2-fp8"] },
  { id: "documents", symbol: "◈", models: ["qwen3-vl-30b"] },
  {
    id: "creative",
    symbol: "✳",
    models: ["flux-schnell", "whisper-large-v3", "indextts2"],
  },
  { id: "knowledge", symbol: "⌘", models: ["bge-m3", "bge-reranker-v2-m3"] },
] as const;
export type ApplicationId = (typeof APPLICATION_METADATA)[number]["id"];

type ApplicationCopy = {
  label: string;
  title: string;
  description: string;
  audience: string;
  input: string;
  output: string;
  capability: string;
};
type TextPair = readonly [string, string];
type StoryCopy = {
  applications: Record<ApplicationId, ApplicationCopy>;
  applicationIntro: string;
  applicationHeading: TextPair;
  applicationAside: string;
  exploreApplications: string;
  input: string;
  output: string;
  exploreModels: string;
  disclaimer: string;
  serviceIntro: string;
  serviceHeading: TextPair;
  serviceAside: string;
  pricingLink: string;
  inclusionsTitle: string;
  inclusions: readonly TextPair[];
  requestAccess: string;
  checkBalance: string;
  illustration: string;
  starterPack: string;
  creditAmount: string;
  selectModel: string;
  inputTokens: string;
  outputTokens: string;
  exampleCost: string;
  exampleNote: string;
  gettingStarted: string;
  steps: readonly TextPair[];
};

export const PLATFORM_STORY_COPY: Record<StoryLanguage, StoryCopy> = {
  en: {
    applicationIntro: "FROM MODELS TO YOUR PRODUCT",
    applicationHeading: ["Your next product.", "More possibilities."],
    applicationAside:
      "From a developer’s first prototype to the tools a team uses every day. Start with the task, then find the right model.",
    exploreApplications: "Explore applications",
    input: "INPUT",
    output: "OUTPUT",
    exploreModels: "EXPLORE THE MODELS",
    disclaimer:
      "Illustrative application patterns. Integration is required; see the documentation and service status for supported capabilities and availability.",
    applications: {
      assistants: {
        label: "Intelligent assistants",
        title: "Turn a conversation into progress.",
        description:
          "Build product assistants, draft content, and help teams work through complex questions. Connect a reasoning model to the context and tools in your own application.",
        audience: "SaaS teams · Product developers · Internal tools",
        input: "A question + your context",
        output: "A useful, structured response",
        capability: "REASONING & LANGUAGE",
      },
      documents: {
        label: "Document intelligence",
        title: "Give your application a new perspective.",
        description:
          "Interpret images, explore visual details, and make document workflows more useful. Bring visual understanding into review tools, research products, and knowledge applications.",
        audience: "Knowledge teams · Research tools · Operations",
        input: "An image + a question",
        output: "Description, context, understanding",
        capability: "VISION & LANGUAGE",
      },
      creative: {
        label: "Creative & voice tools",
        title: "Move beyond the text box.",
        description:
          "Generate visual concepts, turn recordings into text, or bring written content to life with speech. Select a purpose-built image or audio model for each part of your workflow.",
        audience: "Creative studios · Content platforms · Voice products",
        input: "A prompt, recording, or script",
        output: "An image, transcript, or voice",
        capability: "IMAGE & AUDIO",
      },
      knowledge: {
        label: "Search & knowledge",
        title: "Find the context that matters.",
        description:
          "Build semantic search and retrieval pipelines with embeddings and reranking. Pair retrieved passages with a language model in your application to create a knowledge assistant.",
        audience: "Enterprise search · RAG applications · Knowledge bases",
        input: "Your documents + a query",
        output: "Relevant, ranked passages",
        capability: "EMBEDDINGS & RERANKING",
      },
    },
    serviceIntro: "CLEAR SERVICE. CLEAR PRICING.",
    serviceHeading: ["Know what you’re buying.", "Make every call count."],
    serviceAside:
      "Plan credit for hosted model API usage. Start with a small experiment and discuss funding with our team as your product takes shape.",
    pricingLink: "View all rates & credit packs",
    inclusionsTitle: "YOUR MODEL API SERVICE",
    inclusions: [
      [
        "Access to a curated model catalog",
        "A customer-specific API key for supported text, vision, image, speech, and retrieval endpoints. Availability depends on the selected model and gateway.",
      ],
      [
        "Prepaid usage, with manual funding",
        "Review published usage rates and submit a credit request for manual review. Request approval does not process payment or automatically add gateway balance.",
      ],
      [
        "Documentation and integration support",
        "Model IDs, request examples, and endpoint guidance. Talk to our team when your application needs a more tailored setup.",
      ],
    ],
    requestAccess: "Request model API access",
    checkBalance: "Check API balance",
    illustration: "A USAGE ILLUSTRATION",
    starterPack: "Starter credit pack",
    creditAmount: "US${amount} in API credit",
    selectModel: "Select a model to see an example",
    inputTokens: "1,000,000 input tokens",
    outputTokens: "250,000 output tokens",
    exampleCost: "Example usage cost",
    exampleNote:
      "Calculated from published rates, not a live account balance. Actual cost depends on model and usage; images and audio have separate billing units.",
    gettingStarted: "FROM REQUEST TO FIRST CALL",
    steps: [
      [
        "Request access",
        "Share your use case and expected volume. Confirm API key access with our team.",
      ],
      [
        "Arrange API credit",
        "Choose a published pack and submit a credit request. Funding is confirmed manually.",
      ],
      [
        "Connect a model",
        "Set your endpoint and model ID, check service status, and make a documented API request.",
      ],
      [
        "Check and refill",
        "Check your available balance and contact the team to arrange additional credit.",
      ],
    ],
  },
  "zh-Hant": {
    applicationIntro: "從模型，到你的產品",
    applicationHeading: ["你的下一個產品，", "可以做到更多。"],
    applicationAside:
      "從開發者的第一個原型，到團隊每天使用的工具。依照實際任務，找到合適的模型能力。",
    exploreApplications: "探索應用情境",
    input: "輸入",
    output: "輸出",
    exploreModels: "探索相關模型",
    disclaimer:
      "以上為應用流程示意。需自行整合應用程式；各模型的支援功能與可用狀態，請參考文件及服務狀態頁。",
    applications: {
      assistants: {
        label: "智慧助理",
        title: "讓每次對話，都帶來進展。",
        description:
          "打造產品助理、草擬內容，協助團隊拆解複雜問題。將推理模型接入應用程式中的資料與工具，完成你的產品流程。",
        audience: "SaaS 團隊 · 產品開發者 · 內部工具",
        input: "問題與應用情境",
        output: "實用、有條理的回應",
        capability: "推理與語言",
      },
      documents: {
        label: "文件理解",
        title: "讓應用程式，看懂更多。",
        description:
          "理解影像、辨識視覺細節，改善文件處理流程。將視覺理解能力導入審閱工具、研究產品與知識應用。",
        audience: "知識團隊 · 研究工具 · 營運流程",
        input: "影像與提問",
        output: "描述、脈絡與理解",
        capability: "視覺與語言",
      },
      creative: {
        label: "創作與語音",
        title: "創作，不只是一段文字。",
        description:
          "生成視覺概念、將錄音轉成文字，或讓書面內容開口說話。依流程需要，選用專門的圖像或音訊模型。",
        audience: "創意工作室 · 內容平台 · 語音產品",
        input: "提示詞、錄音或腳本",
        output: "圖片、逐字稿或語音",
        capability: "圖像與音訊",
      },
      knowledge: {
        label: "搜尋與知識",
        title: "找到真正相關的資訊。",
        description:
          "以向量嵌入與重排序，建立語意搜尋及檢索流程。在你的應用程式中，將檢索內容交給語言模型，打造知識助理。",
        audience: "企業搜尋 · RAG 應用 · 知識庫",
        input: "文件與搜尋問題",
        output: "依相關性排序的內容",
        capability: "向量嵌入與重排序",
      },
    },
    serviceIntro: "清楚的服務，透明的計費",
    serviceHeading: ["知道你買什麼。", "掌握每次使用。"],
    serviceAside:
      "規劃託管模型 API 的使用額度，從小額測試開始，隨產品需求與團隊確認加值方式。",
    pricingLink: "查看所有費率與儲值方案",
    inclusionsTitle: "模型 API 服務包含",
    inclusions: [
      [
        "精選模型存取",
        "以客戶專屬 API 金鑰，使用支援的文字、視覺、圖像、語音與檢索端點。可用性依所選模型與閘道狀態而定。",
      ],
      [
        "預付用量，人工確認加值",
        "查看已刊登的用量費率，並提出儲值申請供人工審核。核准申請不會處理付款，也不會自動增加閘道餘額。",
      ],
      [
        "文件與整合支援",
        "提供模型識別碼、範例請求與端點說明；有特殊需求可直接與團隊討論。",
      ],
    ],
    requestAccess: "申請模型 API",
    checkBalance: "查詢 API 餘額",
    illustration: "使用費用試算",
    starterPack: "入門儲值方案",
    creditAmount: "取得 US${amount} API 額度",
    selectModel: "選擇模型查看範例",
    inputTokens: "1,000,000 個輸入 Token",
    outputTokens: "250,000 個輸出 Token",
    exampleCost: "範例使用費用",
    exampleNote:
      "依已刊登費率試算，並非即時帳戶資料。實際費用取決於模型與用量；圖像、音訊採各自的計費單位。",
    gettingStarted: "從申請到第一次呼叫",
    steps: [
      ["申請存取", "提供用途與預估用量，與團隊確認 API 金鑰使用權限。"],
      ["安排 API 額度", "選擇已刊登方案並提出儲值申請，加值由團隊人工確認。"],
      ["串接模型", "設定端點與模型 ID，確認服務狀態，再依文件送出請求。"],
      ["查看並補充餘額", "查詢可用金額，並聯絡團隊安排補充額度。"],
    ],
  },
  "zh-Hans": {
    applicationIntro: "从模型，到你的产品",
    applicationHeading: ["你的下一个产品，", "可以做到更多。"],
    applicationAside:
      "从开发者的第一个原型，到团队每天使用的工具。根据实际任务，找到合适的模型能力。",
    exploreApplications: "探索应用场景",
    input: "输入",
    output: "输出",
    exploreModels: "探索相关模型",
    disclaimer:
      "以上为应用流程示意，需要自行集成应用程序。各模型支持的功能与可用状态，请参考文档及服务状态页。",
    applications: {
      assistants: {
        label: "智能助手",
        title: "让每次对话，都带来进展。",
        description:
          "打造产品助手、起草内容，帮助团队拆解复杂问题。将推理模型接入应用程序中的数据与工具，完成你的产品流程。",
        audience: "SaaS 团队 · 产品开发者 · 内部工具",
        input: "问题与应用背景",
        output: "实用、有条理的回复",
        capability: "推理与语言",
      },
      documents: {
        label: "文档理解",
        title: "让应用程序，看懂更多。",
        description:
          "理解图像、识别视觉细节，改善文档处理流程。将视觉理解能力引入审阅工具、研究产品与知识应用。",
        audience: "知识团队 · 研究工具 · 运营流程",
        input: "图像与问题",
        output: "描述、背景与理解",
        capability: "视觉与语言",
      },
      creative: {
        label: "创作与语音",
        title: "创作，不只是一段文字。",
        description:
          "生成视觉创意、将录音转成文字，或让书面内容开口说话。根据流程需要，选择专门的图像或音频模型。",
        audience: "创意工作室 · 内容平台 · 语音产品",
        input: "提示词、录音或脚本",
        output: "图片、转写文本或语音",
        capability: "图像与音频",
      },
      knowledge: {
        label: "搜索与知识",
        title: "找到真正相关的信息。",
        description:
          "通过向量嵌入与重排序，建立语义搜索及检索流程。在你的应用程序中，将检索内容交给语言模型，打造知识助手。",
        audience: "企业搜索 · RAG 应用 · 知识库",
        input: "文档与搜索问题",
        output: "按相关性排序的内容",
        capability: "向量嵌入与重排序",
      },
    },
    serviceIntro: "清楚的服务，透明的计费",
    serviceHeading: ["知道你买什么。", "掌握每次使用。"],
    serviceAside:
      "规划托管模型 API 的使用额度，从小规模测试开始，随着产品需求与团队确认充值方式。",
    pricingLink: "查看所有费率与充值方案",
    inclusionsTitle: "模型 API 服务包含",
    inclusions: [
      [
        "精选模型访问",
        "使用客户专属 API 密钥访问支持的文本、视觉、图像、语音与检索端点。可用性取决于所选模型与网关状态。",
      ],
      [
        "预付用量，人工确认充值",
        "查看已公布的用量费率，并提交充值申请供人工审核。批准申请不会处理付款，也不会自动增加网关余额。",
      ],
      [
        "文档与集成支持",
        "提供模型标识、请求示例与端点说明；如有特殊需求，可直接与团队讨论。",
      ],
    ],
    requestAccess: "申请模型 API",
    checkBalance: "查询 API 余额",
    illustration: "使用费用估算",
    starterPack: "入门充值方案",
    creditAmount: "获得 US${amount} API 额度",
    selectModel: "选择模型查看示例",
    inputTokens: "1,000,000 个输入 Token",
    outputTokens: "250,000 个输出 Token",
    exampleCost: "示例使用费用",
    exampleNote:
      "根据已公布费率估算，并非实时账户数据。实际费用取决于模型与用量；图像、音频采用各自的计费单位。",
    gettingStarted: "从申请到第一次调用",
    steps: [
      ["申请访问", "提供用途与预计用量，与团队确认 API 密钥访问权限。"],
      ["安排 API 额度", "选择已公布方案并提交充值申请，由团队人工确认充值。"],
      ["集成模型", "设置端点与模型 ID，确认服务状态，再根据文档发送请求。"],
      ["查看并补充余额", "查询可用金额，并联系团队安排补充额度。"],
    ],
  },
  ja: {
    applicationIntro: "モデルから、あなたのプロダクトへ",
    applicationHeading: ["次のプロダクトに、", "もっと多くの可能性を。"],
    applicationAside:
      "最初のプロトタイプから、チームが毎日使うツールまで。実現したい用途から、適したモデルを見つけましょう。",
    exploreApplications: "活用例を探す",
    input: "入力",
    output: "出力",
    exploreModels: "関連モデルを見る",
    disclaimer:
      "掲載内容は活用フローの例です。アプリケーションへの組み込みが必要です。対応機能と提供状況は、ドキュメントとサービス状況ページをご確認ください。",
    applications: {
      assistants: {
        label: "インテリジェントアシスタント",
        title: "対話を、次の一歩へ。",
        description:
          "プロダクト内のアシスタントや文章作成機能を構築し、複雑な課題の整理を支援。推論モデルを自社アプリケーションのデータやツールに接続し、業務フローに組み込めます。",
        audience: "SaaS チーム · プロダクト開発 · 社内ツール",
        input: "質問と背景情報",
        output: "実用的で整理された回答",
        capability: "推論と言語",
      },
      documents: {
        label: "ドキュメント理解",
        title: "アプリケーションに、新たな視点を。",
        description:
          "画像や視覚的な細部を読み取り、文書処理を支援。レビュー機能、調査ツール、ナレッジ活用アプリケーションに画像理解を取り入れられます。",
        audience: "ナレッジ管理 · 調査ツール · 業務運用",
        input: "画像と質問",
        output: "説明、背景情報、内容の理解",
        capability: "視覚と言語",
      },
      creative: {
        label: "クリエイティブと音声",
        title: "テキストの先へ、表現を広げる。",
        description:
          "ビジュアル案の生成、録音の文字起こし、文章の音声化。ワークフローの各段階に合わせて、画像や音声に特化したモデルを選べます。",
        audience: "制作スタジオ · コンテンツ基盤 · 音声サービス",
        input: "プロンプト、録音、または原稿",
        output: "画像、文字起こし、または音声",
        capability: "画像と音声",
      },
      knowledge: {
        label: "検索とナレッジ",
        title: "必要な情報に、たどり着く。",
        description:
          "埋め込みとリランキングで、意味に基づく検索と情報取得のフローを構築。取得した文章をアプリケーション内の言語モデルに渡し、ナレッジアシスタントを作成できます。",
        audience: "企業内検索 · RAG アプリケーション · ナレッジベース",
        input: "文書と検索クエリ",
        output: "関連性で順位付けされた文章",
        capability: "埋め込みとリランキング",
      },
    },
    serviceIntro: "サービスも、料金も、明確に。",
    serviceHeading: ["利用するものを理解し、", "一回の呼び出しを大切に。"],
    serviceAside:
      "ホスト型モデル API の利用クレジットを計画。小規模な検証から始め、開発の進展に合わせてチャージ方法をチームにご相談ください。",
    pricingLink: "料金とクレジットプランを見る",
    inclusionsTitle: "モデル API サービスの内容",
    inclusions: [
      [
        "厳選されたモデルを利用",
        "お客様専用の API キーで、対応するテキスト、視覚、画像、音声、検索のエンドポイントを利用します。提供可否はモデルとゲートウェイの状況によります。",
      ],
      [
        "前払いの利用クレジット",
        "掲載料金を確認し、クレジット申請を送信して担当者の確認を受けられます。申請の承認だけでは、決済やゲートウェイ残高への自動加算は行われません。",
      ],
      [
        "ドキュメントと導入支援",
        "モデル ID、リクエスト例、エンドポイントの説明を提供。個別の構成が必要な場合は、チームにご相談ください。",
      ],
    ],
    requestAccess: "モデル API の利用を相談",
    checkBalance: "API 残高を確認",
    illustration: "利用料金の試算例",
    starterPack: "スタータークレジットプラン",
    creditAmount: "US${amount} 分の API クレジット",
    selectModel: "モデルを選んで試算例を見る",
    inputTokens: "入力 1,000,000 トークン",
    outputTokens: "出力 250,000 トークン",
    exampleCost: "利用料金の例",
    exampleNote:
      "掲載料金に基づく試算であり、実際のアカウント残高ではありません。実際の料金はモデルと利用量によって異なり、画像と音声にはそれぞれの課金単位が適用されます。",
    gettingStarted: "相談から、最初の API 呼び出しまで",
    steps: [
      [
        "利用を相談",
        "用途と想定利用量を共有し、API キーの利用条件をチームに確認します。",
      ],
      [
        "クレジットを手配",
        "掲載プランを選び、クレジット申請を送信。チャージは担当者が確認します。",
      ],
      [
        "モデルを接続",
        "エンドポイントとモデル ID を設定し、サービス状況を確認して、ドキュメントに沿ったリクエストを送信します。",
      ],
      [
        "残高を確認・追加",
        "利用可能残高を確認し、追加クレジットはチームにご相談ください。",
      ],
    ],
  },
  ko: {
    applicationIntro: "모델에서 여러분의 제품으로",
    applicationHeading: ["다음 제품에,", "더 많은 가능성을."],
    applicationAside:
      "개발자의 첫 프로토타입부터 팀이 매일 쓰는 도구까지. 해결하려는 과제에서 시작해 적합한 모델을 찾아보세요.",
    exploreApplications: "활용 사례 살펴보기",
    input: "입력",
    output: "출력",
    exploreModels: "관련 모델 살펴보기",
    disclaimer:
      "예시로 제시한 활용 흐름이며, 애플리케이션 통합이 필요합니다. 지원 기능과 이용 가능 여부는 문서 및 서비스 상태 페이지를 확인하세요.",
    applications: {
      assistants: {
        label: "지능형 어시스턴트",
        title: "대화를 다음 단계로 이어가세요.",
        description:
          "제품 어시스턴트를 만들고, 콘텐츠 초안을 작성하고, 팀의 복잡한 문제 해결을 도와보세요. 추론 모델을 자체 애플리케이션의 데이터와 도구에 연결해 제품 흐름을 구성할 수 있습니다.",
        audience: "SaaS 팀 · 제품 개발자 · 내부 도구",
        input: "질문과 배경 정보",
        output: "실용적이고 체계적인 답변",
        capability: "추론 및 언어",
      },
      documents: {
        label: "문서 이해",
        title: "애플리케이션에 새로운 시각을 더하세요.",
        description:
          "이미지와 시각적 세부 정보를 해석해 문서 처리 흐름을 개선하세요. 검토 도구, 연구 서비스, 지식 애플리케이션에 시각 이해 기능을 도입할 수 있습니다.",
        audience: "지식 관리 팀 · 연구 도구 · 운영 업무",
        input: "이미지와 질문",
        output: "설명, 배경 정보, 내용 이해",
        capability: "시각 및 언어",
      },
      creative: {
        label: "창작 및 음성 도구",
        title: "텍스트를 넘어 표현을 확장하세요.",
        description:
          "시각적 아이디어를 생성하고, 녹음을 텍스트로 옮기고, 글을 음성으로 바꿔보세요. 작업 흐름의 각 단계에 맞는 이미지 또는 오디오 전용 모델을 선택할 수 있습니다.",
        audience: "크리에이티브 스튜디오 · 콘텐츠 플랫폼 · 음성 서비스",
        input: "프롬프트, 녹음 또는 원고",
        output: "이미지, 전사문 또는 음성",
        capability: "이미지 및 오디오",
      },
      knowledge: {
        label: "검색 및 지식",
        title: "필요한 맥락을 찾아보세요.",
        description:
          "임베딩과 재순위화로 의미 기반 검색 및 검색 결과 처리 흐름을 구성하세요. 검색한 문단을 애플리케이션의 언어 모델에 전달해 지식 어시스턴트를 만들 수 있습니다.",
        audience: "기업 검색 · RAG 애플리케이션 · 지식 베이스",
        input: "문서와 검색어",
        output: "관련성에 따라 정렬된 문단",
        capability: "임베딩 및 재순위화",
      },
    },
    serviceIntro: "명확한 서비스, 투명한 요금",
    serviceHeading: ["무엇을 이용하는지 알고,", "호출마다 가치를 더하세요."],
    serviceAside:
      "호스팅 모델 API에 필요한 크레딧을 계획하세요. 소규모 실험부터 시작하고, 제품 개발에 맞춰 팀과 충전 방법을 상의할 수 있습니다.",
    pricingLink: "전체 요금 및 크레딧 플랜 보기",
    inclusionsTitle: "모델 API 서비스 구성",
    inclusions: [
      [
        "엄선된 모델 카탈로그 이용",
        "고객 전용 API 키로 지원되는 텍스트, 시각, 이미지, 음성, 검색 엔드포인트를 이용합니다. 이용 가능 여부는 선택한 모델과 게이트웨이 상태에 따라 달라집니다.",
      ],
      [
        "선불 크레딧과 수동 충전 확인",
        "공개된 사용 요금을 확인하고 크레딧 신청을 제출하면 담당자가 검토합니다. 신청 승인만으로 결제가 처리되거나 게이트웨이 잔액이 자동으로 늘어나지는 않습니다.",
      ],
      [
        "문서 및 통합 지원",
        "모델 ID, 요청 예제, 엔드포인트 안내를 제공합니다. 애플리케이션에 맞춘 구성이 필요하면 팀과 상의하세요.",
      ],
    ],
    requestAccess: "모델 API 이용 문의",
    checkBalance: "API 잔액 확인",
    illustration: "사용 요금 계산 예시",
    starterPack: "스타터 크레딧 플랜",
    creditAmount: "US${amount}의 API 크레딧",
    selectModel: "모델을 선택해 예시 확인",
    inputTokens: "입력 토큰 1,000,000개",
    outputTokens: "출력 토큰 250,000개",
    exampleCost: "예상 사용 요금",
    exampleNote:
      "공개된 요금으로 계산한 예시이며 실시간 계정 잔액이 아닙니다. 실제 요금은 모델과 사용량에 따라 달라지며, 이미지와 오디오는 별도 과금 단위를 적용합니다.",
    gettingStarted: "이용 문의부터 첫 API 호출까지",
    steps: [
      [
        "이용 문의",
        "용도와 예상 사용량을 공유하고 API 키 이용 조건을 팀과 확인하세요.",
      ],
      [
        "API 크레딧 준비",
        "공개된 플랜을 선택해 크레딧 신청을 제출하면 담당자가 충전을 확인합니다.",
      ],
      [
        "모델 연결",
        "엔드포인트와 모델 ID를 설정하고 서비스 상태를 확인한 뒤 문서에 따라 요청을 보내세요.",
      ],
      [
        "잔액 확인 및 추가",
        "사용 가능한 잔액을 확인하고 추가 크레딧은 팀에 문의하세요.",
      ],
    ],
  },
};
