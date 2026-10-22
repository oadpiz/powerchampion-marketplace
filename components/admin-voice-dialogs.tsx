"use client";

import { useRef, useState } from "react";
import { codePoints, lineProblem, unsafeMessage } from "../lib/admin-text";
import { LANGUAGE_NAMES } from "../lib/languages";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { useLocale } from "./locale-provider";

/*
 * Dialogs and shared definitions for /admin/voice (phase1-contract §4 A1-A8, §8.6, §9).
 * The enum values mirror server/voice_store.py (INDUSTRIES, STATUSES, PURPOSES, CHANNELS, NUMBER);
 * tests/admin-voice.test.tsx parses that file and fails when the two drift apart.
 */

export const VOICE_INDUSTRIES = ["clinic", "cram", "other"] as const;
export const VOICE_STATUSES = ["draft", "testing", "live", "suspended"] as const;
export const VOICE_PURPOSES = ["customer", "demo", "test", "internal"] as const;
export const VOICE_CHANNELS = ["online", "test_line", "pstn"] as const;
export type VoiceIndustry = (typeof VOICE_INDUSTRIES)[number];
export type VoiceStatus = (typeof VOICE_STATUSES)[number];
export type VoicePurpose = (typeof VOICE_PURPOSES)[number];
export type VoiceChannel = (typeof VOICE_CHANNELS)[number];

/** E.164 (7 to 15 digits) or an extension; the same pattern as the backend's NUMBER (phase1-contract §4.6). */
export const VOICE_NUMBER_PATTERN = /^(?:\+[1-9][0-9]{6,14}|ext-[0-9]{4})$/;
/** Store name: at most 20 characters, spaces not counted (contract amendment A1; was 40). */
export const STORE_NAME_MAX = 20;
/** A store name is still one line; this is the old raw cap, kept so a name of mostly spaces cannot grow without bound. */
const STORE_NAME_RAW_MAX = 40;
const NAME_MAX = 100;
const NOTE_MAX = 80;
const EMAIL_MAX = 254;

/**
 * Status changes an operator may pick (phase1-contract §4.4, the ✓ cells). Live is never offered: in phase 1 every
 * change to live is answered 409 live_requires_g2a, and the G2a launch gate has not passed.
 */
export const STATUS_TARGETS: Record<VoiceStatus, VoiceStatus[]> = {
  draft: ["testing", "suspended"],
  testing: ["draft", "suspended"],
  live: ["suspended"],
  suspended: ["testing"],
};

export type StoreItem = {
  id: string;
  name: string;
  industry: string;
  status: string;
  owner: { id: string; email: string; name: string };
  currentVersion: number | null;
  faqCount: number;
  kbChars: number;
  lastTryAt: string | null;
  aiAnswerEnabled: boolean;
  recordingMode: string;
  createdAt: string;
  updatedAt: string;
};

export type VoiceNumber = {
  id: string;
  number: string;
  storeId: string | null;
  storeName: string | null;
  purpose: string;
  channel: string;
  activeFrom: string;
  activeUntil: string | null;
  note: string;
  activeNow: boolean;
  createdAt: string;
  updatedAt: string;
};

type Copy = { en: string; zh: string };
const pick = (copy: Copy | undefined, zh: boolean, fallback: string) => (copy ? (zh ? copy.zh : copy.en) : fallback);

const INDUSTRY_LABEL: Record<string, Copy> = {
  clinic: { en: "Clinic", zh: "診所" },
  cram: { en: "Cram school", zh: "補習班" },
  other: { en: "Other", zh: "其他" },
};
const STATUS_LABEL: Record<string, Copy> = {
  draft: { en: "Draft", zh: "草稿" },
  testing: { en: "Testing", zh: "測試中" },
  live: { en: "Live", zh: "已上線" },
  suspended: { en: "Suspended", zh: "已停用" },
};
const PURPOSE_LABEL: Record<string, Copy> = {
  customer: { en: "Customer line", zh: "客戶線" },
  demo: { en: "Demo", zh: "示範" },
  test: { en: "Test", zh: "測試" },
  internal: { en: "Internal", zh: "內部" },
};
const CHANNEL_LABEL: Record<string, Copy> = {
  online: { en: "Online", zh: "線上" },
  test_line: { en: "Test line", zh: "測試線" },
  pstn: { en: "PSTN", zh: "市話" },
};

export const industryLabel = (value: string, zh: boolean) => pick(INDUSTRY_LABEL[value], zh, value);
export const statusLabel = (value: string, zh: boolean) => pick(STATUS_LABEL[value], zh, value);
export const purposeLabel = (value: string, zh: boolean) => pick(PURPOSE_LABEL[value], zh, value);
export const channelLabel = (value: string, zh: boolean) => pick(CHANNEL_LABEL[value], zh, value);

/** Characters that count toward the store name limit: the same whitespace set as the opening count (contract §1.4). */
export const nonSpaceLength = (text: string) => codePoints(text.replace(/[ \t\n\r\u3000]/g, ""));

/** Today's date in Taipei (fixed UTC+8, contract §1.4), as YYYY-MM-DD. */
export function taipeiToday(now = Date.now()): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** True for the 404 the backend gives while PC_VOICE_ENABLED is off (or the BFF does not know the path). */
export function voiceFeatureOff(error: unknown): boolean {
  return error instanceof PortalError && error.status === 404 && error.code === "not_found";
}

/** Error copy for the operator pages, by error code (phase1-contract §9); unknown codes fall back to portalErrorText. */
export function voiceAdminErrorText(error: unknown, locale: "en" | "zh"): string {
  const zh = locale === "zh";
  if (!(error instanceof PortalError)) return portalErrorText(error, locale);
  const detail = error.message.trim() && error.message !== "The request could not be completed." ? error.message.trim() : "";
  switch (error.code) {
    case "account_exists":
      return zh
        ? "這個 email 已經有帳號，基於安全不會連結。請改用另一個 email，或先查明那個帳號。"
        : "This email already has an account and will not be linked. Use another email or look into that account first.";
    case "live_requires_g2a":
      return zh
        ? "第 1 期不能改成「已上線」，要等上線門檻（G2a）通過。"
        : "Live is not allowed in phase 1; it needs the G2a launch gate.";
    case "invalid_transition":
      return zh ? "不能從目前的狀態改成這個狀態。" : "This status change is not allowed.";
    case "invalid_number":
      return zh
        ? "號碼要用國際格式（例如 +886227356688）或分機 ext-0001。"
        : "Use international format (e.g. +886227356688) or extension ext-0001.";
    case "number_overlap": {
      const base = zh
        ? "這個號碼在這段期間已經有一筆有效紀錄，請先調整那一筆的迄日。"
        : "This number already has an active entry in this period; change that entry's end date first.";
      return detail ? (zh ? `${base}（${detail}）` : `${base} (${detail})`) : base;
    }
    case "number_not_found":
      return zh ? "這筆號碼已經不存在，請重新整理。" : "This number no longer exists. Reload the page.";
    case "voice_store_not_found":
      // The §9 wording is written for the store owner; an operator is looking at someone else's store.
      return zh ? "找不到這家店，可能已經不存在，請重新整理。" : "This store was not found; it may no longer exist. Reload the page.";
    case "not_found":
      return zh
        ? "電話客服功能未開啟（PC_VOICE_ENABLED 不是 1）。"
        : "The phone agent feature is off (PC_VOICE_ENABLED is not 1).";
    case "invalid_input": {
      if (error.status === 413) return zh ? "內容太大。" : "The content is too large.";
      const base = portalErrorText(error, locale);
      return detail ? (zh ? `${base}（${detail}）` : `${base} (${detail})`) : base;
    }
    default:
      return portalErrorText(error, locale);
  }
}

const working = (zh: boolean) => (zh ? "處理中…" : "Working…");

export type OpenedStore = { store: StoreItem; account: { userId: string; email: string }; temporaryPassword: string };

/** A2: open a store, which always creates a new sign-in account (never links an existing one). */
export function OpenStoreDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (opened: OpenedStore) => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [industry, setIndustry] = useState<VoiceIndustry>("clinic");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  function validate(): string | null {
    const trimmedEmail = email.trim();
    if (codePoints(trimmedEmail) > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail))
      return zh ? "請輸入有效的登入 email。" : "Enter a valid sign-in email.";
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(displayName) || !displayName.trim() || codePoints(displayName.trim()) > NAME_MAX)
      return zh ? "聯絡人姓名要 1～100 字。" : "Enter a contact name of 1 to 100 characters.";
    const nameProblem = lineProblem(storeName, STORE_NAME_RAW_MAX);
    if (nameProblem === "unsafe") return unsafeMessage({ en: "store name", zh: "店名" }, zh);
    const counted = nonSpaceLength(storeName.trim());
    if (nameProblem || counted === 0 || counted > STORE_NAME_MAX)
      return zh ? `店名要 1～${STORE_NAME_MAX} 字（不計空白）。` : `Enter a store name of 1 to ${STORE_NAME_MAX} characters (spaces not counted).`;
    return null;
  }

  async function submit() {
    if (busyRef.current) return;
    const invalid = validate();
    setMessage(invalid);
    if (invalid) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const opened = await portalRequest<OpenedStore>("/admin/voice/stores", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), displayName: displayName.trim(), storeName: storeName.trim(), industry }),
      });
      onOpened(opened);
    } catch (reason: unknown) {
      setMessage(voiceAdminErrorText(reason, locale));
      busyRef.current = false;
      setBusy(false);
    }
  }

  const counted = nonSpaceLength(storeName.trim());
  return (
    <AdminDialog
      title={zh ? "開通店家" : "Open a store"}
      confirmLabel={busy ? working(zh) : zh ? "開通" : "Open store"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={() => void submit()}
      onClose={onClose}
      inFlight={busy}
    >
      <p className="portal-note">
        {zh
          ? "會建立一個新的登入帳號，並產生一次性的臨時密碼。這個 email 已經有帳號的話不能開通：註冊不驗證 email，那個帳號可能是別人搶先註冊的。"
          : "This creates a new sign-in account with a one-time temporary password. An email that already has an account cannot be used: signup does not verify email ownership, so that account may belong to someone else."}
      </p>
      <label className="portal-field">
        {zh ? "登入 email" : "Sign-in email"}
        <input type="email" autoComplete="off" value={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "聯絡人姓名" : "Contact name"}
        <input autoComplete="off" value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "店名" : "Store name"}
        <input autoComplete="off" value={storeName} disabled={busy} aria-describedby="voice-store-name-count" onChange={(event) => setStoreName(event.target.value)} />
      </label>
      <p id="voice-store-name-count" className="portal-hint">
        {zh ? `${counted} / ${STORE_NAME_MAX} 字（不計空白）` : `${counted} / ${STORE_NAME_MAX} characters (spaces not counted)`}
      </p>
      <label className="portal-field">
        {zh ? "產業" : "Industry"}
        <select value={industry} disabled={busy} onChange={(event) => setIndustry(event.target.value as VoiceIndustry)}>
          {VOICE_INDUSTRIES.map((value) => (
            <option key={value} value={value}>
              {industryLabel(value, zh)}
            </option>
          ))}
        </select>
      </label>
      {message !== null && (
        <p className="portal-error" role="alert">
          {message}
        </p>
      )}
    </AdminDialog>
  );
}

/** The only place the temporary password is shown; it lives in props until "I have given it to the store". */
/** Where the store signs in: the sign-in page that goes straight to the phone agent once signed in. */
export const VOICE_SIGN_IN_PATH = "/login?next=/account/voice";

export function StoreOpenedDialog({ opened, onClose }: { opened: OpenedStore; onClose: () => void }) {
  const zh = useLocale().locale === "zh";
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  const [linkCopied, setLinkCopied] = useState<"idle" | "copied" | "error">("idle");
  // The address the operator is using is the portal the store signs in to (verifier finding 2026-10-22: the hint
  // only said "powerchampion.ai", and the store then landed on the API-key overview).
  const signInUrl = (typeof window === "undefined" ? "" : window.location.origin) + VOICE_SIGN_IN_PATH;
  async function copy() {
    try {
      await navigator.clipboard.writeText(opened.temporaryPassword);
      setCopied("copied");
    } catch {
      setCopied("error");
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(signInUrl);
      setLinkCopied("copied");
    } catch {
      setLinkCopied("error");
    }
  }
  return (
    <AdminDialog
      title={zh ? `已開通「${opened.store.name}」` : `"${opened.store.name}" is open`}
      confirmLabel={zh ? "我已交給店家" : "I have given it to the store"}
      onConfirm={onClose}
      onClose={onClose}
      dismissible={false}
    >
      <p className="portal-note">
        {zh
          ? `登入 email：${opened.account.email}。下方臨時密碼只會顯示這一次，關閉後無法再次查看（忘記時請到「客戶」重設密碼）。`
          : `Sign-in email: ${opened.account.email}. The temporary password below is shown only once and cannot be viewed again after you close this (reset it under Customers if it is lost).`}
      </p>
      <div className="portal-secret">
        <code>{opened.temporaryPassword}</code>
      </div>
      <div className="portal-actions">
        <button type="button" className="portal-button-secondary" onClick={() => void copy()}>
          {copied === "copied" ? (zh ? "已複製" : "Copied") : zh ? "複製密碼" : "Copy password"}
        </button>
      </div>
      {copied === "error" && (
        <p className="portal-error" role="alert">
          {zh ? "無法自動複製，請手動選取上方密碼。" : "Copy is unavailable; select the password above manually."}
        </p>
      )}
      <p className="portal-hint">
        {zh
          ? "請透過私下管道交給店家，連同下面這個登入網址（登入後按「前往工作區」會直接到電話客服）："
          : "Give it to the store privately, with this sign-in address (after sign-in, \"Open workspace\" goes straight to the phone agent):"}
      </p>
      <p>
        <code data-voice-sign-in="">{signInUrl}</code>
      </p>
      <div className="portal-actions">
        <button type="button" className="portal-button-secondary" onClick={() => void copyLink()}>
          {linkCopied === "copied" ? (zh ? "已複製網址" : "Address copied") : zh ? "複製登入網址" : "Copy sign-in address"}
        </button>
      </div>
      {linkCopied === "error" && (
        <p className="portal-error" role="alert">
          {zh ? "無法自動複製，請手動選取上方網址。" : "Copy is unavailable; select the address above manually."}
        </p>
      )}
      <p className="portal-hint">
        {zh
          ? `請對方：1) 打開這個網址，用這組 email 與臨時密碼登入；2) 依畫面提示到「安全性」變更密碼；3) 回到「電話客服」完成設定並試打一通。網站第一次打開是英文：按右上角寫著「${LANGUAGE_NAMES.en}」的語言按鈕，再選「${LANGUAGE_NAMES["zh-Hant"]}」。`
          : `Ask them to: 1) open this address and sign in with this email and the temporary password; 2) change the password under Security when asked; 3) go back to Phone agent, finish the setup and try a call. The site opens in English the first time: at the top right, open the language button that says "${LANGUAGE_NAMES.en}" and choose "${LANGUAGE_NAMES["zh-Hant"]}".`}
      </p>
    </AdminDialog>
  );
}

/** A4: change a store's status. Only the targets in STATUS_TARGETS are listed, so live never appears. */
export function StoreStatusDialog({
  store,
  onClose,
  onChanged,
}: {
  store: StoreItem;
  onClose: () => void;
  onChanged: (store: StoreItem, changed: boolean) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const targets = STATUS_TARGETS[store.status as VoiceStatus] ?? [];
  const [target, setTarget] = useState<VoiceStatus | "">(targets[0] ?? "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (busyRef.current || !target) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await portalRequest<{ changed: boolean; store: StoreItem }>(`/admin/voice/stores/${store.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: target }),
      });
      onChanged(result.store, result.changed);
    } catch (reason: unknown) {
      setMessage(voiceAdminErrorText(reason, locale));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={zh ? `改狀態：${store.name}` : `Change status: ${store.name}`}
      confirmLabel={busy ? working(zh) : zh ? "改狀態" : "Change status"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={() => void submit()}
      onClose={onClose}
      inFlight={busy}
    >
      <p>
        {zh ? "目前狀態：" : "Current status: "}
        <strong>{statusLabel(store.status, zh)}</strong>
      </p>
      {targets.length === 0 ? (
        <p className="portal-note" role="status">
          {zh ? "不能從目前的狀態改成其他狀態。" : "This store's status cannot be changed from here."}
        </p>
      ) : (
        <>
          <label className="portal-field">
            {zh ? "新狀態" : "New status"}
            <select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value as VoiceStatus)}>
              {targets.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value, zh)}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <p role="status">
              {zh
                ? `要把「${store.name}」改成「${statusLabel(target, zh)}」嗎？`
                : `Change "${store.name}" to "${statusLabel(target, zh)}"?`}
            </p>
          )}
          {target === "suspended" && (
            <p className="portal-note">
              {zh
                ? "停用後店家只能查看設定，不能修改或試打。"
                : "When suspended, the store can only view its settings; it cannot edit or try calls."}
            </p>
          )}
        </>
      )}
      <p className="portal-hint">
        {zh
          ? "第 1 期不能改成「已上線」，要等上線門檻（G2a）通過。"
          : "Live is not allowed in phase 1; it needs the G2a launch gate."}
      </p>
      {message !== null && (
        <p className="portal-error" role="alert">
          {message}
        </p>
      )}
    </AdminDialog>
  );
}

type NumberDraft = {
  number: string;
  storeId: string;
  purpose: VoicePurpose;
  channel: VoiceChannel;
  activeFrom: string;
  activeUntil: string;
  note: string;
};

/** A6 (add) and A7 (edit, which replaces the whole entry). */
export function NumberDialog({
  existing,
  stores,
  onClose,
  onSaved,
  onStale,
}: {
  existing: VoiceNumber | null;
  stores: StoreItem[];
  onClose: () => void;
  onSaved: (saved: VoiceNumber) => void;
  /** Called when the entry being edited no longer exists, so the list can reload behind the dialog. */
  onStale: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [draft, setDraft] = useState<NumberDraft>(() =>
    existing
      ? {
          number: existing.number,
          storeId: existing.storeId ?? "",
          purpose: (VOICE_PURPOSES as readonly string[]).includes(existing.purpose) ? (existing.purpose as VoicePurpose) : "test",
          channel: (VOICE_CHANNELS as readonly string[]).includes(existing.channel) ? (existing.channel as VoiceChannel) : "online",
          activeFrom: existing.activeFrom,
          activeUntil: existing.activeUntil ?? "",
          note: existing.note,
        }
      : { number: "", storeId: "", purpose: "test", channel: "online", activeFrom: taipeiToday(), activeUntil: "", note: "" },
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const update = (change: Partial<NumberDraft>) => setDraft((current) => ({ ...current, ...change }));
  // Spaces inside a pasted number ("+886 2 2735 6688") are dropped; nothing else is rewritten.
  const number = draft.number.replace(/\s+/g, "");
  // Keep the current store selectable even when it is missing from the loaded list.
  const storeOptions: { id: string; name: string }[] =
    existing?.storeId && !stores.some((store) => store.id === existing.storeId)
      ? [...stores, { id: existing.storeId, name: existing.storeName ?? existing.storeId }]
      : stores;

  function validate(): string | null {
    if (!VOICE_NUMBER_PATTERN.test(number)) return voiceAdminErrorText(new PortalError(400, "invalid_number", ""), locale);
    if (!validDate(draft.activeFrom)) return zh ? "請選擇計費起日。" : "Choose a start date.";
    if (draft.activeUntil && !validDate(draft.activeUntil)) return zh ? "計費迄日不是有效的日期。" : "The end date is not a valid date.";
    if (draft.activeUntil && draft.activeUntil < draft.activeFrom)
      return zh ? "計費迄日不能早於起日。" : "The end date cannot be before the start date.";
    const noteProblem = lineProblem(draft.note, NOTE_MAX, false);
    if (noteProblem === "unsafe") return unsafeMessage({ en: "note", zh: "備註" }, zh);
    if (noteProblem) return zh ? `備註最多 ${NOTE_MAX} 字。` : `The note can be up to ${NOTE_MAX} characters.`;
    return null;
  }

  async function submit() {
    if (busyRef.current) return;
    const invalid = validate();
    setMessage(invalid);
    if (invalid) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await portalRequest<{ number: VoiceNumber }>(existing ? `/admin/voice/numbers/${existing.id}` : "/admin/voice/numbers", {
        method: "POST",
        body: JSON.stringify({
          number,
          storeId: draft.storeId || null,
          purpose: draft.purpose,
          channel: draft.channel,
          activeFrom: draft.activeFrom,
          activeUntil: draft.activeUntil || null,
          note: draft.note.trim(),
        }),
      });
      onSaved(result.number);
    } catch (reason: unknown) {
      setMessage(voiceAdminErrorText(reason, locale));
      if (reason instanceof PortalError && reason.code === "number_not_found") onStale();
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={existing ? (zh ? `編輯號碼 ${existing.number}` : `Edit number ${existing.number}`) : zh ? "新增號碼" : "Add a number"}
      confirmLabel={busy ? working(zh) : zh ? "儲存" : "Save"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={() => void submit()}
      onClose={onClose}
      inFlight={busy}
    >
      <label className="portal-field">
        {zh ? "號碼" : "Number"}
        <input autoComplete="off" value={draft.number} disabled={busy} aria-describedby="voice-number-hint" onChange={(event) => update({ number: event.target.value })} />
      </label>
      <p id="voice-number-hint" className="portal-hint">
        {zh ? "國際格式（例如 +886227356688）或分機 ext-0001" : "International format (e.g. +886227356688) or extension ext-0001"}
      </p>
      <label className="portal-field">
        {zh ? "店家" : "Store"}
        <select value={draft.storeId} disabled={busy} onChange={(event) => update({ storeId: event.target.value })}>
          <option value="">{zh ? "不屬於任何店家" : "No store"}</option>
          {storeOptions.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </label>
      <label className="portal-field">
        {zh ? "用途" : "Purpose"}
        <select value={draft.purpose} disabled={busy} onChange={(event) => update({ purpose: event.target.value as VoicePurpose })}>
          {VOICE_PURPOSES.map((value) => (
            <option key={value} value={value}>
              {purposeLabel(value, zh)}
            </option>
          ))}
        </select>
      </label>
      <label className="portal-field">
        {zh ? "通道" : "Channel"}
        <select value={draft.channel} disabled={busy} onChange={(event) => update({ channel: event.target.value as VoiceChannel })}>
          {VOICE_CHANNELS.map((value) => (
            <option key={value} value={value}>
              {channelLabel(value, zh)}
            </option>
          ))}
        </select>
      </label>
      <label className="portal-field">
        {zh ? "計費起日" : "From"}
        <input type="date" value={draft.activeFrom} disabled={busy} onChange={(event) => update({ activeFrom: event.target.value })} />
      </label>
      <label className="portal-field">
        {zh ? "計費迄日" : "Until"}
        <input type="date" value={draft.activeUntil} disabled={busy} aria-describedby="voice-number-until-hint" onChange={(event) => update({ activeUntil: event.target.value })} />
      </label>
      <p id="voice-number-until-hint" className="portal-hint">
        {zh ? "日期以台北時間計，迄日當天也算有效；留空表示持續中。" : "Dates are Taipei dates and the end date is included; leave it empty for ongoing."}
      </p>
      <label className="portal-field">
        {zh ? "備註" : "Note"}
        <input autoComplete="off" value={draft.note} disabled={busy} onChange={(event) => update({ note: event.target.value })} />
      </label>
      {message !== null && (
        <p className="portal-error" role="alert">
          {message}
        </p>
      )}
    </AdminDialog>
  );
}

/** A8: delete a number after confirmation (phase 1 really deletes it; no call record refers to it yet). */
export function DeleteNumberDialog({
  entry,
  onClose,
  onDeleted,
  onStale,
}: {
  entry: VoiceNumber;
  onClose: () => void;
  onDeleted: () => void;
  onStale: () => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await portalRequest<{ ok: boolean }>(`/admin/voice/numbers/${entry.id}`, { method: "DELETE" });
      onDeleted();
    } catch (reason: unknown) {
      setMessage(voiceAdminErrorText(reason, locale));
      if (reason instanceof PortalError && reason.code === "number_not_found") onStale();
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={zh ? `要刪除號碼 ${entry.number} 嗎？` : `Delete number ${entry.number}?`}
      confirmLabel={busy ? working(zh) : zh ? "刪除" : "Delete"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={() => void submit()}
      onClose={onClose}
      inFlight={busy}
      danger
    >
      <p>
        {entry.storeName ?? (zh ? "不屬於任何店家" : "No store")}
        {" · "}
        {purposeLabel(entry.purpose, zh)}
        {" · "}
        {entry.activeFrom} – {entry.activeUntil ?? (zh ? "持續中" : "Ongoing")}
      </p>
      <p className="portal-note">
        {zh ? "這會真的刪除這筆紀錄，無法復原。" : "This really deletes the entry; it cannot be undone."}
      </p>
      {message !== null && (
        <p className="portal-error" role="alert">
          {message}
        </p>
      )}
    </AdminDialog>
  );
}
