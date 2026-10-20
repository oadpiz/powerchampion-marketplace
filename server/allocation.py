"""機台分配 (node allocation): which b300 GPU node is selling, reserved, or an engineer's.

The portal is the semi-automatic source of truth. It never contacts a node: an
administrator exports engineers.yaml here and runs the cluster repo's ops scripts
(~/github/b300-cluster, docs/engineer-access-runbook.md) to apply it.

The export must pass that repo's `access/render.py check`; the rules mirrored here
(username pattern, reserved names, key line format) are copied from render.py as of
2026-10-20. Keep them in sync when render.py changes.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import secrets
import time
import uuid
from datetime import datetime, timezone

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse

from .security import digest_token, normalize_email, password_hash, verify_password
from .store import iso

ROLES = ("selling", "engineer", "reserved")
NODE_NAME = re.compile(r"^b300-[0-9]{1,3}$")
ENGINEER_ID = re.compile(r"^[a-f0-9]{32}$")
# render.py USER_RE and RESERVED (2026-10-20).
USERNAME = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
RESERVED_USERNAMES = frozenset({"root", "tku", "bastion99", "ubuntu", "admin", "daemon", "bin", "sys", "sync",
                                "nobody", "sshd", "www-data", "b300eng"})
PLACEHOLDER = "CHANGE_ME"
PLACEHOLDER_EMAIL = "CHANGE_ME@your-mail-domain"
# render.py's placeholder for a key that has not arrived yet. render.py (2026-10-21) treats
# such an engineer as "pending": check passes with a warning, their nodes stay theirs, and
# bastion-tsv / ansible-vars / the playbook create no account or key for them.
PLACEHOLDER_KEY = "ssh-ed25519 AAAA... CHANGE_ME"
CLUSTER_ID = re.compile(r"^eng([0-9]{1,6})$")
# Ops-owned parts of engineers.yaml that the portal does not manage. Copied verbatim from
# ~/github/b300-cluster/access/engineers.yaml (2026-10-20); see docs/portal-operations.md.
SELLING_VLLM_PORTS = {"b300-31": [8016, 8017, 8019, 8026], "b300-14": [8017]}
ENGINEER_VLLM_PORTS = [8000, 8001, 8002, 8003, 8004, 8005, 8006, 8007]
KEY_TYPES = ("ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa")
KEY_LINE = re.compile(r"^(?P<type>\S+) (?P<blob>[A-Za-z0-9+/]+={0,3})(?: (?P<comment>.*))?$")
MIN_RSA_BITS = 3072
NOTE_MAX = 200
# Everything exported ends up in ansible vars, and ansible evaluates Jinja in strings.
# Exported text is therefore restricted to template-free character sets.
EMAIL = re.compile(r"^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$")
# render.py NAME_RE: first character a Unicode letter/digit (not _), then \w, space, . or -.
DISPLAY_NAME = re.compile(r"^[^\W_][\w .-]{0,63}$")
KEY_COMMENT = re.compile(r"^[A-Za-z0-9@._+-]{1,100}$")
TEMPLATE_MARKERS = ("{{", "{%", "{#")


def reject_template(value: str, label: str) -> str:
    if any(marker in value for marker in TEMPLATE_MARKERS):
        _bad("The " + label + " cannot contain {{, {% or {#.")
    return value


class AllocationError(Exception):
    def __init__(self, code, detail, status=400):
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status


def _bad(detail, code="invalid_input", status=400):
    raise AllocationError(code, detail, status)


def node_number(name: str) -> int:
    return int(name.split("-", 1)[1])


def validate_username(value) -> str:
    if not isinstance(value, str) or not USERNAME.fullmatch(value):
        _bad("Use a username of 1 to 32 characters: lowercase letters, digits, _ or -, starting with a letter or _.")
    if value in RESERVED_USERNAMES:
        _bad("The username " + value + " is reserved on the cluster.")
    return value


def validate_email(value) -> str:
    try:
        email = normalize_email(value)
    except ValueError:
        _bad("Enter a valid email address.")
    if PLACEHOLDER in email.upper():
        _bad("Enter a real email address, not a placeholder.")
    if not EMAIL.fullmatch(email):
        _bad("Use an email of letters, digits and . _ % + - only (for example name@oadpiz.com).")
    return email


def validate_display_name(value, fallback: str) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        return fallback
    if not isinstance(value, str) or not DISPLAY_NAME.fullmatch(value.strip()):
        _bad("Use a display name of at most 64 letters, digits, spaces, . - or _, starting with a letter or digit (CJK allowed; no { } % # : , quotes or backslash).")
    return reject_template(value.strip(), "display name")


def validate_note(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value.strip()) > NOTE_MAX or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _bad("Enter a note of at most %d characters on one line." % NOTE_MAX)
    # The note is never exported; refusing template markers anyway keeps it safe if that changes.
    return reject_template(value.strip(), "note")


def fingerprint(blob: bytes) -> str:
    return "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def parse_public_key(value) -> dict:
    """One OpenSSH public key line: ed25519, ecdsa (nistp256/384/521) or RSA >= 3072 bits,
    no options prefix. Returns the normalised line, type, bits and SHA256 fingerprint."""
    from cryptography.hazmat.primitives.asymmetric import ec, ed25519, rsa
    from cryptography.hazmat.primitives.serialization import load_ssh_public_key

    if not isinstance(value, str):
        _bad("Paste the public key as text.")
    line = value.strip()
    if not line:
        _bad("Paste an SSH public key.")
    if len(line) > 16384:
        _bad("That public key is too long.")
    if any(ord(c) < 32 or ord(c) == 127 for c in line):
        _bad("Paste exactly one public key on a single line.")
    match = KEY_LINE.fullmatch(line)
    key_type = match.group("type") if match else line.split(" ", 1)[0]
    if key_type not in KEY_TYPES:
        if any(" " + t + " " in " " + line + " " for t in KEY_TYPES):
            _bad("Remove the options before the key type: paste only the 'ssh-ed25519 AAAA… comment' line.")
        _bad("Use an ssh-ed25519, ecdsa-sha2-nistp256/384/521 or ssh-rsa (3072 bits or more) public key.")
    if not match:
        _bad("That is not a single OpenSSH public key line (type, base64 key, optional comment).")
    try:
        blob = base64.b64decode(match.group("blob"), validate=True)
    except (binascii.Error, ValueError):
        _bad("The key data is not valid base64.")
    try:
        key = load_ssh_public_key((key_type + " " + match.group("blob")).encode("ascii"))
    except Exception:
        _bad("The key data does not match its type or is damaged.")
    if key_type == "ssh-ed25519":
        ok, bits = isinstance(key, ed25519.Ed25519PublicKey), 256
    elif key_type == "ssh-rsa":
        ok, bits = isinstance(key, rsa.RSAPublicKey), getattr(key, "key_size", 0)
        if ok and bits < MIN_RSA_BITS:
            _bad("RSA keys must be at least %d bits (this one is %d). Prefer ssh-ed25519." % (MIN_RSA_BITS, bits))
    else:
        curve = key_type.rsplit("-", 1)[1].replace("nistp", "secp") + "r1"
        ok = isinstance(key, ec.EllipticCurvePublicKey) and key.curve.name == curve
        bits = key.curve.key_size if ok else 0
    if not ok:
        _bad("The key data does not match its type or is damaged.")
    comment = (match.group("comment") or "").strip()
    # A comment outside [A-Za-z0-9@._+-] is dropped rather than exported (ansible templates it).
    if comment and not KEY_COMMENT.fullmatch(comment):
        comment = ""
    normalised = key_type + " " + match.group("blob") + (" " + comment if comment else "")
    return {"line": normalised, "type": key_type, "bits": bits, "fingerprint": fingerprint(blob), "comment": comment}


def key_summary(line):
    if not line:
        return None
    parts = line.split(" ")
    try:
        blob = base64.b64decode(parts[1], validate=True)
    except (IndexError, binascii.Error, ValueError):
        return None
    return {"type": parts[0], "fingerprint": fingerprint(blob), "comment": " ".join(parts[2:])}


def key_duplicate(con, line, exclude_id=None):
    """Refuse a key another engineer already holds (compared by key data, not comment).
    Shared by the administrator and the engineer self-service paths."""
    blob = line.split(" ")[1]
    for row in con.execute("SELECT id, ssh_pubkey FROM alloc_engineers WHERE ssh_pubkey IS NOT NULL").fetchall():
        if row["id"] != exclude_id and row["ssh_pubkey"].split(" ")[1] == blob:
            _bad("Another engineer already uses this SSH public key.", "engineer_conflict", 409)


def key_pending_sync(row, last_export_revision) -> bool:
    """The key changed after the last recorded export, so the machines do not have it yet."""
    changed = row["key_updated_revision"]
    return changed is not None and changed > (last_export_revision or 0)


def record_key_change(con, engineer_id, revision, by):
    con.execute("UPDATE alloc_engineers SET key_updated_revision=?,key_updated_by=? WHERE id=?", (revision, by, engineer_id))


# ---------------------------------------------------------------- persistence helpers

def _history(row) -> list:
    try:
        value = json.loads(row["node_history"] or "[]")
    except ValueError:
        value = []
    return [n for n in value if isinstance(n, str)]


def engineer_json(row, nodes, last_export_revision=None):
    key = key_summary(row["ssh_pubkey"])
    account = ({"userId": row["user_id"], "email": row["account_email"], "disabled": row["account_disabled_at"] is not None}
               if row["user_id"] else None)
    return {"id": row["id"], "clusterId": row["cluster_id"], "username": row["username"], "email": row["email"], "displayName": row["display_name"],
            "sshPubkey": row["ssh_pubkey"], "keyFingerprint": key["fingerprint"] if key else None,
            "keyType": key["type"] if key else None, "active": bool(row["active"]), "nodes": nodes,
            "nodeHistory": _history(row), "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"]),
            "account": account, "keyPendingSync": key_pending_sync(row, last_export_revision),
            "keyUpdatedBy": row["key_updated_by"], "keyUpdatedRevision": row["key_updated_revision"]}


def self_engineer_json(con, row):
    """What a linked engineer may see about themselves: never the raw key, never anyone else."""
    nodes = sorted((r["name"] for r in con.execute("SELECT name FROM alloc_nodes WHERE engineer_id=?", (row["id"],)).fetchall()),
                   key=node_number)
    meta = con.execute("SELECT last_export_revision FROM alloc_meta WHERE id=1").fetchone()
    key = None
    if row["ssh_pubkey"]:
        try:
            parsed = parse_public_key(row["ssh_pubkey"])
            key = {"type": parsed["type"], "bits": parsed["bits"], "fingerprint": parsed["fingerprint"]}
        except AllocationError:
            summary = key_summary(row["ssh_pubkey"])
            key = {"type": summary["type"], "bits": None, "fingerprint": summary["fingerprint"]} if summary else None
    return {"username": row["username"], "displayName": row["display_name"], "active": bool(row["active"]), "nodes": nodes,
            "key": key, "keyPendingSync": key_pending_sync(row, meta["last_export_revision"]), "keyUpdatedBy": row["key_updated_by"]}


def _snapshot(con):
    engineers = con.execute("SELECT e.*, u.email AS account_email, u.disabled_at AS account_disabled_at FROM alloc_engineers e "
                            "LEFT JOIN users u ON u.id=e.user_id ORDER BY e.created_at, e.username").fetchall()
    nodes = sorted(con.execute("SELECT n.*,u.email AS updated_by_email FROM alloc_nodes n LEFT JOIN users u ON u.id=n.updated_by").fetchall(),
                   key=lambda r: node_number(r["name"]))
    meta = con.execute("SELECT * FROM alloc_meta WHERE id=1").fetchone()
    return engineers, nodes, meta


def pending_cleanup(nodes, by_id):
    """Nodes that left an engineer (now reserved) and whose sync has not been confirmed."""
    return [{"node": n["name"], "revision": n["pending_cleanup_revision"],
             "engineer": by_id[n["pending_cleanup_engineer_id"]]["username"] if n["pending_cleanup_engineer_id"] in by_id else None}
            for n in nodes if n["pending_cleanup_revision"] is not None]


def state_json(con):
    engineers, nodes, meta = _snapshot(con)
    by_id = {e["id"]: e for e in engineers}
    pending = {p["node"]: p for p in pending_cleanup(nodes, by_id)}
    owned = {e["id"]: [] for e in engineers}
    for n in nodes:
        if n["engineer_id"]:
            owned[n["engineer_id"]].append(n["name"])
    counts = {role: sum(1 for n in nodes if n["role"] == role) for role in ROLES}
    return {
        "revision": meta["revision"],
        "ownerEmail": meta["owner_email"],
        "lastExport": {"revision": meta["last_export_revision"], "at": iso(meta["last_export_at"])} if meta["last_export_revision"] else None,
        "nodes": [{"name": n["name"], "ip": n["ip"], "role": n["role"], "engineerId": n["engineer_id"],
                   "engineer": ({"id": n["engineer_id"], "username": by_id[n["engineer_id"]]["username"],
                                 "displayName": by_id[n["engineer_id"]]["display_name"]} if n["engineer_id"] else None),
                   "note": n["note"], "updatedAt": iso(n["updated_at"]), "updatedBy": n["updated_by_email"],
                   "pendingCleanup": ({"revision": pending[n["name"]]["revision"], "engineer": pending[n["name"]]["engineer"]}
                                      if n["name"] in pending else None)} for n in nodes],
        "pendingCleanup": list(pending.values()),
        "engineers": [engineer_json(e, owned[e["id"]], meta["last_export_revision"]) for e in engineers],
        "summary": {"selling": counts["selling"], "engineer": counts["engineer"], "reserved": counts["reserved"],
                    "perEngineer": [{"id": e["id"], "username": e["username"], "nodes": len(owned[e["id"]])}
                                    for e in engineers if e["active"] or owned[e["id"]]]},
    }


def bump_revision(con, actor_id) -> int:
    con.execute("UPDATE alloc_meta SET revision=revision+1,updated_at=?,updated_by=? WHERE id=1", (int(time.time()), actor_id))
    return con.execute("SELECT revision FROM alloc_meta WHERE id=1").fetchone()[0]


# ---------------------------------------------------------------- export

def _scalar(value) -> str:
    """A YAML scalar: plain when unambiguous (matches the hand-written file), else JSON-quoted
    (a JSON string is a valid YAML double-quoted scalar)."""
    text = str(value)
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9._@+-]*", text) and text.lower() not in {
            "y", "n", "yes", "no", "on", "off", "true", "false", "null", "nan", "inf"}:
        return text
    return json.dumps(text, ensure_ascii=False)


def _flow(items) -> str:
    return "[" + ", ".join(_scalar(i) if isinstance(i, str) else str(i) for i in items) + "]"


def build_export(con, now=None):
    """Return (document, text, warnings, excluded). `document` is what `text` parses to."""
    now = int(time.time()) if now is None else now
    engineers, nodes, meta = _snapshot(con)
    selling = [n["name"] for n in nodes if n["role"] == "selling"]
    owned = {e["id"]: [] for e in engineers}
    for n in nodes:
        if n["engineer_id"]:
            owned[n["engineer_id"]].append(n["name"])
    by_id = {e["id"]: e for e in engineers}
    pending = pending_cleanup(nodes, by_id)
    pending_by_engineer = {}
    for p in pending:
        pending_by_engineer.setdefault(p["engineer"], []).append(p["node"])
    warnings, excluded, entries, missing_keys = [], [], [], []
    if pending:
        listed = ", ".join(f"{p['node']} (was {p['engineer'] or 'unknown'})" for p in pending)
        warnings.append(f"Pending cleanup: {listed}. These nodes left an engineer and are reserved; run the node sync "
                        "(runbook 4.7) with this file so the account is removed, then confirm it in the portal before "
                        "making a node selling.")
    for e in engineers:
        user = e["username"]
        if e["active"]:
            if not owned[e["id"]] and not e["ssh_pubkey"]:
                # No nodes and no key: never had an account (a saved key cannot be cleared), so
                # there is nothing to create or remove; a CHANGE_ME entry would only add a pending warning.
                excluded.append({"username": user, "reason": "尚未提供公鑰"})
                warnings.append(f"{user}: 尚未提供公鑰且沒有節點，不會匯出 (no key and no nodes yet: nothing to create "
                                "or remove, so left out of the file).")
                continue
            if not owned[e["id"]]:
                # render.py accepts an active engineer with nodes: [] (only the Grafana login
                # remains); exporting them is what lets the sync remove the jump and node accounts.
                warnings.append(f"{user}: 此工程師目前沒有節點，同步後會移除其跳板機帳號與節點帳號 "
                                "(no nodes: the sync removes the jump and node accounts; the Grafana login stays)"
                                + (f"; pending cleanup on {', '.join(pending_by_engineer[user])}." if user in pending_by_engineer else "."))
            if not e["ssh_pubkey"]:
                missing_keys.append(user)
            entries.append((e, owned[e["id"]], "present"))
        else:
            history = [n for n in _history(e) if n not in selling]
            dropped = [n for n in _history(e) if n in selling]
            if dropped:
                warnings.append(f"{user}: inactive; {', '.join(dropped)} became selling node(s) and cannot be listed for "
                                "removal (render.py forbids selling nodes on any engineer). Remove that account by hand.")
            if not history:
                excluded.append({"username": user, "reason": "inactive_without_nodes"})
                warnings.append(f"{user}: inactive and never had a non-selling node, so there is nothing to offboard; left out.")
                continue
            entries.append((e, sorted(history, key=node_number), "absent"))
    if missing_keys:
        warnings.append(f"No SSH public key yet for {', '.join(missing_keys)}: exported with the CHANGE_ME key placeholder. "
                        "render.py treats them as pending: check passes with a warning, monitoring includes them, and the "
                        "bastion (4.6) and node (4.7) syncs create no account for them until a key arrives; everyone else "
                        "is synced normally.")
    last_export = meta["last_export_revision"] or 0
    key_changes = [{"username": e["username"], "fingerprint": (key_summary(e["ssh_pubkey"]) or {}).get("fingerprint"),
                    "updatedBy": e["key_updated_by"], "revision": e["key_updated_revision"]}
                   for e in engineers if e["active"] and e["ssh_pubkey"] and key_pending_sync(e, last_export)]
    if key_changes:
        listed = ", ".join(f"{c['username']} ({'engineer' if c['updatedBy'] == 'engineer' else 'admin'}, revision {c['revision']})"
                           for c in key_changes)
        warnings.append(f"SSH key changed since the last export for {listed}: the new key works only after the bastion (4.6) "
                        "and node (4.7) syncs run with this file.")
    owner_email = meta["owner_email"] or PLACEHOLDER_EMAIL
    if not meta["owner_email"]:
        warnings.append("Owner email is not set: the file carries the CHANGE_ME placeholder and render.py check refuses it until you set one.")
    if not entries:
        warnings.append("No engineer can be exported (an active engineer needs at least one node); "
                        "render.py refuses an empty engineers list.")
    vllm_ports = {n: SELLING_VLLM_PORTS[n] for n in SELLING_VLLM_PORTS if n in selling}
    for n in selling:
        if n not in vllm_ports:
            warnings.append(f"{n}: selling node without known vLLM ports; add them to selling.vllm_ports by hand if it serves vLLM.")

    document = {"selling": {"nodes": selling, "vllm_ports": vllm_ports}, "owner": {"email": owner_email},
                "engineer_vllm_ports": list(ENGINEER_VLLM_PORTS), "engineers": []}
    generated = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lines = [
        "# B300 engineer access: single source of truth.",
        "# GENERATED by the Power Champion portal (/admin/allocation, 機台分配). Do not hand-edit:",
        "# change the assignment in the portal and export again.",
        f"# revision: {meta['revision']}",
        f"# generated_at: {generated}",
        "#",
        "# Read by: ansible/engineer-access.yml, access/render.py, bin/b300-bastion-access.sh",
        "# and docs/engineer-access-runbook.md. Selling nodes never get personal accounts; a node",
        "# belongs to at most one engineer; offboarding is state: absent (keep the entry).",
        "# A CHANGE_ME ssh_pubkey means the key has not arrived: render.py treats that engineer",
        "# as pending (check warns; no account or key is created for them until it arrives).",
    ]
    if excluded:
        lines.append("#")
        lines.append("# Listed in the portal but not exported (see the portal's export warnings):")
        for item in excluded:
            nodes_text = (" (pending cleanup on " + ", ".join(item["pendingCleanup"]) + ")") if item.get("pendingCleanup") else ""
            lines.append(f"#   {item['username']}: {item['reason']}{nodes_text}")
    if pending:
        lines.append("#")
        lines.append("# Pending cleanup (left an engineer, now reserved; sync 4.7, then confirm in the portal):")
        for p in pending:
            lines.append(f"#   {p['node']}: was {p['engineer'] or 'unknown'} (since revision {p['revision']})")
    lines += ["", "selling:", "  nodes: " + _flow(selling)]
    lines.append("  # Ops-owned (portal constant, copied from engineers.yaml 2026-10-20): vLLM /metrics ports per selling node.")
    if vllm_ports:
        lines.append("  vllm_ports:")
        lines += [f"    {n}: {_flow(p)}" for n, p in vllm_ports.items()]
    else:
        lines.append("  vllm_ports: {}")
    lines += ["", "# Grafana Admin and Cloudflare Access owner (in addition to the engineers).", "owner:",
              "  email: " + _scalar(owner_email), "",
              "# Ports an engineer may serve vLLM on; all are scraped by Prometheus.",
              "engineer_vllm_ports: " + _flow(ENGINEER_VLLM_PORTS), ""]
    if not entries:
        lines.append("engineers: []")
    else:
        lines.append("engineers:")
        for e, node_list, state in entries:
            item = {"id": e["cluster_id"], "username": e["username"], "name": e["display_name"], "email": e["email"],
                    "ssh_pubkey": e["ssh_pubkey"] or (PLACEHOLDER_KEY if state == "present" else ""),
                    "nodes": node_list, "state": state}
            document["engineers"].append(item)
            lines += [f"  - id: {_scalar(item['id'])}", f"    username: {_scalar(item['username'])}",
                      f"    name: {_scalar(item['name'])}", f"    email: {_scalar(item['email'])}",
                      f"    ssh_pubkey: {json.dumps(item['ssh_pubkey'], ensure_ascii=False)}",
                      f"    nodes: {_flow(node_list)}", f"    state: {state}", ""]
    text = "\n".join(lines).rstrip("\n") + "\n"
    _self_check(text, document)
    return {"document": document, "yaml": text, "warnings": warnings, "excluded": excluded,
            "revision": meta["revision"], "generatedAt": generated,
            # render.py check passes; engineers in missingKeys are pending (no account yet).
            "renderReady": bool(entries) and bool(meta["owner_email"]),
            "monitoringReady": bool(entries) and bool(meta["owner_email"]), "missingKeys": missing_keys,
            "pendingCleanup": pending, "keyChanges": key_changes}


def _self_check(text, document):
    import yaml

    if yaml.safe_load(text) != document:
        raise RuntimeError("engineers.yaml export does not parse back to its intended structure")


# ---------------------------------------------------------------- routes

REVISION_CONFLICT = "資料已被其他管理員更新，請重新整理。 (The allocation changed; reload and try again.)"
ENGINEER_TO_SELLING = ("請先改為保留並完成節點同步，再改為業務。 (Set the node to reserved and finish the node sync "
                       "first, then make it selling.)")
ACCOUNT_EXISTS = ("{email} 已經有入口網站帳號，基於安全不會自動連結：註冊不驗證 email，這個帳號可能是別人搶先註冊的。"
                  "請改用這位工程師另一個還沒有帳號的 email，或先查明並處理該帳號後再試。 ({email} already has a portal "
                  "account. It is not linked automatically: signup does not verify email ownership, so it may belong "
                  "to someone else. Use another email for this engineer that has no account, or resolve that account first.)")
ACCOUNT_LINKED = "這位工程師已經連結了登入帳號，請先解除連結。 (This engineer already has a linked portal account; unlink it first.)"
ENGINEER_INACTIVE = "這位工程師已停用。 (This engineer is deactivated.)"
NOT_ENGINEER = "這個帳號沒有連結工程師。 (This account is not linked to an engineer.)"
KEY_TAKES_EFFECT = ("已收到新公鑰。管理員下次匯出 engineers.yaml 並同步到機器後才會生效，在那之前請繼續使用舊的金鑰。 "
                    "(Key received. It takes effect after the administrator's next export and sync; until then keep "
                    "using your current key.)")
TEMP_PASSWORD_BYTES = 18  # token_urlsafe(18) = 24 characters, within validate_password's 12..128


def attach_allocation(app, store, current_user, body_json, prefix):
    from fastapi.responses import JSONResponse

    base = prefix + "/admin/allocation"

    @app.exception_handler(AllocationError)
    async def allocation_error(_request, error):
        return JSONResponse({"error": error.code, "detail": error.detail}, status_code=error.status)

    def write_lock(con, admin, body):
        """Serialise writers, re-check the caller is still an active admin, and enforce
        optimistic concurrency when the client sent expected_revision."""
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT role, disabled_at FROM users WHERE id=?", (admin["id"],)).fetchone()
        if not row or row["role"] != "admin" or row["disabled_at"] is not None:
            _bad("Administrator access is required.", "admin_required", 403)
        expected = body.get("expected_revision")
        if expected is not None:
            if isinstance(expected, bool) or not isinstance(expected, int):
                _bad("expected_revision must be an integer.")
            current = con.execute("SELECT revision FROM alloc_meta WHERE id=1").fetchone()[0]
            if expected != current:
                _bad(REVISION_CONFLICT, "revision_conflict", 409)

    def engineer_row(con, engineer_id):
        if not ENGINEER_ID.fullmatch(engineer_id or ""):
            _bad("Engineer not found.", "engineer_not_found", 404)
        row = con.execute("SELECT * FROM alloc_engineers WHERE id=?", (engineer_id,)).fetchone()
        if not row:
            _bad("Engineer not found.", "engineer_not_found", 404)
        return row

    def unique_or_conflict(con, column, value, exclude_id=None):
        row = con.execute("SELECT id FROM alloc_engineers WHERE " + column + "=?", (value,)).fetchone()
        if row and row["id"] != exclude_id:
            label = {"username": "username", "email": "email"}[column]
            _bad("Another engineer already uses this " + label + ".", "engineer_conflict", 409)

    def flag(body, name):
        value = body.get(name)
        if value is not None and not isinstance(value, bool):
            _bad(name + " must be true or false.")
        return value is True

    def respond(con, **extra):
        return {**state_json(con), **extra}

    @app.get(base)
    async def allocation_state(request: Request):
        current_user(request, admin=True)
        with store.connect() as con:
            return state_json(con)

    @app.post(base + "/engineers")
    async def allocation_engineer_create(request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        username = validate_username(body.get("username"))
        email = validate_email(body.get("email"))
        display = validate_display_name(body.get("displayName"), username)
        raw_key = body.get("sshPubkey")
        key = parse_public_key(raw_key) if raw_key not in (None, "") else None
        now = int(time.time())
        engineer_id = uuid.uuid4().hex
        with store.connect() as con:
            write_lock(con, admin, body)
            unique_or_conflict(con, "username", username)
            unique_or_conflict(con, "email", email)
            if key:
                key_duplicate(con, key["line"])
            numbers = [int(m.group(1)) for r in con.execute("SELECT cluster_id FROM alloc_engineers").fetchall()
                       if (m := CLUSTER_ID.fullmatch(r["cluster_id"]))]
            cluster_id = "eng%d" % (max(numbers, default=0) + 1)
            con.execute("INSERT INTO alloc_engineers (id,cluster_id,username,email,display_name,ssh_pubkey,active,node_history,created_at,updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?)", (engineer_id, cluster_id, username, email, display, key["line"] if key else None, True, "[]", now, now))
            revision = bump_revision(con, admin["id"])
            if key:
                record_key_change(con, engineer_id, revision, "admin")
            store.audit(con, "alloc.engineer_create", admin["id"], engineer_id,
                        {"username": username, "clusterId": cluster_id, "email": email, "displayName": display,
                         "keyFingerprint": key["fingerprint"] if key else None, "revision": revision})
            return JSONResponse(respond(con, engineerId=engineer_id, sshPubkey=key["line"] if key else None), status_code=201)

    @app.post(base + "/engineers/{engineer_id}")
    async def allocation_engineer_update(engineer_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        with store.connect() as con:
            write_lock(con, admin, body)
            row = engineer_row(con, engineer_id)
            if "username" in body and body["username"] != row["username"]:
                _bad("A username cannot be changed (it is the Linux account name). Deactivate this engineer and add a new one.")
            changes = {}
            if "email" in body:
                email = validate_email(body["email"])
                if email != row["email"]:
                    unique_or_conflict(con, "email", email, engineer_id)
                    changes["email"] = (row["email"], email)
            if "displayName" in body:
                display = validate_display_name(body["displayName"], row["username"])
                if display != row["display_name"]:
                    changes["display_name"] = (row["display_name"], display)
            if "sshPubkey" in body:
                if body["sshPubkey"] in (None, ""):
                    if row["ssh_pubkey"]:
                        _bad("A saved key cannot be cleared: paste a replacement, or deactivate the engineer to remove access.")
                else:
                    key = parse_public_key(body["sshPubkey"])
                    if key["line"] != row["ssh_pubkey"]:
                        key_duplicate(con, key["line"], engineer_id)
                        changes["ssh_pubkey"] = (row["ssh_pubkey"], key["line"])
            if not changes:
                return respond(con, changed=False)
            sets = ",".join(column + "=?" for column in changes) + ",updated_at=?"
            con.execute("UPDATE alloc_engineers SET " + sets + " WHERE id=?",
                        (*[new for _, new in changes.values()], int(time.time()), engineer_id))
            revision = bump_revision(con, admin["id"])
            if "ssh_pubkey" in changes:
                record_key_change(con, engineer_id, revision, "admin")
            details = {"username": row["username"], "revision": revision}
            for column, (old, new) in changes.items():
                if column == "ssh_pubkey":
                    old_key = key_summary(old)
                    details["keyFingerprint"] = {"from": old_key["fingerprint"] if old_key else None,
                                                 "to": key_summary(new)["fingerprint"]}
                else:
                    details["displayName" if column == "display_name" else column] = {"from": old, "to": new}
            store.audit(con, "alloc.engineer_update", admin["id"], engineer_id, details)
            return respond(con, changed=True)

    @app.post(base + "/engineers/{engineer_id}/status")
    async def allocation_engineer_status(engineer_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        active = body.get("active")
        if not isinstance(active, bool):
            _bad("Send active: true or false.")
        with store.connect() as con:
            write_lock(con, admin, body)
            row = engineer_row(con, engineer_id)
            if bool(row["active"]) == active:
                return respond(con, changed=False)
            if not active:
                held = [r["name"] for r in con.execute("SELECT name FROM alloc_nodes WHERE engineer_id=?", (engineer_id,)).fetchall()]
                if held:
                    held.sort(key=node_number)
                    _bad(f"{row['username']} still has {', '.join(held)}. Reassign those nodes first.", "engineer_has_nodes", 409)
            con.execute("UPDATE alloc_engineers SET active=?,updated_at=? WHERE id=?", (active, int(time.time()), engineer_id))
            revision = bump_revision(con, admin["id"])
            store.audit(con, "alloc.engineer_reactivate" if active else "alloc.engineer_deactivate", admin["id"], engineer_id,
                        {"username": row["username"], "active": {"from": not active, "to": active}, "revision": revision})
            return respond(con, changed=True)

    @app.post(base + "/nodes/{name}")
    async def allocation_node_assign(name: str, request: Request):
        admin = current_user(request, admin=True)
        if not NODE_NAME.fullmatch(name):
            _bad("Node not found.", "node_not_found", 404)
        body = await body_json(request)
        role = body.get("role")
        if role not in ROLES:
            _bad("Choose selling, engineer or reserved.")
        engineer_id = body.get("engineerId")
        if role == "engineer":
            if not isinstance(engineer_id, str):
                _bad("Choose the engineer for this node.")
        elif engineer_id not in (None, ""):
            _bad("Only an engineer node has an engineer.")
        confirm_selling = flag(body, "confirm_selling_change")
        confirm_synced = flag(body, "confirm_node_synced")
        with store.connect() as con:
            write_lock(con, admin, body)
            node = con.execute("SELECT * FROM alloc_nodes WHERE name=?", (name,)).fetchone()
            if not node:
                _bad("Node not found.", "node_not_found", 404)
            note = validate_note(body["note"]) if "note" in body else node["note"]
            engineer = None
            if role == "engineer":
                engineer = engineer_row(con, engineer_id)
                if not engineer["active"]:
                    _bad(f"{engineer['username']} is deactivated. Reactivate the engineer first.", "engineer_inactive", 409)
            new_engineer = engineer["id"] if engineer else None
            if node["role"] == role and node["engineer_id"] == new_engineer and node["note"] == note:
                return respond(con, changed=False)
            if node["role"] == "selling" and role != "selling" and not confirm_selling:
                _bad(f"{name} is a selling node serving customers. Moving it out of selling needs "
                     "confirm_selling_change: true.", "selling_change_unconfirmed", 409)
            if node["role"] == "engineer" and role == "selling":
                # ansible never touches selling nodes, so the account must be removed while reserved.
                _bad(ENGINEER_TO_SELLING, "engineer_to_selling", 409)
            meta = con.execute("SELECT last_export_revision FROM alloc_meta WHERE id=1").fetchone()
            pending_revision = node["pending_cleanup_revision"]
            pending_engineer = node["pending_cleanup_engineer_id"]
            cleanup_confirmed = None
            if node["role"] != "selling" and role == "selling" and pending_revision is not None:
                if (meta["last_export_revision"] or 0) < pending_revision:
                    _bad(f"{name} 離開工程師後還沒匯出：請先匯出 engineers.yaml（版本 ≥ {pending_revision}）並執行節點同步（4.7）。"
                         f" (Export revision {pending_revision} or later and run the node sync first.)", "node_cleanup_pending", 409)
                if not confirm_synced:
                    _bad(f"{name} 需要確認已依手冊 4.7 完成節點同步、且節點上已無工程師帳號（confirm_node_synced: true）。"
                         " (Confirm the node sync with confirm_node_synced: true.)", "node_sync_unconfirmed", 409)
                cleanup_confirmed = {"revision": pending_revision, "lastExportRevision": meta["last_export_revision"]}
            old_engineer = (con.execute("SELECT username FROM alloc_engineers WHERE id=?", (node["engineer_id"],)).fetchone()
                            if node["engineer_id"] else None)
            revision = bump_revision(con, admin["id"])
            if node["role"] == "engineer" and role == "reserved":
                pending_revision, pending_engineer = revision, node["engineer_id"]
            elif role != "reserved":
                # selling: cleanup confirmed above; engineer: the node play now owns the node again.
                pending_revision, pending_engineer = None, None
            con.execute("UPDATE alloc_nodes SET role=?,engineer_id=?,note=?,updated_at=?,updated_by=?,"
                        "pending_cleanup_revision=?,pending_cleanup_engineer_id=? WHERE name=?",
                        (role, new_engineer, note, int(time.time()), admin["id"], pending_revision, pending_engineer, name))
            if engineer:
                history = _history(engineer)
                if name not in history:
                    history = sorted(history + [name], key=node_number)
                    con.execute("UPDATE alloc_engineers SET node_history=? WHERE id=?", (json.dumps(history), engineer["id"]))
            details = {
                "from": {"role": node["role"], "engineer": old_engineer["username"] if old_engineer else None, "note": node["note"]},
                "to": {"role": role, "engineer": engineer["username"] if engineer else None, "note": note},
                "revision": revision}
            if confirm_selling and node["role"] == "selling":
                details["confirmSellingChange"] = True
            if cleanup_confirmed:
                details["confirmNodeSynced"] = cleanup_confirmed
            if pending_revision is not None and node["role"] == "engineer":
                details["pendingCleanup"] = {"revision": pending_revision, "engineer": old_engineer["username"] if old_engineer else None}
            store.audit(con, "alloc.node_assign", admin["id"], name, details)
            return respond(con, changed=True)

    @app.post(base + "/owner")
    async def allocation_owner(request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        email = validate_email(body.get("ownerEmail"))
        with store.connect() as con:
            write_lock(con, admin, body)
            meta = con.execute("SELECT owner_email FROM alloc_meta WHERE id=1").fetchone()
            if meta["owner_email"] == email:
                return respond(con, changed=False)
            con.execute("UPDATE alloc_meta SET owner_email=? WHERE id=1", (email,))
            revision = bump_revision(con, admin["id"])
            store.audit(con, "alloc.owner_update", admin["id"], "owner",
                        {"ownerEmail": {"from": meta["owner_email"], "to": email}, "revision": revision})
            return respond(con, changed=True)

    @app.get(base + "/export")
    async def allocation_export(request: Request):
        """Read-only: render the file. Recording that it was downloaded is POST …/export/mark."""
        current_user(request, admin=True)
        with store.connect() as con:
            result = build_export(con)
        if request.query_params.get("format") == "yaml":
            return PlainTextResponse(result["yaml"], media_type="application/yaml",
                                     headers={"Content-Disposition": 'attachment; filename="engineers.yaml"'})
        return {"filename": "engineers.yaml", "yaml": result["yaml"], "revision": result["revision"],
                "generatedAt": result["generatedAt"], "warnings": result["warnings"], "excluded": result["excluded"],
                "renderReady": result["renderReady"], "monitoringReady": result["monitoringReady"],
                "missingKeys": result["missingKeys"], "pendingCleanup": result["pendingCleanup"],
                "keyChanges": result["keyChanges"]}

    @app.post(base + "/export/mark")
    async def allocation_export_mark(request: Request):
        """Record that the file for `revision` was exported (gates reserved -> selling cleanup)."""
        admin = current_user(request, admin=True)
        body = await body_json(request)
        revision = body.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            _bad("revision must be the exported revision number.")
        with store.connect() as con:
            write_lock(con, admin, {})
            current = con.execute("SELECT revision, last_export_revision FROM alloc_meta WHERE id=1").fetchone()
            if revision > current["revision"]:
                _bad("That revision does not exist yet.")
            synced_keys = [r["username"] for r in con.execute(
                "SELECT username FROM alloc_engineers WHERE key_updated_revision>? AND key_updated_revision<=? ORDER BY username",
                (current["last_export_revision"] or 0, revision)).fetchall()]
            # An older download marked late never lowers the recorded export.
            recorded = max(revision, current["last_export_revision"] or 0)
            con.execute("UPDATE alloc_meta SET last_export_revision=?,last_export_at=? WHERE id=1", (recorded, int(time.time())))
            result = build_export(con)
            store.audit(con, "alloc.export", admin["id"], "revision:%d" % revision,
                        {"revision": revision, "currentRevision": current["revision"],
                         "excluded": [i["username"] for i in result["excluded"]], "missingKeys": result["missingKeys"],
                         "pendingCleanup": [p["node"] for p in result["pendingCleanup"]], "keyChanges": synced_keys})
            return respond(con)

    # ------------------------------------------------------------ engineer portal accounts (admin)

    @app.post(base + "/engineers/{engineer_id}/account")
    async def allocation_engineer_account_create(engineer_id: str, request: Request):
        """Create the engineer's portal account (role customer) and link it. The temporary
        password is returned once and stored only as a hash. An existing account with the same
        email is never linked: signup does not verify email ownership."""
        admin = current_user(request, admin=True)
        body = await body_json(request)
        password = secrets.token_urlsafe(TEMP_PASSWORD_BYTES)
        encoded = await run_in_threadpool(password_hash, password)
        user_id = uuid.uuid4().hex
        email = None
        try:
            with store.connect() as con:
                write_lock(con, admin, body)
                row = engineer_row(con, engineer_id)
                email = row["email"]
                if not row["active"]:
                    _bad(ENGINEER_INACTIVE, "engineer_inactive", 409)
                if row["user_id"]:
                    _bad(ACCOUNT_LINKED, "account_linked", 409)
                if con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
                    _bad(ACCOUNT_EXISTS.format(email=email), "account_exists", 409)
                now = int(time.time())
                con.execute("INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
                            (user_id, email, row["display_name"], encoded, "customer", now))
                con.execute("UPDATE alloc_engineers SET user_id=?,updated_at=? WHERE id=?", (user_id, now, engineer_id))
                # The export is unchanged, so the allocation revision is not bumped.
                store.audit(con, "alloc.engineer_account_create", admin["id"], engineer_id,
                            {"username": row["username"], "userId": user_id, "email": email})
                payload = respond(con, changed=True, account={"userId": user_id, "email": email},
                                  temporaryPassword=password)
        except store.IntegrityError:
            # A signup with this email raced the check above (it does not take the writer lock).
            _bad(ACCOUNT_EXISTS.format(email=email or "This email"), "account_exists", 409)
        return JSONResponse(payload, status_code=201)

    @app.post(base + "/engineers/{engineer_id}/account/unlink")
    async def allocation_engineer_account_unlink(engineer_id: str, request: Request):
        """Remove the link only; the portal account itself stays (disable it under Customers)."""
        admin = current_user(request, admin=True)
        body = await body_json(request)
        with store.connect() as con:
            write_lock(con, admin, body)
            row = engineer_row(con, engineer_id)
            if not row["user_id"]:
                return respond(con, changed=False)
            con.execute("UPDATE alloc_engineers SET user_id=NULL,updated_at=? WHERE id=?", (int(time.time()), engineer_id))
            store.audit(con, "alloc.engineer_account_unlink", admin["id"], engineer_id,
                        {"username": row["username"], "userId": row["user_id"]})
            return respond(con, changed=True)

    # ------------------------------------------------------------ engineer self-service

    def linked_engineer(con, user_id):
        return con.execute("SELECT * FROM alloc_engineers WHERE user_id=?", (user_id,)).fetchone()

    @app.get(prefix + "/me/engineer")
    async def my_engineer(request: Request):
        user = current_user(request)
        with store.connect() as con:
            row = linked_engineer(con, user["id"])
            if not row:
                _bad(NOT_ENGINEER, "not_engineer", 404)
            return self_engineer_json(con, row)

    @app.post(prefix + "/me/engineer/ssh-key")
    async def my_engineer_key(request: Request):
        """A linked engineer replaces their own SSH key. Same checks as the admin path, plus
        the account password; it reaches the machines only through the admin's export + sync."""
        user = current_user(request)
        body = await body_json(request)
        with store.connect() as con:
            row = linked_engineer(con, user["id"])
        if not row:
            _bad(NOT_ENGINEER, "not_engineer", 404)
        if not row["active"]:
            _bad(ENGINEER_INACTIVE, "engineer_inactive", 409)
        current = body.get("currentPassword")
        if not isinstance(current, str) or not 1 <= len(current) <= 128:
            _bad("The current password is incorrect.", "invalid_current_password")
        key = parse_public_key(body.get("sshPubkey"))
        scope = "engineer-key:" + digest_token(user["id"])
        if not store.consume_attempt(scope):
            _bad("Too many attempts. Please try again in 15 minutes.", "rate_limited", 429)
        account = store.find_user(user["email"])
        valid = account is not None and await run_in_threadpool(verify_password, current, account["password_hash"])
        if not valid:
            _bad("The current password is incorrect.", "invalid_current_password")
        store.clear_attempts(scope)
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            # Re-check under the writer lock: the account, the link and the engineer may have changed.
            state = con.execute("SELECT disabled_at FROM users WHERE id=?", (user["id"],)).fetchone()
            if not state or state["disabled_at"] is not None:
                _bad("This account has been disabled. Contact support.", "account_disabled", 403)
            row = linked_engineer(con, user["id"])
            if not row:
                _bad(NOT_ENGINEER, "not_engineer", 404)
            if not row["active"]:
                _bad(ENGINEER_INACTIVE, "engineer_inactive", 409)
            if key["line"] == row["ssh_pubkey"]:
                return {"changed": False, "detail": KEY_TAKES_EFFECT, "engineer": self_engineer_json(con, row)}
            key_duplicate(con, key["line"], row["id"])
            con.execute("UPDATE alloc_engineers SET ssh_pubkey=?,updated_at=? WHERE id=?", (key["line"], int(time.time()), row["id"]))
            revision = bump_revision(con, user["id"])
            record_key_change(con, row["id"], revision, "engineer")
            old = key_summary(row["ssh_pubkey"])
            store.audit(con, "alloc.engineer_key_self_update", user["id"], row["id"],
                        {"username": row["username"], "keyFingerprint": {"from": old["fingerprint"] if old else None,
                                                                         "to": key["fingerprint"]},
                         "revision": revision})
            return {"changed": True, "detail": KEY_TAKES_EFFECT, "engineer": self_engineer_json(con, linked_engineer(con, user["id"]))}
