"use client";

import { useState } from "react";
import { PortalError } from "../lib/portal-client";
import {
  studioApi,
  studioErrorText,
  type JsonSchema,
  type SelfCheck,
  type StudioProject,
  type StudioShot,
} from "../lib/studio-client";
import { useLocale } from "./locale-provider";
import { SchemaField } from "./studio-fields";

function changed(draft: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(value ?? null) !== JSON.stringify(base[key] ?? null)) out[key] = value;
  }
  return out;
}

/** Self-check flags from the render-time VLM check: a warning, never a block (spec 8). */
export function SelfCheckNote({ check }: { check: SelfCheck | null | undefined }) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  if (!check || check.verdict !== "review") return null;
  const flags = [
    check.garbled_text && (zh ? "畫面裡可能有亂碼文字" : "The picture may contain garbled text"),
    check.deformity && (zh ? "人物或物品可能變形" : "People or objects may look deformed"),
    check.logo_or_trademark && (zh ? "可能出現商標或品牌標誌" : "A logo or trademark may be visible"),
  ].filter((flag): flag is string => typeof flag === "string");
  return (
    <div className="studio-selfcheck" role="note">
      <p>
        <span aria-hidden="true">⚠</span> {zh ? "AI 自我檢查建議你看一下這一鏡" : "The AI self-check suggests reviewing this shot"}
        {check.validated === false && <span className="studio-tag">{zh ? "未驗證" : "Unverified"}</span>}
      </p>
      {flags.length > 0 && (
        <ul>
          {flags.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}
      {check.notes && <p className="studio-selfcheck-notes">{check.notes}</p>}
      <p className="studio-field-hint">
        {zh ? "這只是提醒，不影響匯出。不滿意可以修改描述或重新產生。" : "This is only a hint and does not block export. Edit the prompt or regenerate if needed."}
      </p>
    </div>
  );
}

/** The shot inspector, rendered from the template's shot_schema. Edits are free; they mark the shot for regeneration. */
export function ShotInspector({
  project,
  shot,
  schema,
  isAdmin,
  locked,
  onSaved,
  onRegenerate,
}: {
  project: StudioProject;
  shot: StudioShot;
  schema: JsonSchema;
  isAdmin: boolean;
  locked: boolean;
  onSaved: (doc: StudioProject) => void;
  onRegenerate: (dirty: boolean) => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const fields = Object.entries(schema.properties ?? {});
  const base: Record<string, unknown> = Object.fromEntries(fields.map(([name]) => [name, shot[name] ?? null]));
  const [draft, setDraft] = useState<Record<string, unknown>>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const diff = changed(draft, base);
  const dirty = Object.keys(diff).length > 0;
  const kind = typeof draft.kind === "string" ? draft.kind : shot.kind;
  const fixed = schema.properties?.seconds?.["x-fixed-for-kind"]?.[kind];
  const seconds = fixed ?? (typeof draft.seconds === "number" ? draft.seconds : shot.seconds);

  function set(name: string, value: unknown) {
    setSaved(false);
    setDraft((current) => {
      const next = { ...current, [name]: value };
      if (name === "kind" && typeof value === "string") {
        const fixedSeconds = schema.properties?.seconds?.["x-fixed-for-kind"]?.[value];
        if (fixedSeconds !== undefined) next.seconds = fixedSeconds;
      }
      return next;
    });
  }

  async function save() {
    if (!dirty || saving) return;
    const body = { ...diff };
    if (fixed !== undefined && "seconds" in body) delete body.seconds;
    setSaving(true);
    setError(null);
    try {
      const doc = await studioApi.editShot(project.id, shot.index, body);
      setSaved(true);
      onSaved(doc);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="studio-inspector-body">
      <div className="studio-inspector-head">
        <h2>{zh ? `第 ${shot.index} 鏡` : `Shot ${shot.index}`}</h2>
        {shot.stale && <span className="studio-badge studio-badge-stale">{zh ? "需重新產生" : "Needs generating"}</span>}
      </div>
      <SelfCheckNote check={shot.selfcheck} />
      {fields.map(([name, field]) => (
        <SchemaField
          key={name}
          name={name}
          schema={field}
          value={draft[name]}
          onChange={(value) => set(name, value)}
          isAdmin={isAdmin}
          disabled={locked || saving}
          projectId={project.id}
          onBusy={setUploading}
          context={{
            kind,
            seconds,
            previews: typeof shot.image_upload_id === "string" && shot.thumb_url ? { [shot.image_upload_id]: shot.thumb_url } : undefined,
          }}
        />
      ))}
      {typeof draft.image_upload_id === "string" && (
        <button type="button" className="portal-text-button" disabled={locked || saving} onClick={() => set("image_upload_id", null)}>
          {zh ? "改回 AI 產生畫面" : "Use an AI picture again"}
        </button>
      )}
      {error !== null && (
        <p className="portal-error" role="alert">
          {studioErrorText(error, locale)}
        </p>
      )}
      {saved && !dirty && (
        <p className="studio-saved" role="status">
          {zh ? "已儲存。按「重新產生」或「產生全部」更新畫面。" : "Saved. Regenerate or generate all to update the picture."}
        </p>
      )}
      <div className="studio-inspector-actions">
        <button type="button" className="portal-button-secondary" disabled={!dirty || saving || locked || uploading} onClick={() => void save()}>
          {saving ? (zh ? "儲存中…" : "Saving…") : zh ? "儲存變更（免費）" : "Save changes (free)"}
        </button>
        <button
          type="button"
          className="portal-button"
          disabled={locked || saving || uploading}
          title={dirty ? (zh ? "請先儲存變更" : "Save your changes first") : undefined}
          onClick={() => onRegenerate(dirty)}
        >
          {zh ? "重新產生這一鏡" : "Regenerate this shot"}
        </button>
      </div>
      {dirty && <p className="studio-field-hint">{zh ? "有尚未儲存的變更。" : "You have unsaved changes."}</p>}
    </div>
  );
}

/** Project settings rendered from project_schema (voice, subtitles, music with a rights checkbox). */
export function ProjectSettings({
  project,
  schema,
  isAdmin,
  locked,
  onSaved,
}: {
  project: StudioProject;
  schema: JsonSchema;
  isAdmin: boolean;
  locked: boolean;
  onSaved: (doc: StudioProject) => void;
}) {
  const { locale } = useLocale();
  const zh = locale === "zh";
  const fields = Object.entries(schema.properties ?? {});
  const base: Record<string, unknown> = Object.fromEntries(
    fields.map(([name]) => [name, name === "title" ? (project.title ?? "") : (project.settings?.[name] ?? schema.properties?.[name]?.default ?? null)]),
  );
  const [draft, setDraft] = useState<Record<string, unknown>>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [check, setCheck] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const diff = changed(draft, base);
  const dirty = Object.keys(diff).length > 0;

  async function save() {
    if (!dirty || saving) return;
    if (typeof draft.music_upload_id === "string" && draft.music_rights_confirmed !== true && "music_rights_confirmed" in (schema.properties ?? {})) {
      setCheck(zh ? "使用背景音樂前，請勾選確認你擁有這首音樂的使用權。" : "Confirm you have the rights to the music before using it.");
      return;
    }
    if ("title" in diff && typeof diff.title === "string" && diff.title.trim() === "") {
      setCheck(zh ? "影片名稱不能空白。" : "The title cannot be empty.");
      return;
    }
    setCheck(null);
    setSaving(true);
    setError(null);
    try {
      const doc = await studioApi.settings(project.id, diff);
      setSaved(true);
      onSaved(doc);
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="studio-inspector-body">
      <div className="studio-inspector-head">
        <h2>{zh ? "專案設定" : "Project settings"}</h2>
      </div>
      {fields.map(([name, field]) => (
        <SchemaField
          key={name}
          name={name}
          schema={field}
          value={draft[name]}
          isAdmin={isAdmin}
          disabled={locked || saving}
          projectId={project.id}
          onBusy={setUploading}
          onChange={(value) => {
            setSaved(false);
            setCheck(null);
            setDraft((current) => ({ ...current, [name]: value }));
          }}
        />
      ))}
      <p className="studio-field-hint">
        {zh
          ? "改配音、字幕或音樂不另扣點；改配音會讓旁白需要重新產生。"
          : "Settings are free to change; a new voice means the narration has to be generated again."}
      </p>
      {check && (
        <p className="portal-error" role="alert">
          {check}
        </p>
      )}
      {error !== null && (
        <p className="portal-error" role="alert">
          {error instanceof PortalError && error.code === "studio_invalid_input"
            ? zh
              ? "設定內容不符合要求，請檢查後再試。"
              : "Check the settings and try again."
            : studioErrorText(error, locale)}
        </p>
      )}
      {saved && !dirty && (
        <p className="studio-saved" role="status">
          {zh ? "設定已儲存。" : "Settings saved."}
        </p>
      )}
      <div className="studio-inspector-actions">
        <button type="button" className="portal-button" disabled={!dirty || saving || locked || uploading} onClick={() => void save()}>
          {saving ? (zh ? "儲存中…" : "Saving…") : zh ? "儲存設定" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
