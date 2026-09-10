"use client";

/* Vinext uses root-relative anchors for page navigation. */
/* eslint-disable @next/next/no-html-link-for-pages */

import { useLocale } from "./locale-provider";
import { MODEL_CATALOG } from "../lib/models";
import { CREDIT_PACKS } from "../lib/pricing";
import type { GatewayStatus } from "../lib/gateway-status";
import { openLaunchAccess } from "./demo-checkout";

export function PlatformOverview({
  gateway,
}: {
  gateway: GatewayStatus | null;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const status = gateway?.status;
  const stateLabel =
    status === "ok"
      ? zh
        ? "服務正常"
        : "Operational"
      : status === "warn"
        ? zh
          ? "部分服務受影響"
          : "Degraded service"
        : status === "down"
          ? zh
            ? "服務中斷"
            : "Service interruption"
          : zh
            ? "狀態待確認"
            : "Status unavailable";
  const tools = [
    {
      href: "/models",
      icon: "◈",
      title: zh ? "探索模型" : "Find your model",
      text: zh
        ? "依能力篩選，深入查看規格、用途與計費單位。"
        : "Filter by capability. Explore specifications, use cases, and billing units.",
      action: zh ? "開啟目錄" : "Open catalog",
    },
    {
      href: "/compare",
      icon: "⇄",
      title: zh ? "比較與試算" : "Compare before you build",
      text: zh
        ? "並排比較最多三個模型，依自己的用量試算費用。"
        : "Compare up to three models side by side and estimate costs for your workload.",
      action: zh ? "開始比較" : "Compare models",
    },
    {
      href: "/playground",
      icon: "▷",
      title: zh ? "測試真實請求" : "Make your first request",
      text: zh
        ? "帶入你的 API 金鑰、設定提示詞，檢視模型回應與用量。"
        : "Bring your API key, configure a prompt, and inspect the response and token usage.",
      action: zh ? "開啟測試介面" : "Open playground",
    },
    {
      href: "/integrations",
      icon: "⌘",
      title: zh ? "完成產品串接" : "Connect your application",
      text: zh
        ? "選擇模型與程式語言，產生可複製的串接設定及範例。"
        : "Choose a model and language. Generate copyable configuration and request examples.",
      action: zh ? "產生串接設定" : "Configure integration",
    },
  ];

  return (
    <main id="main-content" className="platform-page platform-overview">
      <div className="platform-page-heading">
        <div>
          <p className="platform-eyebrow">
            {zh ? "POWER CHAMPION 模型平台" : "YOUR AI DEVELOPMENT WORKSPACE"}
          </p>
          <h1>
            {zh ? "從選模型，到上線產品。" : "From model to application."}
          </h1>
          <p>
            {zh
              ? "探索、比較、測試、串接。打造 AI 產品需要的工具，在這裡一起完成。"
              : "Explore, compare, test, and integrate. Your next AI workflow starts here."}
          </p>
        </div>
        <button
          type="button"
          className="pc-button"
          onClick={() => openLaunchAccess()}
        >
          {zh ? "取得 API 金鑰" : "Get an API key"}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      <div className="platform-overview-summary">
        <div>
          <span>{zh ? "模型目錄" : "CATALOG"}</span>
          <strong>
            {MODEL_CATALOG.length}
            <small>{zh ? "個模型" : "models"}</small>
          </strong>
          <p>
            {zh
              ? "文字、視覺、圖像、音訊、檢索"
              : "Text, vision, image, audio & retrieval"}
          </p>
        </div>
        <div>
          <span>{zh ? "入門額度" : "STARTER CREDIT"}</span>
          <strong>
            <small>US$</small>
            {CREDIT_PACKS[0].price}
          </strong>
          <p>
            {zh
              ? "預付餘額，依模型使用量計費"
              : "Prepaid balance, model-specific usage rates"}
          </p>
        </div>
        <div>
          <span>{zh ? "閘道狀態" : "GATEWAY STATUS"}</span>
          <a
            href="/status"
            className={`platform-status-label platform-status-${status ?? "unknown"}`}
          >
            <i aria-hidden="true" />
            {stateLabel}
            <span aria-hidden="true">↗</span>
          </a>
          <p>
            {gateway
              ? zh
                ? "來源：閘道公開狀態，開啟狀態頁查看更新"
                : "From the public gateway. Open status for updates."
              : zh
                ? "目前無法取得即時資料"
                : "Live status could not be retrieved."}
          </p>
        </div>
      </div>
      <div className="platform-section-title">
        <h2>{zh ? "開始使用" : "Start building"}</h2>
        <span>{zh ? "探索工具不需要金鑰" : "No key needed to explore"}</span>
      </div>
      <div className="platform-tool-grid">
        {tools.map((tool, i) => (
          <a className="platform-tool-card" href={tool.href} key={tool.href}>
            <div>
              <span className="platform-tool-icon" aria-hidden="true">
                {tool.icon}
              </span>
              <small>0{i + 1}</small>
            </div>
            <h3>{tool.title}</h3>
            <p>{tool.text}</p>
            <strong>
              {tool.action}
              <span aria-hidden="true">→</span>
            </strong>
          </a>
        ))}
      </div>
      <div className="platform-overview-lower">
        <section>
          <div className="platform-section-title">
            <h2>{zh ? "精選模型" : "In the catalog"}</h2>
            <a href="/models">{zh ? "查看全部" : "View all"} ↗</a>
          </div>
          <div className="platform-model-list">
            {MODEL_CATALOG.slice(0, 4).map((model) => (
              <a href={`/models/${model.id}`} key={model.id}>
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.servingRole[locale]}</small>
                </span>
                <span>
                  ${model.inputPerMillion.toFixed(2)}
                  <small>
                    {model.categories.includes("image")
                      ? zh
                        ? "每張圖片"
                        : "per image"
                      : zh
                        ? "每百萬輸入 Token"
                        : "per 1M input tokens"}
                  </small>
                </span>
                <span aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>
        <section className="platform-balance-prompt">
          <span className="platform-eyebrow">
            {zh ? "已經有金鑰？" : "ALREADY HAVE A KEY?"}
          </span>
          <h2>{zh ? "掌握可用額度。" : "Keep your balance in view."}</h2>
          <p>
            {zh
              ? "使用 API 金鑰查詢目前可用餘額。金鑰不會儲存在瀏覽器；需要更多額度時，可查看儲值方案。"
              : "Check your available prepaid balance with your API key. Your key is not saved in the browser. Explore credit packs when you’re ready to top up."}
          </p>
          <a className="pc-button" href="/console">
            {zh ? "查詢即時餘額" : "Check live balance"}
            <span aria-hidden="true">→</span>
          </a>
          <a className="pc-link" href="/pricing">
            {zh ? "查看儲值方案" : "View credit packs"}
            <span aria-hidden="true">↗</span>
          </a>
        </section>
      </div>
    </main>
  );
}
