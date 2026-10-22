"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PortalError } from "../lib/portal-client";
import {
  aspectLabel,
  cleanInputs,
  localized,
  newIdempotencyKey,
  schemaDefaults,
  studioApi,
  studioErrorText,
  validateInputs,
  type StudioTemplate,
} from "../lib/studio-client";
import { useLocale } from "./locale-provider";
import { SchemaField } from "./studio-fields";
import { useStudio } from "./studio-shell";

/** The /studio/new route: opens the editor with a client-side navigation once the project exists. */
export function StudioNewRoute() {
  const router = useRouter();
  return <StudioNew navigate={(href) => router.push(href)} />;
}

/** /studio/new: pick a template, fill the form rendered from its input_schema, choose the primary aspect. */
export function StudioNew({ navigate: go }: { navigate: (href: string) => void }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const { user, credits, refreshCredits } = useStudio();
  const [templates, setTemplates] = useState<StudioTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [entered, setValues] = useState<Record<string, unknown>>({});
  const [aspectChoice, setAspect] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyFields, setBusyFields] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  // A create that failed after the agent attached the product images to its project: they must be uploaded again.
  const [reupload, setReupload] = useState(false);
  // One key per filled-in form: a double click or a retry after a lost response creates one project.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    studioApi
      .templates(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setTemplates(result.items);
        setLoadError(null);
      })
      .catch((cause: unknown) => !controller.signal.aborted && setLoadError(cause));
    return () => controller.abort();
  }, [revision]);

  function pick(template: StudioTemplate) {
    setTemplateId(template.id);
    setValues({});
    setAspect(null);
    setBusyFields({});
    setErrors({});
    setSubmitError(null);
    setIdempotencyKey(newIdempotencyKey());
  }

  // A single template is chosen for the user.
  const template = useMemo(
    () => templates?.find((item) => item.id === templateId) ?? (templates?.length === 1 ? templates[0] : null),
    [templates, templateId],
  );
  const values = useMemo(() => (template ? { ...schemaDefaults(template.input_schema), ...entered } : entered), [template, entered]);
  const aspect =
    aspectChoice && template?.aspects.includes(aspectChoice)
      ? aspectChoice
      : template?.aspects.includes("9:16")
        ? "9:16"
        : (template?.aspects[0] ?? "9:16");
  const price = template?.prices?.draft ?? 2;
  const short = credits !== null && credits.balance < price;
  const uploading = Object.values(busyFields).some(Boolean);
  const setBusy = (name: string, busy: boolean) =>
    setBusyFields((current) => (current[name] === busy ? current : { ...current, [name]: busy }));

  function update(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name] && !current._form) return current;
      const rest = { ...current };
      delete rest[name];
      delete rest._form;
      return rest;
    });
    setIdempotencyKey(newIdempotencyKey());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!template || submitting || uploading) return;
    const found = validateInputs(template.input_schema, values, locale);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    setReupload(false);
    try {
      const created = await studioApi.create({
        template_id: template.id,
        inputs: cleanInputs(template.input_schema, values),
        aspect,
        idempotency_key: idempotencyKey,
      });
      refreshCredits();
      go(`/studio/p/${created.id}`);
    } catch (cause) {
      setSubmitError(cause);
      setSubmitting(false);
      refreshCredits(); // a 402 usually means the balance shown was out of date
      const images = values.image_ids;
      if (Array.isArray(images) && images.length > 0) {
        // The server ties the project, and the images attached to it, to this key. A retry with other inputs needs
        // a new key, and the old images cannot follow it: clear them and ask for a fresh upload.
        setValues((current) => ({ ...current, image_ids: [] }));
        setIdempotencyKey(newIdempotencyKey());
        setReupload(true);
      }
    }
  }

  const fields = Object.entries(template?.input_schema.properties ?? {});
  const insufficient = submitError instanceof PortalError && submitError.code === "studio_insufficient_credits";

  return (
    <>
      <header className="portal-header studio-header">
        <div>
          <p className="portal-kicker">NEW VIDEO</p>
          <h1>{zh ? "新增影片" : "New video"}</h1>
          <p>
            {zh
              ? "先產生分鏡（只寫腳本、不出圖），確認每一鏡的畫面與旁白後，再決定要產生哪些。"
              : "First get a storyboard (script only, no pictures). Check each shot's picture and narration, then decide what to generate."}
          </p>
        </div>
      </header>
      {loadError !== null && (
        <div className="portal-panel">
          <p className="portal-error" role="alert">
            {studioErrorText(loadError, locale)}
          </p>
          <button className="portal-button-secondary" type="button" onClick={() => setRevision((value) => value + 1)}>
            {zh ? "重新載入" : "Try again"}
          </button>
        </div>
      )}
      {templates === null && loadError === null && (
        <p className="portal-empty" role="status">
          {zh ? "正在載入範本…" : "Loading templates…"}
        </p>
      )}
      {templates !== null && (
        <section className="studio-step" aria-labelledby="studio-step-template">
          <h2 id="studio-step-template">
            <span className="studio-step-number">1</span>
            {zh ? "選擇範本" : "Choose a template"}
          </h2>
          <div className="studio-template-list" role="radiogroup" aria-labelledby="studio-step-template">
            {templates.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === template?.id}
                tabIndex={item.id === (template?.id ?? templates[0]?.id) ? 0 : -1}
                data-template={item.id}
                className="studio-template"
                onClick={() => pick(item)}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                  if (!step) return;
                  event.preventDefault();
                  const index = templates.findIndex((candidate) => candidate.id === item.id);
                  const next = templates[(index + step + templates.length) % templates.length];
                  pick(next);
                  const group = event.currentTarget.parentElement;
                  queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-template="${next.id}"]`)?.focus());
                }}
              >
                <span className="studio-template-icon" aria-hidden="true">
                  ▣
                </span>
                <strong>{localized(item.title, locale, item.id)}</strong>
                <small>
                  {zh ? `${item.aspects.map((a) => aspectLabel(a, locale)).join("、")}・分鏡 ${item.prices?.draft ?? 2} 點` : `${item.aspects.join(", ")} · storyboard ${item.prices?.draft ?? 2} credits`}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
      {template && (
        <form className="studio-new-form" onSubmit={(event) => void submit(event)} noValidate>
          <section className="studio-step" aria-labelledby="studio-step-inputs">
            <h2 id="studio-step-inputs">
              <span className="studio-step-number">2</span>
              {zh ? "影片內容" : "What the video is about"}
            </h2>
            <div className="portal-panel studio-form-panel">
              <p className="portal-muted studio-form-intro">
                {zh ? "主題、商品網址、商品圖片至少填一項；填得越具體，分鏡越貼近你的商品。" : "Fill in at least one of topic, product URL or images. The more specific, the closer the storyboard."}
              </p>
              <div className="studio-form-grid">
                {fields.map(([name, schema]) => (
                  <div key={name} className={schema.maxLength && schema.maxLength > 200 && schema.format !== "uri" ? "studio-span" : schema["x-upload-purpose"] || schema.items?.["x-upload-purpose"] ? "studio-span" : undefined}>
                    <SchemaField
                      name={name}
                      schema={schema}
                      value={values[name]}
                      onChange={(value) => update(name, value)}
                      isAdmin={user.role === "admin"}
                      disabled={submitting}
                      error={errors[name]}
                      onBusy={(busy) => setBusy(name, busy)}
                    />
                  </div>
                ))}
              </div>
              {errors._form && (
                <p className="portal-error" role="alert">
                  {errors._form}
                </p>
              )}
            </div>
          </section>
          <section className="studio-step" aria-labelledby="studio-step-aspect">
            <h2 id="studio-step-aspect">
              <span className="studio-step-number">3</span>
              {zh ? "主要比例" : "Primary aspect"}
            </h2>
            <div className="studio-aspects" role="radiogroup" aria-labelledby="studio-step-aspect">
              {template.aspects.map((item) => (
                <label key={item} className="studio-aspect" data-checked={item === aspect}>
                  <input type="radio" name="aspect" value={item} checked={item === aspect} onChange={() => setAspect(item)} />
                  <span className={`studio-aspect-frame studio-aspect-${item.replace(":", "x")}`} aria-hidden="true" />
                  <strong>{aspectLabel(item, locale)}</strong>
                  <small>
                    {item === "9:16"
                      ? zh
                        ? "Reels、TikTok、Shorts"
                        : "Reels, TikTok, Shorts"
                      : zh
                        ? "YouTube、網站、簡報"
                        : "YouTube, websites, slides"}
                  </small>
                </label>
              ))}
            </div>
            <p className="portal-hint">
              {zh
                ? "產生與匯出都以主要比例為準。之後要加做另一種比例，需要另外扣點（每個圖片鏡頭重新出圖）。"
                : "Generation and export use the primary aspect. Adding the other aspect later costs extra credits (each still is drawn again)."}
            </p>
          </section>
          <div className="studio-submit">
            {submitError !== null && (
              <p className="portal-error" role="alert">
                {submitError instanceof PortalError && submitError.code === "studio_not_found" && reupload
                  ? zh
                    ? "上傳的商品圖片已無法使用。"
                    : "The uploaded product images can no longer be used."
                  : studioErrorText(submitError, locale)}
                {reupload &&
                  (zh
                    ? " 這次建立沒有完成，已上傳的圖片綁定在那次嘗試上，請重新上傳商品圖片後再送出。"
                    : " This attempt did not finish and the uploaded images stay tied to it. Upload the product images again, then retry.")}
                {insufficient && (
                  <>
                    {" "}
                    <Link href="/studio/credits">{zh ? "查看點數" : "See credits"}</Link>
                  </>
                )}
              </p>
            )}
            {short && (
              <p className="portal-note" role="status">
                {zh ? `可用點數不足 ${price} 點。` : `You need ${price} credits.`} <Link href="/studio/credits">{zh ? "查看點數" : "See credits"}</Link>
              </p>
            )}
            <button className="portal-button studio-primary" type="submit" disabled={submitting || uploading || short}>
              {submitting
                ? zh
                  ? "建立中…"
                  : "Creating…"
                : uploading
                  ? zh
                    ? "等待圖片上傳…"
                    : "Waiting for uploads…"
                  : zh
                    ? `產生分鏡（${price} 點）`
                    : `Write storyboard (${price} credits)`}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
