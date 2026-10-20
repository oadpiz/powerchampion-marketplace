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
  pendingCleanup: { revision: number; engineer: string | null } | null;
};
type PendingCleanup = { node: string; revision: number; engineer: string | null };
type Engineer = {
  id: string;
  clusterId: string;
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
  /** The portal account an administrator created and linked; only it may set this key itself. */
  account?: { userId: string; email: string; disabled: boolean } | null;
  /** The key changed after the last recorded export, so the machines do not have it yet. */
  keyPendingSync?: boolean;
  keyUpdatedBy?: "admin" | "engineer" | null;
  keyUpdatedRevision?: number | null;
  /** The fingerprint the machines had at the last export (null: no key then). */
  keyPreviousFingerprint?: string | null;
};
type KeyChange = {
  username: string;
  fingerprint: string | null;
  previousFingerprint?: string | null;
  updatedBy: "admin" | "engineer" | null;
  revision: number;
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
  pendingCleanup: PendingCleanup[];
  warnings?: string[];
  sshPubkey?: string | null;
  /** Only in the response that created an engineer's portal account; shown once. */
  temporaryPassword?: string;
  account?: { userId: string; email: string };
};
type ExportResult = {
  filename: string;
  yaml: string;
  revision: number;
  generatedAt: string;
  warnings: string[];
  excluded: { username: string; reason: string; pendingCleanup?: string[] }[];
  renderReady: boolean;
  monitoringReady: boolean;
  missingKeys: string[];
  pendingCleanup: PendingCleanup[];
  keyChanges?: KeyChange[];
};
type NodeDraft = { role: Role; engineerId: string; note: string; synced: boolean };

/** Mirrors the server: exported text must not be able to carry an ansible/Jinja template. */
const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{N}_ .-]{0,63}$/u;
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const SYNC_CONFIRM_ZH = "我已依手冊 4.7 執行節點同步，且確認該節點已無工程師帳號";
const SYNC_CONFIRM_EN = "I ran the node sync (runbook 4.7) and confirmed no engineer account remains on this node";
const FINGERPRINT_CONFIRM_ZH = "已透過其他管道（電話／當面／公司通訊）向工程師確認新指紋";
const FINGERPRINT_CONFIRM_EN = "I confirmed each new fingerprint with the engineer through another channel (phone, in person, company chat)";
type EngineerDialog = { kind: "create" } | { kind: "edit"; engineer: Engineer };

/** From ~/github/b300-cluster/docs/engineer-access-runbook.md (2026-10-20: sections 1, 2, 4.2, 4.6, 4.7, 4.8). One command per block. */
export const SYNC_STEPS: { zh: string; en: string; command: string }[] = [
  { zh: "完整檢查（缺公鑰的工程師列為 pending 警告，不擋同步）", en: "Full check (engineers without a key are listed as pending warnings; they do not block the sync)", command: "python3 access/render.py check" },
  { zh: "第 2 節 Cloudflare Access 名單（email 有變時）", en: "Section 2 Cloudflare Access list (when emails change)", command: "python3 access/render.py access-emails" },
  { zh: "4.2 監控：本地檢查", en: "4.2 Monitoring: local check", command: "bash bin/b300-monitoring-update.sh check" },
  { zh: "4.2 監控：準備映像（b300-31 不能連外）", en: "4.2 Monitoring: stage images (b300-31 has no internet)", command: "bash bin/b300-monitoring-update.sh images" },
  { zh: "4.2 監控：重產 Prometheus targets 並套用", en: "4.2 Monitoring: regenerate Prometheus targets and apply", command: "bash bin/b300-monitoring-update.sh apply" },
  { zh: "4.6 跳板機帳號（缺公鑰的工程師略過；bastion99 有 sudo 時）", en: "4.6 Bastion accounts (engineers without a key are skipped; when bastion99 has sudo)", command: "~/.venvs/ansible/bin/ansible-playbook -i ansible/inventory.ini ansible/engineer-access.yml --tags bastion -K" },
  { zh: "4.6 沒有 sudo：產生 TSV 交給 root（之後照 runbook 4.6 上傳與執行）", en: "4.6 Without sudo: render the TSV for root (then upload and run it per runbook 4.6)", command: "python3 access/render.py bastion-tsv --out out/bastion-engineers.tsv" },
  { zh: "4.7 節點帳號（缺公鑰的工程師略過；b300-14、b300-31 不會被碰到）", en: "4.7 Node accounts (engineers without a key are skipped; selling nodes are never touched)", command: "~/.venvs/ansible/bin/ansible-playbook -i ansible/inventory.ini ansible/engineer-access.yml --tags nodes -K" },
  { zh: "4.8 交給工程師：他的 SSH 設定（eng1 換成對方的 cluster id）", en: "4.8 Hand-off: their SSH config (replace eng1 with their cluster id)", command: "python3 access/render.py ssh-config --engineer eng1" },
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
  revision,
  onClose,
  onSaved,
}: {
  dialog: EngineerDialog;
  revision: number;
  onClose: () => void;
  onSaved: (state: AllocationState, savedKey: string | null) => void;
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
    const normalisedEmail = email.trim().toLowerCase();
    if (!EMAIL.test(normalisedEmail)) {
      setMessage(zh ? "Email 只能包含英數字與 . _ % + -（例如 name@oadpiz.com）。" : "Use an email of letters, digits and . _ % + - only (for example name@oadpiz.com).");
      return;
    }
    if (displayName.trim() && !DISPLAY_NAME.test(displayName.trim())) {
      setMessage(
        zh
          ? "顯示名稱最多 64 字，以文字或數字開頭，只能用文字、數字、空白與 . - _（不可用 { } % # : , 引號或反斜線）。"
          : "Use at most 64 letters, digits, spaces, . - or _ for the display name, starting with a letter or digit (no { } % # : , quotes or backslash).",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    const body: Record<string, string | number> = { email: normalisedEmail, displayName: displayName.trim(), expected_revision: revision };
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
      const saved = key.trim()
        ? (state.sshPubkey ?? state.engineers.find((engineer) => engineer.username === (editing?.username ?? username))?.sshPubkey ?? null)
        : null;
      onSaved(state, saved);
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
        <small>
          {zh
            ? "帳號名稱不可與跳板機或節點上既有的非工程師帳號相同；同步腳本會拒絕接管既有帳號。"
            : "The username must not match an existing non-engineer account on the bastion or the nodes; the sync scripts refuse to take over an existing account."}
        </small>
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
          <br />
          {zh ? "目前儲存的公鑰（正規化後）：" : "Saved key (normalised): "}
          <code>{editing.sshPubkey}</code>
        </p>
      )}
      <p className="portal-hint">
        {zh
          ? "接受 ssh-ed25519、ecdsa 或 3072 位元以上的 ssh-rsa；只貼公鑰（.pub），不要貼私鑰，也不要加 from= 等選項。註解只保留英數字與 @ . _ + -，其他註解會被拿掉。"
          : "Accepts ssh-ed25519, ecdsa, or ssh-rsa of 3072 bits or more. Paste the public key (.pub) only, never the private key, and no options such as from=. A comment is kept only if it uses letters, digits and @ . _ + -; otherwise it is dropped."}
      </p>
      <ErrorLine message={message} />
    </AdminDialog>
  );
}

function NodeRow({
  node,
  engineers,
  revision,
  lastExportRevision,
  onSaved,
}: {
  node: AllocationNode;
  engineers: Engineer[];
  revision: number;
  lastExportRevision: number;
  onSaved: (state: AllocationState) => void;
}) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [draft, setDraft] = useState<NodeDraft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = engineers.filter((engineer) => engineer.active);
  const toSelling = draft !== null && draft.role === "selling" && node.role !== "selling";
  const engineerToSelling = toSelling && node.role === "engineer";
  const cleanup = toSelling && node.role === "reserved" ? node.pendingCleanup : null;
  const notExported = cleanup !== null && lastExportRevision < cleanup.revision;
  const blocked = engineerToSelling || notExported || (cleanup !== null && !draft?.synced);

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
          expected_revision: revision,
          ...(confirm && { confirm_selling_change: true }),
          ...(cleanup !== null && draft.synced && { confirm_node_synced: true }),
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
    if (!draft || blocked) return;
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
          {node.pendingCleanup && (
            <>
              <br />
              <span className="portal-badge">
                {zh
                  ? `待清理（原 ${node.pendingCleanup.engineer ?? "工程師"}）`
                  : `Pending cleanup (was ${node.pendingCleanup.engineer ?? "an engineer"})`}
              </span>
            </>
          )}
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
              setDraft({ role: node.role, engineerId: node.engineerId ?? "", note: node.note, synced: false });
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
          onChange={(event) => setDraft({ ...draft, role: event.target.value as Role, synced: false })}
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
        {engineerToSelling && (
          <p className="portal-note" role="status">
            {zh
              ? "請先改為保留並完成節點同步，再改為業務。"
              : "Set the node to Reserved and finish the node sync first, then make it Selling."}
          </p>
        )}
        {notExported && cleanup && (
          <p className="portal-note" role="status">
            {zh
              ? `${node.name} 離開 ${cleanup.engineer ?? "工程師"} 後還沒匯出：請先匯出 engineers.yaml（版本 ≥ ${cleanup.revision}）並執行節點同步（4.7）。`
              : `${node.name} has not been exported since it left ${cleanup.engineer ?? "its engineer"}: export engineers.yaml (revision ${cleanup.revision} or later) and run the node sync (4.7) first.`}
          </p>
        )}
        {cleanup && !notExported && (
          <label className="portal-field">
            <input
              type="checkbox"
              checked={draft.synced}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, synced: event.target.checked })}
            />
            {zh ? SYNC_CONFIRM_ZH : SYNC_CONFIRM_EN}
          </label>
        )}
        <div className="portal-actions">
          <button type="button" className="portal-button" disabled={busy || blocked} onClick={save}>
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

function keyPendingLabel(engineer: Engineer, zh: boolean): string {
  return engineer.keyUpdatedBy === "engineer"
    ? zh
      ? "工程師已更新公鑰，待匯出同步"
      : "Engineer updated the key; pending export and sync"
    : zh
      ? "公鑰已更新，待匯出同步"
      : "Key updated; pending export and sync";
}

function TemporaryPasswordDialog({
  username,
  email,
  password,
  onClose,
}: {
  username: string;
  email: string;
  password: string;
  onClose: () => void;
}) {
  const zh = useLocale().locale === "zh";
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("copied");
    } catch {
      setCopied("error");
    }
  }
  return (
    <AdminDialog
      title={zh ? `已建立 ${username} 的登入帳號` : `Portal account created for ${username}`}
      confirmLabel={zh ? "我已交給工程師" : "I have given it to the engineer"}
      onConfirm={onClose}
      onClose={onClose}
      dismissible={false}
    >
      <p className="portal-note">
        {zh
          ? `登入 email：${email}。下方臨時密碼只會顯示這一次，關閉後無法再次查看（忘記時請到「客戶」重設密碼）。`
          : `Sign-in email: ${email}. The temporary password below is shown only once and cannot be viewed again after you close this (reset it under Customers if it is lost).`}
      </p>
      <div className="portal-secret">
        <code>{password}</code>
      </div>
      <div className="portal-actions">
        <button type="button" className="portal-button-secondary" onClick={copy}>
          {copied === "copied" ? (zh ? "已複製" : "Copied") : zh ? "複製密碼" : "Copy password"}
        </button>
      </div>
      {copied === "error" && (
        <p className="portal-error" role="alert">
          {zh ? "無法自動複製，請手動選取上方密碼。" : "Copy is unavailable; select the password above manually."}
        </p>
      )}
      <p className="portal-hint">
        {zh
          ? "請透過私下管道交給工程師，並請他：1) 用這組 email 與臨時密碼登入；2) 立刻到 /account/security 變更密碼；3) 到 /account/ssh-key 送出自己的 SSH 公鑰（變更密碼前不能送出）。匯出前請透過其他管道向工程師確認新指紋；公鑰要等你下次匯出 engineers.yaml 並同步（4.6、4.7）後才會生效。"
          : "Give it to the engineer privately and ask them to: 1) sign in with this email and the temporary password; 2) change the password right away at /account/security; 3) submit their own SSH public key at /account/ssh-key (not possible until the password is changed). Confirm the new fingerprint with them through another channel before you export; the key takes effect only after your next export of engineers.yaml and sync (4.6, 4.7)."}
      </p>
    </AdminDialog>
  );
}

function ExportPanel({ state, onStateChange }: { state: AllocationState; onStateChange: (state: AllocationState) => void }) {
  const locale = useLocale().locale;
  const zh = locale === "zh";
  const [owner, setOwner] = useState(state.ownerEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // Engineer-submitted key changes found in an export that was held back for confirmation.
  const [heldBack, setHeldBack] = useState<KeyChange[]>([]);

  async function saveOwner() {
    setBusy(true);
    setMessage(null);
    try {
      onStateChange(
        await portalRequest<AllocationState>("/admin/allocation/owner", {
          method: "POST",
          body: JSON.stringify({ ownerEmail: owner.trim().toLowerCase(), expected_revision: state.revision }),
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
      const engineerChanges = (exported.keyChanges ?? []).filter((change) => change.updatedBy === "engineer");
      if (engineerChanges.length > 0 && !confirmed) {
        // Never hand out an engineer-submitted key before its fingerprint is confirmed.
        setHeldBack(engineerChanges);
        setMessage(
          zh
            ? "這次匯出包含工程師自行更新的公鑰：請先向工程師確認新指紋並勾選確認，再匯出。"
            : "This export includes keys engineers submitted themselves: confirm the new fingerprints with them and tick the confirmation, then export.",
        );
        setBusy(false);
        return;
      }
      downloadText(exported.filename || "engineers.yaml", exported.yaml);
      setResult(exported);
      // The download itself is read-only; recording it (and its revision) is a separate write.
      onStateChange(
        await portalRequest<AllocationState>("/admin/allocation/export/mark", {
          method: "POST",
          body: JSON.stringify({ revision: exported.revision, ...(confirmed && { fingerprintsConfirmed: true }) }),
        }),
      );
      setConfirmed(false);
      setHeldBack([]);
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
    }
    setBusy(false);
  }

  const unsynced = state.lastExport === null || state.lastExport.revision !== state.revision;
  const pendingKeys = state.engineers.filter((engineer) => engineer.active && engineer.keyPendingSync && engineer.keyFingerprint);
  const needsConfirmation = heldBack.length > 0 || pendingKeys.some((engineer) => engineer.keyUpdatedBy === "engineer");
  const none = zh ? "（無）" : "(none)";
  return (
    <section className="portal-panel" aria-labelledby="allocation-export">
      <div className="portal-panel-heading">
        <h2 id="allocation-export">{zh ? "匯出與同步" : "Export and sync"}</h2>
        <button type="button" className="portal-button" disabled={busy || (needsConfirmation && !confirmed)} onClick={exportFile}>
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
      {pendingKeys.length > 0 && (
        <div className="portal-note" role="status">
          <p>
            {zh
              ? "以下工程師的公鑰在上次匯出後有變更，匯出並執行跳板機（4.6）與節點（4.7）同步後才會生效："
              : "These engineers' keys changed since the last export; they take effect after you export and run the bastion (4.6) and node (4.7) syncs:"}
          </p>
          <ul aria-label={zh ? "待同步的公鑰" : "Keys pending sync"}>
            {pendingKeys.map((engineer) => (
              <li key={engineer.id}>
                {engineer.username}
                {zh ? "：" : ": "}
                <code>{engineer.keyPreviousFingerprint ?? none}</code>
                {" → "}
                <code>{engineer.keyFingerprint}</code>
                {zh ? "（" : " ("}
                {engineer.keyUpdatedBy === "engineer" ? (zh ? "工程師自行更新" : "updated by the engineer") : zh ? "管理員更新" : "updated by an administrator"}
                {zh ? "）" : ")"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {heldBack.length > 0 && (
        <ul className="portal-note" aria-label={zh ? "待確認的工程師公鑰" : "Engineer keys to confirm"}>
          {heldBack.map((change) => (
            <li key={change.username}>
              {change.username}
              {zh ? "：" : ": "}
              <code>{change.previousFingerprint ?? none}</code>
              {" → "}
              <code>{change.fingerprint}</code>
            </li>
          ))}
        </ul>
      )}
      {needsConfirmation && (
        <label className="portal-field">
          <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
          {zh ? FINGERPRINT_CONFIRM_ZH : FINGERPRINT_CONFIRM_EN}
        </label>
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
            {!result.monitoringReady
              ? zh
                ? " 這個檔案還過不了 render.py，請看下列提醒。"
                : " This file will not pass render.py yet; see below."
              : result.missingKeys.length > 0 &&
                (zh
                  ? ` ${result.missingKeys.join("、")} 還沒有公鑰：render.py 會列為 pending，同步（4.6、4.7）不會為他們建帳號，其他人照常同步。`
                  : ` ${result.missingKeys.join(", ")} have no key yet: render.py lists them as pending and the syncs (4.6, 4.7) create no account for them; everyone else is synced normally.`)}
          </p>
          {result.keyChanges && result.keyChanges.length > 0 && (
            <ul className="portal-hint" aria-label={zh ? "這次匯出包含的公鑰變更" : "Key changes in this export"}>
              {result.keyChanges.map((change) => (
                <li key={change.username}>
                  {zh
                    ? `${change.username}：${change.previousFingerprint ?? none} → ${change.fingerprint ?? none}（${change.updatedBy === "engineer" ? "工程師" : "管理員"}，版本 ${change.revision}）`
                    : `${change.username}: ${change.previousFingerprint ?? none} → ${change.fingerprint ?? none} (${change.updatedBy === "engineer" ? "engineer" : "admin"}, revision ${change.revision})`}
                </li>
              ))}
            </ul>
          )}
          {result.excluded.length > 0 && (
            <p className="portal-hint">
              {zh ? "未匯出：" : "Not exported: "}
              {result.excluded.map((item) => `${item.username}（${item.reason}）`).join(zh ? "、" : ", ")}
            </p>
          )}
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
          ? "在 Mac 上：先把 ~/github/b300-cluster/access/engineers.yaml 備份，再用下載的 engineers.yaml 覆蓋它。以下指令都在 ~/github/b300-cluster 目錄執行，一次貼一行（依 docs/engineer-access-runbook.md；換人或調整節點依序跑 4.2、4.6、4.7；標「生產・需 owner 核准」的步驟照 runbook 先取得核准）。"
          : "On the Mac: back up ~/github/b300-cluster/access/engineers.yaml, then replace it with the downloaded engineers.yaml. Run these in ~/github/b300-cluster, one line at a time (per docs/engineer-access-runbook.md; after a change run 4.2, 4.6 and 4.7 in order; production steps need the owner's approval as the runbook says)."}
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
          ? "業務節點不會開個人帳號，playbook 也不會碰它們，所以工程師節點不能直接改成業務：先改成「保留」→ 匯出 engineers.yaml → 執行節點同步（4.7，移除不再分配的工程師帳號）→ 在該節點勾選「已完成節點同步」→ 再改成業務。"
          : "Selling nodes never get personal accounts and the playbook never touches them, so an engineer node cannot go straight to Selling: set it to Reserved → export engineers.yaml → run the node sync (4.7, which removes engineer accounts that are no longer assigned) → tick the sync confirmation on that node → then make it Selling."}
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
  const [notice, setNotice] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; email: string; password: string } | null>(null);
  const [unlinking, setUnlinking] = useState<Engineer | null>(null);
  const state = override ?? resource.data;

  function applyState(next: AllocationState) {
    setOverride(next);
    setWarnings(next.warnings ?? []);
  }

  function reload() {
    setOverride(null);
    setWarnings([]);
    setMessage(null);
    setNotice(null);
    resource.refresh();
  }

  async function setActive(engineer: Engineer, active: boolean) {
    setBusyId(engineer.id);
    setMessage(null);
    try {
      applyState(
        await portalRequest<AllocationState>(`/admin/allocation/engineers/${encodeURIComponent(engineer.id)}/status`, {
          method: "POST",
          body: JSON.stringify({ active, expected_revision: state?.revision }),
        }),
      );
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
    }
    setBusyId(null);
  }

  async function createAccount(engineer: Engineer) {
    setBusyId(engineer.id);
    setMessage(null);
    try {
      const next = await portalRequest<AllocationState>(`/admin/allocation/engineers/${encodeURIComponent(engineer.id)}/account`, {
        method: "POST",
        body: JSON.stringify({ expected_revision: state?.revision }),
      });
      const password = next.temporaryPassword;
      applyState({ ...next, temporaryPassword: undefined });
      if (password) setIssued({ username: engineer.username, email: next.account?.email ?? engineer.email, password });
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
    }
    setBusyId(null);
  }

  async function unlinkAccount(engineer: Engineer) {
    setBusyId(engineer.id);
    setMessage(null);
    try {
      applyState(
        await portalRequest<AllocationState>(`/admin/allocation/engineers/${encodeURIComponent(engineer.id)}/account/unlink`, {
          method: "POST",
          body: JSON.stringify({ expected_revision: state?.revision }),
        }),
      );
      setUnlinking(null);
    } catch (reason: unknown) {
      setMessage(errorText(reason, locale));
      setUnlinking(null);
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
              <button type="button" className="portal-button-secondary" onClick={reload}>
                {zh ? "重新整理" : "Reload"}
              </button>
            </div>
            <div className="portal-actions">
              {state.summary.perEngineer.map((item) => (
                <span key={item.id} className="portal-badge">
                  {zh ? `${item.username} ${item.nodes} 台` : `${item.username}: ${item.nodes}`}
                </span>
              ))}
            </div>
          </section>
          {state.pendingCleanup.length > 0 && (
            <section className="portal-panel" aria-labelledby="allocation-pending">
              <h2 id="allocation-pending">{zh ? "待清理節點" : "Pending cleanup"}</h2>
              <p className="portal-hint">
                {zh
                  ? "這些節點離開了工程師、目前是保留。匯出 engineers.yaml 並執行節點同步（4.7）移除帳號後，勾選確認才可改為業務。"
                  : "These nodes left an engineer and are reserved. Export engineers.yaml and run the node sync (4.7) to remove the account; only then can you confirm and make them selling."}
              </p>
              <ul>
                {state.pendingCleanup.map((item) => (
                  <li key={item.node}>
                    {zh
                      ? `${item.node}：原屬 ${item.engineer ?? "工程師"}（版本 ${item.revision} 起）`
                      : `${item.node}: was ${item.engineer ?? "an engineer"} (since revision ${item.revision})`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {notice && (
            <p className="portal-note" role="status">
              {notice}
            </p>
          )}
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
                    <NodeRow
                      key={`${node.name}:${state.revision}`}
                      node={node}
                      engineers={state.engineers}
                      revision={state.revision}
                      lastExportRevision={state.lastExport?.revision ?? 0}
                      onSaved={applyState}
                    />
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
                ? "還沒有 SSH 公鑰的工程師仍會匯出，公鑰欄位是 CHANGE_ME 佔位：render.py 視為 pending（check 通過但會警告），監控照常包含他，同步（4.6、4.7）不會為他建帳號，其他人不受影響。停用的工程師以 state: absent 匯出，下次同步時移除帳號。cluster id（eng1…）是匯出檔的 id，也是 Prometheus 的 owner 標籤。「建立登入帳號」會用工程師的 email 開一個入口網站帳號並連結，工程師登入後可在 /account/ssh-key 自行送出公鑰；新公鑰要等你下次匯出並同步後才會生效。"
                : "Engineers without an SSH public key are still exported, with the CHANGE_ME key placeholder: render.py treats them as pending (check passes with a warning), monitoring includes them, and the syncs (4.6, 4.7) create no account for them; nobody else is affected. Deactivated engineers are exported as state: absent so the next sync removes their accounts. The cluster id (eng1…) is the id in the exported file and the Prometheus owner label. “Create portal account” opens a portal account for the engineer's email and links it, so the engineer can submit their own key at /account/ssh-key; a new key takes effect only after your next export and sync."}
            </p>
            <ErrorLine message={message} />
            <div className="portal-table-wrap">
              <table className="portal-table">
                <caption className="sr-only">{zh ? "工程師" : "Engineers"}</caption>
                <thead>
                  <tr>
                    <th scope="col">{zh ? "帳號" : "Username"}</th>
                    <th scope="col">Cluster id</th>
                    <th scope="col">Email</th>
                    <th scope="col">{zh ? "顯示名稱" : "Display name"}</th>
                    <th scope="col">{zh ? "公鑰指紋" : "Key fingerprint"}</th>
                    <th scope="col">{zh ? "登入帳號" : "Portal account"}</th>
                    <th scope="col">{zh ? "節點" : "Nodes"}</th>
                    <th scope="col">{zh ? "狀態" : "Status"}</th>
                    <th scope="col">{zh ? "操作" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.engineers.map((engineer) => (
                    <tr key={engineer.id}>
                      <th scope="row">{engineer.username}</th>
                      <td>
                        <code>{engineer.clusterId}</code>
                      </td>
                      <td>{engineer.email}</td>
                      <td>{engineer.displayName}</td>
                      <td>
                        {engineer.keyFingerprint ? (
                          <>
                            <code>{engineer.keyFingerprint}</code>
                            <br />
                            <small>{engineer.keyType}</small>
                            {engineer.keyPendingSync && (
                              <>
                                <br />
                                <span className="portal-badge">{keyPendingLabel(engineer, zh)}</span>
                              </>
                            )}
                          </>
                        ) : engineer.active && engineer.nodes.length === 0 ? (
                          <span className="portal-badge">{zh ? "尚未提供公鑰（沒有節點，不會匯出）" : "No key yet (no nodes, not exported)"}</span>
                        ) : (
                          <span className="portal-badge">{zh ? "尚未設定公鑰（匯出為 CHANGE_ME）" : "No key yet (exported as CHANGE_ME)"}</span>
                        )}
                      </td>
                      <td>
                        {engineer.account ? (
                          <>
                            {engineer.account.email}
                            {engineer.account.disabled && (
                              <>
                                <br />
                                <span className="portal-badge">{zh ? "帳號已停用" : "Account disabled"}</span>
                              </>
                            )}
                            <br />
                            <button
                              type="button"
                              className="portal-text-button"
                              disabled={busyId === engineer.id}
                              aria-label={zh ? `解除 ${engineer.username} 的登入帳號連結` : `Unlink ${engineer.username}'s portal account`}
                              onClick={() => setUnlinking(engineer)}
                            >
                              {zh ? "解除連結" : "Unlink"}
                            </button>
                          </>
                        ) : engineer.active ? (
                          <button
                            type="button"
                            className="portal-text-button"
                            disabled={busyId === engineer.id}
                            aria-label={zh ? `為 ${engineer.username} 建立登入帳號` : `Create portal account for ${engineer.username}`}
                            onClick={() => void createAccount(engineer)}
                          >
                            {zh ? "建立登入帳號" : "Create portal account"}
                          </button>
                        ) : (
                          "—"
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
          {issued && (
            <TemporaryPasswordDialog
              username={issued.username}
              email={issued.email}
              password={issued.password}
              onClose={() => setIssued(null)}
            />
          )}
          {unlinking && (
            <AdminDialog
              title={zh ? `解除 ${unlinking.username} 的登入帳號連結？` : `Unlink ${unlinking.username}'s portal account?`}
              confirmLabel={zh ? "解除連結" : "Unlink"}
              cancelLabel={zh ? "取消" : "Cancel"}
              onConfirm={() => void unlinkAccount(unlinking)}
              onClose={() => setUnlinking(null)}
              inFlight={busyId === unlinking.id}
              danger
            >
              <p>
                {zh
                  ? `${unlinking.account?.email ?? unlinking.email} 將不能再更新 ${unlinking.username} 的 SSH 公鑰。帳號本身不會被刪除或停用（需要時請到「客戶」停用），已存的公鑰與節點也不變。`
                  : `${unlinking.account?.email ?? unlinking.email} will no longer be able to update ${unlinking.username}'s SSH key. The account itself is not deleted or disabled (disable it under Customers if needed), and the saved key and nodes stay as they are.`}
              </p>
            </AdminDialog>
          )}
          {dialog && (
            <EngineerFormDialog
              dialog={dialog}
              revision={state.revision}
              onClose={() => setDialog(null)}
              onSaved={(next, savedKey) => {
                setDialog(null);
                applyState(next);
                setNotice(
                  savedKey
                    ? zh
                      ? `已儲存公鑰（正規化後）：${savedKey}`
                      : `Saved key (normalised): ${savedKey}`
                    : null,
                );
              }}
            />
          )}
        </>
      )}
    </ResourceState>
  );
}
