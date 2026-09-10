"use client";

import { useId, useRef, useState } from "react";
import { MODEL_CATALOG } from "../lib/models";
import {
  API_BASE_URL,
  buildIntegrationExample,
  DEFAULT_INTEGRATION_INPUTS,
  getModelIntegration,
  type IntegrationInputs,
  type IntegrationLanguage,
} from "../lib/integration-examples";
import { useLocale } from "./locale-provider";

const LANGUAGES: { id: IntegrationLanguage; label: string; file: string }[] = [
  { id: "python", label: "Python", file: "example.py" },
  { id: "javascript", label: "JavaScript", file: "example.mjs" },
  { id: "curl", label: "cURL", file: "Terminal" },
];

export function IntegrationBuilder({
  initialModel = "glm-5.2-fp8",
}: {
  initialModel?: string;
}) {
  const { locale } = useLocale();
  const t = (en: string, zh: string) => (locale === "en" ? en : zh);
  const [modelId, setModelId] = useState(
    getModelIntegration(initialModel).model.id,
  );
  const [language, setLanguage] = useState<IntegrationLanguage>("python");
  const [inputs, setInputs] = useState<IntegrationInputs>(
    DEFAULT_INTEGRATION_INPUTS,
  );
  const [mode, setMode] = useState<"sdk" | "app">("sdk");
  const [feedback, setFeedback] = useState<string>("");
  const languageRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const { model, kind, endpoint } = getModelIntegration(modelId);
  const code = buildIntegrationExample(modelId, language, inputs);
  const chatCompatible = kind === "chat" || kind === "vision";
  const languageInfo = LANGUAGES.find((item) => item.id === language)!;
  const installCommand =
    language === "python"
      ? `python -m pip install ${kind === "rerank" ? "httpx" : "openai"}`
      : language === "javascript" && kind !== "rerank"
        ? "npm install openai"
        : "";

  async function copyValue(value: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setFeedback(t(`${label} copied.`, `已複製${label}。`));
    } catch {
      setFeedback(
        t(
          "Copy unavailable. Select and copy the text manually.",
          "無法自動複製，請選取文字手動複製。",
        ),
      );
    }
  }

  function updateInput(key: keyof IntegrationInputs, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
    setFeedback("");
  }

  function selectModel(nextModel: string) {
    setModelId(nextModel);
    setFeedback("");
    const url = new URL(window.location.href);
    url.searchParams.set("model", nextModel);
    window.history.replaceState(window.history.state, "", url);
  }

  function selectLanguage(index: number) {
    const next = (index + LANGUAGES.length) % LANGUAGES.length;
    setLanguage(LANGUAGES[next].id);
    setFeedback("");
    languageRefs.current[next]?.focus();
  }

  return (
    <main id="main-content" className="platform-page integration-page">
      <header className="integration-intro">
        <p className="integration-eyebrow">
          {t("Developer workspace / Integrations", "開發工作區 / 串接工具")}
        </p>
        <div>
          <h1>{t("Your next integration.", "開始你的下一個串接。")}</h1>
          <p>
            {t(
              "Choose a model, tailor a request, and take working code into your application.",
              "選擇模型、調整請求，將產生的程式碼帶入你的應用程式。",
            )}
          </p>
        </div>
        <a className="integration-subtle-link" href="/docs">
          {t("API documentation", "API 文件")} <span aria-hidden="true">↗</span>
        </a>
      </header>

      <div className="integration-workbench">
        <aside
          className="integration-config"
          aria-label={t("Request configuration", "請求設定")}
        >
          <div className="integration-section-title">
            <span>01</span>
            <h2>{t("Configure", "設定請求")}</h2>
          </div>
          <label htmlFor={`${id}-model`}>{t("Model", "模型")}</label>
          <select
            id={`${id}-model`}
            value={modelId}
            onChange={(event) => selectModel(event.target.value)}
          >
            {MODEL_CATALOG.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="integration-model-description">
            {model.servingRole[locale]}
          </p>

          <div className="integration-endpoint">
            <span>POST</span>
            <code>{endpoint}</code>
          </div>

          {kind !== "transcription" && (
            <>
              <label htmlFor={`${id}-prompt`}>
                {kind === "rerank"
                  ? t("Search query", "搜尋問題")
                  : kind === "embedding"
                    ? t("Text to embed", "要轉成向量的文字")
                    : kind === "speech"
                      ? t("Text to speak", "要朗讀的文字")
                      : t("Prompt", "提示詞")}
              </label>
              <textarea
                id={`${id}-prompt`}
                rows={5}
                value={inputs.prompt}
                onChange={(event) => updateInput("prompt", event.target.value)}
                spellCheck={false}
              />
            </>
          )}
          {kind === "vision" && (
            <>
              <label htmlFor={`${id}-image`}>
                {t("Image URL", "圖片網址")}
              </label>
              <input
                id={`${id}-image`}
                type="url"
                value={inputs.imageUrl}
                onChange={(event) =>
                  updateInput("imageUrl", event.target.value)
                }
                spellCheck={false}
              />
              <p className="integration-field-note">
                {t(
                  "Replace the example URL with an accessible image.",
                  "請將範例網址替換成可存取的圖片。",
                )}
              </p>
            </>
          )}
          {kind === "transcription" && (
            <>
              <label htmlFor={`${id}-audio`}>
                {t("Local audio filename", "本機音檔名稱")}
              </label>
              <input
                id={`${id}-audio`}
                value={inputs.audioFile}
                onChange={(event) =>
                  updateInput("audioFile", event.target.value)
                }
                spellCheck={false}
              />
              <p className="integration-field-note">
                {t(
                  "The file will be read from the machine running your code.",
                  "程式會讀取執行環境中的音檔。",
                )}
              </p>
            </>
          )}
          {kind === "rerank" && (
            <>
              <label htmlFor={`${id}-documents`}>
                {t("Documents · one per line", "候選文件・每行一份")}
              </label>
              <textarea
                id={`${id}-documents`}
                rows={5}
                value={inputs.documents}
                onChange={(event) =>
                  updateInput("documents", event.target.value)
                }
                spellCheck={false}
              />
            </>
          )}
          {kind === "speech" && (
            <p className="integration-callout">
              {t(
                "IndexTTS2 needs a registered reference voice. Ask the team to provision a voice ID, then set POWERCHAMPION_VOICE_ID in your runtime.",
                "IndexTTS2 需要已註冊的參考音色。請聯絡團隊配置音色 ID，並在執行環境設定 POWERCHAMPION_VOICE_ID。",
              )}
            </p>
          )}
          <div className="integration-config-links">
            <a href={`/models/${model.id}`}>
              {t("Model details", "模型詳情")} <span aria-hidden="true">↗</span>
            </a>
            <a
              href={chatCompatible ? `/playground?model=${model.id}` : "/docs"}
            >
              {chatCompatible
                ? t("Open Playground", "開啟 Playground")
                : t("Endpoint guide", "端點說明")}{" "}
              <span aria-hidden="true">↗</span>
            </a>
          </div>
          <p className="integration-field-note">
            {t(
              "Code generation is local. Running a request with your key consumes API credit.",
              "程式碼在本機產生。使用金鑰執行請求時，會扣除 API 額度。",
            )}{" "}
            <a href="/status">{t("Check availability", "查看服務狀態")}</a>
          </p>
        </aside>

        <section
          className="integration-output"
          aria-label={t("Connection instructions", "串接步驟")}
        >
          <div className="integration-output-top">
            <div className="integration-section-title">
              <span>02</span>
              <h2>{t("Connect", "完成串接")}</h2>
            </div>
            <div
              className="integration-mode-switch"
              role="group"
              aria-label={t("Integration method", "串接方式")}
            >
              <button
                type="button"
                aria-pressed={mode === "sdk"}
                onClick={() => setMode("sdk")}
              >
                {t("Write code", "程式碼")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "app"}
                onClick={() => setMode("app")}
              >
                {t("Connect an app", "串接應用程式")}
              </button>
            </div>
          </div>

          {mode === "sdk" ? (
            <>
              <div className="integration-code-toolbar">
                <div
                  className="integration-language-tabs"
                  role="tablist"
                  aria-label={t("Code language", "程式語言")}
                >
                  {LANGUAGES.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={language === item.id}
                      aria-controls={`${id}-code-panel`}
                      id={`${id}-${item.id}-tab`}
                      tabIndex={language === item.id ? 0 : -1}
                      ref={(element) => {
                        languageRefs.current[index] = element;
                      }}
                      onClick={() => selectLanguage(index)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowRight" ||
                          event.key === "ArrowLeft"
                        ) {
                          event.preventDefault();
                          selectLanguage(
                            index + (event.key === "ArrowRight" ? 1 : -1),
                          );
                        }
                        if (event.key === "Home" || event.key === "End") {
                          event.preventDefault();
                          selectLanguage(
                            event.key === "Home" ? 0 : LANGUAGES.length - 1,
                          );
                        }
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  className="integration-copy"
                  type="button"
                  onClick={() => void copyValue(code, t("Code", "程式碼"))}
                >
                  {t("Copy code", "複製程式碼")}{" "}
                  <span aria-hidden="true">⧉</span>
                </button>
              </div>
              <div className="integration-code-file">
                <span>{languageInfo.file}</span>
                <span>
                  {language === "javascript"
                    ? "Node.js · server"
                    : language === "python"
                      ? "Python · server"
                      : "Shell"}
                </span>
              </div>
              <div
                className="integration-code-panel"
                role="tabpanel"
                id={`${id}-code-panel`}
                aria-labelledby={`${id}-${language}-tab`}
                tabIndex={0}
              >
                <pre>
                  <code>{code}</code>
                </pre>
              </div>
              <div className="integration-runtime">
                <h3>{t("Before you run", "執行前準備")}</h3>
                <ol>
                  <li>
                    {installCommand ? (
                      <>
                        {t("Install the dependency:", "安裝套件：")}{" "}
                        <code>{installCommand}</code>
                      </>
                    ) : (
                      t(
                        language === "javascript"
                          ? "Use a current Node.js runtime with built-in fetch."
                          : "Run this command in a shell with cURL installed.",
                        language === "javascript"
                          ? "使用內建 fetch 的新版 Node.js 執行環境。"
                          : "使用已安裝 cURL 的命令列環境。",
                      )
                    )}
                  </li>
                  <li>
                    {t(
                      "Set POWERCHAMPION_API_KEY as an environment variable on your server.",
                      "在伺服器上將 POWERCHAMPION_API_KEY 設為環境變數。",
                    )}
                  </li>
                  <li>
                    {t(
                      "Review the inputs, save the example, and run it in your own environment.",
                      "確認輸入內容、儲存範例，並在你的環境中執行。",
                    )}
                  </li>
                </ol>
                <p>
                  {t(
                    "Keep API keys on your server; do not embed them in browser code or public repositories.",
                    "請將 API 金鑰保存在伺服器，不要嵌入瀏覽器程式碼或公開儲存庫。",
                  )}
                </p>
              </div>
            </>
          ) : (
            <div className="integration-app-guide">
              <h3>{t("Use a custom API provider", "設定自訂 API 供應商")}</h3>
              <p>
                {chatCompatible
                  ? t(
                      "In an app that supports a custom OpenAI-compatible chat provider, use the values below. Field names vary by app.",
                      "在支援自訂 OpenAI 相容對話供應商的應用程式中，填入下方設定。不同應用程式的欄位名稱可能不同。",
                    )
                  : t(
                      "This model uses a dedicated endpoint. Your app must support this API type; a chat-only connector will not be enough. Use the code example if your app does not expose this endpoint.",
                      "這個模型使用專屬端點。應用程式必須支援此 API 類型，僅支援對話的連接器無法使用。若應用程式未提供此端點，請使用程式碼範例。",
                    )}
              </p>
              <ol>
                <li>
                  <strong>
                    {t("Add a custom provider", "新增自訂供應商")}
                  </strong>
                  <p>
                    {t(
                      "Choose a provider setting that allows you to edit the base URL and model ID.",
                      "選擇可自行編輯基礎網址與模型 ID 的供應商設定。",
                    )}
                  </p>
                </li>
                <li>
                  <strong>
                    {t("Enter your connection settings", "輸入串接設定")}
                  </strong>
                  <p>
                    {t(
                      "Copy the base URL and exact model ID below. Enter your own API key only in the trusted app.",
                      "複製下方基礎網址及完整模型 ID。僅在可信任的應用程式中填入你的 API 金鑰。",
                    )}
                  </p>
                </li>
                <li>
                  <strong>
                    {t("Send a small test request", "發送簡短的測試請求")}
                  </strong>
                  <p>
                    {t(
                      "Confirm the selected model is available, then check the response and your balance.",
                      "確認所選模型目前可用，再檢查回應與帳戶餘額。",
                    )}
                  </p>
                </li>
              </ol>
              {kind === "vision" && (
                <p className="integration-callout">
                  {t(
                    "For image input, your app must send image_url content blocks in chat messages.",
                    "若要傳送圖片，應用程式必須在對話訊息中送出 image_url 內容區塊。",
                  )}
                </p>
              )}
              <a className="integration-subtle-link" href="/console">
                {t("Check API balance", "查詢 API 餘額")}{" "}
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          )}

          <div className="integration-connection-values">
            <div>
              <span>{t("Base URL", "基礎網址")}</span>
              <code>{API_BASE_URL}</code>
              <button
                type="button"
                aria-label={t("Copy base URL", "複製基礎網址")}
                onClick={() =>
                  void copyValue(API_BASE_URL, t("Base URL", "基礎網址"))
                }
              >
                ⧉
              </button>
            </div>
            <div>
              <span>Model ID</span>
              <code>{model.modelId}</code>
              <button
                type="button"
                aria-label={t("Copy model ID", "複製模型 ID")}
                onClick={() =>
                  void copyValue(model.modelId, t("Model ID", "模型 ID"))
                }
              >
                ⧉
              </button>
            </div>
          </div>
          <p className="integration-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
        </section>
      </div>

      <section
        className="integration-help"
        aria-label={t("Integration support", "串接支援")}
      >
        <div>
          <span>01 / ACCESS</span>
          <h2>{t("Need an API key?", "還沒有 API 金鑰？")}</h2>
          <p>
            {t(
              "Request access from the team and fund your prepaid balance.",
              "向團隊申請存取權限，並為預付餘額儲值。",
            )}
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("powerchampion:launch-access"),
              )
            }
          >
            {t("Request API access", "申請 API 存取")}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div>
          <span>02 / TROUBLESHOOT</span>
          <h2>{t("Request not working?", "請求未成功？")}</h2>
          <p>
            {t(
              "401: check your key. 402: check credit. 429: respect Retry-After. 503: check availability and retry later.",
              "401：檢查金鑰。402：檢查額度。429：依 Retry-After 重試。503：查看可用狀態，稍後再試。",
            )}
          </p>
          <a href="/status">
            {t("Service status", "服務狀態")} <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div>
          <span>03 / SCALE</span>
          <h2>{t("A dedicated deployment?", "需要專屬部署？")}</h2>
          <p>
            {t(
              "Plan GPU capacity, model hosting, and deployment requirements with the team.",
              "與團隊規劃 GPU 容量、模型託管及部署需求。",
            )}
          </p>
          <a href="/infrastructure">
            {t("Explore infrastructure", "探索算力服務")}{" "}
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </section>
    </main>
  );
}
