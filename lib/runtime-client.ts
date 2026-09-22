import { PortalError, portalErrorText, portalRequest } from "./portal-client";

export type TaskStatus = "queued" | "running" | "paused" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type TaskReference = { name: string; content: string };
export type TaskArtifact = { id: string; name: string; mimeType: string; size: number; createdAt: string };
export type TaskApproval = { id: string; tool: string; args: Record<string, unknown>; reason: string; status: "pending" | "approved" | "rejected" };
export type RuntimeTask = {
  id: string; goal: string; status: TaskStatus; model: string;
  agentId: string | null; agentVersion: number | null; createdAt: string; updatedAt: string;
  stepCount: number; maxSteps: number; maxOutputTokens: number; requestedControl: string | null;
  usage: { inputTokens: number; outputTokens: number }; summary: string; error: string | null;
};
export type TaskDetail = RuntimeTask & {
  plan: { id: string; title: string; status: string }[];
  events: { id: string; kind: string; title: string; content: string; createdAt: string }[];
  references: (TaskReference & { id: string })[];
  artifacts: TaskArtifact[];
  approval: TaskApproval | null;
};
export type RuntimeConfig = {
  enabled: boolean; available: boolean; models: string[]; tools: string[];
  limits: { maxSteps: number; maxOutputTokens: number; maxReferences: number; referenceCharacters: number };
  reason?: string;
};
export type SavedTaskAgent = { id: string; name: string; version: number };
export type CreateTask = {
  goal: string; agentId?: string; model: string; apiKey: string;
  maxSteps: number; maxOutputTokens: number; references: TaskReference[];
};
export type TaskControl = "pause" | "resume" | "cancel";

export const runtimeClient = {
  config: (signal?: AbortSignal) => portalRequest<RuntimeConfig>("/runtime/config", { signal }),
  list: (signal?: AbortSignal) => portalRequest<{ tasks: RuntimeTask[] }>("/runtime/tasks", { signal }),
  agents: (signal?: AbortSignal) => portalRequest<{ agents: SavedTaskAgent[] }>("/agents", { signal }),
  get: (id: string, signal?: AbortSignal) => portalRequest<{ task: TaskDetail }>(`/runtime/tasks/${encodeURIComponent(id)}`, { signal }),
  create: (body: CreateTask, signal?: AbortSignal) => portalRequest<{ task: RuntimeTask }>("/runtime/tasks", { method: "POST", body: JSON.stringify(body), signal }),
  control: (id: string, action: TaskControl, signal?: AbortSignal) => portalRequest<{ task: TaskDetail }>(`/runtime/tasks/${encodeURIComponent(id)}/control`, { method: "POST", body: JSON.stringify({ action }), signal }),
  instruct: (id: string, message: string, signal?: AbortSignal) => portalRequest<{ task: TaskDetail }>(`/runtime/tasks/${encodeURIComponent(id)}/instructions`, { method: "POST", body: JSON.stringify({ message }), signal }),
  decide: (id: string, approvalId: string, decision: "approve" | "reject", signal?: AbortSignal) => portalRequest<{ task: TaskDetail }>(`/runtime/tasks/${encodeURIComponent(id)}/approval`, { method: "POST", body: JSON.stringify({ approvalId, decision }), signal }),
  artifact: (id: string, artifactId: string, signal?: AbortSignal) => portalRequest<{ artifact: Omit<TaskArtifact, "createdAt"> & { contentBase64: string } }>(`/runtime/tasks/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`, { signal }),
};

export function isTaskTerminal(status: TaskStatus) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function runtimeErrorText(error: unknown, locale: "en" | "zh") {
  const messages: Record<string, [string, string]> = {
    active_limit: ["Finish or cancel an existing task before starting another. Your account can have two unfinished tasks.", "請先完成或取消既有任務，再開始新的任務。每個帳號最多同時保留兩個未完成任務。"],
    stale_approval: ["This approval is no longer pending. Review the latest task activity before deciding again.", "此核准要求已不在待處理狀態。請確認最新的任務紀錄後再操作。"],
    terminal_task: ["This task has already ended. Its saved work remains available; start a new task to continue.", "此任務已結束。仍可查看已儲存的成果，如需繼續請建立新任務。"],
    instruction_limit: ["Wait for the agent to read your pending instructions before sending more.", "請等待智能體讀取待處理的指令後，再送出新的指令。"],
    missing_credential: ["This task can no longer use its API key. Start a new task with your key to continue.", "此任務已無法使用原本的 API 金鑰，請提供金鑰建立新任務。"],
    storage_limit: ["This task has reached its saved context limit. Start a new task with a smaller scope.", "此任務已達儲存內容上限，請縮小範圍並建立新任務。"],
    not_found: ["This task, agent or file is no longer available in your account. Refresh to check the latest saved work.", "此帳號已無法取得這個任務、智能體或檔案。請重新整理確認最新紀錄。"],
  };
  return error instanceof PortalError && messages[error.code]
    ? messages[error.code][locale === "zh" ? 1 : 0]
    : portalErrorText(error, locale);
}

/** Attachments are never navigated to or injected into the document. */
export function downloadTaskArtifact(artifact: { name: string; contentBase64: string }) {
  if (artifact.contentBase64.length > 1_400_000) throw new Error("Artifact exceeds download limit");
  const bytes = Uint8Array.from(atob(artifact.contentBase64), (character) => character.charCodeAt(0));
  // eslint-disable-next-line no-control-regex -- Downloads must exclude path separators and control bytes.
  const filename = artifact.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+/, "").slice(0, 180) || "task-deliverable.txt";
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); URL.revokeObjectURL(url); }
}
