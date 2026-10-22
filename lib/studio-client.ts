/** Video studio (/studio): API shapes, calls, labels and the JSON-schema helpers the screens share. */
import { PortalError, portalErrorCodeText, portalErrorText, portalRequest } from "./portal-client";

type Locale = "en" | "zh";
export type Localized = string | { zh?: string; en?: string } | undefined;

export type JsonSchema = {
  type?: string | string[];
  title?: Localized;
  description?: Localized;
  enum?: unknown[];
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  format?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  "x-upload-purpose"?: UploadPurpose;
  "x-chars-per-second"?: number;
  "x-fixed-for-kind"?: Record<string, number>;
  "x-require-one-of"?: string[];
  "x-enum-labels"?: Record<string, Localized>;
  "x-internal-values"?: string[];
};

export type OpSpec = { type: string; label?: Localized; target_kind?: "shot" | "aspect" | "character" | null };

export type StudioTemplate = {
  id: string;
  version: number;
  title: Localized;
  input_schema: JsonSchema;
  shot_schema: JsonSchema;
  project_schema: JsonSchema;
  aspects: string[];
  ops: OpSpec[];
  prices: Record<string, number>;
};

export type ProjectSummary = {
  id: string;
  title: string | null;
  template_id: string;
  status: string;
  thumb_url: string | null;
  updated_at: number | null;
};

export type SelfCheck = {
  verdict?: string;
  garbled_text?: boolean;
  deformity?: boolean;
  logo_or_trademark?: boolean;
  notes?: string;
  validated?: boolean;
};

export type StudioShot = {
  index: number;
  kind: string;
  seconds: number;
  visual_prompt?: string;
  narration?: string;
  image_upload_id?: string | null;
  character_ids?: string[];
  revision?: number;
  rendered_revision?: number | null;
  stale?: boolean;
  status?: string;
  preview_url?: string | null;
  thumb_url?: string | null;
  selfcheck?: SelfCheck | null;
  [field: string]: unknown;
};

export type ActiveOp = { op_id: string; type: string; state: string };
export type ExportInfo = { url: string; srt_url?: string | null; rendered_at?: number; duration?: number } | null;

export type StudioProject = {
  id: string;
  template_id: string;
  template_version?: number;
  title: string | null;
  status: string;
  aspect: string;
  aspects?: string[];
  storyboard_rev: number;
  queue: { position: number } | null;
  active_op: ActiveOp | null;
  last_op?: { op_id: string; type: string; state: string; error?: { code?: string } | null } | null;
  shots: StudioShot[];
  characters?: unknown[];
  settings: Record<string, unknown>;
  exports?: Record<string, ExportInfo>;
  total_seconds?: number | null;
  style?: string | null;
  updated_at?: number;
};

export type Quote = {
  quote_id: string;
  type: string;
  target: string | null;
  credits: number;
  breakdown: { part: string; count: number; credits: number }[];
  storyboard_rev: number;
  exp: number;
  sig: string;
};

export type OpResult = {
  op_id: string;
  project_id: string;
  type: string;
  target: string | null;
  state: string;
  credits: number;
  credits_charged: number | null;
  credits_refunded: number | null;
  error: { code: string } | null;
  queue_position: number | null;
};

export type LedgerRow = { id: number; op_id: string | null; kind: string; delta: number; note: string | null; created_at: number };
export type StudioCredits = {
  balance: number;
  reserved: number;
  plan: string | null;
  period_end: number | null;
  recent: LedgerRow[];
};

/** Op states that mean "still running" on either side (portal ledger or agent queue). */
const SETTLED_OP_STATES = new Set(["succeeded", "failed", "settled", "settled_partial", "refunded", "cancelled"]);
export function opIsActive(op: { state: string } | null | undefined): boolean {
  return !!op && !SETTLED_OP_STATES.has(op.state);
}

// ---------------------------------------------------------------------------------------------- calls

const S = "/studio";
const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const studioApi = {
  templates: (signal?: AbortSignal) =>
    portalRequest<{ items: StudioTemplate[]; media_origin?: string | null }>(`${S}/templates`, { signal }).then((result) => {
      setMediaOrigin(result.media_origin ?? null);
      return result;
    }),
  projects: (cursor?: string | null, signal?: AbortSignal) =>
    portalRequest<{ items: ProjectSummary[]; next: string | null }>(
      `${S}/projects?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    ),
  project: (id: string, signal?: AbortSignal) => portalRequest<StudioProject>(`${S}/projects/${id}`, { signal }),
  credits: (signal?: AbortSignal) => portalRequest<StudioCredits>(`${S}/credits`, { signal }),
  create: (body: { template_id: string; inputs: Record<string, unknown>; aspect: string; idempotency_key: string }) =>
    portalRequest<{ id: string; op_id: string; status: string; state: string }>(`${S}/projects`, json(body)),
  settings: (id: string, body: Record<string, unknown>) => portalRequest<StudioProject>(`${S}/projects/${id}/settings`, json(body)),
  editShot: (id: string, index: number, body: Record<string, unknown>) =>
    portalRequest<StudioProject>(`${S}/projects/${id}/shots/${index}/edit`, json(body)),
  quote: (id: string, type: string, target?: string | null) =>
    portalRequest<Quote>(`${S}/projects/${id}/quote`, json(target === undefined || target === null ? { type } : { type, target })),
  submit: (id: string, quote: Quote, idempotencyKey: string) =>
    portalRequest<{ op_id: string; state: string }>(`${S}/projects/${id}/ops`, json({
      quote_id: quote.quote_id,
      type: quote.type,
      target: quote.target,
      credits: quote.credits,
      breakdown: quote.breakdown,
      storyboard_rev: quote.storyboard_rev,
      exp: quote.exp,
      sig: quote.sig,
      idempotency_key: idempotencyKey,
    })),
  op: (id: string, opId: string) => portalRequest<OpResult>(`${S}/projects/${id}/ops/${opId}`),
};

/** 8–64 characters of [A-Za-z0-9_-], as the portal requires for every op-creating POST. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "k" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------------------------- media URLs

/** The media host the portal names (PC_STUDIO_MEDIA_ORIGIN); null = not configured, any http(s) URL is used. */
let mediaOrigin: string | null = null;
export function setMediaOrigin(origin: string | null) {
  mediaOrigin = origin ? origin.replace(/\/$/, "") : null;
}

/** A signed media URL, or null when it is not http(s) or not on the configured media host (defence in depth). */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (mediaOrigin && parsed.origin !== mediaOrigin) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * The export as a download: `dl=1` asks the media host for Content-Disposition: attachment (agent-side flag;
 * the link also opens in a new tab, so without it the studio page is never replaced by the video).
 */
export function downloadUrl(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "dl=1";
}

// ---------------------------------------------------------------------------------------------- uploads

export type UploadPurpose = "input_image" | "shot_image" | "music" | "character_ref";
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AUDIO_TYPES = ["audio/mpeg", "audio/mp4", "audio/wav"];
const LIMITS: Record<UploadPurpose, number> = {
  input_image: 10_000_000,
  shot_image: 10_000_000,
  character_ref: 10_000_000,
  music: 20_000_000,
};

export class UploadError extends Error {
  constructor(public readonly reason: "type" | "size" | "put", message: string) {
    super(message);
    this.name = "UploadError";
  }
}

export function acceptFor(purpose: UploadPurpose): string {
  return (purpose === "music" ? AUDIO_TYPES : IMAGE_TYPES).join(",");
}

/** Checks the file, asks the portal for a one-time PUT URL, then sends the bytes to the media host. */
export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
  projectId?: string,
  put: typeof fetch = (...args) => fetch(...args),
): Promise<string> {
  const types = purpose === "music" ? AUDIO_TYPES : IMAGE_TYPES;
  // Browsers report .wav as audio/wav or audio/x-wav and .m4a as audio/x-m4a.
  const type = file.type === "audio/x-wav" ? "audio/wav" : file.type === "audio/x-m4a" ? "audio/mp4" : file.type;
  if (!types.includes(type)) throw new UploadError("type", "unsupported type");
  if (file.size < 1 || file.size > LIMITS[purpose]) throw new UploadError("size", "too large");
  const ticket = await portalRequest<{ upload_id: string; put_url: string; expires_at: number }>(`${S}/uploads`, json({
    purpose,
    content_type: type,
    bytes: file.size,
    ...(projectId ? { project_id: projectId } : {}),
  }));
  if (!mediaUrl(ticket.put_url)) throw new UploadError("put", "unexpected upload host");
  // The browser sets Content-Length from the File; the URL is signed and single use. No cookies go to the media host.
  const response = await put(ticket.put_url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": type },
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }).catch(() => null);
  if (!response || !response.ok) throw new UploadError("put", "upload failed");
  return ticket.upload_id;
}

// ---------------------------------------------------------------------------------------------- text

export function localized(value: Localized, locale: Locale, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value[locale] ?? value.zh ?? value.en ?? fallback;
  return fallback;
}

const STUDIO_ERRORS: Record<string, [string, string]> = {
  service_unavailable: ["影片服務暫時無法連線，請稍後再試。", "The video service is unreachable right now. Try again in a moment."],
};

/** Error text for the studio screens; `service_unavailable` here means the video service, not the account service. */
export function studioErrorText(error: unknown, locale: Locale): string {
  const zh = locale === "zh";
  if (error instanceof UploadError) {
    if (error.reason === "type")
      return zh ? "不支援這種檔案格式。圖片請用 PNG、JPEG 或 WebP；音樂請用 MP3、M4A 或 WAV。" : "That file type is not supported. Use PNG, JPEG or WebP images, or MP3, M4A or WAV music.";
    if (error.reason === "size")
      return zh ? "檔案太大：圖片上限 10 MB，音樂上限 20 MB。" : "The file is too large: images up to 10 MB, music up to 20 MB.";
    return zh ? "檔案上傳失敗，請重新選擇檔案再試一次。" : "The upload failed. Choose the file again and retry.";
  }
  if (error instanceof PortalError && STUDIO_ERRORS[error.code]) return STUDIO_ERRORS[error.code][zh ? 0 : 1];
  if (error instanceof PortalError && error.status >= 500 && !portalErrorCodeText(error, locale)) return STUDIO_ERRORS.service_unavailable[zh ? 0 : 1];
  if (!(error instanceof PortalError))
    return zh ? "影片服務暫時無法連線，請檢查網路後再試。" : "The video service could not be reached. Check your connection and try again.";
  return portalErrorText(error, locale);
}

/** Why an op ended without (fully) producing its result; codes from the agent (spec 13.1.19). */
export function opErrorText(code: string | null | undefined, locale: Locale): string {
  const zh = locale === "zh";
  if (!code) return zh ? "沒有完成。" : "It did not finish.";
  const known = portalErrorCodeText(new PortalError(400, code, ""), locale);
  if (code.startsWith("studio_") && known) return known;
  const text: Record<string, [string, string]> = {
    gateway_error: ["AI 服務暫時出錯。", "The AI service had an error."],
    draft_failed: ["分鏡沒有產生成功，可以再試一次。", "The storyboard could not be written. You can try again."],
    product_fetch_failed: ["讀不到商品網址的內容，請改填主題或上傳商品圖片。", "The product page could not be read. Enter a topic or upload product images instead."],
    interrupted: ["服務重新啟動，步驟中斷了。", "The service restarted and the step was interrupted."],
    op_failed: ["步驟沒有完成。", "The step did not finish."],
    internal_error: ["服務內部錯誤。", "An internal error occurred."],
    stale_quote: ["內容已變更，請重新確認價格。", "The content changed. Confirm the price again."],
  };
  return (text[code] ?? text.op_failed)[zh ? 0 : 1];
}

export function projectStatusLabel(status: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    empty: ["未開始", "Not started"],
    drafting: ["分鏡產生中", "Writing storyboard"],
    draft_ready: ["待產生畫面", "Ready to generate"],
    rendering: ["產生中", "Generating"],
    ready: ["完成", "Ready"],
    failed_draft: ["分鏡失敗", "Storyboard failed"],
    failed_render: ["產生失敗", "Generation failed"],
  };
  return (labels[status] ?? [status, status])[locale === "zh" ? 0 : 1];
}

export function opStateLabel(state: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    reserved: ["準備送出", "Preparing"],
    submitted: ["已送出", "Submitted"],
    unknown: ["確認中", "Confirming"],
    queued: ["排隊中", "Queued"],
    running: ["產生中", "Generating"],
  };
  return (labels[state] ?? [state, state])[locale === "zh" ? 0 : 1];
}

export function opTypeLabel(type: string, target: string | null | undefined, locale: Locale, ops: OpSpec[] = []): string {
  const zh = locale === "zh";
  if (type === "draft") return zh ? "產生分鏡" : "Write storyboard";
  if (type === "render") return zh ? "產生全部" : "Generate all";
  if (type === "regenerate") return zh ? `重新產生第 ${target ?? "?"} 鏡` : `Regenerate shot ${target ?? "?"}`;
  if (type === "export") return zh ? `匯出 ${target ?? ""}`.trim() : `Export ${target ?? ""}`.trim();
  if (type === "add_aspect") return zh ? `加做 ${target ?? ""}`.trim() : `Add ${target ?? ""}`.trim();
  const spec = ops.find((op) => op.type === type);
  return localized(spec?.label, locale, type);
}

/**
 * A quote line in words. The agent prices per asset key: `image@9:16` is a still for one aspect, a bare
 * `image` next to those is a motion shot's source picture (aspect-independent).
 */
export function partLabel(part: string, locale: Locale, parts: string[] = []): string {
  const zh = locale === "zh";
  const [kind, aspect] = part.split("@");
  const labels: Record<string, [string, string]> = {
    draft: ["分鏡腳本", "Storyboard"],
    image: ["畫面", "Picture"],
    speech: ["配音", "Narration audio"],
    clip: ["動態影片", "Video clip"],
  };
  if (aspect) return `${(labels[kind] ?? [kind, kind])[zh ? 0 : 1]}（${aspect}）`;
  if (kind === "image" && parts.some((other) => other.startsWith("image@"))) return zh ? "動態鏡頭底圖" : "Motion-shot source picture";
  return (labels[kind] ?? [kind, kind])[zh ? 0 : 1];
}

export function kindLabel(kind: string, locale: Locale): string {
  if (kind === "video") return locale === "zh" ? "動態" : "Motion";
  if (kind === "image") return locale === "zh" ? "圖片" : "Still";
  return kind;
}

export function aspectLabel(aspect: string, locale: Locale): string {
  const zh = locale === "zh";
  if (aspect === "9:16") return zh ? "直式 9:16" : "Vertical 9:16";
  if (aspect === "16:9") return zh ? "橫式 16:9" : "Horizontal 16:9";
  return aspect;
}

export function planLabel(plan: string | null | undefined, locale: Locale): string {
  const names: Record<string, string> = { creator: "Creator", merchant: "Merchant", agency: "Agency" };
  if (!plan) return locale === "zh" ? "尚未設定" : "Not set";
  return names[plan] ?? plan;
}

export function ledgerKindLabel(kind: string, locale: Locale): string {
  const labels: Record<string, [string, string]> = {
    grant: ["發放", "Granted"],
    reserve: ["預留", "Reserved"],
    settle: ["結算", "Settled"],
    refund: ["退還", "Refunded"],
    expire: ["扣除", "Removed"],
  };
  return (labels[kind] ?? [kind, kind])[locale === "zh" ? 0 : 1];
}

/** A ledger row's note in words: the op type of a reservation, the charge of a settlement, the error of a refund. */
export function ledgerNote(row: LedgerRow, locale: Locale): string {
  const zh = locale === "zh";
  const note = row.note ?? "";
  if (row.kind === "reserve" && note) return opTypeLabel(note, null, locale);
  if (row.kind === "settle") {
    const charged = /^charged (\d+)$/.exec(note)?.[1];
    if (charged !== undefined) return zh ? `實扣 ${charged} 點` : `${charged} charged`;
  }
  if (row.kind === "refund") return note ? opErrorText(note, locale) : zh ? "未使用的部分" : "Unused part";
  return note;
}

export function signedCredits(delta: number): string {
  return delta > 0 ? `+${delta.toLocaleString()}` : delta < 0 ? `−${Math.abs(delta).toLocaleString()}` : "0";
}

export function timeLabel(epochSeconds: number | null | undefined, locale: Locale): string {
  if (!epochSeconds) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-TW" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(epochSeconds * 1000),
  );
}

// ---------------------------------------------------------------------------------------------- schemas

/** Labels for project settings, whose schema carries no titles. */
const FIELD_LABELS: Record<string, [string, string]> = {
  title: ["影片名稱", "Video title"],
  voice: ["配音", "Voice"],
  subtitles: ["燒錄字幕", "Burn-in subtitles"],
  music_upload_id: ["背景音樂", "Background music"],
  music_rights_confirmed: ["我確認擁有這首音樂的使用權", "I confirm I have the rights to use this music"],
};

export function fieldLabel(name: string, schema: JsonSchema, locale: Locale): string {
  const fallback = FIELD_LABELS[name]?.[locale === "zh" ? 0 : 1] ?? name;
  return localized(schema.title, locale, fallback);
}

export function schemaTypes(schema: JsonSchema): string[] {
  return Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
}

/**
 * Voices the agent knows. Its schema lists ids only (spec 13.2), so labels and the internal flag come from
 * schema annotations when the agent sends them, else from this table (agent config `studio.voices`).
 */
const KNOWN_VOICES: Record<string, { zh: string; en: string; internal: boolean }> = {
  tw_ref: { zh: "內部測試", en: "Internal test", internal: true },
};

/** Whether a voice is for internal tests only (portal list in x-internal-values, plus the known table). */
export function isInternalVoice(schema: JsonSchema | undefined, voice: unknown): boolean {
  if (typeof voice !== "string") return false;
  return (schema?.["x-internal-values"] ?? []).includes(voice) || !!KNOWN_VOICES[voice]?.internal;
}

export function enumOptions(name: string, schema: JsonSchema, locale: Locale, isAdmin: boolean) {
  const values = (schema.enum ?? []).filter((value): value is string => typeof value === "string");
  const internal = new Set(schema["x-internal-values"] ?? []);
  return values
    .map((value) => {
      const known = name === "voice" ? KNOWN_VOICES[value] : undefined;
      const hidden = internal.has(value) || !!known?.internal;
      const label = localized(schema["x-enum-labels"]?.[value], locale, known ? known[locale] : name === "kind" ? kindLabel(value, locale) : value);
      return { value, label: hidden && !label.includes(locale === "zh" ? "內部測試" : "Internal") ? `${label}（${locale === "zh" ? "內部測試" : "internal test"}）` : label, internal: hidden };
    })
    .filter((option) => isAdmin || !option.internal);
}

/** The narration meter: characters at the template's reading speed versus the shot length. */
export function narrationFit(text: string, charsPerSecond: number, seconds: number) {
  const characters = Array.from(text.replace(/\s+/g, "")).length;
  const needed = charsPerSecond > 0 ? characters / charsPerSecond : 0;
  const ratio = seconds > 0 ? needed / seconds : 0;
  return { characters, needed, ratio, state: ratio > 1.05 ? "over" : ratio < 0.5 ? "short" : "ok" } as const;
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Initial form values from schema defaults. */
export function schemaDefaults(schema: JsonSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    if (field.default !== undefined) values[name] = field.default;
    else if (schemaTypes(field).includes("array")) values[name] = [];
  }
  return values;
}

/** The creation body: empty strings dropped, numbers kept, as the template's own validator expects. */
export function cleanInputs(schema: JsonSchema, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of Object.keys(schema.properties ?? {})) {
    const value = values[name];
    if (isEmptyValue(value)) continue;
    out[name] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

/** Client-side checks that mirror the schema; the agent validates again. Returns field -> message. */
export function validateInputs(schema: JsonSchema, values: Record<string, unknown>, locale: Locale): Record<string, string> {
  const zh = locale === "zh";
  const errors: Record<string, string> = {};
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = values[name];
    if (isEmptyValue(value)) continue;
    if (typeof value === "string") {
      if (field.maxLength && value.length > field.maxLength) errors[name] = zh ? `最多 ${field.maxLength} 字` : `Up to ${field.maxLength} characters`;
      if (field.format === "uri" && !/^https?:\/\/\S+$/.test(value.trim())) errors[name] = zh ? "請輸入 http:// 或 https:// 開頭的網址" : "Enter a URL starting with http:// or https://";
    }
    if (typeof value === "number") {
      if ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum))
        errors[name] = zh ? `請輸入 ${field.minimum}–${field.maximum}` : `Enter ${field.minimum}–${field.maximum}`;
    }
  }
  const oneOf = schema["x-require-one-of"];
  if (oneOf?.length && oneOf.every((name) => isEmptyValue(values[name]))) {
    const names = oneOf.map((name) => fieldLabel(name, schema.properties?.[name] ?? {}, locale)).join(zh ? "、" : ", ");
    errors._form = zh ? `請至少填寫其中一項：${names}` : `Fill in at least one of: ${names}`;
  }
  return errors;
}

/** A media URL's file type, from the signed URL's path. */
export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return /\.mp4$/i.test(new URL(url, "https://media.invalid").pathname);
  } catch {
    return false;
  }
}
