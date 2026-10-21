"use client";

import { useState } from "react";
import { PortalError, portalErrorText, portalRequest } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { RevisionEditor, TryPanel, type PersonaExample, type PersonaRevisionSummary } from "./admin-persona-editor";
import { GatewayNotConnected, ResourceState, dateLabel, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type PersonaSummary = {
  persona_id: string;
  name?: string;
  created_at?: number | string | null;
  active_rev?: number | null;
  latest_rev?: number | null;
};
type PersonaList = { gatewayConfigured: boolean; personas: PersonaSummary[] };
/** A persona with no revisions has no rev/system/note/author/examples: every field is optional. */
type PersonaDetail = {
  persona: {
    persona_id: string;
    name?: string;
    created_at?: number | string | null;
    active_rev?: number | null;
    rev?: number;
    system?: string;
    note?: string;
    author?: string;
    rev_created_at?: number | string | null;
    examples?: PersonaExample[];
  };
  revisions: PersonaRevisionSummary[];
};

const timeValue = (value: number | string | null | undefined) => (value === undefined ? null : value);

function CreatePersonaDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit() {
    if (busy) return;
    if (!name.trim() || name.trim().length > 80) {
      setMessage(zh ? "請輸入 1–80 字的名稱。" : "Enter a name of 1 to 80 characters.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const created = await portalRequest<{ persona_id: string }>("/admin/personas", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      onCreated(created.persona_id);
    } catch (reason: unknown) {
      setMessage(portalErrorText(reason, locale));
      setBusy(false);
    }
  }
  return (
    <AdminDialog
      title={zh ? "新增人設" : "New persona"}
      confirmLabel={zh ? "建立" : "Create"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      <label className="portal-field">
        {zh ? "名稱" : "Name"}
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
      </label>
      {message !== null && (
        <p className="portal-error" role="alert">{message}</p>
      )}
    </AdminDialog>
  );
}

function PersonaView({ personaId, onGone, onChanged }: { personaId: string; onGone: () => void; onChanged: () => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [rev, setRev] = useState<number | null>(null);
  const path = `/admin/personas/${encodeURIComponent(personaId)}${rev === null ? "" : `?rev=${rev}`}`;
  const resource = usePortalResource<PersonaDetail>(path);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (resource.error instanceof PortalError && resource.error.code === "persona_not_found") {
    return (
      <section className="portal-panel">
        <p className="portal-error" role="alert">{portalErrorText(resource.error, locale)}</p>
        <button type="button" className="portal-button-secondary" onClick={onGone}>
          {zh ? "回到清單" : "Back to the list"}
        </button>
      </section>
    );
  }

  async function activate(target: number) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await portalRequest(`/admin/personas/${encodeURIComponent(personaId)}/activate`, { method: "POST", body: JSON.stringify({ rev: target }) });
      setConfirm(null);
      resource.refresh();
      onChanged();
    } catch (reason: unknown) {
      setConfirm(null);
      if (reason instanceof PortalError && reason.code === "persona_not_found") onGone();
      else setMessage(portalErrorText(reason, locale));
    } finally {
      setBusy(false);
    }
  }

  const detail = resource.data;
  const persona = detail?.persona;
  const revisions = detail?.revisions ?? [];
  const activeRev = persona?.active_rev ?? null;
  return (
    <ResourceState {...resource}>
      {detail && persona && (
        <>
          <section className="portal-panel">
            <h2>{persona.name ?? persona.persona_id}</h2>
            {message !== null && (
              <p className="portal-error" role="alert">{message}</p>
            )}
            {persona.rev === undefined ? (
              <p className="portal-note">{zh ? "尚無版本，請建立第一個版本。" : "No revisions yet. Create the first revision."}</p>
            ) : (
              <>
                <p>
                  {zh ? `正在檢視版本 ${persona.rev}` : `Viewing revision ${persona.rev}`}
                  {persona.rev === activeRev ? (zh ? "（使用中）" : " (active)") : ""}
                  {persona.note ? ` · ${persona.note}` : ""}
                  {persona.author ? ` · ${persona.author}` : ""}
                  {` · ${dateLabel(timeValue(persona.rev_created_at), zh)}`}
                </p>
                <h3>{zh ? "系統提示" : "System prompt"}</h3>
                <pre style={{ whiteSpace: "pre-wrap" }}>{persona.system ?? ""}</pre>
                {(persona.examples ?? []).length > 0 && (
                  <div className="portal-table-wrap">
                    <table className="portal-table">
                      <caption className="sr-only">{zh ? "範例對話" : "Examples"}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{zh ? "使用者" : "User"}</th>
                          <th scope="col">{zh ? "助理" : "Assistant"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(persona.examples ?? []).map((pair, index) => (
                          <tr key={index}>
                            <td>{pair.user}</td>
                            <td>{pair.assistant}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            {revisions.length > 0 && (
              <div className="portal-table-wrap">
                <table className="portal-table">
                  <caption className="sr-only">{zh ? "版本" : "Revisions"}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{zh ? "版本" : "Revision"}</th>
                      <th scope="col">{zh ? "備註" : "Note"}</th>
                      <th scope="col">{zh ? "作者" : "Author"}</th>
                      <th scope="col">{zh ? "時間" : "Created"}</th>
                      <th scope="col">{zh ? "系統提示長度" : "System length"}</th>
                      <th scope="col">{zh ? "範例數" : "Examples"}</th>
                      <th scope="col">{zh ? "動作" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisions.map((item) => (
                      <tr key={item.rev}>
                        <td>{item.rev}</td>
                        <td>{item.note || "—"}</td>
                        <td>{item.author || "—"}</td>
                        <td>{dateLabel(timeValue(item.created_at), zh)}</td>
                        <td>{item.system_len ?? "—"}</td>
                        <td>{item.example_count ?? "—"}</td>
                        <td>
                          <button type="button" className="portal-text-button" aria-label={zh ? `檢視版本 ${item.rev}` : `View revision ${item.rev}`} onClick={() => setRev(item.rev)}>
                            {zh ? "檢視" : "View"}
                          </button>{" "}
                          {item.rev === activeRev ? (
                            <span>{zh ? "使用中" : "Active"}</span>
                          ) : (
                            <button type="button" className="portal-text-button" aria-label={zh ? `啟用版本 ${item.rev}` : `Activate revision ${item.rev}`} disabled={busy} onClick={() => setConfirm(item.rev)}>
                              {zh ? "啟用" : "Activate"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <RevisionEditor
            key={`${personaId}:${persona.rev ?? 0}`}
            personaId={personaId}
            initialSystem={persona.system ?? ""}
            initialExamples={(persona.examples ?? []).map((pair) => ({ user: pair.user ?? "", assistant: pair.assistant ?? "" }))}
            onSaved={(saved) => {
              if (saved === rev) resource.refresh();
              else setRev(saved);
              onChanged();
            }}
          />
          <TryPanel key={`try:${personaId}:${revisions.length}:${activeRev ?? 0}`} personaId={personaId} revisions={revisions} hasActive={activeRev !== null} />
          {confirm !== null && (
            <AdminDialog
              title={zh ? `啟用版本 ${confirm}？` : `Activate revision ${confirm}?`}
              confirmLabel={zh ? "啟用" : "Activate"}
              cancelLabel={zh ? "取消" : "Cancel"}
              onConfirm={() => activate(confirm)}
              onClose={() => setConfirm(null)}
              inFlight={busy}
            >
              <p>
                {zh
                  ? `啟用版本 ${confirm} 後，使用這個人設的請求立即改用此版本。`
                  : `Requests that use this persona switch to revision ${confirm} immediately.`}
              </p>
            </AdminDialog>
          )}
        </>
      )}
    </ResourceState>
  );
}

export function AdminPersonasSection() {
  const zh = useLocale().locale === "zh";
  const resource = usePortalResource<PersonaList>("/admin/personas");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const data = resource.data;
  return (
    <>
      <ResourceState {...resource}>
        {data && !data.gatewayConfigured ? (
          <GatewayNotConnected />
        ) : (
          data && (
            <section className="portal-panel">
              <div className="portal-actions">
                <button type="button" className="portal-button" onClick={() => setCreating(true)}>
                  {zh ? "新增人設" : "New persona"}
                </button>
                <button type="button" className="portal-button-secondary" onClick={resource.refresh}>
                  {zh ? "重新整理" : "Refresh"}
                </button>
              </div>
              {data.personas.length === 0 ? (
                <p className="portal-note">{zh ? "還沒有人設。" : "No personas yet."}</p>
              ) : (
                <div className="portal-table-wrap">
                  <table className="portal-table">
                    <caption className="sr-only">{zh ? "人設" : "Personas"}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{zh ? "名稱" : "Name"}</th>
                        <th scope="col">ID</th>
                        <th scope="col">{zh ? "使用中版本" : "Active revision"}</th>
                        <th scope="col">{zh ? "最新版本" : "Latest revision"}</th>
                        <th scope="col">{zh ? "建立時間" : "Created"}</th>
                        <th scope="col">{zh ? "動作" : "Actions"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.personas.map((persona) => (
                        <tr key={persona.persona_id} aria-current={selected === persona.persona_id ? "true" : undefined}>
                          <td>{persona.name ?? "—"}</td>
                          <td><code>{persona.persona_id}</code></td>
                          <td>{persona.active_rev ?? (zh ? "尚未啟用" : "Not active yet")}</td>
                          <td>{persona.latest_rev ?? "—"}</td>
                          <td>{dateLabel(timeValue(persona.created_at), zh)}</td>
                          <td>
                            <button type="button" className="portal-text-button" aria-label={zh ? `檢視 ${persona.name ?? persona.persona_id}` : `View ${persona.name ?? persona.persona_id}`} onClick={() => setSelected(persona.persona_id)}>
                              {zh ? "檢視" : "View"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )
        )}
      </ResourceState>
      {selected !== null && (
        <PersonaView
          key={selected}
          personaId={selected}
          onGone={() => {
            setSelected(null);
            resource.refresh();
          }}
          onChanged={resource.refresh}
        />
      )}
      {creating && (
        <CreatePersonaDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(id);
            resource.refresh();
          }}
        />
      )}
    </>
  );
}
