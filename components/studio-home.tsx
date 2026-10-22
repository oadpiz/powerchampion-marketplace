"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  cleanTitle,
  localized,
  mediaUrl,
  projectStatusLabel,
  studioApi,
  studioErrorText,
  timeLabel,
  TITLE_MAX,
  TRASH_DAYS,
  type ProjectSummary,
  type StudioTemplate,
} from "../lib/studio-client";
import { AdminDialog } from "./admin-dialog";
import { useLocale } from "./locale-provider";
import { useStudio } from "./studio-shell";

const BUSY = new Set(["drafting", "rendering"]);
const LIST_POLL_MS = 10_000;

type Renaming = { item: ProjectSummary; value: string; error: string | null; busy: boolean };
type Deleting = { item: ProjectSummary; error: string | null; busy: boolean };

/** /studio: the signed-in user's videos, newest first. */
export function StudioHome() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const { credits } = useStudio();
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [revision, setRevision] = useState(0);
  const firstPage = useRef(true);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [deletedTitle, setDeletedTitle] = useState<string | null>(null);
  const untitled = zh ? "未命名影片" : "Untitled video";
  const nameOf = (item: ProjectSummary) => item.title || untitled;

  useEffect(() => {
    const controller = new AbortController();
    studioApi
      .templates(controller.signal)
      .then((result) => !controller.signal.aborted && setTemplates(result.items))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    studioApi
      .projects(null, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems((current) => {
          if (!current) return result.items;
          // A refresh updates the first page in place and keeps the pages loaded below it.
          const fresh = new Map(result.items.map((item) => [item.id, item]));
          const added = result.items.filter((item) => !current.some((known) => known.id === item.id));
          return [...added, ...current.map((item) => fresh.get(item.id) ?? item)];
        });
        if (firstPage.current) {
          firstPage.current = false;
          setNext(result.next);
        }
        setError(null);
      })
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause));
    return () => controller.abort();
  }, [revision]);

  // While a video is being drafted or generated, refresh the list now and then so its status moves on.
  const busy = items?.some((item) => BUSY.has(item.status)) ?? false;
  // Paused while the tab is hidden (each refresh makes the portal re-read every busy project from the agent).
  useEffect(() => {
    if (!busy) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "hidden") return;
      timer = setTimeout(() => {
        // Hidden in the meantime: wait for visibilitychange instead.
        if (document.visibilityState !== "hidden") setRevision((value) => value + 1);
      }, LIST_POLL_MS);
    };
    const wake = () => {
      if (document.visibilityState === "visible") setRevision((value) => value + 1);
      else arm();
    };
    arm();
    document.addEventListener("visibilitychange", wake);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [busy, items]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const result = await studioApi.projects(next);
      setItems((current) => [...(current ?? []), ...result.items.filter((item) => !current?.some((c) => c.id === item.id))]);
      setNext(result.next);
    } catch (cause) {
      setError(cause);
    } finally {
      setMore(false);
    }
  }

  const templateTitle = (id: string) => localized(templates.find((t) => t.id === id)?.title, locale, id);

  async function saveTitle() {
    if (!renaming || renaming.busy) return;
    const title = cleanTitle(renaming.value);
    if (!title) {
      setRenaming({ ...renaming, error: zh ? `請輸入 1 到 ${TITLE_MAX} 個字的名稱。` : `Enter a name of 1 to ${TITLE_MAX} characters.` });
      return;
    }
    const id = renaming.item.id;
    setRenaming({ ...renaming, busy: true, error: null });
    try {
      const doc = await studioApi.rename(id, title);
      const saved = typeof doc.title === "string" && doc.title ? doc.title : title;
      setItems((current) => current?.map((item) => (item.id === id ? { ...item, title: saved } : item)) ?? current);
      setRenaming(null);
    } catch (cause) {
      setRenaming((current) => current && { ...current, busy: false, error: studioErrorText(cause, locale) });
    }
  }

  async function confirmDelete() {
    if (!deleting || deleting.busy) return;
    const { item } = deleting;
    setDeleting({ ...deleting, busy: true, error: null });
    try {
      await studioApi.remove(item.id);
      setItems((current) => current?.filter((known) => known.id !== item.id) ?? current);
      setDeletedTitle(nameOf(item));
      setDeleting(null);
    } catch (cause) {
      setDeleting((current) => current && { ...current, busy: false, error: studioErrorText(cause, locale) });
    }
  }

  return (
    <>
      <header className="portal-header studio-header">
        <div>
          <p className="portal-kicker">VIDEO STUDIO</p>
          <h1>{zh ? "我的影片" : "My videos"}</h1>
          <p>
            {zh
              ? "輸入商品網址、主題或圖片，AI 先寫分鏡，你逐鏡修改後再產生與匯出。"
              : "Give a product URL, a topic or images. AI writes the storyboard; you edit it shot by shot, then generate and export."}
          </p>
        </div>
        <div className="portal-actions">
          <Link className="portal-button" href="/studio/new">
            ＋ {zh ? "新增影片" : "New video"}
          </Link>
        </div>
      </header>
      {deletedTitle !== null && (
        <p className="portal-note studio-notice" role="status">
          {zh ? `「${deletedTitle}」已移到回收區，${TRASH_DAYS} 天內可以從` : `“${deletedTitle}” moved to the trash. You can restore it from the `}
          <Link href="/studio/trash">{zh ? "回收區" : "trash"}</Link>
          {zh ? "復原。" : ` within ${TRASH_DAYS} days.`}
        </p>
      )}
      {error !== null && (
        <div className="portal-panel">
          <p className="portal-error" role="alert">
            {studioErrorText(error, locale)}
          </p>
          <button className="portal-button-secondary" type="button" onClick={() => setRevision((value) => value + 1)}>
            {zh ? "重新載入" : "Try again"}
          </button>
        </div>
      )}
      {items === null && error === null && (
        <p className="portal-empty" role="status">
          {zh ? "正在載入影片…" : "Loading videos…"}
        </p>
      )}
      {items !== null && items.length === 0 && (
        <section className="portal-panel studio-empty">
          <div className="studio-empty-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2>{zh ? "還沒有影片" : "No videos yet"}</h2>
          <p className="portal-muted">
            {zh
              ? `建立第一支影片：產生分鏡只要 ${templates[0]?.prices?.draft ?? 2} 點，滿意之後再產生畫面。`
              : `Start your first video: the storyboard costs ${templates[0]?.prices?.draft ?? 2} credits, and you generate pictures only once you like it.`}
          </p>
          {credits && credits.balance === 0 && (
            <p className="portal-note">
              {zh ? "你目前沒有點數。請先" : "You have no credits yet. "}
              <Link href="/contact">{zh ? "聯絡我們開通方案" : "Contact us to start a plan"}</Link>
              {zh ? "。" : "."}
            </p>
          )}
          <Link className="portal-button" href="/studio/new">
            {zh ? "新增影片" : "New video"}
          </Link>
        </section>
      )}
      {items !== null && items.length > 0 && (
        <>
          <ul className="studio-grid" aria-label={zh ? "影片列表" : "Videos"}>
            {items.map((item) => (
              <li key={item.id} className="studio-card-item">
                <Link className="studio-card" href={`/studio/p/${item.id}`}>
                  <span className="studio-card-thumb">
                    {mediaUrl(item.thumb_url) ? (
                      // Signed media URL from the studio media host; next/image cannot optimise it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(item.thumb_url) ?? undefined} alt="" loading="lazy" />
                    ) : (
                      <span className="studio-card-placeholder" aria-hidden="true">
                        ▶
                      </span>
                    )}
                    <span className={`studio-status studio-status-${item.status}`}>
                      {BUSY.has(item.status) && <span className="studio-pulse" aria-hidden="true" />}
                      {projectStatusLabel(item.status, locale)}
                    </span>
                  </span>
                  <span className="studio-card-body">
                    <strong>{nameOf(item)}</strong>
                    <small>
                      {templateTitle(item.template_id)} · {timeLabel(item.updated_at, locale)}
                    </small>
                  </span>
                </Link>
                <div className="studio-card-actions">
                  <button
                    type="button"
                    className="studio-card-action"
                    aria-label={zh ? `重新命名「${nameOf(item)}」` : `Rename “${nameOf(item)}”`}
                    onClick={() => setRenaming({ item, value: item.title ?? "", error: null, busy: false })}
                  >
                    {zh ? "重新命名" : "Rename"}
                  </button>
                  <button
                    type="button"
                    className="studio-card-action studio-card-action-danger"
                    aria-label={zh ? `刪除「${nameOf(item)}」` : `Delete “${nameOf(item)}”`}
                    onClick={() => setDeleting({ item, error: null, busy: false })}
                  >
                    {zh ? "刪除" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {next && (
            <div className="studio-more">
              <button className="portal-button-secondary" type="button" disabled={more} onClick={() => void loadMore()}>
                {more ? (zh ? "載入中…" : "Loading…") : zh ? "載入更多" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
      {renaming && (
        <AdminDialog
          title={zh ? "重新命名影片" : "Rename video"}
          confirmLabel={renaming.busy ? (zh ? "儲存中…" : "Saving…") : zh ? "儲存" : "Save"}
          cancelLabel={zh ? "取消" : "Cancel"}
          inFlight={renaming.busy}
          onClose={() => setRenaming(null)}
          onConfirm={() => void saveTitle()}
        >
          <label className="studio-rename-field">
            <span>{zh ? "影片名稱" : "Video title"}</span>
            <input
              type="text"
              value={renaming.value}
              maxLength={TITLE_MAX}
              disabled={renaming.busy}
              onChange={(event) => setRenaming({ ...renaming, value: event.target.value, error: null })}
            />
          </label>
          <p className="portal-muted">{zh ? `最多 ${TITLE_MAX} 個字。` : `Up to ${TITLE_MAX} characters.`}</p>
          {renaming.error && (
            <p className="portal-error" role="alert">
              {renaming.error}
            </p>
          )}
        </AdminDialog>
      )}
      {deleting && (
        <AdminDialog
          title={zh ? `刪除「${nameOf(deleting.item)}」？` : `Delete “${nameOf(deleting.item)}”?`}
          confirmLabel={deleting.busy ? (zh ? "刪除中…" : "Deleting…") : zh ? "刪除" : "Delete"}
          cancelLabel={zh ? "取消" : "Cancel"}
          inFlight={deleting.busy}
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>
            {zh
              ? `刪除不會退回已使用的點數。${TRASH_DAYS} 天內可以從回收區復原。`
              : `Deleting does not refund credits already used. You can restore it from the trash within ${TRASH_DAYS} days.`}
          </p>
          {deleting.error && (
            <p className="portal-error" role="alert">
              {deleting.error}
            </p>
          )}
        </AdminDialog>
      )}
    </>
  );
}
