"use client";

import { useState } from "react";
import { portalErrorText, portalRequest, PortalError } from "../lib/portal-client";
import { AdminDialog } from "./admin-dialog";
import { ResourceState, dateLabel, usePortalResource } from "./admin-resource";
import { useLocale } from "./locale-provider";

type Role = "selling" | "engineer" | "reserved";
type AllocationNode = {
  name: string;
  ip: string;
  role: Role;
  engineerId: string | null;
  engineer: { id: string; username: string; displayName: string } | null;
  note: string;
  updatedAt: string | null;
  updatedBy: string | null;
};
type Engineer = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  sshPubkey: string | null;
  keyFingerprint: string | null;
  keyType: string | null;
  active: boolean;
  nodes: string[];
  createdAt: string | null;
  updatedAt: string | null;
};
export type AllocationState = {
  revision: number;
  ownerEmail: string | null;
  lastExport: { revision: number; at: string | null } | null;
  nodes: AllocationNode[];
  engineers: Engineer[];
  summary: {
    selling: number;
    engineer: number;
    reserved: number;
    perEngineer: { id: string; username: string; nodes: number }[];
  };
  warnings?: string[];
};
type ExportResult = {
  filename: string;
  yaml: string;
  revision: number;
  generatedAt: string;
  warnings: string[];
  excluded: { username: string; reason: string; nodes?: string[] }[];
  renderReady: boolean;
};
type NodeDraft = { role: Role; engineerId: string; note: string };
type EngineerDialog = { kind: "create" } | { kind: "edit"; engineer: Engineer };

/** From ~/github/b300-cluster/docs/engineer-access-runbook.md (sections 1, 4.2, 4.4, 4.5, 4.7). One command per block. */
export const SYNC_STEPS: { zh: string; en: string; command: string }[] = [
  { zh: "檢查匯出的檔案", en: "Validate the exported file", command: "python3 access/render.py check" },
  { zh: "確認分配表", en: "Review the assignment table", command: "python3 access/render.py summary" },
  { zh: "4.2 監控：本地檢查", en: "4.2 Monitoring: local check", command: "bash bin/b300-monitoring-update.sh check" },
  { zh: "4.2 監控：重產 Prometheus targets 並套用", en: "4.2 Monitoring: regenerate Prometheus targets and apply", command: "bash bin/b300-monitoring-update.sh apply" },
  { zh: "4.4 跳板機帳號（bastion99 有 sudo 時）", en: "4.4 Bastion accounts (when bastion99 has sudo)", command: "~/.venvs/ansible/bin/ansible-playbook -i ansible/inventory.ini ansible/engineer-access.yml --tags bastion -K" },
  { zh: "4.4 沒有 sudo：產生 TSV 交給 root（之後照 runbook 4.4 上傳與執行）", en: "4.4 Without sudo: render the TSV for root (then upload and run it per runbook 4.4)", command: "python3 access/render.py bastion-tsv --out out/bastion-engineers.tsv" },
  { zh: "4.5 節點帳號（b300-14、b300-31 不會被碰到）", en: "4.5 Node accounts (selling nodes are never touched)", command: "~/.venvs/ansible/bin/ansible-playbook -i ansible/inventory.ini ansible/engineer-access.yml --tags nodes -K" },
  { zh: "4.7 新工程師：產生他的 SSH 設定（id 換成對方的 username）", en: "4.7 New engineer: print their SSH config (replace the id with their username)", command: "python3 access/render.py ssh-config --engineer justin" },
];

function roleLabel(role: Role, zh: boolean): string {
  const labels: Record<Role, [string, string]> = {
    selling: ["Selling", "業務"],
    engineer: ["Engineer", "工程師"],
    reserved: ["Reserved", "保留"],
  };
  return labels[role][zh ? 1 : 0];
}

function ErrorLine({ message }: { message: string | null }) {
  return message === null ? null : (
    <p className="portal-error" role="alert">
      {message}
    </p>
  );
}

function errorText(reason: unknown, locale: "en" | "zh"): string {
  // The allocation API's 400/409 details are specific and actionable (which node, which rule).
  if (reason instanceof PortalError && [400, 404, 409].includes(reason.status) && reason.message)
    return reason.message;
  return portalErrorText(reason, locale);
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function EngineerFormDialog({
  dialog,
  onClose,
  onSaved,
}: {
  dialog: EngineerDialog;
  onClose: () => void;
  onSaved: (state: AllocationState) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const editing = dialog.kind === "edit" ? dialog.engineer : null;
  const [username, setUsername] = useState(editing?.username ?? "");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [email, setEmail] = useState(editing?.email ?? "");
  const [displayName, setDisplayName] = useState(editing?.displayName ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function changeEmail(value: string) {
    setEmail(value);
    // Usernames are the lowercase local part of the email unless the admin types one.
    if (!editing && !usernameTouched) setUsername(value.split("@")[0].toLowerCase());
  }

  async function submit() {
    if (!editing && !/^[a-z_][a-z0-9_-]{0,31}$/.test(username)) {
      setMessage(
        zh
          ? "帳號須為 1–32 個字元的小寫英文、數字、_ 或 -，並以英文字母或 _ 開頭。"
          : "Use 1–32 lowercase letters, digits, _ or -, starting with a letter or _.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    const body: Record<string, string> = { email: email.trim(), displayName: displayName.trim() };
    if (key.trim()) body.sshPubkey = key.trim();
    try {
      const state = editing
        ? await portalRequest<AllocationState>(`/admin/allocation/engineers/${encodeURIComponent(editing.id)}`, {
            method: "POST",
            body: JSON.stringify(body),
          })
        : await portalRequest<AllocationState>("/admin/allocation/engineers", {
            method: "POST",
            body: JSON.stringify({ ...body, username }),
          });
      onSaved(state);
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
      setBusy(false);
    }
  }

  return (
    <AdminDialog
      title={editing ? (zh ? `編輯工程師：${editing.username}` : `Edit engineer: ${editing.username}`) : zh ? "新增工程師" : "Add engineer"}
      confirmLabel={zh ? "儲存" : "Save"}
      cancelLabel={zh ? "取消" : "Cancel"}
      onConfirm={submit}
      onClose={onClose}
      inFlight={busy}
    >
      <label className="portal-field">
        Email
        <input type="email" maxLength={254} value={email} disabled={busy} onChange={(event) => changeEmail(event.target.value)} />
      </label>
      <label className="portal-field">
        {zh ? "帳號（Linux 使用者名稱，建立後不可改）" : "Username (Linux account, fixed once created)"}
        <input
          value={username}
          maxLength={32}
          readOnly={Boolean(editing)}
          disabled={busy || Boolean(editing)}
          onChange={(event) => {
            setUsernameTouched(true);
            setUsername(event.target.value);
          }}
        />
      </label>
      <label className="portal-field">
        {zh ? "顯示名稱（選填）" : "Display name (optional)"}
        <input maxLength={80} value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="portal-field">
        {editing?.keyFingerprint
          ? zh
            ? "SSH 公鑰（貼上新的一行即可替換；留空則保留目前的）"
            : "SSH public key (paste a new line to replace; leave empty to keep the current one)"
          : zh
            ? "SSH 公鑰（一行，例如 ssh-ed25519 AAAA… 名字；可稍後再補）"
            : "SSH public key (one line, e.g. ssh-ed25519 AAAA… name; can be added later)"}
        <textarea rows={3} value={key} disabled={busy} spellCheck={false} onChange={(event) => setKey(event.target.value)} />
      </label>
      {editing?.keyFingerprint && (
        <p className="portal-hint">
          {zh ? "目前指紋：" : "Current fingerprint: "}
          <code>{editing.keyFingerprint}</code>
        </p>
      )}
      <p className="portal-hint">
        {zh
          ? "接受 ssh-ed25519、ecdsa 或 3072 位元以上的 ssh-rsa；只貼公鑰（.pub），不要貼私鑰，也不要加 from= 等選項。"
          : "Accepts ssh-ed25519, ecdsa, or ssh-rsa of 3072 bits or more. Paste the public key (.pub) only, never the private key, and no options such as from=."}
      </p>
      <ErrorLine message={message} />
    </AdminDialog>
  );
}

function NodeRow({
  node,
  engineers,
  onSaved,
}: {
  node: AllocationNode;
  engineers: Engineer[];
  onSaved: (state: AllocationState) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [draft, setDraft] = useState<NodeDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = engineers.filter((engineer) => engineer.active);

  async function send(confirm: boolean) {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      const state = await portalRequest<AllocationState>(`/admin/allocation/nodes/${encodeURIComponent(node.name)}`, {
        method: "POST",
        body: JSON.stringify({
          role: draft.role,
          ...(draft.role === "engineer" && { engineerId: draft.engineerId }),
          note: draft.note,
          ...(confirm && { confirm_selling_change: true }),
        }),
      });
      setDraft(null);
      setConfirming(false);
      setBusy(false);
      onSaved(state);
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
      setConfirming(false);
      setBusy(false);
    }
  }

  function save() {
    if (!draft) return;
    if (draft.role === "engineer" && !draft.engineerId) {
      setMessage(zh ? "請選擇工程師。" : "Choose an engineer.");
      return;
    }
    if (node.role === "selling" && draft.role !== "selling") setConfirming(true);
    else void send(false);
  }

  if (!draft)
    return (
      <tr>
        <th scope="row">{node.name}</th>
        <td>
          <code>{node.ip}</code>
        </td>
        <td>
          <span className="portal-badge">{roleLabel(node.role, zh)}</span>
        </td>
        <td>{node.engineer ? node.engineer.username : "—"}</td>
        <td>{node.note || "—"}</td>
        <td>
          {dateLabel(node.updatedAt, zh)}
          {node.updatedBy && (
            <>
              <br />
              <small>{node.updatedBy}</small>
            </>
          )}
        </td>
        <td>
          <button
            type="button"
            className="portal-text-button"
            aria-label={zh ? `編輯 ${node.name}` : `Edit ${node.name}`}
            onClick={() => {
              setMessage(null);
              setDraft({ role: node.role, engineerId: node.engineerId ?? "", note: node.note });
            }}
          >
            {zh ? "編輯" : "Edit"}
          </button>
        </td>
      </tr>
    );

  return (
    <tr>
      <th scope="row">{node.name}</th>
      <td>
        <code>{node.ip}</code>
      </td>
      <td>
        <select
          aria-label={zh ? `${node.name} 角色` : `${node.name} role`}
          value={draft.role}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}
        >
          {(["selling", "engineer", "reserved"] as Role[]).map((role) => (
            <option key={role} value={role}>
              {roleLabel(role, zh)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          aria-label={zh ? `${node.name} 工程師` : `${node.name} engineer`}
          value={draft.role === "engineer" ? draft.engineerId : ""}
          disabled={busy || draft.role !== "engineer"}
          onChange={(event) => setDraft({ ...draft, engineerId: event.target.value })}
        >
          <option value="">{draft.role === "engineer" ? (zh ? "選擇工程師" : "Choose an engineer") : "—"}</option>
          {active.map((engineer) => (
            <option key={engineer.id} value={engineer.id}>
              {engineer.username}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          aria-label={zh ? `${node.name} 備註` : `${node.name} note`}
          maxLength={200}
          value={draft.note}
          disabled={busy}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
      </td>
      <td>{dateLabel(node.updatedAt, zh)}</td>
      <td>
        <div className="portal-actions">
          <button type="button" className="portal-button" disabled={busy} onClick={save}>
            {zh ? "儲存" : "Save"}
          </button>
          <button
            type="button"
            className="portal-button-secondary"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setMessage(null);
            }}
          >
            {zh ? "取消" : "Cancel"}
          </button>
        </div>
        <ErrorLine message={message} />
        {confirming && (
          <AdminDialog
            title={zh ? `將 ${node.name} 移出業務？` : `Move ${node.name} out of selling?`}
            confirmLabel={zh ? "確認移出業務" : "Move out of selling"}
            cancelLabel={zh ? "取消" : "Cancel"}
            onConfirm={() => void send(true)}
            onClose={() => setConfirming(false)}
            inFlight={busy}
            danger
          >
            <p>
              {zh
                ? `${node.name} 目前是對外銷售的節點，正在服務客戶。改成「${roleLabel(draft.role, zh)}」後，下次匯出並同步時它就不再受販售節點保護。請先確認該節點上的模型已移走。`
                : `${node.name} is a selling node serving customers. After it becomes "${roleLabel(draft.role, zh)}", the next export and sync no longer protect it as a selling node. Make sure its models have moved first.`}
            </p>
          </AdminDialog>
        )}
      </td>
    </tr>
  );
}

function ExportPanel({ state, onStateChange }: { state: AllocationState; onStateChange: (state: AllocationState) => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [owner, setOwner] = useState(state.ownerEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  async function saveOwner() {
    setBusy(true);
    setMessage(null);
    try {
      onStateChange(
        await portalRequest<AllocationState>("/admin/allocation/owner", {
          method: "POST",
          body: JSON.stringify({ ownerEmail: owner.trim() }),
        }),
      );
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
    }
    setBusy(false);
  }

  async function exportFile() {
    setBusy(true);
    setMessage(null);
    try {
      const exported = await portalRequest<ExportResult>("/admin/allocation/export");
      downloadText(exported.filename || "engineers.yaml", exported.yaml);
      setResult(exported);
      onStateChange(await portalRequest<AllocationState>("/admin/allocation"));
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
    }
    setBusy(false);
  }

  const unsynced = state.lastExport === null || state.lastExport.revision !== state.revision;
  return (
    <section className="portal-panel" aria-labelledby="allocation-export">
      <div className="portal-panel-heading">
        <h2 id="allocation-export">{zh ? "匯出與同步" : "Export and sync"}</h2>
        <button type="button" className="portal-button" disabled={busy} onClick={exportFile}>
          {zh ? "匯出 engineers.yaml" : "Export engineers.yaml"}
        </button>
      </div>
      <p>
        {zh ? "目前版本：" : "Current revision: "}
        <strong>{state.revision}</strong>
        {"　"}
        {state.lastExport
          ? zh
            ? `上次匯出：版本 ${state.lastExport.revision}（${dateLabel(state.lastExport.at, zh)}）`
            : `Last export: revision ${state.lastExport.revision} (${dateLabel(state.lastExport.at, zh)})`
          : zh
            ? "尚未匯出過"
            : "Never exported"}
      </p>
      {unsynced && (
        <p className="portal-note" role="status">
          {zh
            ? "目前的分配尚未匯出；機器上仍是上次同步的狀態。"
            : "The current assignment has not been exported; the machines still have the last synced state."}
        </p>
      )}
      <div className="portal-inline-form">
        <label className="portal-field">
          {zh ? "Owner email（Grafana Admin、Cloudflare Access）" : "Owner email (Grafana Admin, Cloudflare Access)"}
          <input type="email" value={owner} disabled={busy} onChange={(event) => setOwner(event.target.value)} />
        </label>
        <button type="button" className="portal-button-secondary" disabled={busy || !owner.trim()} onClick={saveOwner}>
          {zh ? "儲存 owner" : "Save owner"}
        </button>
      </div>
      <ErrorLine message={message} />
      {result && (
        <div role="status">
          <p>
            {zh
              ? `已下載 engineers.yaml（版本 ${result.revision}，${result.generatedAt}）。`
              : `Downloaded engineers.yaml (revision ${result.revision}, ${result.generatedAt}).`}
            {!result.renderReady &&
              (zh ? " 這個檔案還過不了 render.py check，請看下列提醒。" : " This file will not pass render.py check yet; see below.")}
          </p>
          {result.warnings.length > 0 && (
            <ul className="portal-note">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <h3>{zh ? "同步到機器" : "Sync to the machines"}</h3>
      <p className="portal-hint">
        {zh
          ? "在 Mac 上：先把 ~/github/b300-cluster/access/engineers.yaml 備份，再用下載的 engineers.yaml 覆蓋它。以下指令都在 ~/github/b300-cluster 目錄執行，一次貼一行（依 docs/engineer-access-runbook.md；換人或調整節點依序跑 4.2、4.4、4.5）。"
          : "On the Mac: back up ~/github/b300-cluster/access/engineers.yaml, then replace it with the downloaded engineers.yaml. Run these in ~/github/b300-cluster, one line at a time (per docs/engineer-access-runbook.md; after a change run 4.2, 4.4 and 4.5 in order)."}
      </p>
      <ol>
        {SYNC_STEPS.map((step) => (
          <li key={step.command}>
            {zh ? step.zh : step.en}
            <pre>
              <code>{step.command}</code>
            </pre>
          </li>
        ))}
      </ol>
      <p className="portal-hint">
        {zh
          ? "業務節點不會開個人帳號，playbook 也不會碰它們：要把工程師的節點改成業務，先改成「保留」並同步一次（4.5 會移除帳號），再改成業務。"
          : "Selling nodes never get personal accounts and the playbook never touches them: to turn an engineer's node into a selling node, set it to Reserved and sync once (4.5 removes the account), then make it Selling."}
      </p>
    </section>
  );
}

export function AdminAllocationSection() {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const resource = usePortalResource<AllocationState>("/admin/allocation");
  const [override, setOverride] = useState<AllocationState | null>(null);
  const [dialog, setDialog] = useState<EngineerDialog | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const state = override ?? resource.data;

  function applyState(next: AllocationState) {
    setOverride(next);
    setWarnings(next.warnings ?? []);
  }

  async function setActive(engineer: Engineer, active: boolean) {
    setBusyId(engineer.id);
    setMessage(null);
    try {
      applyState(
        await portalRequest<AllocationState>(`/admin/allocation/engineers/${encodeURIComponent(engineer.id)}/status`, {
          method: "POST",
          body: JSON.stringify({ active }),
        }),
      );
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
    }
    setBusyId(null);
  }

  return (
    <ResourceState {...resource}>
      {state && (
        <>
          <section className="portal-panel" aria-label={zh ? "分配摘要" : "Allocation summary"}>
            <div className="portal-actions">
              <span className="portal-badge">{zh ? `業務 ${state.summary.selling} 台` : `Selling: ${state.summary.selling}`}</span>
              <span className="portal-badge">{zh ? `工程師 ${state.summary.engineer} 台` : `Engineers: ${state.summary.engineer}`}</span>
              <span className="portal-badge">{zh ? `保留 ${state.summary.reserved} 台` : `Reserved: ${state.summary.reserved}`}</span>
            </div>
            <div className="portal-actions">
              {state.summary.perEngineer.map((item) => (
                <span key={item.id} className="portal-badge">
                  {zh ? `${item.username} ${item.nodes} 台` : `${item.username}: ${item.nodes}`}
                </span>
              ))}
            </div>
          </section>
          {warnings.length > 0 && (
            <ul className="portal-note" role="status">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <section className="portal-panel" aria-labelledby="allocation-nodes">
            <h2 id="allocation-nodes">{zh ? "節點" : "Nodes"}</h2>
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">{zh ? "GPU 節點分配" : "GPU node allocation"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "節點" : "Node"}</th>
                    <th scope="col">IP</th>
                    <th scope="col">{zh ? "角色" : "Role"}</th>
                    <th scope="col">{zh ? "工程師" : "Engineer"}</th>
                    <th scope="col">{zh ? "備註" : "Note"}</th>
                    <th scope="col">{zh ? "最後變更" : "Last change"}</th>
                    <th scope="col">{zh ? "操作" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.nodes.map((node) => (
                    <NodeRow key={`${node.name}:${state.revision}`} node={node} engineers={state.engineers} onSaved={applyState} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="portal-panel" aria-labelledby="allocation-engineers">
            <div className="portal-panel-heading">
              <h2 id="allocation-engineers">{zh ? "工程師" : "Engineers"}</h2>
              <button type="button" className="portal-button" onClick={() => setDialog({ kind: "create" })}>
                {zh ? "新增工程師" : "Add engineer"}
              </button>
            </div>
            <p className="portal-hint">
              {zh
                ? "還沒有 SSH 公鑰的工程師會列在這裡，但不會寫進匯出的 engineers.yaml（render.py 會拒絕沒有公鑰的帳號），他的節點在檔案裡會是未分配，直到貼上公鑰。停用的工程師會以 state: absent 匯出，下次同步時移除帳號。"
                : "Engineers without an SSH public key stay listed here but are left out of the exported engineers.yaml (render.py rejects accounts without a key); their nodes are unassigned in the file until a key is saved. Deactivated engineers are exported as state: absent so the next sync removes their accounts."}
            </p>
            <ErrorLine message={message} />
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">{zh ? "工程師" : "Engineers"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "帳號" : "Username"}</th>
                    <th scope="col">Email</th>
                    <th scope="col">{zh ? "顯示名稱" : "Display name"}</th>
                    <th scope="col">{zh ? "公鑰指紋" : "Key fingerprint"}</th>
                    <th scope="col">{zh ? "節點" : "Nodes"}</th>
                    <th scope="col">{zh ? "狀態" : "Status"}</th>
                    <th scope="col">{zh ? "操作" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.engineers.map((engineer) => (
                    <tr key={engineer.id}>
                      <th scope="row">{engineer.username}</th>
                      <td>{engineer.email}</td>
                      <td>{engineer.displayName}</td>
                      <td>
                        {engineer.keyFingerprint ? (
                          <>
                            <code>{engineer.keyFingerprint}</code>
                            <br />
                            <small>{engineer.keyType}</small>
                          </>
                        ) : (
                          <span className="portal-badge">{zh ? "尚未設定公鑰（不會匯出）" : "No key yet (not exported)"}</span>
                        )}
                      </td>
                      <td>{engineer.nodes.length ? engineer.nodes.join(", ") : "—"}</td>
                      <td>{engineer.active ? (zh ? "啟用" : "Active") : zh ? "已停用" : "Deactivated"}</td>
                      <td>
                        <div className="portal-actions">
                          <button
                            type="button"
                            className="portal-text-button"
                            aria-label={zh ? `編輯 ${engineer.username}` : `Edit ${engineer.username}`}
                            onClick={() => setDialog({ kind: "edit", engineer })}
                          >
                            {zh ? "編輯" : "Edit"}
                          </button>
                          <button
                            type="button"
                            className="portal-text-button"
                            disabled={busyId === engineer.id}
                            aria-label={
                              engineer.active
                                ? zh ? `停用 ${engineer.username}` : `Deactivate ${engineer.username}`
                                : zh ? `重新啟用 ${engineer.username}` : `Reactivate ${engineer.username}`
                            }
                            onClick={() => void setActive(engineer, !engineer.active)}
                          >
                            {engineer.active ? (zh ? "停用" : "Deactivate") : zh ? "重新啟用" : "Reactivate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <ExportPanel key={state.ownerEmail ?? ""} state={state} onStateChange={applyState} />
          {dialog && (
            <EngineerFormDialog
              dialog={dialog}
              onClose={() => setDialog(null)}
              onSaved={(next) => {
                setDialog(null);
                applyState(next);
              }}
            />
          )}
        </>
      )}
    </ResourceState>
  );
}
