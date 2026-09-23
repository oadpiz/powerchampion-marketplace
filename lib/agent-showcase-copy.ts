import type { HomeLanguage } from "./home-copy";

type Stage = readonly [title: string, body: string];
export type ShowcaseScenario = {
  label: string;
  title: string;
  brief: string;
  sources: readonly [string, string, string];
  document: string;
  sections: readonly [Stage, Stage, Stage];
  stages: readonly [Stage, Stage, Stage, Stage];
};
type ShowcaseCopy = {
  eyebrow: string;
  title: readonly [string, string];
  lead: string;
  scenariosLabel: string;
  stagesLabel: string;
  stageNames: readonly [string, string, string, string];
  example: string;
  briefLabel: string;
  sourcesLabel: string;
  documentLabel: string;
  reviewLabel: string;
  reviewNote: string;
  draft: string;
  pause: string;
  play: string;
  static: string;
  footnote: string;
  build: string;
  contact: string;
  tasks: string;
  taskNote: string;
  scenarios: readonly [ShowcaseScenario, ShowcaseScenario, ShowcaseScenario];
};

export const agentShowcaseCopy: Record<HomeLanguage, ShowcaseCopy> = {
  en: {
    eyebrow: "AGENTS, WITH A PURPOSE", title: ["From intent", "to outcome."],
    lead: "Give the work a direction. Bring the right context. Shape a result worth reviewing.",
    scenariosLabel: "Explore an agent use case", stagesLabel: "Explore the workflow", stageNames: ["Brief", "Sources", "Review", "Deliver"],
    example: "Capability walkthrough", briefLabel: "The brief", sourcesLabel: "Reference material", documentLabel: "Sample deliverable", reviewLabel: "Human review", reviewNote: "You decide what moves forward.", draft: "Illustrative draft", pause: "Pause walkthrough", play: "Play walkthrough", static: "Manual exploration",
    footnote: "Illustrative examples. Tools, connected sources, and delivery are configured for each project.",
    build: "Design your agent", contact: "Discuss a project", tasks: "Open Tasks", taskNote: "Sign in and use your own model API key. Check task availability in Tasks.",
    scenarios: [
      {
        label: "Research", title: "A clearer path to a decision.", brief: "Compare a model API shortlist for our next product.", sources: ["Product criteria", "Model documentation", "Pricing notes"], document: "Model selection brief",
        sections: [["Requirements", "Text and image input, with a familiar API."], ["Trade-offs", "Compare capability, usage, and data handling."], ["Next step", "Validate the shortlist against your own examples."]],
        stages: [["Start with the decision.", "Define the question, the audience, and what a useful answer needs to include."], ["Give every claim context.", "Bring selected documentation and requirements into the same working brief."], ["Make room for judgment.", "Surface assumptions and unanswered questions for a person to review."], ["Leave with a useful artifact.", "Shape the findings into a decision brief with references and next steps."]],
      },
      {
        label: "Operations", title: "Turn a handover into a plan.", brief: "Organize a service handover into clear next steps.", sources: ["Service notes", "Runbook excerpt", "Handover log"], document: "Handover action plan",
        sections: [["Context", "Summarize the affected service and open questions."], ["Review", "Check the proposed actions against the runbook."], ["Next step", "Confirm owners before putting the plan into action."]],
        stages: [["Name the work ahead.", "Describe the handover and the boundaries of what the agent should prepare."], ["Connect the working context.", "Collect the relevant notes, procedures, and open issues for the task."], ["Keep actions accountable.", "Review proposed steps and assign responsibility before execution."], ["Make the next step explicit.", "Prepare an action plan that a teammate can check, own, and follow."]],
      },
      {
        label: "Documents", title: "Give scattered ideas a shape.", brief: "Turn project notes into a proposal ready for review.", sources: ["Project outline", "Meeting notes", "Delivery criteria"], document: "Project proposal",
        sections: [["Objective", "Explain the problem the project is meant to solve."], ["Scope", "Separate agreed work from decisions still to make."], ["Next step", "Review the assumptions and confirm the delivery plan."]],
        stages: [["Begin with the reader.", "Set the purpose, format, and audience for the document you need."], ["Bring the material together.", "Use the selected outline and notes as the starting point for a coherent draft."], ["Refine before sharing.", "Check the scope, language, and assumptions with a human in the loop."], ["Create something to work with.", "Prepare a structured proposal that can be reviewed, revised, and shared."]],
      },
    ],
  },
  "zh-Hant": {
    eyebrow: "讓智能體，圍繞真正的工作", title: ["從你的想法，", "走向具體成果。"], lead: "給工作明確的方向，帶入合適的資訊，讓成果值得進一步審閱。",
    scenariosLabel: "探索智能體應用情境", stagesLabel: "探索工作流程", stageNames: ["需求", "資料", "審核", "交付"], example: "流程示意", briefLabel: "任務需求", sourcesLabel: "參考資料", documentLabel: "交付內容示例", reviewLabel: "人工審核", reviewNote: "由你決定，什麼可以往下走。", draft: "示意草稿", pause: "暫停流程示意", play: "播放流程示意", static: "手動探索",
    footnote: "本區為能力與流程示意。工具、資料來源串接及交付方式，皆依專案設定。", build: "設計你的智能體", contact: "討論專案需求", tasks: "開啟任務工作台", taskNote: "登入後使用自己的模型 API 金鑰，任務開放狀態請見任務頁面。",
    scenarios: [
      { label: "研究分析", title: "讓決策，有更清楚的依據。", brief: "比較下一個產品適合採用的模型 API。", sources: ["產品需求", "模型文件", "費率筆記"], document: "模型選型簡報",
        sections: [["需求", "支援文字與圖像輸入，採用熟悉的 API。"], ["取捨", "比較模型能力、用量及資料處理方式。"], ["下一步", "用自己的實際案例驗證候選模型。"]],
        stages: [["先確定，要做什麼決定。", "界定研究問題、讀者，以及一份有用答案應包含的內容。"], ["讓每個論點，都有脈絡。", "把選定的文件與需求，整理進同一份工作資料。"], ["為人的判斷，保留空間。", "列出假設與待確認問題，交由人員檢視。"], ["帶走一份能接著用的成果。", "將分析整理成選型簡報，附上參考資料與下一步。"]] },
      { label: "營運作業", title: "讓交接，成為明確的計畫。", brief: "把服務交接紀錄整理成清楚的後續行動。", sources: ["服務筆記", "作業程序摘錄", "交接紀錄"], document: "交接行動計畫",
        sections: [["背景", "摘要受影響的服務與待確認問題。"], ["審查", "依作業程序檢查建議的行動。"], ["下一步", "確認負責人後，再推進執行。"]],
        stages: [["說清楚，接下來的工作。", "描述交接情境，界定智能體應準備的內容與範圍。"], ["接上工作所需的資訊。", "彙整相關筆記、作業流程與未解事項。"], ["讓行動，有人把關。", "在執行前，審核建議步驟並確認責任歸屬。"], ["把下一步，寫得更明確。", "準備一份同事能檢查、承接並遵循的行動計畫。"]] },
      { label: "文件製作", title: "讓零散想法，有完整的樣子。", brief: "把專案筆記整理成可供審閱的提案。", sources: ["專案大綱", "會議筆記", "交付條件"], document: "專案提案草稿",
        sections: [["目標", "說明專案要解決的問題。"], ["範圍", "區分已確認工作與待決事項。"], ["下一步", "檢視假設，確認交付計畫。"]],
        stages: [["從讀者，需要什麼開始。", "確定文件的目的、格式與閱讀對象。"], ["讓材料，聚成一條主線。", "以選定的大綱與筆記，整理出連貫的草稿。"], ["分享前，再精煉一次。", "由人員檢查範圍、用詞與假設，保留最後判斷。"], ["完成一份能繼續推進的文件。", "準備結構清楚的提案，供後續審閱、修改與分享。"]] },
    ],
  },
  "zh-Hans": {
    eyebrow: "让智能体，围绕真正的工作", title: ["从你的想法，", "走向具体成果。"], lead: "给工作明确的方向，带入合适的信息，让成果值得进一步审阅。",
    scenariosLabel: "探索智能体应用场景", stagesLabel: "探索工作流程", stageNames: ["需求", "资料", "审核", "交付"], example: "流程示意", briefLabel: "任务需求", sourcesLabel: "参考资料", documentLabel: "交付内容示例", reviewLabel: "人工审核", reviewNote: "由你决定，什么可以继续推进。", draft: "示意草稿", pause: "暂停流程示意", play: "播放流程示意", static: "手动探索",
    footnote: "本区域为能力与流程示意。工具、数据来源集成及交付方式，均按项目配置。", build: "设计你的智能体", contact: "讨论项目需求", tasks: "打开任务工作台", taskNote: "登录后使用自己的模型 API 密钥，任务开放状态请见任务页面。",
    scenarios: [
      { label: "研究分析", title: "让决策，有更清晰的依据。", brief: "比较下一个产品适合采用的模型 API。", sources: ["产品需求", "模型文档", "费率笔记"], document: "模型选型简报",
        sections: [["需求", "支持文字与图像输入，采用熟悉的 API。"], ["取舍", "比较模型能力、用量及数据处理方式。"], ["下一步", "用自己的实际案例验证候选模型。"]],
        stages: [["先确定，要做什么决定。", "明确研究问题、读者，以及一份有用答案应包含的内容。"], ["让每个论点，都有依据。", "把选定的文档与需求，整理到同一份工作资料。"], ["为人的判断，保留空间。", "列出假设与待确认问题，交由人员检查。"], ["带走一份能接着用的成果。", "将分析整理成选型简报，附上参考资料与下一步。"]] },
      { label: "运营工作", title: "让交接，成为明确的计划。", brief: "把服务交接记录整理成清楚的后续行动。", sources: ["服务笔记", "操作规程摘录", "交接记录"], document: "交接行动计划",
        sections: [["背景", "摘要受影响的服务与待确认问题。"], ["审查", "按操作规程检查建议的行动。"], ["下一步", "确认负责人后，再推进执行。"]],
        stages: [["说清楚，接下来的工作。", "描述交接场景，明确智能体应准备的内容与范围。"], ["连接工作所需的信息。", "汇总相关笔记、操作流程与未解决事项。"], ["让行动，有人把关。", "在执行前，审核建议步骤并确认责任归属。"], ["把下一步，写得更明确。", "准备一份同事能检查、承接并遵循的行动计划。"]] },
      { label: "文档制作", title: "让零散想法，有完整的样子。", brief: "把项目笔记整理成可供审阅的提案。", sources: ["项目大纲", "会议笔记", "交付条件"], document: "项目提案草稿",
        sections: [["目标", "说明项目要解决的问题。"], ["范围", "区分已确认工作与待决事项。"], ["下一步", "检查假设，确认交付计划。"]],
        stages: [["从读者，需要什么开始。", "确定文档的目的、格式与阅读对象。"], ["让材料，汇成一条主线。", "以选定的大纲与笔记，整理出连贯的草稿。"], ["分享前，再完善一次。", "由人员检查范围、用词与假设，保留最后判断。"], ["完成一份能继续推进的文档。", "准备结构清楚的提案，供后续审阅、修改与分享。"]] },
    ],
  },
  ja: {
    eyebrow: "仕事に、目的のあるエージェントを", title: ["アイデアから、", "具体的な成果へ。"], lead: "仕事の方向を定め、必要な情報を集め、検討に値する成果へと整える。",
    scenariosLabel: "活用シーンを選ぶ", stagesLabel: "ワークフローを探索", stageNames: ["要件", "資料", "確認", "成果物"], example: "機能と流れのイメージ", briefLabel: "タスクの要件", sourcesLabel: "参考資料", documentLabel: "成果物の例", reviewLabel: "人による確認", reviewNote: "次に進めるかは、あなたが決める。", draft: "サンプル草稿", pause: "デモを一時停止", play: "デモを再生", static: "手動で探索",
    footnote: "内容は説明用の例です。ツール、情報源との接続、納品方法はプロジェクトごとに設定します。", build: "エージェントを設計", contact: "プロジェクトを相談", tasks: "タスク画面を開く", taskNote: "ログインして、ご自身のモデル API キーを使用してください。利用状況はタスク画面で確認できます。",
    scenarios: [
      { label: "リサーチ", title: "判断の根拠を、より明確に。", brief: "次の製品に適したモデル API の候補を比較する。", sources: ["製品要件", "モデルの資料", "料金のメモ"], document: "モデル選定レポート",
        sections: [["要件", "テキストと画像入力、使い慣れた API。"], ["比較", "機能、利用量、データの扱いを検討。"], ["次のステップ", "実際の事例で候補モデルを検証する。"]],
        stages: [["まず、何を決めるか。", "問いと読み手を定め、回答に必要な内容を明確にします。"], ["主張に、根拠を添える。", "選んだ資料と要件をひとつの作業用ブリーフにまとめます。"], ["人の判断に、余地を残す。", "仮定や未解決の問いを提示し、人による確認につなげます。"], ["次につながる成果物に。", "参考資料と次のステップを含む選定レポートに整理します。"]] },
      { label: "オペレーション", title: "引き継ぎを、行動計画に。", brief: "サービスの引き継ぎ記録から、次の作業を整理する。", sources: ["サービスのメモ", "手順書の抜粋", "引き継ぎ記録"], document: "引き継ぎアクションプラン",
        sections: [["背景", "対象サービスと未確認事項を要約。"], ["確認", "提案された対応を手順書と照合。"], ["次のステップ", "実施前に担当者を確認する。"]],
        stages: [["必要な仕事を、言葉にする。", "引き継ぎの状況と、エージェントが準備する範囲を定めます。"], ["業務の文脈を、つなげる。", "関連するメモ、手順、未解決の課題を集めます。"], ["行動に、責任を持たせる。", "実施前に提案内容を確認し、担当を明確にします。"], ["次の一歩を、具体的に。", "チームの誰かが確認し、引き受け、進められる計画にまとめます。"]] },
      { label: "ドキュメント", title: "散らばった考えを、ひとつに。", brief: "プロジェクトのメモから、確認用の提案書を作る。", sources: ["プロジェクト概要", "会議メモ", "納品条件"], document: "プロジェクト提案書",
        sections: [["目的", "プロジェクトが解決する課題を明確に。"], ["範囲", "合意済みの作業と未決定事項を区別。"], ["次のステップ", "前提を見直し、納品計画を確認する。"]],
        stages: [["読み手から、考える。", "必要な文書の目的、形式、読者を定めます。"], ["材料に、一本の筋を通す。", "選んだ概要とメモをもとに、一貫した草稿を作ります。"], ["共有前に、磨き上げる。", "人が範囲、表現、前提を確認し、内容を整えます。"], ["使い続けられる文書へ。", "確認、修正、共有に進めるよう、構造の明確な提案書にします。"]] },
    ],
  },
  ko: {
    eyebrow: "실제 업무를 위한 에이전트", title: ["의도에서 시작해,", "결과로 이어집니다."], lead: "업무의 방향을 정하고, 필요한 맥락을 모아, 검토할 가치가 있는 결과를 만드세요.",
    scenariosLabel: "에이전트 활용 사례 선택", stagesLabel: "워크플로 살펴보기", stageNames: ["요구사항", "자료", "검토", "산출물"], example: "기능과 흐름 예시", briefLabel: "작업 요구사항", sourcesLabel: "참고 자료", documentLabel: "산출물 예시", reviewLabel: "사람의 검토", reviewNote: "다음으로 진행할지는 직접 결정합니다.", draft: "예시 초안", pause: "데모 일시 정지", play: "데모 재생", static: "직접 살펴보기",
    footnote: "설명을 위한 예시입니다. 도구, 자료 연결, 제공 방식은 프로젝트별로 구성합니다.", build: "에이전트 설계하기", contact: "프로젝트 상담", tasks: "작업 화면 열기", taskNote: "로그인 후 자신의 모델 API 키를 사용하세요. 이용 가능 여부는 작업 화면에서 확인할 수 있습니다.",
    scenarios: [
      { label: "리서치", title: "결정의 근거를 더 명확하게.", brief: "다음 제품에 적합한 모델 API 후보를 비교합니다.", sources: ["제품 요구사항", "모델 문서", "요금 메모"], document: "모델 선정 보고서",
        sections: [["요구사항", "텍스트와 이미지 입력, 익숙한 API."], ["비교", "기능, 사용량, 데이터 처리 방식을 검토합니다."], ["다음 단계", "실제 사례로 후보 모델을 검증합니다."]],
        stages: [["어떤 결정인지부터 정합니다.", "질문과 독자, 유용한 답변에 필요한 내용을 정의합니다."], ["주장에 맥락을 더합니다.", "선택한 문서와 요구사항을 하나의 작업 자료로 모읍니다."], ["사람의 판단을 위한 여유.", "가정과 미해결 질문을 드러내어 사람이 검토하도록 합니다."], ["다음 작업에 쓸 수 있는 결과.", "참고 자료와 다음 단계를 담은 선정 보고서로 정리합니다."]] },
      { label: "운영", title: "인수인계를 실행 계획으로.", brief: "서비스 인수인계 기록을 명확한 후속 작업으로 정리합니다.", sources: ["서비스 메모", "운영 절차 발췌", "인수인계 기록"], document: "인수인계 작업 계획",
        sections: [["배경", "관련 서비스와 확인할 질문을 요약합니다."], ["검토", "제안된 작업을 운영 절차와 대조합니다."], ["다음 단계", "진행하기 전에 담당자를 확인합니다."]],
        stages: [["앞으로 할 일을 정의합니다.", "인수인계 상황과 에이전트가 준비할 범위를 설명합니다."], ["업무의 맥락을 연결합니다.", "관련 메모, 절차, 미해결 사항을 작업 자료로 모읍니다."], ["행동에 책임을 더합니다.", "실행 전에 제안된 단계를 검토하고 책임을 정합니다."], ["다음 단계를 구체적으로.", "동료가 확인하고 맡아서 진행할 수 있는 계획을 준비합니다."]] },
      { label: "문서", title: "흩어진 아이디어를 하나로.", brief: "프로젝트 메모를 검토할 수 있는 제안서로 만듭니다.", sources: ["프로젝트 개요", "회의 메모", "납품 기준"], document: "프로젝트 제안서",
        sections: [["목표", "프로젝트가 해결할 문제를 설명합니다."], ["범위", "합의한 작업과 결정할 사항을 구분합니다."], ["다음 단계", "가정을 검토하고 납품 계획을 확인합니다."]],
        stages: [["독자에게 필요한 것부터.", "문서의 목적, 형식, 읽을 대상을 정합니다."], ["자료를 하나의 흐름으로.", "선택한 개요와 메모로 일관된 초안을 준비합니다."], ["공유 전에 다듬습니다.", "사람이 범위, 표현, 가정을 확인하고 내용을 정리합니다."], ["계속 활용할 수 있는 문서.", "검토하고 수정하고 공유할 수 있도록 구조를 갖춘 제안서를 만듭니다."]] },
    ],
  },
};
