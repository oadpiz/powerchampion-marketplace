"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  acceptFor,
  enumOptions,
  fieldLabel,
  narrationFit,
  RIGHTS_PURPOSES,
  schemaTypes,
  studioErrorText,
  uploadFile,
  UploadError,
  type JsonSchema,
  type UploadPurpose,
} from "../lib/studio-client";
import { useLocale } from "./locale-provider";

type FieldProps = {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  isAdmin?: boolean;
  disabled?: boolean;
  error?: string;
  /** For upload fields: the project the file belongs to (none for creation-time product images). */
  projectId?: string;
  onBusy?: (busy: boolean) => void;
  /** For seconds fields with x-fixed-for-kind, and the narration meter. */
  context?: { kind?: string; seconds?: number; previews?: Record<string, string> };
};

/** One form control rendered from a JSON-schema property (spec 7: the shell hard-codes no template fields). */
export function SchemaField(props: FieldProps) {
  const { name, schema, value, onChange, isAdmin = false, disabled, error, context } = props;
  const { locale } = useLocale();
  const zh = locale === "zh";
  const id = useId();
  const label = fieldLabel(name, schema, locale);
  const types = schemaTypes(schema);
  const purpose = schema["x-upload-purpose"] ?? (types.includes("array") ? schema.items?.["x-upload-purpose"] : undefined);
  const describedBy = error ? `${id}-error` : undefined;
  const errorNode = error ? (
    <span className="studio-field-error" id={`${id}-error`}>
      {error}
    </span>
  ) : null;

  if (purpose) return <UploadField {...props} purpose={purpose} label={label} multiple={types.includes("array")} />;

  if (types.includes("boolean")) {
    return (
      <label className="studio-check">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }

  if (schema.enum) {
    const options = enumOptions(name, schema, locale, isAdmin);
    const current = typeof value === "string" ? value : "";
    const known = options.some((option) => option.value === current);
    return (
      <div className="portal-field studio-field">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={current} disabled={disabled} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)}>
          {!known && <option value={current}>{current ? (zh ? "（目前設定）" : "(current)") : zh ? "請選擇" : "Choose"}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {errorNode}
      </div>
    );
  }

  if (types.includes("integer") || types.includes("number")) {
    const fixed = context?.kind ? schema["x-fixed-for-kind"]?.[context.kind] : undefined;
    const shown = fixed ?? (typeof value === "number" ? value : "");
    return (
      <div className="portal-field studio-field">
        <label htmlFor={id}>
          {label}
          {schema.minimum !== undefined && schema.maximum !== undefined && (
            <small className="studio-field-range">
              {schema.minimum}–{schema.maximum}
            </small>
          )}
        </label>
        <input
          id={id}
          type="number"
          inputMode={types.includes("integer") ? "numeric" : "decimal"}
          min={schema.minimum}
          max={schema.maximum}
          step={types.includes("integer") ? 1 : 0.5}
          value={shown}
          disabled={disabled || fixed !== undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
        {fixed !== undefined && (
          <span className="studio-field-hint">{zh ? `動態鏡頭固定 ${fixed} 秒` : `Motion shots are fixed at ${fixed} s`}</span>
        )}
        {errorNode}
      </div>
    );
  }

  const text = typeof value === "string" ? value : "";
  const long = (schema.maxLength ?? 0) > 200 && schema.format !== "uri";
  const rate = schema["x-chars-per-second"];
  const fit = rate && context?.seconds ? narrationFit(text, rate, context.seconds) : null;
  return (
    <div className="portal-field studio-field">
      <label htmlFor={id}>{label}</label>
      {long ? (
        <textarea
          id={id}
          value={text}
          maxLength={schema.maxLength}
          disabled={disabled}
          rows={name === "narration" ? 3 : 4}
          aria-describedby={[describedBy, fit ? `${id}-meter` : undefined].filter(Boolean).join(" ") || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          type={schema.format === "uri" ? "url" : "text"}
          inputMode={schema.format === "uri" ? "url" : undefined}
          placeholder={schema.format === "uri" ? "https://" : undefined}
          value={text}
          maxLength={schema.maxLength}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {fit && context?.seconds && (
        <span className={`studio-meter studio-meter-${fit.state}`} id={`${id}-meter`} data-testid="narration-meter">
          <span className="studio-meter-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round(fit.ratio * 100))}%` }} />
          </span>
          <span>
            {zh
              ? `${fit.characters} 字，約 ${fit.needed.toFixed(1)} 秒／鏡頭 ${context.seconds} 秒`
              : `${fit.characters} characters ≈ ${fit.needed.toFixed(1)} s of ${context.seconds} s`}
            {fit.state === "over" && (zh ? "：太長，旁白會被加速或截斷" : ": too long, it will be rushed")}
            {fit.state === "short" && (zh ? "：偏短" : ": on the short side")}
          </span>
        </span>
      )}
      {schema.maxLength !== undefined && !fit && long && (
        <span className="studio-field-hint">
          {text.length}/{schema.maxLength}
        </span>
      )}
      {errorNode}
    </div>
  );
}

type UploadProps = FieldProps & { purpose: UploadPurpose; label: string; multiple: boolean };

/** Uploads through a one-time put_url; the field value is the upload id (or a list of ids). */
function UploadField({ name, schema, value, onChange, disabled, error, projectId, onBusy, purpose, label, multiple, context }: UploadProps) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const input = useRef<HTMLInputElement>(null);
  const [local, setPreviews] = useState<Record<string, string>>({});
  // Saved uploads show the server's signed thumbnail; files picked here show a local object URL.
  const previews = { ...(context?.previews ?? {}), ...local };
  const [pending, setPending] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const ids = multiple ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === "string" ? [value] : [];
  const max = multiple ? (schema.maxItems ?? 5) : 1;
  const image = purpose !== "music";
  // Product photos: the rights checkbox comes first; the file picker stays disabled until it is ticked.
  const needsRights = RIGHTS_PURPOSES.includes(purpose);
  const [rights, setRights] = useState(false);
  const blocked = needsRights && !rights;

  const busy = pending > 0;
  useEffect(() => onBusy?.(busy), [busy, onBusy]);
  useEffect(
    () => () => {
      for (const url of Object.values(local)) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    // Object URLs are released when the field unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function choose(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    if (blocked) {
      setUploadError(studioErrorText(new UploadError("rights", "rights not confirmed"), locale));
      if (input.current) input.current.value = "";
      return;
    }
    const room = multiple ? max - ids.length : 1;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    if (chosen.length < files.length)
      setUploadError(zh ? `最多 ${max} 個檔案，多的沒有上傳。` : `Up to ${max} files; the rest were not uploaded.`);
    let next = multiple ? [...ids] : [];
    setPending((count) => count + chosen.length);
    for (const file of chosen) {
      try {
        const uploadId = await uploadFile(file, purpose, projectId, undefined, { rightsConfirmed: needsRights && rights });
        if (image && typeof URL.createObjectURL === "function") {
          const url = URL.createObjectURL(file);
          setPreviews((current) => ({ ...current, [uploadId]: url }));
        } else {
          setPreviews((current) => ({ ...current, [uploadId]: file.name }));
        }
        next = multiple ? [...next, uploadId] : [uploadId];
        onChange(multiple ? next : uploadId);
      } catch (cause) {
        setUploadError(studioErrorText(cause, locale));
      } finally {
        setPending((count) => count - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  function remove(id: string) {
    onChange(multiple ? ids.filter((item) => item !== id) : null);
  }

  const inputId = `${name}-upload`;
  return (
    <div className="studio-upload" role="group" aria-labelledby={`${inputId}-label`}>
      <span className="studio-upload-label" id={`${inputId}-label`}>
        {label}
        {multiple && <small>{zh ? `（最多 ${max} 張）` : ` (up to ${max})`}</small>}
      </span>
      <div className="studio-upload-row">
        {ids.map((id, position) => (
          <div className="studio-upload-item" key={id}>
            {image && previews[id] ? (
              // A local object URL, or the studio media host's signed thumbnail.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previews[id]} alt={zh ? `已上傳的圖片 ${position + 1}` : `Uploaded image ${position + 1}`} />
            ) : (
              <span className="studio-upload-chip">{previews[id] ?? (image ? (zh ? "已上傳圖片" : "Uploaded image") : zh ? "已上傳音樂" : "Uploaded music")}</span>
            )}
            <button
              type="button"
              className="studio-upload-remove"
              disabled={disabled}
              aria-label={zh ? `移除 ${previews[id] && !image ? previews[id] : `第 ${position + 1} 個檔案`}` : `Remove file ${position + 1}`}
              onClick={() => remove(id)}
            >
              ×
            </button>
          </div>
        ))}
        {ids.length < max && (
          <label className="studio-upload-drop" htmlFor={inputId} aria-disabled={disabled || pending > 0 || blocked}>
            {pending > 0 ? (zh ? "上傳中…" : "Uploading…") : image ? (zh ? "選擇圖片" : "Choose image") : zh ? "選擇音樂檔" : "Choose music"}
            <input
              ref={input}
              id={inputId}
              className="sr-only"
              type="file"
              accept={acceptFor(purpose)}
              multiple={multiple}
              disabled={disabled || pending > 0 || blocked}
              onChange={(event) => void choose(event.target.files)}
            />
          </label>
        )}
      </div>
      {needsRights && (
        <label className="studio-upload-rights">
          <input type="checkbox" checked={rights} disabled={disabled} onChange={(event) => setRights(event.target.checked)} />
          <span>
            {zh
              ? "我擁有或已取得這張商品照片的使用權，並同意用於產生影片。"
              : "I own or have obtained the rights to use this product photo, and agree to its use to generate videos."}
          </span>
        </label>
      )}
      <span className="studio-field-hint">
        {image ? (zh ? "PNG、JPEG 或 WebP，每張 10 MB 以內。" : "PNG, JPEG or WebP, up to 10 MB each.") : zh ? "MP3、M4A 或 WAV，20 MB 以內。" : "MP3, M4A or WAV, up to 20 MB."}
      </span>
      {(uploadError || error) && (
        <span className="studio-field-error" role="alert">
          {uploadError ?? error}
        </span>
      )}
    </div>
  );
}
