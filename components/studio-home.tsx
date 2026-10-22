"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  localized,
  projectStatusLabel,
  studioApi,
  studioErrorText,
  timeLabel,
  type ProjectSummary,
  type StudioTemplate,
} from "../lib/studio-client";
import { useLocale } from "./locale-provider";
import { useStudio } from "./studio-shell";

const BUSY = new Set(["drafting", "rendering"]);
const LIST_POLL_MS = 10_000;

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
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setRevision((value) => value + 1), LIST_POLL_MS);
    return () => clearTimeout(timer);
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
              <li key={item.id}>
                <Link className="studio-card" href={`/studio/p/${item.id}`}>
                  <span className="studio-card-thumb">
                    {item.thumb_url ? (
                      // Signed media URL from the studio media host; next/image cannot optimise it.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumb_url} alt="" loading="lazy" />
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
                    <strong>{item.title || (zh ? "未命名影片" : "Untitled video")}</strong>
                    <small>
                      {templateTitle(item.template_id)} · {timeLabel(item.updated_at, locale)}
                    </small>
                  </span>
                </Link>
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
    </>
  );
}
