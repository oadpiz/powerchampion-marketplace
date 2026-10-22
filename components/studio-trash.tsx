"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  mediaUrl,
  restoreDaysLeft,
  studioApi,
  studioErrorText,
  timeLabel,
  TRASH_DAYS,
  type ProjectSummary,
} from "../lib/studio-client";
import { useLocale } from "./locale-provider";

/** /studio/trash (回收區): videos deleted in the last 30 days, which can be restored. Credits are never refunded. */
export function StudioTrash() {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [more, setMore] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [restored, setRestored] = useState<ProjectSummary | null>(null);
  const nameOf = (item: ProjectSummary) => item.title || (zh ? "未命名影片" : "Untitled video");

  useEffect(() => {
    const controller = new AbortController();
    studioApi
      .projects(null, controller.signal, { deleted: true })
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setNext(result.next);
        setError(null);
      })
      .catch((cause: unknown) => !controller.signal.aborted && setError(cause));
    return () => controller.abort();
  }, [revision]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try {
      const result = await studioApi.projects(next, undefined, { deleted: true });
      setItems((current) => [...(current ?? []), ...result.items.filter((item) => !current?.some((c) => c.id === item.id))]);
      setNext(result.next);
    } catch (cause) {
      setError(cause);
    } finally {
      setMore(false);
    }
  }

  async function restore(item: ProjectSummary) {
    if (restoring) return;
    setRestoring(item.id);
    setActionError(null);
    setRestored(null);
    try {
      await studioApi.restore(item.id);
      setItems((current) => current?.filter((known) => known.id !== item.id) ?? current);
      setRestored(item);
    } catch (cause) {
      setActionError(cause);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <>
      <header className="portal-header studio-header">
        <div>
          <p className="portal-kicker">TRASH</p>
          <h1>{zh ? "回收區" : "Trash"}</h1>
          <p>
            {zh
              ? `刪除的影片會保留 ${TRASH_DAYS} 天，${TRASH_DAYS} 天內可以復原，之後就會永久移除。已使用的點數不會退回。`
              : `Deleted videos are kept for ${TRASH_DAYS} days and can be restored until then; after that they are removed for good. Credits already used are not refunded.`}
          </p>
        </div>
      </header>
      {restored && (
        <p className="portal-note studio-notice" role="status">
          {zh ? `已復原「${nameOf(restored)}」。` : `Restored “${nameOf(restored)}”. `}
          <Link href={`/studio/p/${restored.id}`}>{zh ? "開啟" : "Open"}</Link>
        </p>
      )}
      {actionError !== null && (
        <p className="portal-error" role="alert">
          {studioErrorText(actionError, locale)}
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
          {zh ? "正在載入回收區…" : "Loading the trash…"}
        </p>
      )}
      {items !== null && items.length === 0 && (
        <section className="portal-panel studio-empty">
          <p>{zh ? "回收區是空的。" : "The trash is empty."}</p>
          <Link className="portal-button-secondary" href="/studio">
            {zh ? "回到我的影片" : "Back to my videos"}
          </Link>
        </section>
      )}
      {items !== null && items.length > 0 && (
        <>
          <ul className="studio-grid" aria-label={zh ? "已刪除的影片" : "Deleted videos"}>
            {items.map((item) => {
              const days = restoreDaysLeft(item.restore_until);
              return (
                <li key={item.id} className="studio-card studio-card-deleted">
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
                  </span>
                  <span className="studio-card-body">
                    <strong>{nameOf(item)}</strong>
                    <small>
                      {zh ? "刪除於 " : "Deleted "}
                      {timeLabel(item.deleted_at, locale)}
                    </small>
                    <small className="studio-trash-left">
                      {days > 0
                        ? zh
                          ? `還可復原 ${days} 天`
                          : `${days} ${days === 1 ? "day" : "days"} left to restore`
                        : zh
                          ? "不到 1 天後永久移除"
                          : "Removed for good in less than a day"}
                    </small>
                    <button
                      type="button"
                      className="portal-button-secondary"
                      disabled={restoring !== null}
                      aria-label={zh ? `復原「${nameOf(item)}」` : `Restore “${nameOf(item)}”`}
                      onClick={() => void restore(item)}
                    >
                      {restoring === item.id ? (zh ? "復原中…" : "Restoring…") : zh ? "復原" : "Restore"}
                    </button>
                  </span>
                </li>
              );
            })}
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
    </>
  );
}
