"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { internationalPath, type InternationalLanguage } from "../lib/languages";

type Language = InternationalLanguage | "en";
const content = {
  en: { eyebrow: "THE COMPLETE PICTURE", title: "Intelligence is only", accent: "the beginning.", lead: "Build with the model. Connect it to your business. Give it the infrastructure to grow.", label: "Explore our services", architecture: "A possible architecture", services: [
    { title: "Model APIs", tagline: "One integration. More ways to build.", body: "Choose models for language, vision, images, speech, and retrieval. Start with familiar request formats and published usage rates.", action: "Discover the models", nodes: ["Your product", "One API", "Language", "Vision", "Creation"], note: "Model capabilities and availability vary. Explore each model before integrating." },
    { title: "Agent development", tagline: "Designed around the work you do.", body: "Turn your knowledge and operating process into an agent brief. We help scope the instructions, integrations, human review, and testing your project needs.", action: "Explore agent services", nodes: ["Your knowledge", "Custom agent", "Tools", "Human review", "Workflow"], note: "External tools and business systems are connected through a separately scoped project." },
    { title: "Dedicated compute", tagline: "Your workload. Its own foundation.", body: "Plan NVIDIA HGX-based GPU capacity for inference, model adaptation, and dedicated deployments. Align configuration and delivery with your workload.", action: "Explore infrastructure", nodes: ["Your workload", "GPU cluster", "Inference", "Model tuning", "Deployment"], note: "Hardware configuration, capacity, availability, and delivery are confirmed per project." },
  ] },
  "zh-Hant": { eyebrow: "完整服務，彼此連結", title: "模型的智慧，", accent: "只是開始。", lead: "選擇模型，接上你的業務，再為成長準備合適的基礎設施。", label: "探索服務", architecture: "架構規劃示意", services: [
    { title: "模型 API", tagline: "一次串接，展開更多可能。", body: "從文字、視覺、圖像、語音到檢索，挑選適合產品的模型。透過熟悉的請求格式與公開使用費率開始打造。", action: "探索模型服務", nodes: ["你的產品", "一組 API", "語言", "視覺", "創作"], note: "模型能力與可用狀態各有不同，請在串接前查看個別模型資訊。" },
    { title: "智能體建置", tagline: "圍繞真正的工作，設計 AI。", body: "把企業知識與作業流程整理成智能體需求。我們協助界定指令、系統串接、人工審核及測試，依專案規劃交付。", action: "了解智能體服務", nodes: ["企業知識", "專屬智能體", "工具", "人工審核", "作業流程"], note: "外部工具與企業系統的連接，需要另行確認專案範圍與實作。" },
    { title: "專屬算力", tagline: "讓基礎設施配合你的工作負載。", body: "以 NVIDIA HGX 為基礎，規劃推論、模型調整與專用部署所需的 GPU。從配置到交付，依實際需求確認。", action: "探索基礎設施", nodes: ["工作負載", "GPU 叢集", "模型推論", "模型調整", "專用部署"], note: "硬體配置、容量、可用性與交付條件皆依專案確認。" },
  ] },
  "zh-Hans": { eyebrow: "完整服务，彼此连接", title: "模型的智能，", accent: "只是开始。", lead: "选择模型，连接你的业务，再为成长准备合适的基础设施。", label: "探索服务", architecture: "架构规划示意", services: [
    { title: "模型 API", tagline: "一次集成，展开更多可能。", body: "从文字、视觉、图像、语音到检索，挑选适合产品的模型。通过熟悉的请求格式与公开使用费率开始构建。", action: "探索模型服务", nodes: ["你的产品", "一组 API", "语言", "视觉", "创作"], note: "模型能力与可用状态各有不同，请在集成前查看具体模型信息。" },
    { title: "智能体开发", tagline: "围绕真正的工作，设计 AI。", body: "把企业知识与业务流程整理成智能体需求。我们协助界定指令、系统集成、人工审核及测试，按项目规划交付。", action: "了解智能体服务", nodes: ["企业知识", "专属智能体", "工具", "人工审核", "业务流程"], note: "外部工具与企业系统的连接，需要另行确认项目范围与实现。" },
    { title: "专属算力", tagline: "让基础设施配合你的工作负载。", body: "以 NVIDIA HGX 为基础，规划推理、模型调整与专用部署所需的 GPU。从配置到交付，按实际需求确认。", action: "探索基础设施", nodes: ["工作负载", "GPU 集群", "模型推理", "模型调整", "专用部署"], note: "硬件配置、容量、可用性与交付条件均按项目确认。" },
  ] },
  ja: { eyebrow: "つながるサービス全体像", title: "モデルの知能は、", accent: "はじまりにすぎない。", lead: "モデルを選び、業務につなぎ、成長を支える基盤を整える。", label: "サービスを探索", architecture: "構成例", services: [
    { title: "モデル API", tagline: "ひとつの接続から、広がる開発。", body: "言語、ビジョン、画像、音声、検索。製品に合ったモデルを選び、使い慣れたリクエスト形式と公開料金で開発を始められます。", action: "モデルを探す", nodes: ["あなたの製品", "ひとつの API", "言語", "ビジョン", "画像生成"], note: "機能と稼働状況はモデルごとに異なります。導入前に個別の情報をご確認ください。" },
    { title: "エージェント開発", tagline: "実際の業務に合わせて設計。", body: "企業の知識と業務をエージェントの要件に整理。指示、システム連携、人による確認、テストの範囲を一緒に定めます。", action: "開発サービスを見る", nodes: ["企業の知識", "専用エージェント", "ツール", "人による確認", "業務フロー"], note: "外部ツールや業務システムとの連携は、別途合意したプロジェクトで実装します。" },
    { title: "専用コンピュート", tagline: "ワークロードに合った基盤を。", body: "NVIDIA HGX を基盤に、推論、モデル調整、専用デプロイ向けの GPU を計画。構成と納期は要件に応じて確認します。", action: "インフラを見る", nodes: ["ワークロード", "GPU クラスター", "推論", "モデル調整", "デプロイ"], note: "ハードウェア構成、容量、空き状況、納期はプロジェクトごとに確認します。" },
  ] },
  ko: { eyebrow: "하나로 연결되는 서비스", title: "모델의 지능은", accent: "시작일 뿐입니다.", lead: "모델을 선택하고, 비즈니스에 연결하고, 성장을 위한 기반을 준비하세요.", label: "서비스 살펴보기", architecture: "아키텍처 예시", services: [
    { title: "모델 API", tagline: "하나의 연결로 넓어지는 가능성.", body: "언어, 비전, 이미지, 음성, 검색 모델을 제품에 맞게 선택하세요. 익숙한 요청 형식과 공개 요금으로 개발을 시작할 수 있습니다.", action: "모델 살펴보기", nodes: ["당신의 제품", "하나의 API", "언어", "비전", "창작"], note: "모델별 기능과 가용성이 다릅니다. 연동 전에 각 모델 정보를 확인하세요." },
    { title: "에이전트 개발", tagline: "실제 업무를 중심으로 설계합니다.", body: "기업 지식과 운영 절차를 에이전트 요구사항으로 정리합니다. 지침, 시스템 연동, 사람의 검토, 테스트 범위를 함께 계획합니다.", action: "에이전트 서비스 보기", nodes: ["기업 지식", "맞춤형 에이전트", "도구", "사람의 검토", "업무 흐름"], note: "외부 도구와 비즈니스 시스템은 별도로 범위를 합의한 프로젝트를 통해 연결합니다." },
    { title: "전용 컴퓨팅", tagline: "워크로드에 맞춘 전용 기반.", body: "NVIDIA HGX 기반 GPU로 추론, 모델 조정, 전용 배포를 계획합니다. 구성과 공급 일정은 실제 요구사항에 맞게 확인합니다.", action: "인프라 살펴보기", nodes: ["워크로드", "GPU 클러스터", "추론", "모델 조정", "배포"], note: "하드웨어 구성, 용량, 가용성, 공급 조건은 프로젝트별로 확인합니다." },
  ] },
} satisfies Record<Language, { eyebrow: string; title: string; accent: string; lead: string; label: string; architecture: string; services: { title: string; tagline: string; body: string; action: string; nodes: string[]; note: string }[] }>;

export function BrandCapabilities({ language }: { language: Language }) {
  const [selected, setSelected] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const copy = content[language];
  const service = copy.services[selected];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = ["ArrowDown", "ArrowRight"].includes(event.key) ? (index + 1) % 3 : ["ArrowUp", "ArrowLeft"].includes(event.key) ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
    if (next === null) return;
    event.preventDefault(); setSelected(next); list.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }
  const destination = internationalPath(language, selected === 1 ? "agent-platform" : selected === 0 ? "models" : "infrastructure");
  return <section className="brand-capabilities pc-frame" aria-labelledby="brand-capabilities-title">
    <div className="brand-capabilities-intro"><p className="brand-eyebrow"><span className="brand-line" aria-hidden="true"/>{copy.eyebrow}</p><h2 id="brand-capabilities-title">{copy.title}<br/><em>{copy.accent}</em></h2><p>{copy.lead}</p></div>
    <div className="brand-capabilities-layout">
      <div className="brand-service-tabs" role="tablist" aria-label={copy.label} aria-orientation="vertical" ref={list}>{copy.services.map((item, index) => <button type="button" role="tab" id={`brand-service-${index}`} aria-selected={selected === index} aria-controls="brand-service-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={(event) => navigate(event, index)} key={item.title}><span className="brand-service-number">0{index + 1}</span><span><strong>{item.title}</strong><small>{item.tagline}</small></span><span className="brand-service-arrow" aria-hidden="true">↗</span></button>)}</div>
      <div className="brand-service-panel" id="brand-service-panel" role="tabpanel" aria-labelledby={`brand-service-${selected}`}>
        <div className={`brand-architecture brand-architecture-${selected}`} aria-hidden="true">
          <div className="brand-diagram-label"><span>{copy.architecture}</span><span>PC / 0{selected + 1}</span></div>
          <svg className="brand-diagram-lines" viewBox="0 0 640 300" fill="none"><path d="M108 150H302M338 150H395Q425 150 425 120V82Q425 60 452 60H525M338 150H525M338 150H395Q425 150 425 180V218Q425 240 452 240H525"/><path className="brand-flow-line" d="M108 150H302M338 150H395Q425 150 425 120V82Q425 60 452 60H525M338 150H525M338 150H395Q425 150 425 180V218Q425 240 452 240H525"/></svg>
          <div className="brand-diagram-source"><span>{selected === 0 ? "⌘" : selected === 1 ? "▤" : "▦"}</span><strong>{service.nodes[0]}</strong></div>
          <div className="brand-diagram-hub"><span>╱╱</span><strong>{service.nodes[1]}</strong></div>
          {service.nodes.slice(2).map((label, index) => <div className={`brand-diagram-target brand-diagram-target-${index}`} key={index}><i/><span>{label}</span></div>)}
        </div>
        <div className="brand-service-detail" key={selected}><p>{service.body}</p><a href={destination}>{service.action}<span aria-hidden="true">↗</span></a><small>{service.note}</small></div>
      </div>
    </div>
  </section>;
}
