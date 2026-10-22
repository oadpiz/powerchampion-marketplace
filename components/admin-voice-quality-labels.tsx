/*
 * Copy for the "Quality" tab on /admin/voice (P2-6): labels for the call enums and the error codes the tab can see.
 * Wording follows phase2-contract §11.1-§11.3, §12; each table is typed by its enum, so a value the backend gains
 * (server/test_voice_calls_sync.py keeps lib/voice-quality.ts and lib/voice-calls.ts in step with it) cannot be
 * left without copy. Values the contract gives no wording for are marked "not in the contract" below.
 */
import { PortalError } from "../lib/portal-client";
import { callTime, dateText, type CallEntry, type CallOutcome, type HandoffReason, type MeterReason } from "../lib/voice-calls";
import type {
  AutoFlag,
  DegradeReason,
  DeletionReason,
  DeletionStatus,
  ListeningKind,
  MessageOutcome,
  ReviewLabel,
  ReviewStatus,
} from "../lib/voice-quality";
import { errorMessage } from "./admin-resource";
import { voiceAdminErrorText, voiceFeatureOff } from "./admin-voice-dialogs";

export type Copy = { en: string; zh: string };
export const say = (copy: Copy, zh: boolean) => (zh ? copy.zh : copy.en);
/** Fills {name} placeholders. */
export const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));

/** §11.1 "結果". */
export const OUTCOME_LABEL: Record<CallOutcome, Copy> = {
  answered: { zh: "已回答", en: "Answered" },
  message: { zh: "留言", en: "Message" },
  handoff: { zh: "轉真人", en: "Handed off" },
  degraded: { zh: "降級", en: "Fallback" },
  not_answered: { zh: "未接通", en: "Not connected" },
  hangup_early: { zh: "開頭就掛斷", en: "Hung up early" },
  no_speech: { zh: "沒有說話", en: "No speech" },
  error: { zh: "處理失敗", en: "Failed" },
  unknown: { zh: "待補紀錄", en: "Pending" },
};

/** §11.2 "入口". */
export const ENTRY_LABEL: Record<CallEntry, Copy> = {
  pstn: { zh: "市話", en: "Phone line" },
  webrtc: { zh: "網頁通話", en: "Web call" },
  softphone: { zh: "內部軟電話", en: "Internal softphone" },
  try: { zh: "試打", en: "Test call" },
};

/** §11.3 "標記：自動" (the 10 autoFlags). */
export const AUTO_FLAG_LABEL: Record<AutoFlag, Copy> = {
  no_answer: { zh: "答不出來", en: "No answer" },
  low_confidence: { zh: "低信心", en: "Low confidence" },
  impatient: { zh: "客人不耐煩", en: "Impatient caller" },
  talk_over: { zh: "搶話", en: "Talked over" },
  no_response: { zh: "沒回應", en: "No response" },
  degraded: { zh: "降級", en: "Fallback" },
  unknown_number: { zh: "號碼不在表上", en: "Unknown number" },
  config_mismatch: { zh: "設定版本不符", en: "Settings version mismatch" },
  source_mismatch: { zh: "兩邊紀錄不一致", en: "Records disagree" },
  retention_mismatch: { zh: "保存天數不一致", en: "Retention mismatch" },
};

/** §11.3 "抽屜：降級". */
export const DEGRADE_LABEL: Record<DegradeReason, Copy> = {
  llm: { zh: "LLM", en: "LLM" },
  tts: { zh: "TTS", en: "TTS" },
  asr: { zh: "ASR", en: "ASR" },
  orchestrator: { zh: "編排器", en: "Orchestrator" },
  link: { zh: "泰國連線", en: "Link" },
  config: { zh: "讀不到設定", en: "Config" },
  edge_fallback: { zh: "邊緣主機接手", en: "Edge fallback" },
};

/** §11.3 "標籤" (A11 labels). */
export const REVIEW_LABEL_COPY: Record<ReviewLabel, Copy> = {
  wrong_answer: { zh: "答錯", en: "Wrong answer" },
  made_up: { zh: "編造", en: "Made up" },
  missed_handoff: { zh: "該轉沒轉", en: "Missed handoff" },
  over_refusal: { zh: "能答卻拒答", en: "Refused when it could answer" },
  number_readback: { zh: "號碼覆誦錯", en: "Number read back wrong" },
  talk_over: { zh: "搶話", en: "Talked over" },
  slow: { zh: "太慢", en: "Too slow" },
  unnatural_voice: { zh: "聲音不自然", en: "Unnatural voice" },
  disclosure_missing: { zh: "缺告知", en: "Missing notice" },
  other: { zh: "其他", en: "Other" },
};

/** §11.3 review form "狀態". */
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, Copy> = {
  open: { zh: "待處理", en: "Open" },
  done: { zh: "已處理", en: "Done" },
};

/** §16 A10 "刪除": why the portal asked the Taiwan host to delete content, and how far it got. */
export const DELETION_REASON_LABEL: Record<DeletionReason, Copy> = {
  store_deleted: { zh: "店家刪除", en: "Deleted by the store" },
  recording_expired: { zh: "錄音到期", en: "Recording past its date" },
  content_expired: { zh: "內容到期（90 天）", en: "Content past its date (90 days)" },
};
export const DELETION_STATUS_LABEL: Record<DeletionStatus, Copy> = {
  pending: { zh: "等紀錄端刪除", en: "Waiting for the records host" },
  done: { zh: "紀錄端已刪除", en: "Deleted by the records host" },
};

/** §11.3 list column "狀態": a call without a finished review is still to review. */
export const LIST_STATUS: { open: Copy; done: Copy } = {
  open: { zh: "待審", en: "To review" },
  done: { zh: "已審", en: "Reviewed" },
};

/** §12.2 "計量理由" (14 values). */
export const METER_REASON_LABEL: Record<MeterReason, Copy> = {
  ai_speech: { zh: "AI 接聽，客人說話滿 3 秒", en: "AI answered and the caller spoke for 3 seconds or more" },
  message: { zh: "有留言", en: "A message was left" },
  callback: { zh: "留下回電號碼", en: "A callback number was left" },
  try: { zh: "試打不計費", en: "Test calls are free" },
  unknown_line: { zh: "號碼不在號碼表", en: "Number not in the number table" },
  non_customer_line: { zh: "示範或測試號碼", en: "Demo or test number" },
  channel_not_billable: { zh: "網頁通話不計費", en: "Web calls are not billed" },
  not_answered: { zh: "系統沒有接起", en: "Not answered by the system" },
  no_message_record: { zh: "沒有留言紀錄", en: "No message record" },
  processing_error: { zh: "處理失敗", en: "Processing failed" },
  notice_hangup: { zh: "告知語中掛斷", en: "Hung up during the notice" },
  no_speech: { zh: "客人沒有說話", en: "The caller did not speak" },
  short_speech: { zh: "說話不足 3 秒", en: "Less than 3 seconds of speech" },
  callback_unconfirmed: { zh: "回電號碼沒有確認", en: "Callback number not confirmed" },
};

/** Handoff reasons (not in the contract; wording is ours). */
export const HANDOFF_LABEL: Record<HandoffReason, Copy> = {
  requested: { zh: "客人要求", en: "The caller asked" },
  no_answer: { zh: "AI 答不出來", en: "The AI had no answer" },
  no_ai_question: { zh: "這題設定不讓 AI 回答", en: "A question the AI may not answer" },
  urgent: { zh: "緊急", en: "Urgent" },
  complaint: { zh: "客訴", en: "Complaint" },
};

/** A10 message.outcome (not in the contract; wording follows §12.2 where it can). */
export const MESSAGE_OUTCOME_LABEL: Record<MessageOutcome, Copy> = {
  none: { zh: "沒有留言", en: "No message" },
  message: { zh: "有留言", en: "A message was left" },
  callback_only: { zh: "只留回電號碼", en: "Only a callback number" },
  no_speech: { zh: "客人沒有說話", en: "The caller did not speak" },
  notice_hangup: { zh: "告知語中掛斷", en: "Hung up during the notice" },
  error: { zh: "處理失敗", en: "Processing failed" },
};

/** §11.3 blind listening "類型". */
export const LISTENING_KIND_LABEL: Record<ListeningKind, Copy> = {
  tts_voice: { zh: "聲音盲聽", en: "Voice test" },
  call_sample: { zh: "通話抽樣", en: "Call sample" },
  prompt_audio: { zh: "提示音", en: "Prompt audio" },
  other: { zh: "其他", en: "Other" },
};

/** §11.3 blind listening "結果" (`passed`). */
export const PASSED_LABEL = {
  yes: { zh: "通過", en: "Passed" },
  no: { zh: "不通過", en: "Failed" },
  recorded: { zh: "只記錄", en: "Recorded only" },
} satisfies Record<string, Copy>;
export const passedLabel = (passed: boolean | null, zh: boolean) =>
  say(passed === null ? PASSED_LABEL.recorded : passed ? PASSED_LABEL.yes : PASSED_LABEL.no, zh);

/** §11.3 "店家空白": the dialed number is not in the number table, so the call has no store. */
export const NO_STORE: Copy = { zh: "（號碼不在表上）", en: "(number not in table)" };

/**
 * Taipei time (contract §1.4: fixed UTC+8) for one instant: the store pages' 24-hour format with the year
 * ("2026 年 10 月 22 日 14:04" / "Oct 22, 2026, 14:04"), so an operator and a store read the same time the same way.
 */
export const taipeiTime = (value: string | null, zh: boolean) => callTime(value, zh);
/** The same with seconds (the drawer's time line: several calls can share a minute). */
export const taipeiSeconds = (value: string | null, zh: boolean) => callTime(value, zh, true, true);
/** Taipei date only, as the store pages write it. */
export const taipeiDate = (value: string | null, zh: boolean) => dateText(value, zh);

/** "2026-12-21 09:15:02" in Taipei, for files (the same text whatever the browser's time zone or language). */
export function taipeiStamp(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

export const working = (zh: boolean) => (zh ? "處理中…" : "Working…");

/** §11.3 "功能未開啟" uses phase 1 §8.6. */
export const FEATURE_OFF: Copy = {
  zh: "電話客服功能未開啟（PC_VOICE_ENABLED 不是 1）。",
  en: "The phone agent feature is off (PC_VOICE_ENABLED is not 1).",
};

/**
 * Error copy for the Quality tab (§12.1), falling back to the phase 1 operator copy. `call_not_found` drops the
 * store-owner half of §12.1 ("or does not belong to your store"): an operator sees every store's calls.
 */
export function qualityErrorText(error: unknown, locale: "en" | "zh"): string {
  const zh = locale === "zh";
  if (voiceFeatureOff(error)) return say(FEATURE_OFF, zh);
  if (!(error instanceof PortalError)) return voiceAdminErrorText(error, locale);
  switch (error.code) {
    case "call_not_found":
      return zh ? "這通紀錄不存在，請重新整理。" : "This call does not exist. Reload the page.";
    case "note_contains_number":
      return zh ? "備註裡不要寫電話號碼。" : "Do not put phone numbers in the note.";
    case "call_content_unavailable":
      return zh ? "這通沒有保存內容。" : "No content was kept for this call.";
    case "call_content_expired":
      return zh ? "內容已超過保存期限，不能再查看。" : "The content is past its retention period and can no longer be viewed.";
    case "call_content_deleted":
      return zh ? "店家已刪除這通的錄音與文字，不能再查看。" : "The store deleted this call's recording and text; it can no longer be viewed.";
    case "voice_content_link_limit":
      return zh ? "查看次數太多了，請 1 小時後再試。" : "Too many views. Try again in an hour.";
    case "listening_not_found":
      return zh ? "這筆盲聽紀錄已經不存在，請重新整理。" : "This entry no longer exists. Reload the page.";
    case "listening_limit":
      return zh ? "盲聽紀錄最多 500 筆，請先刪掉舊的。" : "Up to 500 entries. Delete old ones first.";
    case "admin_required":
    case "auth_required":
      return errorMessage(error, zh);
    default:
      return voiceAdminErrorText(error, locale);
  }
}
