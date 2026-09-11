"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { InternationalLanguage } from "../lib/languages";

type Language = InternationalLanguage | "en";
type Props = { language: Language; motionPaused: boolean; onToggleMotion: () => void };
const words = {
  en: { eyebrow: "OPEN MODELS. EXTRAORDINARY IDEAS.", title: "One API.", accent: "Every possibility.", lead: "From an idea to an intelligent product. Model APIs, custom agents, and dedicated compute — brought together with purpose.", explore: "Explore models", docs: "Read the docs", scroll: "SCROLL TO DISCOVER", pause: "Pause motion", resume: "Resume motion", models: "Explore the intelligence", detail: "Explore this model", type: ["Reasoning", "Vision", "Creation"], description: ["Think through complex questions. Turn context into a useful next step.", "Bring images and language into the same conversation.", "Turn a creative direction into an image through a familiar API."], core: "MODEL CORE", compatible: "OpenAI-compatible", usage: "Pay per use", note: "Interactive model illustration", move: "Move to explore" },
  "zh-Hant": { eyebrow: "開放模型，成就不凡想法。", title: "一組 API。", accent: "無限可能。", lead: "從一個想法，到真正能用的智慧產品。整合模型 API、客製智能體與專屬算力，讓每一層技術都服務於你的目標。", explore: "探索模型", docs: "閱讀 API 文件", scroll: "向下探索", pause: "暫停動態", resume: "開啟動態", models: "探索模型能力", detail: "深入了解模型", type: ["推理", "視覺", "創作"], description: ["拆解複雜問題，讓資訊成為明確的下一步。", "讓圖像與文字，在同一個對話中被理解。", "透過熟悉的 API，讓創作方向成為圖像。"], core: "模型核心", compatible: "相容 OpenAI API", usage: "按量計費", note: "模型互動概念圖", move: "移動游標探索" },
  "zh-Hans": { eyebrow: "开放模型，成就不凡想法。", title: "一组 API。", accent: "无限可能。", lead: "从一个想法，到真正能用的智能产品。整合模型 API、定制智能体与专属算力，让每一层技术都服务于你的目标。", explore: "探索模型", docs: "阅读 API 文档", scroll: "向下探索", pause: "暂停动态", resume: "开启动画", models: "探索模型能力", detail: "深入了解模型", type: ["推理", "视觉", "创作"], description: ["拆解复杂问题，让信息成为明确的下一步。", "让图像与文字，在同一个对话中被理解。", "通过熟悉的 API，让创作方向成为图像。"], core: "模型核心", compatible: "兼容 OpenAI API", usage: "按量计费", note: "模型交互概念图", move: "移动光标探索" },
  ja: { eyebrow: "オープンモデルから、新たな可能性へ。", title: "ひとつの API。", accent: "広がる可能性。", lead: "アイデアを、使える AI プロダクトへ。モデル API、カスタムエージェント、専用 GPU を、あなたの目的に合わせて。", explore: "モデルを見る", docs: "API ドキュメント", scroll: "スクロールして探索", pause: "動きを止める", resume: "動きを再開", models: "モデルの能力を探索", detail: "モデルの詳細", type: ["推論", "ビジョン", "画像生成"], description: ["複雑な問いを整理し、次の一歩につなげる。", "画像と言葉を、同じ会話の中で理解する。", "使い慣れた API で、アイデアを画像にする。"], core: "モデルコア", compatible: "OpenAI API 互換", usage: "従量課金", note: "モデルのインタラクティブな概念図", move: "ポインターで探索" },
  ko: { eyebrow: "오픈 모델로 시작하는 새로운 가능성.", title: "하나의 API.", accent: "무한한 가능성.", lead: "아이디어를 실제로 쓰이는 AI 제품으로. 모델 API, 맞춤형 에이전트, 전용 GPU를 목표에 맞게 연결합니다.", explore: "모델 살펴보기", docs: "API 문서", scroll: "스크롤하여 살펴보기", pause: "동작 일시 정지", resume: "동작 다시 시작", models: "모델 기능 살펴보기", detail: "모델 자세히 보기", type: ["추론", "비전", "이미지 생성"], description: ["복잡한 질문을 풀고 다음 단계를 구체화합니다.", "이미지와 언어를 하나의 대화에서 이해합니다.", "익숙한 API로 아이디어를 이미지로 만듭니다."], core: "모델 코어", compatible: "OpenAI API 호환", usage: "사용량 기반 요금", note: "대화형 모델 개념도", move: "포인터로 살펴보기" },
} satisfies Record<Language, { eyebrow: string; title: string; accent: string; lead: string; explore: string; docs: string; scroll: string; pause: string; resume: string; models: string; detail: string; type: string[]; description: string[]; core: string; compatible: string; usage: string; note: string; move: string }>;
const models = [
  { id: "glm-5.2-fp8", name: "GLM 5.2", symbol: "✳", code: "GLM" },
  { id: "qwen3-vl-30b", name: "Qwen3 VL", symbol: "◈", code: "QWEN" },
  { id: "flux-schnell", name: "Flux Schnell", symbol: "✧", code: "FLUX" },
];

export function BrandHero({ language, motionPaused, onToggleMotion }: Props) {
  const copy = words[language];
  const [selected, setSelected] = useState(0);
  const scene = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const model = models[selected];
  function tilt(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || motionPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    scene.current?.style.setProperty("--pointer-x", `${((event.clientX - bounds.left) / bounds.width - .5) * 10}deg`);
    scene.current?.style.setProperty("--pointer-y", `${((event.clientY - bounds.top) / bounds.height - .5) * -8}deg`);
  }
  function resetTilt() {
    scene.current?.style.setProperty("--pointer-x", "0deg");
    scene.current?.style.setProperty("--pointer-y", "0deg");
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
    if (next === null) return;
    event.preventDefault(); setSelected(next);
    controls.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }
  return <section className="pc-hero brand-hero" aria-labelledby="home-title" data-language={language}>
    <div className="brand-hero-grid pc-frame">
      <div className="brand-hero-copy">
        <p className="brand-eyebrow"><span aria-hidden="true" className="brand-line"/>{copy.eyebrow}</p>
        <h1 id="home-title">{copy.title}<br/><span>{copy.accent}</span></h1>
        <p className="brand-hero-lead">{copy.lead}</p>
        <div className="brand-hero-actions"><a className="pc-button" href="#models">{copy.explore}<span aria-hidden="true">↗</span></a><a className="brand-text-link" href="/docs">{copy.docs}<span aria-hidden="true">→</span></a></div>
        <div className="brand-hero-assurances"><span><i aria-hidden="true"/> {copy.compatible}</span><span>{copy.usage}</span></div>
      </div>
      <div className="brand-intelligence">
        <div className="brand-scene" ref={scene} onPointerMove={tilt} onPointerLeave={resetTilt} role="img" aria-label={copy.note}>
          <div className="brand-scene-grid" aria-hidden="true"/>
          <div className="brand-orbit brand-orbit-one" aria-hidden="true"/><div className="brand-orbit brand-orbit-two" aria-hidden="true"/>
          <div className="brand-core-float" aria-hidden="true">
            <div className={`brand-core brand-core-mode-${selected}`}>
              {[0, 1, 2, 3, 4].map((layer) => <div className={`brand-core-layer brand-core-layer-${layer}`} key={layer}><span className="brand-core-etch"/>{layer === 4 && <div className="brand-core-face"><span>{model.symbol}</span><strong>{model.code}</strong><small>POWER CHAMPION</small></div>}</div>)}
              <div className="brand-core-light"/>
            </div>
          </div>
          <div className="brand-scene-label brand-scene-label-top" aria-hidden="true"><span className="brand-cross">+</span><span>{copy.core}<small>PC / 0{selected + 1}</small></span></div>
          <div className="brand-scene-label brand-scene-label-bottom" aria-hidden="true"><span>{copy.move}</span><span>↗</span></div>
        </div>
        <div className="brand-model-controls" role="tablist" aria-label={copy.models} ref={controls}>
          {models.map((item, index) => <button key={item.id} id={`hero-model-${index}`} role="tab" type="button" aria-selected={selected === index} aria-controls="hero-model-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={(e) => navigate(e, index)}><span>0{index + 1}</span>{copy.type[index]}<i aria-hidden="true"/></button>)}
        </div>
        <div className="brand-model-panel" id="hero-model-panel" role="tabpanel" aria-labelledby={`hero-model-${selected}`}><div><strong>{model.name}</strong><p>{copy.description[selected]}</p></div><a href={`/models/${model.id}`} aria-label={`${copy.detail} — ${model.name}`}><span aria-hidden="true">↗</span></a></div>
      </div>
    </div>
    <div className="brand-hero-bottom pc-frame"><a href="#models">{copy.scroll}<span aria-hidden="true">↓</span></a><span className="brand-bottom-rule" aria-hidden="true"/><span className="brand-origin">TAIPEI · TAIWAN</span><button className="brand-motion-toggle" type="button" aria-pressed={motionPaused} onClick={onToggleMotion}><span aria-hidden="true">{motionPaused ? "▷" : "Ⅱ"}</span>{motionPaused ? copy.resume : copy.pause}</button></div>
  </section>;
}
