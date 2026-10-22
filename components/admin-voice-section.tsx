"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { portalRequest } from "../lib/portal-client";
import { ResourceState, dateLabel, usePortalResource } from "./admin-resource";
import {
  DeleteNumberDialog,
  NumberDialog,
  OpenStoreDialog,
  StoreOpenedDialog,
  StoreStatusDialog,
  VOICE_INDUSTRIES,
  VOICE_STATUSES,
  channelLabel,
  industryLabel,
  purposeLabel,
  statusLabel,
  voiceAdminErrorText,
  voiceFeatureOff,
  type OpenedStore,
  type StoreItem,
  type VoiceNumber,
} from "./admin-voice-dialogs";
import { useLocale } from "./locale-provider";

/** A3 (phase1-contract §4.3). Phase 1 does not return FAQ contents. */
type StoreDetail = {
  store: StoreItem & {
    greeting: string;
    afterHoursMode: string;
    askCallback: string;
    maxMessageSeconds: number;
    retentionDays: number;
    hoursSegments: number;
    closures: number;
  };
  versions: { version: number; configSha256: string; createdAt: string; createdBy: { id: string; email: string } | null }[];
  numbers: VoiceNumber[];
  try: { used24h: number; lastIssuedAt: string | null };
};

type Resource<T> = { data: T | null; error: unknown; loading: boolean; refresh: () => void };
type Tab = "stores" | "numbers";
const TABS: { tab: Tab; en: string; zh: string }[] = [
  { tab: "stores", en: "Stores", zh: "店家" },
  { tab: "numbers", en: "Numbers", zh: "號碼" },
];

const AFTER_HOURS: Record<string, [string, string]> = {
  answer_and_message: ["Answer questions; take a message when the caller needs a person", "照常回答問題，要找人時請客人留言"],
  message_only: ["Only take a message; do not answer questions", "只請客人留言，不回答問題"],
};
const ASK_CALLBACK: Record<string, [string, string]> = {
  auto: ["When needed", "視情況"],
  always: ["Always", "一定要問"],
  never: ["Never", "不要問"],
};
const RECORDING: Record<string, [string, string]> = {
  off: ["Do not record", "不錄音"],
  message_only: ["Record messages only", "只錄留言"],
  full: ["Record whole calls", "全程錄音"],
};
const label = (table: Record<string, [string, string]>, value: string, zh: boolean) => table[value]?.[zh ? 1 : 0] ?? value;

/** /admin/voice: stores and the number table, switched by in-page tabs (phase1-contract §7.2, §8.6). */
export function AdminVoiceSection() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [tab, setTab] = useState<Tab>("stores");
  const stores = usePortalResource<{ stores: StoreItem[] }>("/admin/voice/stores");
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // A1 answers 404 not_found while PC_VOICE_ENABLED is off; then nothing else here can work either.
  if (voiceFeatureOff(stores.error)) return <FeatureOff onRetry={stores.refresh} />;

  function moveTab(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex((item) => item.tab === tab);
    const next =
      event.key === "ArrowRight" ? (index + 1) % TABS.length
      : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
      : event.key === "Home" ? 0
      : event.key === "End" ? TABS.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next].tab);
    tabRefs.current[TABS[next].tab]?.focus();
  }

  return (
    <>
      <div className="portal-actions" role="tablist" aria-label={zh ? "電話客服管理" : "Phone agent administration"}>
        {TABS.map((item) => (
          <button
            key={item.tab}
            ref={(element) => {
              tabRefs.current[item.tab] = element;
            }}
            type="button"
            role="tab"
            id={`voice-tab-${item.tab}`}
            aria-selected={tab === item.tab}
            aria-controls={tab === item.tab ? `voice-panel-${item.tab}` : undefined}
            tabIndex={tab === item.tab ? 0 : -1}
            className={tab === item.tab ? "portal-button" : "portal-button-secondary"}
            onClick={() => setTab(item.tab)}
            onKeyDown={moveTab}
          >
            {item[locale]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`voice-panel-${tab}`} aria-labelledby={`voice-tab-${tab}`}>
        {tab === "stores" ? <StoresPanel resource={stores} /> : <NumbersPanel stores={stores.data?.stores ?? []} />}
      </div>
    </>
  );
}

function FeatureOff({ onRetry }: { onRetry: () => void }) {
  const zh = useLocale().locale === "zh";
  return (
    <section className="portal-panel">
      <p className="portal-note" role="status">
        {zh ? "電話客服功能未開啟（PC_VOICE_ENABLED 不是 1）。" : "The phone agent feature is off (PC_VOICE_ENABLED is not 1)."}
      </p>
      <div className="portal-actions">
        <button type="button" className="portal-button-secondary" onClick={onRetry}>
          {zh ? "重試" : "Try again"}
        </button>
      </div>
    </section>
  );
}

function StoresPanel({ resource }: { resource: Resource<{ stores: StoreItem[] }> }) {
  const zh = useLocale().locale === "zh";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [industry, setIndustry] = useState("all");
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState<OpenedStore | null>(null);
  // After "I have given it to the store", focus goes back to "Open a store": the dialog's own restore target was
  // the open-store dialog's button, which is gone by then (verifier finding 2026-10-22: focus fell to <body>).
  const openButton = useRef<HTMLButtonElement>(null);
  const refocusOpen = useRef(false);
  useEffect(() => {
    // Runs after the dialog's own focus restore (its cleanup), so this one wins.
    if (opened !== null || !refocusOpen.current) return;
    refocusOpen.current = false;
    openButton.current?.focus();
  }, [opened]);
  const [changing, setChanging] = useState<StoreItem | null>(null);
  const [selected, setSelected] = useState<StoreItem | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const all = resource.data?.stores ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const visible = all.filter(
    (store) =>
      (status === "all" || store.status === status) &&
      (industry === "all" || store.industry === industry) &&
      (!needle || store.name.toLocaleLowerCase().includes(needle) || store.owner.email.toLocaleLowerCase().includes(needle)),
  );
  const count = (value: number) => value.toLocaleString(zh ? "zh-TW" : "en-US");

  return (
    <>
      <ResourceState {...resource}>
        {resource.data && (
          <section className="portal-panel" aria-labelledby="voice-stores-title">
            <div className="portal-panel-heading">
              <h2 id="voice-stores-title">{zh ? "店家" : "Stores"}</h2>
              <button
                ref={openButton}
                type="button"
                className="portal-button"
                onClick={() => {
                  setNotice(null);
                  setOpening(true);
                }}
              >
                {zh ? "開通店家" : "Open a store"}
              </button>
            </div>
            {notice !== null && (
              <p className="portal-note" role="status">
                {notice}
              </p>
            )}
            {all.length === 0 ? (
              <p className="portal-empty">
                {zh ? "還沒有開通任何店家。按「開通店家」建立第一家。" : 'No stores yet. Use "Open a store" to add the first one.'}
              </p>
            ) : (
              <>
                <div className="portal-actions">
                  <label className="portal-field">
                    {zh ? "搜尋店名或 email" : "Search store or email"}
                    <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
                  </label>
                  <label className="portal-field">
                    {zh ? "狀態" : "Status"}
                    <select value={status} onChange={(event) => setStatus(event.target.value)}>
                      <option value="all">{zh ? "全部狀態" : "All statuses"}</option>
                      {VOICE_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {statusLabel(value, zh)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="portal-field">
                    {zh ? "產業" : "Industry"}
                    <select value={industry} onChange={(event) => setIndustry(event.target.value)}>
                      <option value="all">{zh ? "全部產業" : "All industries"}</option>
                      {VOICE_INDUSTRIES.map((value) => (
                        <option key={value} value={value}>
                          {industryLabel(value, zh)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="portal-button-secondary" onClick={resource.refresh}>
                    {zh ? "重新整理" : "Refresh"}
                  </button>
                </div>
                <p className="portal-muted">
                  {zh ? `顯示 ${count(visible.length)} / ${count(all.length)} 家` : `Showing ${count(visible.length)} of ${count(all.length)} stores`}
                </p>
                {visible.length === 0 ? (
                  <p className="portal-empty">{zh ? "沒有符合條件的店家。" : "No stores match these filters."}</p>
                ) : (
                  <div className="portal-table-wrap">
                    <table className="portal-table voice-stack">
                      <caption className="sr-only">{zh ? "店家" : "Stores"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "店名" : "Store"}</th>
                          <th scope="col">{zh ? "帳號 email" : "Account email"}</th>
                          <th scope="col">{zh ? "產業" : "Industry"}</th>
                          <th scope="col">{zh ? "狀態" : "Status"}</th>
                          <th scope="col">{zh ? "設定版本" : "Version"}</th>
                          <th scope="col">{zh ? "問答數" : "FAQs"}</th>
                          <th scope="col">{zh ? "最後試打" : "Last test call"}</th>
                          <th scope="col">{zh ? "AI 回答" : "AI answers"}</th>
                          <th scope="col">{zh ? "動作" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((store) => (
                          <tr key={store.id}>
                            <th scope="row">{store.name}</th>
                            <td data-label={zh ? "帳號 email" : "Account email"}>{store.owner.email}</td>
                            <td data-label={zh ? "產業" : "Industry"}>{industryLabel(store.industry, zh)}</td>
                            <td data-label={zh ? "狀態" : "Status"}>
                              <span className="portal-badge">{statusLabel(store.status, zh)}</span>
                            </td>
                            <td data-label={zh ? "設定版本" : "Version"}>
                              {store.currentVersion === null
                                ? zh ? "未套用" : "Not applied"
                                : zh ? `第 ${store.currentVersion} 版` : `v${store.currentVersion}`}
                            </td>
                            <td data-label={zh ? "問答數" : "FAQs"}>{count(store.faqCount)}</td>
                            <td data-label={zh ? "最後試打" : "Last test call"}>
                              {store.lastTryAt === null ? (zh ? "沒有試打過" : "Never") : dateLabel(store.lastTryAt, zh)}
                            </td>
                            <td data-label={zh ? "AI 回答" : "AI answers"}>{store.aiAnswerEnabled ? (zh ? "開" : "On") : zh ? "關" : "Off"}</td>
                            <td>
                              <div className="portal-actions">
                                <button
                                  type="button"
                                  className="portal-text-button"
                                  aria-label={zh ? `詳細：${store.name}` : `Details for ${store.name}`}
                                  onClick={() => setSelected(store)}
                                >
                                  {zh ? "詳細" : "Details"}
                                </button>
                                <button
                                  type="button"
                                  className="portal-text-button"
                                  aria-label={zh ? `改狀態：${store.name}` : `Change status of ${store.name}`}
                                  onClick={() => {
                                    setNotice(null);
                                    setChanging(store);
                                  }}
                                >
                                  {zh ? "改狀態" : "Change status"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </ResourceState>
      {selected !== null && (
        <StoreDetailPanel
          key={selected.id}
          store={selected}
          revision={detailRevision}
          onClose={() => setSelected(null)}
          onChangeStatus={(store) => {
            setNotice(null);
            setChanging(store);
          }}
        />
      )}
      {opening && (
        <OpenStoreDialog
          onClose={() => setOpening(false)}
          onOpened={(result) => {
            setOpening(false);
            setOpened(result);
            resource.refresh();
          }}
        />
      )}
      {opened !== null && (
        <StoreOpenedDialog
          opened={opened}
          onClose={() => {
            refocusOpen.current = true;
            setOpened(null);
          }}
        />
      )}
      {changing !== null && (
        <StoreStatusDialog
          store={changing}
          onClose={() => setChanging(null)}
          onChanged={(store, changed) => {
            setChanging(null);
            setNotice(
              changed
                ? zh ? `已把「${store.name}」改成「${statusLabel(store.status, zh)}」。` : `"${store.name}" is now "${statusLabel(store.status, zh)}".`
                : zh ? `「${store.name}」本來就是「${statusLabel(store.status, zh)}」。` : `"${store.name}" was already "${statusLabel(store.status, zh)}".`,
            );
            resource.refresh();
            setDetailRevision((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

function StoreDetailPanel({
  store,
  revision,
  onClose,
  onChangeStatus,
}: {
  store: StoreItem;
  revision: number;
  onClose: () => void;
  onChangeStatus: (store: StoreItem) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const key = `${store.id}:${revision}`;
  const [result, setResult] = useState<{ key: string; data: StoreDetail | null; error: unknown }>({ key: "", data: null, error: null });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    portalRequest<StoreDetail>(`/admin/voice/stores/${store.id}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, data: null, error });
      });
    return () => controller.abort();
  }, [store.id, key]);

  const loading = result.key !== key;
  // A reload after a status change keeps the previous details on screen until the new ones arrive.
  const detail = result.data;
  const current = detail?.store ?? store;
  const count = (value: number) => value.toLocaleString(zh ? "zh-TW" : "en-US");
  return (
    <section className="portal-panel" aria-labelledby="voice-store-detail-title">
      <div className="portal-panel-heading">
        <h2 id="voice-store-detail-title" ref={headingRef} tabIndex={-1}>
          {current.name}
        </h2>
        <div className="portal-actions">
          <button type="button" className="portal-button-secondary" disabled={loading && !detail} onClick={() => onChangeStatus(current)}>
            {zh ? "改狀態" : "Change status"}
          </button>
          <button type="button" className="portal-button-secondary" onClick={onClose}>
            {zh ? "關閉" : "Close"}
          </button>
        </div>
      </div>
      {loading && !detail && (
        <p className="portal-muted" role="status">
          {zh ? "正在載入店家詳細資料…" : "Loading store details…"}
        </p>
      )}
      {!loading && result.error !== null && (
        <p className="portal-error" role="alert">
          {voiceAdminErrorText(result.error, locale)}
        </p>
      )}
      {detail && (
        <>
          <dl className="portal-meta">
            <dt>{zh ? "帳號 email" : "Account email"}</dt>
            <dd>{detail.store.owner.email}</dd>
            <dt>{zh ? "聯絡人" : "Contact"}</dt>
            <dd>{detail.store.owner.name || "—"}</dd>
            <dt>{zh ? "產業" : "Industry"}</dt>
            <dd>{industryLabel(detail.store.industry, zh)}</dd>
            <dt>{zh ? "狀態" : "Status"}</dt>
            <dd>{statusLabel(detail.store.status, zh)}</dd>
            <dt>{zh ? "設定版本" : "Version"}</dt>
            <dd>
              {detail.store.currentVersion === null
                ? zh ? "未套用" : "Not applied"
                : zh ? `第 ${detail.store.currentVersion} 版` : `v${detail.store.currentVersion}`}
            </dd>
            <dt>{zh ? "問答數" : "FAQs"}</dt>
            <dd>{count(detail.store.faqCount)}</dd>
            <dt>{zh ? "知識庫字數" : "Knowledge base characters"}</dt>
            <dd>{count(detail.store.kbChars)}</dd>
            <dt>{zh ? "AI 回答" : "AI answers"}</dt>
            <dd>{detail.store.aiAnswerEnabled ? (zh ? "開" : "On") : zh ? "關" : "Off"}</dd>
            <dt>{zh ? "開場白" : "Greeting"}</dt>
            <dd>{detail.store.greeting || "—"}</dd>
            <dt>{zh ? "下班時間的做法" : "After hours"}</dt>
            <dd>{label(AFTER_HOURS, detail.store.afterHoursMode, zh)}</dd>
            <dt>{zh ? "問回電號碼" : "Ask for a callback number"}</dt>
            <dd>{label(ASK_CALLBACK, detail.store.askCallback, zh)}</dd>
            <dt>{zh ? "留言長度" : "Message length"}</dt>
            <dd>{zh ? `最長 ${detail.store.maxMessageSeconds} 秒` : `Up to ${detail.store.maxMessageSeconds} s`}</dd>
            <dt>{zh ? "錄音方式" : "Recording"}</dt>
            <dd>{label(RECORDING, detail.store.recordingMode, zh)}</dd>
            <dt>{zh ? "錄音保存" : "Retention"}</dt>
            <dd>{zh ? `${detail.store.retentionDays} 天` : `${detail.store.retentionDays} days`}</dd>
            <dt>{zh ? "營業時段" : "Business hour segments"}</dt>
            <dd>{count(detail.store.hoursSegments)}</dd>
            <dt>{zh ? "特殊休假日" : "Special closures"}</dt>
            <dd>{count(detail.store.closures)}</dd>
            <dt>{zh ? "24 小時內試打" : "Test calls in the last 24 hours"}</dt>
            <dd>{count(detail.try.used24h)}</dd>
            <dt>{zh ? "最後試打" : "Last test call"}</dt>
            <dd>{detail.try.lastIssuedAt === null ? (zh ? "沒有試打過" : "Never") : dateLabel(detail.try.lastIssuedAt, zh)}</dd>
            <dt>{zh ? "開通時間" : "Opened"}</dt>
            <dd>{dateLabel(detail.store.createdAt, zh)}</dd>
          </dl>
          <h3>{zh ? "版本紀錄" : "Versions"}</h3>
          {detail.versions.length === 0 ? (
            <p className="portal-muted">{zh ? "還沒有套用任何版本" : "No version applied yet"}</p>
          ) : (
            <ul>
              {detail.versions.map((version) => (
                <li key={version.version}>
                  {zh
                    ? `第 ${version.version} 版・${dateLabel(version.createdAt, zh)}・${version.createdBy?.email ?? "—"}・sha ${version.configSha256.slice(0, 8)}`
                    : `v${version.version} · ${dateLabel(version.createdAt, zh)} · ${version.createdBy?.email ?? "—"} · sha ${version.configSha256.slice(0, 8)}`}
                </li>
              ))}
            </ul>
          )}
          <h3>{zh ? "號碼" : "Numbers"}</h3>
          {detail.numbers.length === 0 ? (
            <p className="portal-muted">{zh ? "這家店還沒有號碼。" : "This store has no numbers yet."}</p>
          ) : (
            <ul>
              {detail.numbers.map((entry) => (
                <li key={entry.id}>
                  <code>{entry.number}</code>
                  {` · ${purposeLabel(entry.purpose, zh)} · ${channelLabel(entry.channel, zh)} · ${entry.activeFrom} – ${entry.activeUntil ?? (zh ? "持續中" : "Ongoing")}`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function NumbersPanel({ stores }: { stores: StoreItem[] }) {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<{ numbers: VoiceNumber[] }>("/admin/voice/numbers");
  const [editing, setEditing] = useState<VoiceNumber | "new" | null>(null);
  const [deleting, setDeleting] = useState<VoiceNumber | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (voiceFeatureOff(resource.error)) return <FeatureOff onRetry={resource.refresh} />;
  const numbers = resource.data?.numbers ?? [];
  const period = (entry: VoiceNumber) => `${entry.number} (${entry.activeFrom})`;
  return (
    <>
      <ResourceState {...resource}>
        {resource.data && (
          <section className="portal-panel" aria-labelledby="voice-numbers-title">
            <div className="portal-panel-heading">
              <h2 id="voice-numbers-title">{zh ? "號碼" : "Numbers"}</h2>
              <button
                type="button"
                className="portal-button"
                onClick={() => {
                  setNotice(null);
                  setEditing("new");
                }}
              >
                {zh ? "新增號碼" : "Add a number"}
              </button>
            </div>
            {notice !== null && (
              <p className="portal-note" role="status">
                {notice}
              </p>
            )}
            {numbers.length === 0 ? (
              <p className="portal-empty">
                {zh
                  ? "還沒有號碼。這張表是之後產生邊緣主機設定與號碼對照的唯一來源。"
                  : "No numbers yet. This table will be the only source for edge-host settings and number lists."}
              </p>
            ) : (
              <div className="portal-table-wrap">
                <table className="portal-table voice-stack">
                  <caption className="sr-only">{zh ? "號碼" : "Numbers"}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{zh ? "號碼" : "Number"}</th>
                      <th scope="col">{zh ? "店家" : "Store"}</th>
                      <th scope="col">{zh ? "用途" : "Purpose"}</th>
                      <th scope="col">{zh ? "通道" : "Channel"}</th>
                      <th scope="col">{zh ? "計費起日" : "From"}</th>
                      <th scope="col">{zh ? "計費迄日" : "Until"}</th>
                      <th scope="col">{zh ? "備註" : "Note"}</th>
                      <th scope="col">{zh ? "動作" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {numbers.map((entry) => (
                      <tr key={entry.id}>
                        <th scope="row">
                          <code>{entry.number}</code>
                          {entry.activeNow && (
                            <>
                              {" "}
                              <span className="portal-badge">{zh ? "目前有效" : "Active now"}</span>
                            </>
                          )}
                        </th>
                        <td data-label={zh ? "店家" : "Store"}>{entry.storeName ?? (zh ? "不屬於任何店家" : "No store")}</td>
                        <td data-label={zh ? "用途" : "Purpose"}>{purposeLabel(entry.purpose, zh)}</td>
                        <td data-label={zh ? "通道" : "Channel"}>{channelLabel(entry.channel, zh)}</td>
                        <td data-label={zh ? "計費起日" : "From"}>{entry.activeFrom}</td>
                        <td data-label={zh ? "計費迄日" : "Until"}>{entry.activeUntil ?? (zh ? "持續中" : "Ongoing")}</td>
                        <td data-label={zh ? "備註" : "Note"}>{entry.note || "—"}</td>
                        <td>
                          <div className="portal-actions">
                            <button
                              type="button"
                              className="portal-text-button"
                              aria-label={zh ? `編輯 ${period(entry)}` : `Edit ${period(entry)}`}
                              onClick={() => {
                                setNotice(null);
                                setEditing(entry);
                              }}
                            >
                              {zh ? "編輯" : "Edit"}
                            </button>
                            <button
                              type="button"
                              className="portal-text-button"
                              aria-label={zh ? `刪除 ${period(entry)}` : `Delete ${period(entry)}`}
                              onClick={() => {
                                setNotice(null);
                                setDeleting(entry);
                              }}
                            >
                              {zh ? "刪除" : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </ResourceState>
      {editing !== null && (
        <NumberDialog
          existing={editing === "new" ? null : editing}
          stores={stores}
          onClose={() => setEditing(null)}
          onStale={resource.refresh}
          onSaved={(saved) => {
            setEditing(null);
            setNotice(zh ? `已儲存號碼 ${saved.number}。` : `Saved number ${saved.number}.`);
            resource.refresh();
          }}
        />
      )}
      {deleting !== null && (
        <DeleteNumberDialog
          entry={deleting}
          onClose={() => setDeleting(null)}
          onStale={resource.refresh}
          onDeleted={() => {
            setNotice(zh ? `已刪除號碼 ${deleting.number}。` : `Deleted number ${deleting.number}.`);
            setDeleting(null);
            resource.refresh();
          }}
        />
      )}
    </>
  );
}
