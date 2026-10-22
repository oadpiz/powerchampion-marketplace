"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { PortalError } from "../lib/portal-client";
import {
  aspectLabel,
  downloadUrl,
  isInternalVoice,
  isVideoUrl,
  mediaUrl,
  kindLabel,
  localized,
  newIdempotencyKey,
  opErrorText,
  opIsActive,
  opStateLabel,
  opTypeLabel,
  partLabel,
  projectStatusLabel,
  studioApi,
  studioErrorText,
  type OpResult,
  type Quote,
  type StudioShot,
  type StudioTemplate,
} from "../lib/studio-client";
import { AdminDialog } from "./admin-dialog";
import { useLocale } from "./locale-provider";
import { ProjectSettings, ShotInspector } from "./studio-inspector";
import { useStudio } from "./studio-shell";
import { useStudioProject } from "./use-studio-project";

type Pending = { quote: Quote; key: string; label: string; error: unknown; busy: boolean; requoted: boolean };
type Notice = { tone: "ok" | "warn" | "error"; text: string };
const MEDIA_RETRY_MS = 30_000;
/** How long the actions stay disabled after a submit if the reloaded document does not show the op yet. */
const SUBMITTED_HOLD_MS = 15_000;
const STOPPED = new Set([401, 403, 404]);

/** Arrow-key navigation for a tablist (WAI-ARIA tabs with automatic activation). */
function tabKeys(event: KeyboardEvent<HTMLElement>, order: string[], current: string, select: (value: string) => void) {
  const index = order.indexOf(current);
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % order.length;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + order.length) % order.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = order.length - 1;
  else return;
  event.preventDefault();
  select(order[next]);
  const list = event.currentTarget.closest("[role=tablist]");
  queueMicrotask(() => list?.querySelector<HTMLElement>(`[data-tab="${order[next]}"]`)?.focus());
}

function shotBadge(shot: StudioShot, zh: boolean) {
  if (shot.status === "rendering") return { cls: "studio-badge-busy", text: zh ? "產生中" : "Generating" };
  if (shot.status === "queued") return { cls: "studio-badge-queued", text: zh ? "排隊中" : "Queued" };
  if (shot.stale) return { cls: "studio-badge-stale", text: zh ? "需產生" : "To generate" };
  return null;
}

/** /studio/p/{id}: timeline, preview, schema-driven inspector, settings and the priced actions. */
export function StudioEditor({ projectId }: { projectId: string }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const { user, credits, refreshCredits } = useStudio();
  const isAdmin = user.role === "admin";
  const { project, error, loading, refresh, setProject } = useStudioProject(projectId);
  const [templates, setTemplates] = useState<StudioTemplate[] | null>(null);
  const [selected, setSelected] = useState(1);
  const [tab, setTab] = useState<"shot" | "settings">("shot");
  const [view, setView] = useState<"shot" | "export">("shot");
  const [viewAspect, setViewAspect] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<{ rev: number; render?: Quote | null; aspects: Record<string, Quote | null> } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const watched = useRef<string | null>(null);
  const submitting = useRef(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const ids = useId();
  const mediaRetry = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    studioApi
      .templates(controller.signal)
      .then((result) => !controller.signal.aborted && setTemplates(result.items))
      .catch(() => !controller.signal.aborted && setTemplates([]));
    return () => controller.abort();
  }, []);

  const template = templates?.find((item) => item.id === project?.template_id) ?? null;
  const active = project ? opIsActive(project.active_op) : false;
  const shots = project?.shots ?? [];
  const hasStoryboard = shots.length > 0;
  const staleCount = shots.filter((shot) => shot.stale).length;
  const aspects = project?.aspects ?? (project ? [project.aspect] : []);
  const currentAspect = viewAspect && aspects.includes(viewAspect) ? viewAspect : (project?.aspect ?? "9:16");
  const shot = shots.find((item) => item.index === selected) ?? shots[0] ?? null;
  const rawExport = project?.exports?.[currentAspect] ?? null;
  const exported = rawExport && mediaUrl(rawExport.url) ? rawExport : null;
  const missingAspects = (template?.aspects ?? []).filter((aspect) => !aspects.includes(aspect));
  // D-V4: a customer's project on an internal voice cannot be narrated (the portal refuses those quotes too).
  const noVoice = !isAdmin && !!template && !!project && isInternalVoice(template.project_schema.properties?.voice, project.settings?.voice);

  // When an op this page saw running ends, tell the user what it cost (the portal's ledger is the truth).
  useEffect(() => {
    if (!project) return;
    const op = project.active_op;
    if (op && opIsActive(op)) {
      watched.current = op.op_id;
      return;
    }
    const finished = watched.current;
    if (!finished) return;
    watched.current = null;
    refreshCredits();
    studioApi
      .op(project.id, finished)
      .then((result: OpResult) => {
        const label = opTypeLabel(result.type, result.target, locale, template?.ops);
        const charged = result.credits_charged ?? 0;
        const refunded = result.credits_refunded ?? 0;
        if (result.state === "settled")
          setNotice({
            tone: "ok",
            text: charged > 0 ? (zh ? `「${label}」完成，扣 ${charged} 點。` : `"${label}" finished; ${charged} credits charged.`) : zh ? `「${label}」完成。` : `"${label}" finished.`,
          });
        else if (result.state === "settled_partial")
          setNotice({
            tone: "warn",
            text: zh
              ? `「${label}」只完成一部分：扣 ${charged} 點，退還 ${refunded} 點。${opErrorText(result.error?.code, locale)}`
              : `"${label}" finished in part: ${charged} credits charged, ${refunded} refunded. ${opErrorText(result.error?.code, locale)}`,
          });
        else if (result.state === "refunded")
          setNotice({
            tone: "error",
            text: zh
              ? `「${label}」沒有完成，已退還 ${refunded} 點。${opErrorText(result.error?.code, locale)}`
              : `"${label}" did not finish; ${refunded} credits refunded. ${opErrorText(result.error?.code, locale)}`,
          });
      })
      .catch(() => {});
  }, [project, locale, zh, refreshCredits, template?.ops]);

  // After a submit the actions stay disabled until the document shows the op (or that it already ended).
  const holding = submitted !== null && project?.active_op?.op_id !== submitted && project?.last_op?.op_id !== submitted;
  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => setSubmitted(null), SUBMITTED_HOLD_MS);
    return () => clearTimeout(timer);
  }, [submitted]);

  // Prices for the top bar, once per storyboard revision while nothing runs (quotes are signed and short-lived).
  const rev = project?.storyboard_rev ?? -1;
  const quoteRender = hasStoryboard && staleCount > 0 && !active && !noVoice;
  const quoteAspects = hasStoryboard && staleCount === 0 && !active ? missingAspects.join(",") : "";
  useEffect(() => {
    if (!project || active || !hasStoryboard) return;
    let cancelled = false;
    const wanted = quoteAspects ? quoteAspects.split(",") : [];
    Promise.all([
      quoteRender ? studioApi.quote(project.id, "render").catch(() => null) : Promise.resolve(undefined),
      ...wanted.map((aspect) => studioApi.quote(project.id, "add_aspect", aspect).catch(() => null)),
    ]).then(([render, ...added]) => {
      if (cancelled) return;
      setQuotes({ rev, render: render ?? null, aspects: Object.fromEntries(wanted.map((aspect, i) => [aspect, added[i] ?? null])) });
    });
    return () => {
      cancelled = true;
    };
    // project.id and rev identify the storyboard; the quote targets are derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, rev, active, quoteRender, quoteAspects, hasStoryboard]);
  const fresh = quotes && quotes.rev === rev ? quotes : null;

  async function ask(type: string, target?: string | null) {
    if (!project) return;
    setActionError(null);
    setNotice(null);
    setQuoting(type + (target ?? ""));
    try {
      const quote = await studioApi.quote(project.id, type, target);
      const label = opTypeLabel(type, quote.target ?? target, locale, template?.ops);
      if (quote.credits === 0) {
        // Free steps (export) need no confirmation.
        const op = await studioApi.submit(project.id, quote, newIdempotencyKey());
        setSubmitted(op.op_id);
        refresh();
      } else {
        setPending({ quote, key: newIdempotencyKey(), label, error: null, busy: false, requoted: false });
      }
    } catch (cause) {
      setActionError(cause);
    } finally {
      setQuoting(null);
    }
  }

  async function confirm() {
    // A ref, not state: two clicks in the same tick must not both submit.
    if (!pending || !project || pending.busy || submitting.current) return;
    submitting.current = true;
    setPending({ ...pending, busy: true, error: null });
    try {
      const op = await studioApi.submit(project.id, pending.quote, pending.key);
      setSubmitted(op.op_id);
      setPending(null);
      refreshCredits();
      refresh();
    } catch (cause) {
      // Whatever went wrong (402, busy, stale), the balance and the project may have moved on.
      refreshCredits();
      refresh();
      if (cause instanceof PortalError && cause.code === "studio_stale_quote") {
        // The storyboard changed under the quote: price it again and ask once more.
        try {
          const quote = await studioApi.quote(project.id, pending.quote.type, pending.quote.target);
          setPending({ quote, key: newIdempotencyKey(), label: pending.label, error: cause, busy: false, requoted: true });
          return;
        } catch (again) {
          setPending({ ...pending, busy: false, error: again });
          return;
        }
      }
      setPending({ ...pending, busy: false, error: cause });
    } finally {
      submitting.current = false;
    }
  }

  function mediaFailed() {
    // Signed media URLs expire (spec 5.3): reload the document for fresh ones, at most every 30 s.
    const now = Date.now();
    if (now - mediaRetry.current < MEDIA_RETRY_MS) return;
    mediaRetry.current = now;
    refresh();
  }

  if (loading && !project)
    return (
      <p className="portal-empty" role="status">
        {zh ? "正在載入影片…" : "Loading the video…"}
      </p>
    );
  if (!project)
    return (
      <section className="portal-panel">
        <p className="portal-error" role="alert">
          {studioErrorText(error, locale)}
        </p>
        <div className="portal-actions">
          <button className="portal-button-secondary" type="button" onClick={refresh}>
            {zh ? "重新載入" : "Try again"}
          </button>
          <Link className="portal-text-link" href="/studio">
            {zh ? "回到我的影片" : "Back to my videos"}
          </Link>
        </div>
      </section>
    );

  const balance = credits?.balance ?? null;
  const draftPrice = template?.prices?.draft ?? 2;
  const renderLabel = fresh?.render ? (zh ? `產生全部（${fresh.render.credits} 點）` : `Generate all (${fresh.render.credits} credits)`) : zh ? "產生全部" : "Generate all";
  const preview = mediaUrl(shot?.preview_url);
  const stageKeys = (event: KeyboardEvent<HTMLElement>) =>
    tabKeys(event, exported ? ["shot", "export"] : ["shot"], view, (value) => setView(value as "shot" | "export"));
  const lastFailed = !notice && !active && project.last_op?.state === "failed" ? project.last_op : null;
  const busyNow = active || quoting !== null || pending?.busy === true || holding;
  const pollStopped = error instanceof PortalError && STOPPED.has(error.status);

  return (
    <div className="studio-editor-page">
      <header className="studio-editor-header">
        <div className="studio-editor-title">
          <Link href="/studio" className="studio-back">
            ← {zh ? "我的影片" : "My videos"}
          </Link>
          <h1>{project.title || (zh ? "未命名影片" : "Untitled video")}</h1>
          <p>
            <span className={`studio-status studio-status-${project.status}`}>{projectStatusLabel(project.status, locale)}</span>
            <span>{localized(template?.title, locale, project.template_id)}</span>
            <span>{aspects.map((aspect) => aspectLabel(aspect, locale)).join(" + ")}</span>
            {hasStoryboard && (
              <span>
                {zh ? `${shots.length} 鏡` : `${shots.length} shots`}
                {project.total_seconds ? ` · ${Math.round(project.total_seconds)} ${zh ? "秒" : "s"}` : ""}
              </span>
            )}
          </p>
        </div>
        <div className="studio-toolbar" role="toolbar" aria-label={zh ? "影片動作" : "Video actions"}>
          {!hasStoryboard && !active && (
            <button type="button" className="portal-button" disabled={busyNow} onClick={() => void ask("draft")}>
              {zh ? `產生分鏡（${draftPrice} 點）` : `Write storyboard (${draftPrice} credits)`}
            </button>
          )}
          {hasStoryboard && (
            <button type="button" className="portal-button" disabled={busyNow || staleCount === 0 || noVoice} onClick={() => void ask("render")}>
              {renderLabel}
            </button>
          )}
          {hasStoryboard && (
            <button
              type="button"
              className="portal-button-secondary"
              disabled={busyNow || staleCount > 0}
              title={staleCount > 0 ? (zh ? "還有鏡頭需要產生" : "Some shots still need generating") : undefined}
              onClick={() => void ask("export", currentAspect)}
            >
              {quoting === `export${currentAspect}` ? (zh ? "準備中…" : "Preparing…") : zh ? `匯出 ${currentAspect}` : `Export ${currentAspect}`}
            </button>
          )}
          {hasStoryboard &&
            missingAspects.map((aspect) => {
              const quote = fresh?.aspects[aspect];
              return (
                <button
                  key={aspect}
                  type="button"
                  className="portal-button-secondary"
                  disabled={busyNow || staleCount > 0}
                  onClick={() => void ask("add_aspect", aspect)}
                >
                  {zh ? `加做 ${aspect}` : `Add ${aspect}`}
                  {quote ? (zh ? `（${quote.credits} 點）` : ` (${quote.credits} credits)`) : ""}
                </button>
              );
            })}
          {hasStoryboard &&
            (template?.ops ?? [])
              .filter((op) => op.target_kind !== "character")
              .map((op) => (
                <button
                  key={op.type}
                  type="button"
                  className="portal-button-secondary"
                  disabled={busyNow || noVoice}
                  onClick={() => void ask(op.type, op.target_kind === "shot" ? String(shot?.index ?? 1) : op.target_kind === "aspect" ? currentAspect : undefined)}
                >
                  {localized(op.label, locale, op.type)}
                </button>
              ))}
        </div>
      </header>

      {active && project.active_op && (
        <div className="studio-progress" role="status" aria-live="polite">
          <span className="studio-spinner" aria-hidden="true" />
          <span>
            <strong>{opTypeLabel(project.active_op.type, null, locale, template?.ops)}</strong>
            {" · "}
            {project.queue?.position
              ? zh
                ? `排隊中，第 ${project.queue.position} 位`
                : `Queued, position ${project.queue.position}`
              : opStateLabel(project.active_op.state, locale)}
          </span>
          <small>{zh ? "處理中暫時不能編輯；完成後會自動更新，可以先離開此頁。" : "Editing is paused until it finishes. This page updates by itself; you can leave and come back."}</small>
        </div>
      )}
      {notice && (
        <div className={`studio-notice studio-notice-${notice.tone}`} role="status">
          <span>{notice.text}</span>
          <button type="button" className="portal-text-button" onClick={() => setNotice(null)}>
            {zh ? "關閉" : "Dismiss"}
          </button>
        </div>
      )}
      {lastFailed && (
        <div className="studio-notice studio-notice-error" role="status">
          <span>
            {zh ? `上一個步驟「${opTypeLabel(lastFailed.type, null, locale)}」沒有完成：` : `The last step ("${opTypeLabel(lastFailed.type, null, locale)}") did not finish: `}
            {opErrorText(lastFailed.error?.code, locale)}
          </span>
        </div>
      )}
      {actionError !== null && (
        <p className="portal-error" role="alert">
          {studioErrorText(actionError, locale)}
          {actionError instanceof PortalError && actionError.code === "studio_insufficient_credits" && (
            <>
              {" "}
              <Link href="/studio/credits">{zh ? "查看點數" : "See credits"}</Link>
            </>
          )}
        </p>
      )}
      {noVoice && (
        <p className="portal-note" role="status">
          {zh
            ? "目前沒有可對外使用的配音，暫時無法產生畫面與配音；你仍可編輯分鏡，開放授權配音後即可產生。"
            : "No licensed voice is available yet, so pictures and narration cannot be generated for now. You can still edit the storyboard."}
        </p>
      )}
      {error !== null &&
        (pollStopped ? (
          <p className="portal-error" role="alert">
            {studioErrorText(error, locale)}
          </p>
        ) : active ? (
          <p className="portal-note" role="status">
            {zh ? "暫時無法更新狀態，會自動重試。" : "Could not refresh the status; retrying automatically."} {studioErrorText(error, locale)}
          </p>
        ) : (
          <div className="studio-notice studio-notice-error" role="status">
            <span>{studioErrorText(error, locale)}</span>
            <button type="button" className="portal-text-button" onClick={refresh}>
              {zh ? "重新載入" : "Reload"}
            </button>
          </div>
        ))}

      {!hasStoryboard ? (
        <section className="portal-panel studio-drafting">
          {project.status === "drafting" || active ? (
            <>
              <div className="studio-skeleton" aria-hidden="true">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <span key={n} />
                ))}
              </div>
              <h2>{zh ? "AI 正在寫分鏡…" : "AI is writing the storyboard…"}</h2>
              <p className="portal-muted">
                {zh ? "通常不到一分鐘。完成後你可以逐鏡修改畫面描述與旁白，再決定要產生哪些。" : "Usually under a minute. Then you can edit each shot's picture prompt and narration before generating."}
              </p>
            </>
          ) : (
            <>
              <h2>{project.status === "failed_draft" ? (zh ? "分鏡沒有產生成功" : "The storyboard could not be written") : zh ? "還沒有分鏡" : "No storyboard yet"}</h2>
              <p className="portal-muted">
                {zh ? `按上方「產生分鏡（${draftPrice} 點）」再試一次。` : `Use "Write storyboard (${draftPrice} credits)" above to try again.`}
              </p>
            </>
          )}
        </section>
      ) : (
        <div className="studio-editor">
          <ol className="studio-timeline" aria-label={zh ? "分鏡時間軸" : "Shot timeline"}>
            {shots.map((item) => {
              const badge = shotBadge(item, zh);
              const warn = item.selfcheck?.verdict === "review";
              return (
                <li key={item.index}>
                  <button
                    type="button"
                    className="studio-shot"
                    aria-current={item.index === shot?.index ? "true" : undefined}
                    onClick={() => {
                      setSelected(item.index);
                      setView("shot");
                      setTab("shot");
                    }}
                  >
                    <span className="studio-shot-thumb">
                      {mediaUrl(item.thumb_url) ? (
                        // Signed media URL (studio media host).
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl(item.thumb_url) ?? undefined} alt="" loading="lazy" onError={mediaFailed} />
                      ) : (
                        <span aria-hidden="true">{item.index}</span>
                      )}
                      <span className="studio-shot-index">#{item.index}</span>
                    </span>
                    <span className="studio-shot-body">
                      <span className="studio-shot-meta">
                        <span className={`studio-kind studio-kind-${item.kind}`}>{kindLabel(item.kind, locale)}</span>
                        <span>{item.seconds}{zh ? " 秒" : " s"}</span>
                        {warn && (
                          <span className="studio-warn" title={zh ? "AI 自我檢查有提醒" : "Self-check warning"} aria-label={zh ? "AI 自我檢查有提醒" : "Self-check warning"}>
                            ⚠
                          </span>
                        )}
                      </span>
                      <span className="studio-shot-text">{item.narration}</span>
                      {badge && <span className={`studio-badge ${badge.cls}`}>{badge.text}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <section className="studio-stage" aria-label={zh ? "預覽" : "Preview"}>
            <div
              className="studio-stage-tabs"
              role="tablist"
              aria-label={zh ? "預覽內容" : "Preview content"}
            >
              <button
                type="button"
                role="tab"
                id={`${ids}-view-shot`}
                data-tab="shot"
                aria-controls={`${ids}-screen`}
                aria-selected={view === "shot"}
                tabIndex={view === "shot" ? 0 : -1}
                onKeyDown={stageKeys}
                onClick={() => setView("shot")}
              >
                {zh ? `第 ${shot?.index ?? 1} 鏡` : `Shot ${shot?.index ?? 1}`}
              </button>
              <button
                type="button"
                role="tab"
                id={`${ids}-view-export`}
                data-tab="export"
                aria-controls={`${ids}-screen`}
                aria-selected={view === "export"}
                tabIndex={view === "export" ? 0 : -1}
                onKeyDown={stageKeys}
                disabled={!exported}
                onClick={() => setView("export")}
              >
                {zh ? "成片" : "Final video"}
              </button>
              {aspects.length > 1 &&
                aspects.map((aspect) => (
                  <button key={aspect} type="button" className="studio-aspect-chip" aria-pressed={aspect === currentAspect} onClick={() => setViewAspect(aspect)}>
                    {aspect}
                  </button>
                ))}
            </div>
            <div
              id={`${ids}-screen`}
              role="tabpanel"
              aria-labelledby={`${ids}-view-${view}`}
              className={`studio-screen studio-screen-${(view === "export" ? currentAspect : project.aspect).replace(":", "x")}`}>
              {view === "export" && exported ? (
                // Subtitles are burned into the export by default; the SRT is offered as a download below.
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video key={exported.url} src={exported.url} controls playsInline preload="metadata" onError={mediaFailed} />
              ) : preview && isVideoUrl(preview) ? (
                <video key={preview} src={preview} controls muted loop playsInline preload="metadata" onError={mediaFailed} />
              ) : preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={shot?.visual_prompt ?? ""} onError={mediaFailed} />
              ) : (
                <div className="studio-screen-empty">
                  <span aria-hidden="true">▣</span>
                  <p>{zh ? "這一鏡還沒有畫面" : "No picture for this shot yet"}</p>
                  <small>{shot?.visual_prompt}</small>
                </div>
              )}
            </div>
            {view === "shot" && shot && (
              <p className="studio-caption">
                <span>{zh ? "旁白" : "Narration"}</span>
                {shot.narration}
              </p>
            )}
            {exported && (
              <div className="studio-downloads">
                <a className="portal-button-secondary" href={downloadUrl(exported.url)} target="_blank" rel="noopener noreferrer">
                  {zh ? `下載 MP4（${currentAspect}）` : `Download MP4 (${currentAspect})`}
                </a>
                {mediaUrl(exported.srt_url) && (
                  <a className="portal-text-link" href={mediaUrl(exported.srt_url) ?? undefined} target="_blank" rel="noopener noreferrer">
                    {zh ? "下載字幕 SRT" : "Download subtitles (SRT)"}
                  </a>
                )}
              </div>
            )}
            {staleCount > 0 && (
              <p className="studio-field-hint">
                {zh ? `還有 ${staleCount} 鏡需要產生，完成後才能匯出。` : `${staleCount} shot(s) still need generating before export.`}
              </p>
            )}
          </section>

          <aside className="studio-inspector" aria-label={zh ? "編輯" : "Inspector"}>
            <div
              className="studio-inspector-tabs"
              role="tablist"
              aria-label={zh ? "編輯內容" : "Edit"}
            >
              {(["shot", "settings"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${value}`}
                  data-tab={value}
                  aria-controls={`${ids}-panel`}
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  onKeyDown={(event) => tabKeys(event, ["shot", "settings"], tab, (next) => setTab(next as "shot" | "settings"))}
                  onClick={() => setTab(value)}
                >
                  {value === "shot" ? (zh ? "鏡頭" : "Shot") : zh ? "專案設定" : "Settings"}
                </button>
              ))}
            </div>
            <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
            {template === null ? (
              <p className="portal-empty" role="status">
                {templates === null ? (zh ? "正在載入…" : "Loading…") : zh ? "找不到此影片的範本設定。" : "This video's template is not available."}
              </p>
            ) : tab === "shot" && shot ? (
              <ShotInspector
                key={`${project.id}-${shot.index}`}
                project={project}
                shot={shot}
                schema={template.shot_schema}
                isAdmin={isAdmin}
                locked={active}
                canRegenerate={!busyNow && !noVoice}
                onSaved={setProject}
                onRegenerate={(dirty) => {
                  if (dirty) {
                    setActionError(null);
                    setNotice({ tone: "warn", text: zh ? "請先儲存變更，再重新產生。" : "Save your changes before regenerating." });
                    return;
                  }
                  void ask("regenerate", String(shot.index));
                }}
              />
            ) : (
              <ProjectSettings key={project.id} project={project} schema={template.project_schema} isAdmin={isAdmin} locked={active} onSaved={setProject} />
            )}
            </div>
          </aside>
        </div>
      )}

      {pending && (
        <AdminDialog
          title={zh ? `確認：${pending.label}` : `Confirm: ${pending.label}`}
          confirmLabel={pending.busy ? (zh ? "送出中…" : "Submitting…") : zh ? `確認（${pending.quote.credits} 點）` : `Confirm (${pending.quote.credits} credits)`}
          cancelLabel={zh ? "取消" : "Cancel"}
          inFlight={pending.busy}
          onClose={() => setPending(null)}
          onConfirm={() => void confirm()}
        >
          {pending.requoted && (
            <p className="portal-note" role="status">
              {zh ? "內容在報價後有變更，以下是更新後的價格。" : "The video changed after the quote; this is the updated price."}
            </p>
          )}
          <table className="studio-quote" aria-label={zh ? "費用明細" : "Price breakdown"}>
            <tbody>
              {pending.quote.breakdown.map((row) => (
                <tr key={row.part}>
                  <th scope="row">{partLabel(row.part, locale, pending.quote.breakdown.map((item) => item.part))}</th>
                  <td>× {row.count}</td>
                  <td>{zh ? `${row.credits} 點` : `${row.credits} credits`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{zh ? "合計" : "Total"}</th>
                <td />
                <td>
                  <strong data-testid="quote-total">{zh ? `${pending.quote.credits} 點` : `${pending.quote.credits} credits`}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
          {balance !== null && (
            <p className={balance < pending.quote.credits ? "portal-error" : "portal-muted"}>
              {zh
                ? `目前可用 ${balance} 點${balance >= pending.quote.credits ? `，完成後約剩 ${balance - pending.quote.credits} 點` : "，點數不足"}。`
                : `You have ${balance} credits${balance >= pending.quote.credits ? `; about ${balance - pending.quote.credits} left afterwards` : ", which is not enough"}.`}
            </p>
          )}
          <p className="studio-field-hint">
            {zh ? "點數先預留，沒產生出來的部分會自動退還。" : "Credits are reserved first; anything not produced is refunded automatically."}
          </p>
          {pending.error !== null && !(pending.error instanceof PortalError && pending.error.code === "studio_stale_quote" && pending.requoted) && (
            <p className="portal-error" role="alert">
              {studioErrorText(pending.error, locale)}
              {pending.error instanceof PortalError && pending.error.code === "studio_insufficient_credits" && (
                <>
                  {" "}
                  <Link href="/studio/credits">{zh ? "查看點數" : "See credits"}</Link>
                </>
              )}
            </p>
          )}
        </AdminDialog>
      )}
      {shot && tab === "shot" && view === "shot" && <SelfCheckSummary shots={shots} />}
    </div>
  );
}

/** A count of shots the self-check flagged, so they are not missed in a long timeline. */
function SelfCheckSummary({ shots }: { shots: StudioShot[] }) {
  const { locale } = useLocale();
  const flagged = shots.filter((shot) => shot.selfcheck?.verdict === "review");
  if (flagged.length === 0) return null;
  return (
    <p className="studio-field-hint studio-selfcheck-summary">
      {locale === "zh"
        ? `AI 自我檢查提醒 ${flagged.length} 鏡：${flagged.map((shot) => `#${shot.index}`).join("、")}`
        : `The AI self-check flagged ${flagged.length} shot(s): ${flagged.map((shot) => `#${shot.index}`).join(", ")}`}
      {flagged.some((shot) => shot.selfcheck?.validated === false) && <span className="studio-tag">{locale === "zh" ? "未驗證" : "Unverified"}</span>}
    </p>
  );
}

