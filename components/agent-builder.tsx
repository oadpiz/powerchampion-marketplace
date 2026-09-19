"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { AgentAccount } from "./agent-account";
import {
  AGENT_TEMPLATES,
  getAgentTemplate,
  type AgentTemplateId,
} from "../lib/agents";
import {
  AGENT_CHAT_MODEL_IDS,
  AGENT_DRAFT_STORAGE_KEY,
  AGENT_LIMITS,
  AGENT_TEST_STORAGE_KEY,
  AGENT_TEST_TTL_MS,
  AGENT_TONES,
  buildAgentInstructions,
  createAgentDraft,
  exportAgentBlueprint,
  parseDraft,
  parseAgentTestSession,
  type AgentDraft,
} from "../lib/agent-blueprint";
import { useLocale } from "./locale-provider";

const COPY = {
  en: {
    kicker: "AGENT STUDIO",
    title: "Make it your own.",
    lead: "Give your assistant a purpose, a voice and the knowledge it needs. Then put it to the test.",
    back: "All agents",
    starting: "Choose a starting point",
    startingHint:
      "A template replaces the fields below. Save your current draft first if you want to keep it.",
    steps: ["Identity", "Behavior", "Knowledge", "Test & export"],
    identityTitle: "What should your agent do?",
    identityLead:
      "Define its role and the outcome it should help people reach.",
    name: "Agent name",
    purpose: "Purpose",
    model: "Model",
    modelNote:
      "Choose a chat model. This builder configures instructions; it does not deploy a model or connect external tools.",
    behaviorTitle: "Set the way it works.",
    behaviorLead:
      "Good instructions explain the task, the boundaries and the desired response.",
    instructions: "System instructions",
    tone: "Response tone",
    tones: ["Balanced", "Concise", "Friendly", "Formal"],
    knowledgeTitle: "Give it useful context.",
    knowledgeLead:
      "Paste the information your agent should use, such as a product summary, policies or project notes.",
    knowledge: "Reference knowledge",
    knowledgePlaceholder: "Add relevant facts and reference material here…",
    knowledgeNote:
      "Reference text is included in the model request when you test this agent. It is saved in this browser only when you choose Save draft.",
    testTitle: "Try it on a real question.",
    testLead:
      "Choose a representative prompt. Testing opens the chat workspace, where you review and send the request with your API key.",
    sample: "Sample test prompt",
    samplePlaceholder: "Write a question your agent should be able to answer…",
    test: "Test this agent",
    testNotice:
      "This action temporarily stores the configuration and reference text in this tab for up to 30 minutes. No model request is sent until you send a message in chat. API usage may be billed.",
    next: "Continue",
    previous: "Back",
    preview: "Instruction preview",
    previewLabel: "Assembled instructions",
    previewNote:
      "This is the system message your model receives. Changes appear here as you type.",
    copy: "Copy instructions",
    copied: "Instructions copied.",
    copyError:
      "Copy is unavailable. Select the instructions to copy them manually.",
    export: "Export JSON",
    exported: "JSON blueprint exported.",
    exportError:
      "The file could not be downloaded. Try again or copy the instructions instead.",
    save: "Save draft in this browser",
    saved: "Draft saved in this browser, including reference text.",
    saveNotice:
      "Saving is optional. Your current draft and reference text stay in this browser until you delete them.",
    restore: "Restore saved draft",
    restored: "Saved draft restored.",
    resumed: "Current test configuration restored.",
    sessionExpired:
      "The test configuration has expired. Restore a saved draft or choose a template to continue.",
    remove: "Delete saved draft",
    removed: "Saved draft deleted. Your current edits remain on this page.",
    reset: "Reset to template",
    resetDone: "Current fields reset to the selected template.",
    storageError:
      "Browser storage is unavailable. You can still copy instructions or export JSON.",
    invalid:
      "Complete the name, purpose and system instructions before saving, exporting or testing.",
    built: "BUILT FROM YOUR CONFIGURATION",
    local: "Instruction-based assistant",
    external: "No external tools connected",
    chars: "characters",
    optional: "Optional",
  },
  zh: {
    kicker: "AGENT 工作室",
    title: "打造你的專屬助理。",
    lead: "定義助理的任務、語氣與參考知識，接著在實際對話中測試。",
    back: "所有助理",
    starting: "選擇起始範本",
    startingHint: "選擇範本會取代下方設定。若要保留目前內容，請先儲存草稿。",
    steps: ["角色設定", "行為指令", "參考知識", "測試與匯出"],
    identityTitle: "你希望助理完成什麼？",
    identityLead: "先定義角色，以及它應協助使用者達成的結果。",
    name: "助理名稱",
    purpose: "任務目的",
    model: "模型",
    modelNote:
      "選擇對話模型。此工作室設定的是模型指令，不會部署模型或連接外部工具。",
    behaviorTitle: "設定它的工作方式。",
    behaviorLead: "清楚的指令應說明任務、限制，以及你期待的回覆方式。",
    instructions: "系統指令",
    tone: "回覆語氣",
    tones: ["均衡", "簡潔", "親切", "正式"],
    knowledgeTitle: "提供實用的參考資訊。",
    knowledgeLead: "貼上助理應參考的資料，例如產品介紹、服務政策或專案筆記。",
    knowledge: "參考知識",
    knowledgePlaceholder: "在這裡加入相關事實與參考資料…",
    knowledgeNote:
      "測試助理時，參考文字會隨請求傳送給模型。只有按下儲存草稿後，內容才會保存在此瀏覽器。",
    testTitle: "用一個實際問題測試。",
    testLead:
      "選擇具代表性的提示詞。測試會開啟對話工作區，讓你確認內容，再以 API 金鑰傳送請求。",
    sample: "測試提示詞",
    samplePlaceholder: "寫下一個助理應該能回答的問題…",
    test: "測試這個助理",
    testNotice:
      "此操作會將設定與參考文字暫存在此分頁，最長保留 30 分鐘。開啟對話後，按下傳送訊息才會呼叫模型，API 使用量可能計費。",
    next: "繼續",
    previous: "上一步",
    preview: "指令預覽",
    previewLabel: "組合後的系統指令",
    previewNote: "這是模型會收到的系統訊息，內容會隨你的編輯即時更新。",
    copy: "複製指令",
    copied: "已複製指令。",
    copyError: "目前無法自動複製，請選取指令後手動複製。",
    export: "匯出 JSON",
    exported: "已匯出 JSON 設定。",
    exportError: "無法下載檔案，請重試或改為複製指令。",
    save: "在此瀏覽器儲存草稿",
    saved: "草稿已儲存在此瀏覽器，包含參考文字。",
    saveNotice:
      "儲存為選用功能。設定與參考文字會留在此瀏覽器，直到你主動刪除。",
    restore: "還原已存草稿",
    restored: "已還原儲存的草稿。",
    resumed: "已還原目前測試中的設定。",
    sessionExpired: "測試設定已過期，請還原已儲存的草稿，或選擇範本繼續。",
    remove: "刪除已存草稿",
    removed: "已刪除儲存的草稿，目前頁面的編輯內容仍會保留。",
    reset: "重設為範本",
    resetDone: "目前欄位已重設為所選範本。",
    storageError: "瀏覽器無法使用儲存功能，你仍可複製指令或匯出 JSON。",
    invalid: "請填寫名稱、任務目的與系統指令後，再儲存、匯出或測試。",
    built: "依你的設定組合",
    local: "以指令設定的助理",
    external: "未連接外部工具",
    chars: "字元",
    optional: "選填",
  },
};

export function AgentBuilder() {
  const { locale } = useLocale();
  const t = COPY[locale];
  const [draft, setDraft] = useState<AgentDraft>(() =>
    createAgentDraft("support", "en"),
  );
  const [step, setStep] = useState(0);
  const [hasSaved, setHasSaved] = useState(false);
  const [message, setMessage] = useState<
    | "saved"
    | "restored"
    | "resumed"
    | "sessionExpired"
    | "removed"
    | "resetDone"
    | "storageError"
    | "copied"
    | "copyError"
    | "exported"
    | "exportError"
    | null
  >(null);
  const edited = useRef(false);
  const chosenTemplate = useRef<AgentTemplateId | null>(null);
  const stepHeading = useRef<HTMLHeadingElement | null>(null);
  const stepNavigation = useRef(false);
  const sessionLoaded = useRef(false);

  useEffect(() => {
    const query = getAgentTemplate(
      new URLSearchParams(window.location.search).get("template"),
    );
    chosenTemplate.current ??= query?.id ?? "support";
    // Restore only the selected template on initialization; drafts require an explicit Restore action.
    if (!edited.current)
      setDraft(createAgentDraft(chosenTemplate.current, locale));
    if (
      !sessionLoaded.current &&
      new URLSearchParams(window.location.search).get("draft") === "session"
    ) {
      sessionLoaded.current = true;
      try {
        const currentTest = parseAgentTestSession(
          sessionStorage.getItem(AGENT_TEST_STORAGE_KEY),
        );
        if (currentTest) {
          edited.current = true;
          chosenTemplate.current = currentTest.draft.templateId;
          setDraft(currentTest.draft);
          setMessage("resumed");
        } else setMessage("sessionExpired");
      } catch {
        setMessage("storageError");
      }
    }
    try {
      setHasSaved(
        parseDraft(window.localStorage.getItem(AGENT_DRAFT_STORAGE_KEY)) !==
          null,
      );
    } catch {
      setHasSaved(false);
    }
  }, [locale]);

  function update<K extends keyof AgentDraft>(field: K, value: AgentDraft[K]) {
    edited.current = true;
    setDraft((previous) => ({ ...previous, [field]: value }));
    setMessage(null);
  }
  function chooseTemplate(id: AgentTemplateId) {
    chosenTemplate.current = id;
    edited.current = false;
    setDraft(createAgentDraft(id, locale));
    setStep(0);
    setMessage(null);
  }
  useEffect(() => {
    if (stepNavigation.current) stepHeading.current?.focus();
  }, [step]);
  function moveStep(next: number) {
    stepNavigation.current = true;
    setStep(next);
  }
  const valid = parseDraft(draft) !== null;
  const instructions = buildAgentInstructions(draft);

  function saveDraft() {
    if (!valid) return;
    try {
      localStorage.setItem(AGENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      setHasSaved(true);
      setMessage("saved");
    } catch {
      setMessage("storageError");
    }
  }
  function restoreDraft() {
    try {
      const stored = parseDraft(localStorage.getItem(AGENT_DRAFT_STORAGE_KEY));
      if (stored) {
        edited.current = true;
        chosenTemplate.current = stored.templateId;
        setDraft(stored);
        setMessage("restored");
      } else {
        setHasSaved(false);
        setMessage("storageError");
      }
    } catch {
      setMessage("storageError");
    }
  }
  function removeDraft() {
    try {
      localStorage.removeItem(AGENT_DRAFT_STORAGE_KEY);
      setHasSaved(false);
      setMessage("removed");
    } catch {
      setMessage("storageError");
    }
  }
  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(instructions);
      setMessage("copied");
    } catch {
      setMessage("copyError");
    }
  }
  function exportDraft() {
    if (!valid) return;
    try {
      const url = URL.createObjectURL(
        new Blob([exportAgentBlueprint(draft)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        draft.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "agent"
      }-blueprint.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("exported");
    } catch {
      setMessage("exportError");
    }
  }
  function prepareTest(event: MouseEvent<HTMLAnchorElement>) {
    if (!valid) {
      event.preventDefault();
      return;
    }
    try {
      const now = Date.now();
      sessionStorage.setItem(
        AGENT_TEST_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          draft,
          createdAt: now,
          expiresAt: now + AGENT_TEST_TTL_MS,
        }),
      );
    } catch {
      event.preventDefault();
      setMessage("storageError");
    }
  }

  return (
    <main id="main-content" className="platform-page agent-builder-page">
      <header className="agent-builder-header">
        <div>
          <p className="agent-builder-kicker">{t.kicker}</p>
          <h1>{t.title}</h1>
          <p>{t.lead}</p>
        </div>
        <a href="/agents">{t.back} ↗</a>
      </header>
      <section
        className="agent-builder-starting"
        aria-labelledby="agent-starting-title"
      >
        <div>
          <h2 id="agent-starting-title">{t.starting}</h2>
          <p>{t.startingHint}</p>
        </div>
        <div className="agent-template-options">
          {AGENT_TEMPLATES.map((template) => (
            <button
              type="button"
              key={template.id}
              aria-pressed={draft.templateId === template.id}
              onClick={() => chooseTemplate(template.id)}
            >
              <span aria-hidden="true">{template.icon}</span>
              <strong>{template.name[locale]}</strong>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </section>
      <div className="agent-builder-layout">
        <section
          className="agent-builder-editor"
          aria-label={locale === "zh" ? "助理設定" : "Agent configuration"}
        >
          <nav
            className="agent-builder-steps"
            aria-label={locale === "zh" ? "設定步驟" : "Configuration steps"}
          >
            {t.steps.map((name, index) => (
              <button
                type="button"
                key={name}
                aria-current={step === index ? "step" : undefined}
                onClick={() => moveStep(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {name}
              </button>
            ))}
          </nav>
          <div className="agent-builder-step-panel">
            <h2 ref={stepHeading} tabIndex={-1}>
              {
                [
                  t.identityTitle,
                  t.behaviorTitle,
                  t.knowledgeTitle,
                  t.testTitle,
                ][step]
              }
            </h2>
            <p className="agent-builder-step-lead">
              {
                [t.identityLead, t.behaviorLead, t.knowledgeLead, t.testLead][
                  step
                ]
              }
            </p>
            <div hidden={step !== 0}>
              <label className="agent-builder-field">
                {t.name}
                <input
                  value={draft.name}
                  maxLength={AGENT_LIMITS.name}
                  required
                  onChange={(event) => update("name", event.target.value)}
                  aria-invalid={!draft.name.trim()}
                />
              </label>
              <label className="agent-builder-field">
                {t.purpose}
                <textarea
                  value={draft.purpose}
                  maxLength={AGENT_LIMITS.purpose}
                  required
                  rows={4}
                  onChange={(event) => update("purpose", event.target.value)}
                  aria-invalid={!draft.purpose.trim()}
                />
              </label>
              <label className="agent-builder-field">
                {t.model}
                <select
                  value={draft.model}
                  onChange={(event) =>
                    update("model", event.target.value as AgentDraft["model"])
                  }
                >
                  {AGENT_CHAT_MODEL_IDS.map((model) => (
                    <option key={model} value={model}>
                      {model === "glm-5.2-fp8" ? "GLM 5.2 FP8" : "Qwen3-VL 30B"}
                    </option>
                  ))}
                </select>
              </label>
              <p className="agent-builder-hint">{t.modelNote}</p>
            </div>
            <div hidden={step !== 1}>
              <label className="agent-builder-field">
                {t.instructions}
                <textarea
                  value={draft.systemInstructions}
                  maxLength={AGENT_LIMITS.systemInstructions}
                  required
                  rows={10}
                  onChange={(event) =>
                    update("systemInstructions", event.target.value)
                  }
                  aria-invalid={!draft.systemInstructions.trim()}
                />
              </label>
              <fieldset className="agent-tone-options">
                <legend>{t.tone}</legend>
                {AGENT_TONES.map((tone, index) => (
                  <label key={tone}>
                    <input
                      type="radio"
                      name="agent-tone"
                      value={tone}
                      checked={draft.tone === tone}
                      onChange={() => update("tone", tone)}
                    />
                    <span>{t.tones[index]}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div hidden={step !== 2}>
              <label className="agent-builder-field">
                {t.knowledge}
                <textarea
                  value={draft.knowledge}
                  maxLength={AGENT_LIMITS.knowledge}
                  rows={12}
                  onChange={(event) => update("knowledge", event.target.value)}
                  placeholder={t.knowledgePlaceholder}
                  aria-describedby="agent-knowledge-note"
                />
              </label>
              <p className="agent-builder-count">
                {draft.knowledge.length.toLocaleString()} / 8,000 {t.chars} ·{" "}
                {t.optional}
              </p>
              <p id="agent-knowledge-note" className="agent-builder-hint">
                {t.knowledgeNote}
              </p>
            </div>
            <div hidden={step !== 3}>
              <label className="agent-builder-field">
                {t.sample}
                <textarea
                  value={draft.samplePrompt}
                  maxLength={AGENT_LIMITS.samplePrompt}
                  rows={6}
                  onChange={(event) =>
                    update("samplePrompt", event.target.value)
                  }
                  placeholder={t.samplePlaceholder}
                />
              </label>
              <p className="agent-builder-hint">{t.optional}</p>
              <div className="agent-builder-export-box">
                <span aria-hidden="true">↗</span>
                <div>
                  <strong>
                    {locale === "zh"
                      ? "你的設定，可隨時帶走。"
                      : "Your configuration, ready to take with you."}
                  </strong>
                  <p>
                    {locale === "zh"
                      ? "匯出 JSON 可保留所有欄位與組合後的系統指令。"
                      : "Export JSON to keep every field and the assembled system instructions."}
                  </p>
                </div>
              </div>
            </div>
            <div className="agent-builder-step-actions">
              <button
                type="button"
                disabled={step === 0}
                onClick={() => moveStep(step - 1)}
              >
                {t.previous}
              </button>
              <span>{step + 1} / 4</span>
              <button
                type="button"
                disabled={step === 3}
                onClick={() => moveStep(step + 1)}
              >
                {t.next} <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
          <div className="agent-builder-save">
            <div className="agent-builder-save-actions">
              <button type="button" disabled={!valid} onClick={saveDraft}>
                {t.save}
              </button>
              <button
                type="button"
                onClick={() => {
                  chooseTemplate(draft.templateId);
                  setMessage("resetDone");
                }}
              >
                {t.reset}
              </button>
            </div>
            <p>{t.saveNotice}</p>
            {hasSaved && (
              <div className="agent-builder-saved-actions">
                <button type="button" onClick={restoreDraft}>
                  {t.restore}
                </button>
                <button type="button" onClick={removeDraft}>
                  {t.remove}
                </button>
              </div>
            )}
          </div>
        </section>
        <aside
          className="agent-builder-preview"
          aria-labelledby="agent-preview-title"
        >
          <div className="agent-preview-head">
            <p className="agent-builder-kicker">{t.built}</p>
            <h2 id="agent-preview-title">{t.preview}</h2>
            <p>{t.previewNote}</p>
            <div>
              <span>{t.local}</span>
              <span>{draft.model}</span>
            </div>
          </div>
          <pre aria-label={t.previewLabel}>
            <code>{instructions}</code>
          </pre>
          <div className="agent-preview-footer">
            <span>
              {instructions.length.toLocaleString()} / 16,000 {t.chars}
            </span>
            <span>{t.external}</span>
          </div>
          {!valid && (
            <p className="agent-builder-error" role="alert">
              {t.invalid}
            </p>
          )}
          <div className="agent-builder-delivery">
            <div className="agent-builder-delivery-actions">
              <button type="button" onClick={copyInstructions}>
                {t.copy}
              </button>
              <button type="button" disabled={!valid} onClick={exportDraft}>
                {t.export}
              </button>
            </div>
            <a
              className="agent-builder-test"
              href="/chat?agent=custom"
              aria-disabled={!valid}
              onClick={prepareTest}
            >
              {t.test} <span aria-hidden="true">↗</span>
            </a>
            <p>{t.testNotice}</p>
          </div>
          <AgentAccount
            draft={draft}
            valid={valid}
            onLoad={(loaded) => {
              edited.current = true;
              setDraft(loaded);
              setStep(0);
            }}
          />
        </aside>
      </div>
      <p className="agent-builder-message" role="status">
        {message ? t[message] : ""}
      </p>
    </main>
  );
}
