"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { useLocale } from "./locale-provider";
import { useMotionAvailability } from "./promo-motion";
import { TASK_STARTERS, taskEntry } from "../lib/task-starters";
import { PortalError } from "../lib/portal-client";
import {
  downloadTaskArtifact, isTaskTerminal, runtimeClient, runtimeErrorText,
  type RuntimeConfig, type RuntimeTask, type SavedTaskAgent, type TaskControl,
  type TaskDetail, type TaskReference, type TaskStatus,
} from "../lib/runtime-client";

const STATUS: Record<TaskStatus, [string, string]> = {
  queued: ["Queued", "排程中"], running: ["Working", "執行中"], paused: ["Paused", "已暫停"],
  awaiting_approval: ["Needs approval", "等待核准"], completed: ["Completed", "已完成"],
  failed: ["Failed", "執行失敗"], cancelled: ["Cancelled", "已取消"],
};
const PLAN_STATUS: Record<string, [string, string]> = {
  pending: ["Pending", "待處理"], queued: ["Pending", "待處理"], in_progress: ["In progress", "進行中"],
  running: ["In progress", "進行中"], completed: ["Completed", "已完成"], done: ["Completed", "已完成"],
};
const EVENT_KIND: Record<string, [string, string]> = {
  queued: ["Queued", "已排程"], model: ["Agent", "智能體"], tool: ["Tool", "工具"],
  instruction: ["Your instruction", "你的指令"], control: ["Control", "操作"],
  approval: ["Approval", "核准"], completed: ["Completed", "已完成"], error: ["Error", "錯誤"],
};
function date(value: string, zh: boolean) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString(zh ? "zh-TW" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function Status({ status, zh }: { status: TaskStatus; zh: boolean }) {
  return <span className="tasks-status" data-status={status}>{STATUS[status]?.[zh ? 1 : 0] ?? status}</span>;
}
function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Invalid text"));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsText(file, "UTF-8");
  });
}

export function TaskConsole() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const canAnimate = useMotionAvailability();
  const text = (en: string, chinese: string) => zh ? chinese : en;
  const [phase, setPhase] = useState<"loading" | "ready" | "signedOut" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [tasks, setTasks] = useState<RuntimeTask[]>([]);
  const [agents, setAgents] = useState<SavedTaskAgent[]>([]);
  const [agentsUnavailable, setAgentsUnavailable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [pollError, setPollError] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<"instruction" | "download" | null>(null);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [agentId, setAgentId] = useState("");
  const [missingAgent, setMissingAgent] = useState(false);
  const [returnPath, setReturnPath] = useState("/tasks");
  const [starterId, setStarterId] = useState<string | null>(null);
  const [maxSteps, setMaxSteps] = useState("12");
  const [maxOutputTokens, setMaxOutputTokens] = useState("1024");
  const [references, setReferences] = useState<TaskReference[]>([]);
  const [referenceName, setReferenceName] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceError, setReferenceError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [instruction, setInstruction] = useState("");
  const mounted = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const referenceEditor = useRef<HTMLDetailsElement | null>(null);
  const entryInitialized = useRef(false);
  const currentLocale = useRef(locale);

  useEffect(() => { currentLocale.current = locale; }, [locale]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const entry = taskEntry(window.location.search);
      try {
        const settings = await runtimeClient.config(controller.signal);
        const [listing, saved] = await Promise.allSettled([runtimeClient.list(controller.signal), runtimeClient.agents(controller.signal)]);
        if (controller.signal.aborted) return;
        if (listing.status === "rejected") throw listing.reason;
        if (saved.status === "rejected" && saved.reason instanceof PortalError && saved.reason.status === 401) throw saved.reason;
        setConfig(settings);
        setModel(settings.models[0] ?? "");
        setMaxSteps(String(Math.min(12, settings.limits.maxSteps)));
        setMaxOutputTokens(String(Math.min(1024, settings.limits.maxOutputTokens)));
        setTasks(listing.value.tasks);
        const savedAgents = saved.status === "fulfilled" ? saved.value.agents : [];
        const linkedAgent = savedAgents.find((agent) => agent.id === entry.agent);
        setAgents(savedAgents);
        setAgentId(linkedAgent?.id ?? "");
        setMissingAgent(entry.agent !== null && !linkedAgent);
        setReturnPath(entry.returnPath);
        setAgentsUnavailable(saved.status === "rejected");
        setSelectedId(listing.value.tasks[0]?.id ?? null);
        setCreating(entry.agent !== null || entry.starterId !== null || listing.value.tasks.length === 0);
        // Apply a linked starter only after the first successful load. Retrying
        // or changing language must not replace an edited (or cleared) goal.
        if (!entryInitialized.current) {
          entryInitialized.current = true;
          const linkedStarter = TASK_STARTERS.find((item) => item.id === entry.starterId);
          if (linkedStarter) {
            const initialGoal = linkedStarter[currentLocale.current].goal;
            setGoal((current) => current || initialGoal);
            setStarterId(linkedStarter.id);
          }
        }
        setPhase("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setReturnPath(entry.returnPath);
        setLoadError(error);
        setPhase(error instanceof PortalError && error.status === 401 ? "signedOut" : "error");
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (phase !== "ready") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      const version = generation.current;
      try {
        if (!busyRef.current) {
          const [listing, current] = await Promise.all([
            runtimeClient.list(controller.signal),
            selectedId ? runtimeClient.get(selectedId, controller.signal) : Promise.resolve(null),
          ]);
          if (controller.signal.aborted || version !== generation.current) return;
          setTasks(listing.tasks);
          if (current) setDetail(current.task);
          setPollError(false);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof PortalError && error.status === 401) {
          setPhase("signedOut"); setApiKey(""); setDetail(null); setTasks([]);
        } else { setPollError(true); }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 3000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [phase, selectedId]);

  function selectTask(id: string) {
    setSelectedId(id); setCreating(false); setApiKey(""); setActionError(null); setNotice(null); setInstruction("");
  }
  function newTask() {
    setCreating(true); setApiKey(""); setActionError(null); setNotice(null);
  }
  function updateTask(task: RuntimeTask) {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)].slice(0, 50));
    if ("events" in task) setDetail(task as TaskDetail);
  }
  async function mutate(run: (signal: AbortSignal) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; generation.current += 1; setBusy(true); setActionError(null); setNotice(null);
    const controller = new AbortController();
    operation.current = controller;
    try { await run(controller.signal); }
    catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof PortalError && error.status === 401) { setPhase("signedOut"); setApiKey(""); setDetail(null); setTasks([]); }
      else setActionError(error);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const stepLimit = Math.min(20, config?.limits.maxSteps ?? 20);
  const outputLimit = Math.min(4096, config?.limits.maxOutputTokens ?? 4096);
  const referenceLimit = Math.min(8, config?.limits.maxReferences ?? 8);
  const characterLimit = Math.min(32000, config?.limits.referenceCharacters ?? 32000);
  const referenceCharacters = references.reduce((count, item) => count + item.content.length, 0);
  const pendingReference = Boolean(referenceName.trim() || referenceText.trim());
  const available = Boolean(config?.enabled && config.available && config.models.length);
  const valid = goal.trim().length > 0 && goal.trim().length <= 6000 && /^[\x21-\x7e]{8,512}$/.test(apiKey)
    && Boolean(config?.models.includes(model)) && Number.isInteger(Number(maxSteps)) && Number(maxSteps) >= 1 && Number(maxSteps) <= stepLimit
    && Number.isInteger(Number(maxOutputTokens)) && Number(maxOutputTokens) >= 128 && Number(maxOutputTokens) <= outputLimit && !pendingReference && !missingAgent;

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const starter = TASK_STARTERS.find((item) => item.id === starterId);
  function applyStarter(item: typeof TASK_STARTERS[number]) {
    setGoal(item[locale].goal); setStarterId(item.id);
    if (referenceEditor.current) referenceEditor.current.open = true;
  }

  function addReference() {
    if (!referenceName.trim() || !referenceText.trim() || referenceText.includes("\0") || references.length >= referenceLimit || referenceCharacters + referenceText.length > characterLimit) {
      setReferenceError(true); return;
    }
    setReferences((current) => [...current, { name: referenceName.trim(), content: referenceText }]);
    setReferenceName(""); setReferenceText(""); setReferenceError(false);
  }
  async function uploadFiles(files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(true); setReferenceError(false);
    try {
      const incoming = Array.from(files);
      if (incoming.length + references.length > referenceLimit || incoming.some((file) => !/\.(txt|csv|md)$/i.test(file.name) || file.size > characterLimit * 4)) throw new Error("Invalid references");
      const loaded = await Promise.all(incoming.map(async (file) => ({ name: file.name.slice(0, 160), content: await readTextFile(file) })));
      if (loaded.some((item) => !item.content.trim() || item.content.includes("\0")) || referenceCharacters + loaded.reduce((sum, item) => sum + item.content.length, 0) > characterLimit) throw new Error("Invalid references");
      if (mounted.current) setReferences((current) => [...current, ...loaded]);
    } catch { if (mounted.current) setReferenceError(true); }
    finally { if (mounted.current) setUploading(false); }
  }
  function createTask(event: FormEvent) {
    event.preventDefault();
    if (!valid || !available || busyRef.current || uploading) return;
    const body = { goal: goal.trim(), model, apiKey, maxSteps: Number(maxSteps), maxOutputTokens: Number(maxOutputTokens), references, ...(agentId ? { agentId } : {}) };
    setApiKey("");
    void mutate(async (signal) => {
      const response = await runtimeClient.create(body, signal);
      if (signal.aborted) return;
      updateTask(response.task); setSelectedId(response.task.id); setCreating(false);
      setGoal(""); setStarterId(null); setReferences([]); setReferenceName(""); setReferenceText("");
    });
  }
  function control(action: TaskControl) {
    if (!current) return;
    void mutate(async (signal) => {
      const response = await runtimeClient.control(current.id, action, signal);
      if (!signal.aborted) updateTask(response.task);
    });
  }
  function decide(decision: "approve" | "reject") {
    if (!current?.approval || current.approval.status !== "pending") return;
    const approval = current.approval;
    void mutate(async (signal) => {
      const response = await runtimeClient.decide(current.id, approval.id, decision, signal);
      if (!signal.aborted) updateTask(response.task);
    });
  }
  function sendInstruction(event: FormEvent) {
    event.preventDefault();
    if (!current || !instruction.trim() || instruction.length > 4000) return;
    void mutate(async (signal) => {
      const response = await runtimeClient.instruct(current.id, instruction.trim(), signal);
      if (!signal.aborted) { updateTask(response.task); setInstruction(""); setNotice("instruction"); }
    });
  }
  function download(artifactId: string) {
    if (!current) return;
    void mutate(async (signal) => {
      const response = await runtimeClient.artifact(current.id, artifactId, signal);
      if (!signal.aborted) { downloadTaskArtifact(response.artifact); setNotice("download"); }
    });
  }
  const current = detail?.id === selectedId ? detail : null;
  const terminal = current ? isTaskTerminal(current.status) : false;
  const pendingApproval = current?.approval?.status === "pending" ? current.approval : null;

  return (
    <main id="main-content" className="tasks-console">
      <header className="tasks-header">
        <div>
          <p className="tasks-eyebrow">POWER CHAMPION / AGENTS</p>
          <h1>{text("Agent tasks", "智能體任務")}</h1>
          <p className="tasks-lead">{text("Set the outcome. Follow the work. Keep the deliverables.", "設定目標，掌握進度，保留每一份成果。")}</p>
        </div>
        <div className="tasks-header-actions">
          <Link href="/agents/build">{text("Build an agent", "建立智能體")} ↗</Link>
          <Link href="/account">{text("Account", "帳號")} ↗</Link>
          {phase === "ready" && available && <button type="button" className="tasks-button" onClick={newTask} disabled={busy}>{text("New task", "新增任務")} <span aria-hidden="true">＋</span></button>}
        </div>
      </header>

      {phase === "loading" && <section className="tasks-panel tasks-loading" role="status"><span className="tasks-empty-symbol" aria-hidden="true">◌</span><p>{text("Loading your saved tasks…", "正在載入已儲存的任務…")}</p></section>}
      {phase === "signedOut" && <section className="tasks-panel tasks-empty">
        <span className="tasks-empty-symbol" aria-hidden="true">↗</span>
        <h2>{text("Your work, in one private workspace.", "讓工作成果，留在自己的空間。")}</h2>
        <p>{text("Sign in to start a task and return to its progress, approvals and files.", "登入後即可建立任務，隨時回來查看進度、核准要求與檔案。")}</p>
        <div className="tasks-capability-strip">
          <div><span>01</span><strong>{text("Bring your sources", "提供資料")}</strong><p>{text("Text, CSV and approved web pages.", "文字、CSV 與經核准的網頁。")}</p></div>
          <div><span>02</span><strong>{text("Guide the work", "掌握執行")}</strong><p>{text("Follow progress. Pause or add direction.", "查看進度、暫停與補充方向。")}</p></div>
          <div><span>03</span><strong>{text("Keep the result", "取得成果")}</strong><p>{text("Download reports and structured files.", "下載報告與結構化檔案。")}</p></div>
        </div>
        <div className="tasks-actions"><Link className="tasks-button" href={`/login?next=${encodeURIComponent(returnPath)}`}>{text("Sign in", "登入")}</Link><Link className="tasks-button-secondary" href={`/register?next=${encodeURIComponent(returnPath)}`}>{text("Create an account", "建立帳號")}</Link></div>
      </section>}
      {phase === "error" && <section className="tasks-panel tasks-empty"><h2>{text("We could not load your workspace.", "目前無法載入工作空間。")}</h2><p role="alert">{runtimeErrorText(loadError, locale)}</p><button type="button" className="tasks-button-secondary" onClick={() => { setPhase("loading"); setRevision((value) => value + 1); }}>{text("Try again", "再試一次")}</button></section>}

      {phase === "ready" && <>
        {!available && <p className="tasks-note" role="status">{text("Task execution is not available. Saved history remains accessible. You can build an agent now or contact us for access.", "任務執行目前無法使用，仍可查看已儲存的紀錄。你可以先建立智能體，或聯繫我們開通服務。")} <Link href="/contact">{text("Contact us", "聯繫我們")} ↗</Link></p>}
        {pollError && <p className="tasks-error" role="status">{text("Live updates are temporarily unavailable. Showing the last saved view; reconnecting automatically. This does not confirm the task has stopped.", "暫時無法取得即時更新，目前顯示上次取得的紀錄，正在自動重新連線。這不代表任務已停止。")}</p>}
        <div className="tasks-workspace">
          <aside className="tasks-sidebar" aria-label={text("Task history", "任務紀錄")}>
            <div className="tasks-sidebar-heading"><h2>{text("Your tasks", "你的任務")}</h2><span className="tasks-count">{tasks.length}</span></div>
            {tasks.length === 0 ? <p className="tasks-hint">{text("Your first task starts here. Saved progress will appear in this list.", "從第一個任務開始。儲存的執行紀錄會顯示在這裡。")}</p> : <ul className="tasks-list">
              {tasks.map((task) => <li key={task.id}><button type="button" className="tasks-list-item" aria-current={!creating && selectedId === task.id ? "true" : undefined} onClick={() => selectTask(task.id)} disabled={busy}>
                <span className="tasks-list-goal">{task.goal}</span>
                <span className="tasks-list-meta"><Status status={task.status} zh={zh} /><time dateTime={task.updatedAt}>{date(task.updatedAt, zh)}</time></span>
              </button></li>)}
            </ul>}
            <p className="tasks-hint">{text("The latest 50 tasks are kept in your account. Active tasks keep working when you close this page.", "帳號保留最近 50 個任務。執行中的任務會在關閉頁面後繼續工作。")}</p>
          </aside>

          <div className="tasks-main">
            {actionError !== null && <p className="tasks-error" role="alert">{runtimeErrorText(actionError, locale)}</p>}
            {notice && <p className="tasks-inline-status" role="status">{notice === "instruction" ? text("Instruction saved. The agent will apply it at the next completed step.", "指令已儲存，智能體會在完成目前步驟後套用。") : text("Download prepared.", "下載已準備完成。")}</p>}
            {creating && available && <section className="tasks-panel">
              <div className="tasks-panel-heading"><div><p className="tasks-kicker">{text("A NEW OUTCOME", "開始新的成果")}</p><h2>{text("What are we working on?", "這次要完成什麼？")}</h2></div><span className="tasks-empty-symbol" aria-hidden="true">✦</span></div>
              <p className="tasks-hint">{text("Give the agent a clear goal and source material. It can read references, analyze CSV data, read approved web pages and create files.", "提供明確的目標與參考資料。智能體可以閱讀資料、分析 CSV、讀取你核准的網頁，並製作檔案。")}</p>
              <div className="tasks-starters" role="group" aria-label={text("Task starting points", "任務起點")}>
                {TASK_STARTERS.map((item) => <motion.button key={item.id} type="button" className="tasks-starter" disabled={busy} aria-pressed={starterId === item.id} onClick={() => applyStarter(item)} whileHover={canAnimate ? { y: -3 } : { y: 0 }} whileTap={canAnimate ? { scale: 0.985 } : { scale: 1 }} transition={{ duration: canAnimate ? 0.18 : 0 }}>
                  <span className="tasks-starter-top" aria-hidden="true"><span>{item.mark}</span><span>↗</span></span><strong>{item[locale].title}</strong><span>{item[locale].detail}</span><small>{item.format}</small>
                </motion.button>)}
              </div>
              <form className="tasks-form" onSubmit={createTask}>
                <label className="tasks-field">{text("What should the agent accomplish?", "希望智能體完成什麼？")}<textarea value={goal} onChange={(event) => setGoal(event.target.value)} required maxLength={6000} rows={5} disabled={busy} placeholder={text("Compare the attached supplier proposals, identify trade-offs and create a decision brief as a Word document.", "比較供應商提案、整理各方案的取捨，並製作 Word 決策報告。")} /></label>
                <div className="tasks-form-grid">
                  <label className="tasks-field">{text("Model", "模型")}<select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy}>{config?.models.map((id) => <option key={id} value={id}>{id}</option>)}</select></label>
                  <label className="tasks-field">{text("Saved agent (optional)", "已儲存的智能體（選填）")}<select value={missingAgent ? "missing" : agentId} onChange={(event) => { setAgentId(event.target.value); setMissingAgent(false); }} disabled={busy}>{missingAgent && <option value="missing" disabled>{text("Choose an available agent", "請選擇可用的智能體")}</option>}<option value="">{text("General task agent", "通用任務智能體")}</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · v{agent.version}</option>)}</select></label>
                </div>
                {missingAgent && <p className="tasks-error" role="alert">{text("The linked agent is not available in this account. Choose an available agent or explicitly select the general task agent.", "此帳號無法取得連結中的智能體。請選擇可用的智能體，或自行改用通用任務智能體。")}</p>}
                {selectedAgent && <p className="tasks-agent-context"><span aria-hidden="true">◈</span><span><strong>{selectedAgent.name} · v{selectedAgent.version}</strong><br />{text("Its saved instructions and reference knowledge will guide this task. The version is captured when you start; future edits do not change a running task.", "此任務會沿用已儲存的指令與參考知識。開始時會保留當下版本，之後的編輯不會改變執行中的任務。")}</span></p>}
                {agentsUnavailable && <p className="tasks-hint">{text("Saved agents could not be loaded. You can still use the general task agent.", "無法載入已儲存的智能體，仍可使用通用任務智能體。")}</p>}
                <label className="tasks-field">{text("Your API key", "你的 API 金鑰")}<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} minLength={8} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy} aria-describedby="task-key-note" /></label>
                <p className="tasks-hint" id="task-key-note">{text("Starting a task uses this key’s model credits. The key is encrypted for this task, cleared when it ends, and never saved in your browser.", "開始任務會使用這把金鑰的模型額度。金鑰會加密供此任務使用，任務結束即清除，不會儲存在瀏覽器。")}</p>
                <div className="tasks-form-grid">
                  <label className="tasks-field">{text("Maximum model steps", "模型步驟上限")}<input type="number" min={1} max={stepLimit} step={1} value={maxSteps} onChange={(event) => setMaxSteps(event.target.value)} disabled={busy} required /></label>
                  <label className="tasks-field">{text("Output tokens per step", "每步輸出 Token 上限")}<input type="number" min={128} max={outputLimit} step={1} value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} disabled={busy} required /></label>
                </div>
                <p className="tasks-hint">{text("These limits bound model calls and each reply; they are not a fixed price. Input tokens also consume credits.", "上述限制控制模型呼叫次數與每次回覆長度，不代表固定費用；輸入 Token 也會消耗額度。")}</p>
                <details className="tasks-reference-editor" ref={referenceEditor}>
                  <summary>{text("References (optional)", "參考資料（選填）")}<span className="tasks-reference-count">{references.length}/{referenceLimit}</span></summary>
                  <div className="tasks-reference-fields">
                    {starter && <p className="tasks-note">{starter[locale].source}</p>}
                    <label className="tasks-field">{text("Reference name", "資料名稱")}<input value={referenceName} maxLength={160} onChange={(event) => setReferenceName(event.target.value)} disabled={busy || uploading} placeholder={text("Project brief or sales.csv", "專案需求或 sales.csv")} /></label>
                    <label className="tasks-field">{text("Reference text", "資料內容")}<textarea value={referenceText} maxLength={characterLimit} rows={4} onChange={(event) => setReferenceText(event.target.value)} disabled={busy || uploading} /></label>
                    <div className="tasks-actions"><button type="button" className="tasks-button-secondary" onClick={addReference} disabled={busy || uploading || !referenceName.trim() || !referenceText.trim() || references.length >= referenceLimit}>{text("Add reference", "加入資料")}</button><label className="tasks-upload">{text("Choose text files", "選擇文字檔案")}<input type="file" accept=".txt,.csv,.md,text/plain,text/csv,text/markdown" multiple disabled={busy || uploading || references.length >= referenceLimit} onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} /></label></div>
                    <p className="tasks-hint">{text(`TXT, CSV or Markdown · ${referenceCharacters.toLocaleString()} / ${characterLimit.toLocaleString()} characters total. Add pasted text before starting.`, `TXT、CSV 或 Markdown · 總字元 ${referenceCharacters.toLocaleString()} / ${characterLimit.toLocaleString()}。貼上內容後請先按「加入資料」。`)}</p>
                    {uploading && <p role="status">{text("Reading files…", "正在讀取檔案…")}</p>}
                    {referenceError && <p className="tasks-error" role="alert">{text(`Use non-empty TXT, CSV or Markdown text, up to ${referenceLimit} references and ${characterLimit.toLocaleString()} characters in total.`, `請提供非空白的 TXT、CSV 或 Markdown 文字，最多 ${referenceLimit} 份，合計不超過 ${characterLimit.toLocaleString()} 字元。`)}</p>}
                    {references.length > 0 && <ul className="tasks-reference-list">{references.map((item, index) => <li key={`${index}-${item.name}`} className="tasks-reference-item"><span>{item.name}<small>{item.content.length.toLocaleString()} {text("characters", "字元")}</small></span><button className="tasks-button-quiet" type="button" disabled={busy || uploading} aria-label={`${text("Remove", "移除")} ${item.name}`} onClick={() => setReferences((current) => current.filter((_, position) => position !== index))}>×</button></li>)}</ul>}
                  </div>
                </details>
                <div className="tasks-actions"><button type="submit" className="tasks-button" disabled={!valid || busy || uploading}>{busy ? text("Starting…", "啟動中…") : text("Start task", "開始任務")} <span aria-hidden="true">↗</span></button><span className="tasks-hint">{text("You can pause, steer or cancel while it works.", "執行中可隨時暫停、補充指令或取消。")}</span></div>
              </form>
            </section>}

            {!creating && selectedId && !current && <section className="tasks-panel tasks-loading" role="status">{text("Loading task details…", "正在載入任務詳情…")}</section>}
            {!creating && current && <>
              <section className="tasks-panel tasks-detail-header" aria-labelledby="task-goal">
                <div className="tasks-panel-heading"><Status status={current.status} zh={zh} /><span className="tasks-hint"><time dateTime={current.updatedAt}>{date(current.updatedAt, zh)}</time></span></div>
                <h2 className="tasks-detail-title" id="task-goal">{current.goal}</h2>
                <p className="tasks-detail-meta">{current.model}{current.agentVersion !== null ? ` · ${text("Agent version", "智能體版本")} ${current.agentVersion}` : ""}</p>
                <div className="tasks-budget"><div><span>{text("Model steps", "模型步驟")}</span><strong>{current.stepCount}<small> / {current.maxSteps}</small></strong></div><div><span>{text("Input tokens", "輸入 Token")}</span><strong>{current.usage.inputTokens.toLocaleString()}</strong></div><div><span>{text("Output tokens", "輸出 Token")}</span><strong>{current.usage.outputTokens.toLocaleString()}</strong></div></div>
                <progress className="tasks-budget-meter" value={current.stepCount} max={current.maxSteps} aria-label={text("Model step budget used", "已使用的模型步驟額度")} />
                <p className="tasks-hint">{text(`Budget used, not completion percentage. Up to ${current.maxOutputTokens.toLocaleString()} output tokens per step.`, `此為已使用額度，不代表完成百分比。每步最多輸出 ${current.maxOutputTokens.toLocaleString()} Token。`)}</p>
                {current.requestedControl && !terminal && <p className="tasks-note" role="status">{current.requestedControl === "pause" ? text("Pause requested. Waiting for the current step to finish.", "已要求暫停，等待目前步驟完成。") : text("Cancellation requested. Waiting for the current step to finish.", "已要求取消，等待目前步驟完成。")}</p>}
                {current.status === "paused" && <p className="tasks-note">{pendingApproval ? text("This paused task needs an approval decision below before it can continue.", "此暫停的任務需要先處理下方的核准要求才能繼續。") : text("This task is paused. Review its latest activity before resuming; its original budget still applies.", "任務已暫停。請確認最新執行紀錄後繼續，原本的額度限制仍然適用。")}</p>}
                {current.error && <p className="tasks-error" role="alert">{current.error}</p>}
                {current.summary && <div className="tasks-summary">{current.summary}</div>}
                {!terminal && <div className="tasks-actions">
                  {(current.status === "running" || current.status === "queued") && <button type="button" className="tasks-button-secondary" disabled={busy || Boolean(current.requestedControl)} onClick={() => control("pause")}>{text("Pause task", "暫停任務")}</button>}
                  {current.status === "paused" && !pendingApproval && <button type="button" className="tasks-button" disabled={busy || !available} onClick={() => control("resume")}>{text("Resume task", "繼續任務")}</button>}
                  <button type="button" className="tasks-button-quiet tasks-button-danger" disabled={busy || current.requestedControl === "cancel"} onClick={() => control("cancel")}>{text("Cancel task", "取消任務")}</button>
                </div>}
              </section>
              {pendingApproval && <section className="tasks-panel tasks-approval" aria-labelledby="task-approval-title">
                <p className="tasks-kicker">{text("YOUR DECISION", "等待你的決定")}</p><h2 id="task-approval-title">{text("Allow this web read?", "允許讀取這個網頁？")}</h2>
                <p>{pendingApproval.reason}</p>
                <code className="tasks-approval-url">{typeof pendingApproval.args.url === "string" ? pendingApproval.args.url : JSON.stringify(pendingApproval.args, null, 2)}</code>
                <p className="tasks-hint">{text("This approves only the exact read shown above, not future web access. The page is read without your account cookies or credentials.", "此核准只適用於上方這一次讀取，不會授權未來的網頁存取。讀取時不會使用你的帳號 Cookie 或憑證。")}</p>
                <div className="tasks-actions"><button type="button" className="tasks-button" disabled={busy || !available || pendingApproval.tool !== "read_url"} onClick={() => decide("approve")}>{text("Approve this read", "核准此次讀取")}</button><button type="button" className="tasks-button-secondary" disabled={busy} onClick={() => decide("reject")}>{text("Reject", "拒絕")}</button></div>
              </section>}
              <section className="tasks-panel" aria-labelledby="task-plan-title"><div className="tasks-panel-heading"><h2 id="task-plan-title">{text("Execution plan", "執行計畫")}</h2><span className="tasks-count">{current.plan.length}</span></div>
                {current.plan.length ? <ol className="tasks-plan">{current.plan.map((step) => <li key={step.id} data-status={step.status}><span>{step.title}</span><span className="tasks-plan-state">{PLAN_STATUS[step.status]?.[zh ? 1 : 0] ?? step.status}</span></li>)}</ol> : <p className="tasks-hint">{text("No plan has been recorded yet. The agent’s saved steps will appear here.", "尚未記錄計畫，智能體儲存的步驟會顯示在這裡。")}</p>}
              </section>
              <section className="tasks-panel" aria-labelledby="task-files-title"><div className="tasks-panel-heading"><h2 id="task-files-title">{text("Deliverables", "成果檔案")}</h2><span className="tasks-count">{current.artifacts.length}</span></div>
                {current.artifacts.length ? <ul className="tasks-artifacts">{current.artifacts.map((artifact) => <li key={artifact.id}><span className="tasks-artifact-icon" aria-hidden="true">↧</span><div className="tasks-artifact-copy"><strong>{artifact.name}</strong><span>{Math.max(1, Math.ceil(artifact.size / 1024)).toLocaleString()} KB · {artifact.mimeType}</span></div><button type="button" className="tasks-button-secondary" disabled={busy} aria-label={`${text("Download", "下載")} ${artifact.name}`} onClick={() => download(artifact.id)}>{text("Download", "下載")}</button></li>)}</ul> : <p className="tasks-hint">{text("No files have been created yet. Downloadable results will appear here as they are saved.", "尚未建立檔案，儲存的成果會在這裡提供下載。")}</p>}
              </section>
              <section className="tasks-panel" aria-labelledby="task-activity-title"><div className="tasks-panel-heading"><h2 id="task-activity-title">{text("Activity", "執行紀錄")}</h2><span className="tasks-hint">{text("Saved automatically", "自動儲存")}</span></div>
                {current.events.length ? <ol className="tasks-timeline">{current.events.map((event) => <li key={event.id}><div className="tasks-event-heading"><span className="tasks-event-kind">{EVENT_KIND[event.kind]?.[zh ? 1 : 0] ?? event.kind}</span><time dateTime={event.createdAt}>{date(event.createdAt, zh)}</time></div><h3>{event.title}</h3>{event.content && <p className="tasks-event-content">{event.content}</p>}</li>)}</ol> : <p className="tasks-hint">{text("Waiting for the first recorded action.", "等待第一筆執行紀錄。")}</p>}
              </section>
              {current.references.length > 0 && <section className="tasks-panel" aria-labelledby="task-references-title"><h2 id="task-references-title">{text("Source references", "參考資料")}</h2>{current.references.map((reference) => <details className="tasks-reference-preview" key={reference.id}><summary>{reference.name}</summary><pre>{reference.content}</pre></details>)}</section>}
              {!terminal && <section className="tasks-panel"><form className="tasks-steering" onSubmit={sendInstruction}><label className="tasks-field">{text("Add an instruction", "補充指令")}<textarea value={instruction} maxLength={4000} rows={3} onChange={(event) => setInstruction(event.target.value)} disabled={busy} placeholder={text("Change a priority, clarify the scope or add a constraint…", "調整優先順序、釐清範圍，或補充限制條件…")} /></label><p className="tasks-hint">{text("Instructions are saved and applied after the current step. Sending one does not resume a paused task.", "指令會儲存並在目前步驟完成後套用。送出指令不會自動繼續已暫停的任務。")}</p><button type="submit" className="tasks-button-secondary" disabled={busy || !instruction.trim()}>{text("Send instruction", "送出指令")}</button></form></section>}
            </>}
            {(!available && creating || !creating && !selectedId) && <section className="tasks-panel tasks-empty"><span className="tasks-empty-symbol" aria-hidden="true">✦</span><h2>{text("A place for work that takes more than one reply.", "讓多步驟的工作，有持續完成的空間。")}</h2><p>{text("Tasks keep their plan, activity and files together so you can return to the work when you need to.", "任務集中保存計畫、執行紀錄與成果檔案，方便你隨時回來接續工作。")}</p><div className="tasks-capabilities"><span>{text("Read & analyze", "閱讀與分析")}</span><span>{text("Review & guide", "審核與引導")}</span><span>{text("Create & download", "製作與下載")}</span></div></section>}
          </div>
        </div>
      </>}
    </main>
  );
}
