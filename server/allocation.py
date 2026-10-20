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
import time
import uuid
from datetime import datetime, timezone

from fastapi import Request
from fastapi.responses import PlainTextResponse

from .security import normalize_email
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
# render.py's placeholder for a key that has not arrived yet: accepted by its monitoring
# commands and `check --allow-missing-keys`, refused by account creation (bastion, playbook).
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
    return email


def validate_display_name(value, fallback: str) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        return fallback
    if not isinstance(value, str) or len(value.strip()) > 80 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _bad("Enter a display name of at most 80 characters.")
    return value.strip()


def validate_note(value) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value.strip()) > NOTE_MAX or any(ord(c) < 32 or ord(c) == 127 for c in value):
        _bad("Enter a note of at most %d characters on one line." % NOTE_MAX)
    return value.strip()


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
    if len(comment) > 200:
        _bad("Shorten the key comment to at most 200 characters.")
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


# ---------------------------------------------------------------- persistence helpers

def _history(row) -> list:
    try:
        value = json.loads(row["node_history"] or "[]")
    except ValueError:
        value = []
    return [n for n in value if isinstance(n, str)]


def engineer_json(row, nodes):
    key = key_summary(row["ssh_pubkey"])
    return {"id": row["id"], "clusterId": row["cluster_id"], "username": row["username"], "email": row["email"], "displayName": row["display_name"],
            "sshPubkey": row["ssh_pubkey"], "keyFingerprint": key["fingerprint"] if key else None,
            "keyType": key["type"] if key else None, "active": bool(row["active"]), "nodes": nodes,
            "nodeHistory": _history(row), "createdAt": iso(row["created_at"]), "updatedAt": iso(row["updated_at"])}


def _snapshot(con):
    engineers = con.execute("SELECT * FROM alloc_engineers ORDER BY created_at, username").fetchall()
    nodes = sorted(con.execute("SELECT n.*,u.email AS updated_by_email FROM alloc_nodes n LEFT JOIN users u ON u.id=n.updated_by").fetchall(),
                   key=lambda r: node_number(r["name"]))
    meta = con.execute("SELECT * FROM alloc_meta WHERE id=1").fetchone()
    return engineers, nodes, meta


def state_json(con):
    engineers, nodes, meta = _snapshot(con)
    by_id = {e["id"]: e for e in engineers}
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
                   "note": n["note"], "updatedAt": iso(n["updated_at"]), "updatedBy": n["updated_by_email"]} for n in nodes],
        "engineers": [engineer_json(e, owned[e["id"]]) for e in engineers],
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
    warnings, excluded, entries, missing_keys = [], [], [], []
    for e in engineers:
        user = e["username"]
        if e["active"]:
            if not owned[e["id"]]:
                excluded.append({"username": user, "reason": "no_nodes"})
                warnings.append(f"{user}: active but has no nodes, so it is left out (render.py rejects an engineer without nodes).")
                continue
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
                        "Monitoring works (render.py check --allow-missing-keys, targets, access-emails), but account "
                        "creation (bastion 4.6, node playbook 4.7) refuses until every present engineer has a key.")
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
        "# A CHANGE_ME ssh_pubkey means the key has not arrived: monitoring may run, account",
        "# creation refuses (render.py check --allow-missing-keys vs check).",
    ]
    if excluded:
        lines.append("#")
        lines.append("# Listed in the portal but not exported (see the portal's export warnings):")
        for item in excluded:
            nodes_text = (" (" + ", ".join(item["nodes"]) + " stay unassigned)") if item.get("nodes") else ""
            lines.append(f"#   {item['username']}: {item['reason']}{nodes_text}")
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
            "renderReady": bool(entries) and bool(meta["owner_email"]) and not missing_keys,
            "monitoringReady": bool(entries) and bool(meta["owner_email"]), "missingKeys": missing_keys}


def _self_check(text, document):
    import yaml

    if yaml.safe_load(text) != document:
        raise RuntimeError("engineers.yaml export does not parse back to its intended structure")


# ---------------------------------------------------------------- routes

def attach_allocation(app, store, current_user, body_json, prefix):
    base = prefix + "/admin/allocation"

    @app.exception_handler(AllocationError)
    async def allocation_error(_request, error):
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": error.code, "detail": error.detail}, status_code=error.status)

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
            label = {"username": "username", "email": "email", "ssh_pubkey": "SSH public key"}[column]
            _bad("Another engineer already uses this " + label + ".", "engineer_conflict", 409)

    def key_duplicate(con, line, exclude_id=None):
        blob = line.split(" ")[1]
        for row in con.execute("SELECT id, ssh_pubkey FROM alloc_engineers WHERE ssh_pubkey IS NOT NULL").fetchall():
            if row["id"] != exclude_id and row["ssh_pubkey"].split(" ")[1] == blob:
                _bad("Another engineer already uses this SSH public key.", "engineer_conflict", 409)

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
            con.execute("BEGIN IMMEDIATE")
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
            store.audit(con, "alloc.engineer_create", admin["id"], engineer_id,
                        {"username": username, "clusterId": cluster_id, "email": email, "displayName": display,
                         "keyFingerprint": key["fingerprint"] if key else None, "revision": revision})
            from fastapi.responses import JSONResponse
            return JSONResponse(respond(con, engineerId=engineer_id), status_code=201)

    @app.post(base + "/engineers/{engineer_id}")
    async def allocation_engineer_update(engineer_id: str, request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
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
            con.execute("BEGIN IMMEDIATE")
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
        confirm = body.get("confirm_selling_change")
        if confirm is not None and not isinstance(confirm, bool):
            _bad("confirm_selling_change must be true or false.")
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
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
                return respond(con, changed=False, warnings=[])
            if node["role"] == "selling" and role != "selling" and confirm is not True:
                _bad(f"{name} is a selling node serving customers. Moving it out of selling needs "
                     "confirm_selling_change: true.", "selling_change_unconfirmed", 409)
            old_engineer = (con.execute("SELECT username FROM alloc_engineers WHERE id=?", (node["engineer_id"],)).fetchone()
                            if node["engineer_id"] else None)
            con.execute("UPDATE alloc_nodes SET role=?,engineer_id=?,note=?,updated_at=?,updated_by=? WHERE name=?",
                        (role, new_engineer, note, int(time.time()), admin["id"], name))
            if engineer:
                history = _history(engineer)
                if name not in history:
                    history = sorted(history + [name], key=node_number)
                    con.execute("UPDATE alloc_engineers SET node_history=? WHERE id=?", (json.dumps(history), engineer["id"]))
            revision = bump_revision(con, admin["id"])
            store.audit(con, "alloc.node_assign", admin["id"], name, {
                "from": {"role": node["role"], "engineer": old_engineer["username"] if old_engineer else None, "note": node["note"]},
                "to": {"role": role, "engineer": engineer["username"] if engineer else None, "note": note},
                "revision": revision})
            warnings = []
            if node["role"] == "engineer" and role == "selling":
                warnings.append(f"{name} was {old_engineer['username'] if old_engineer else 'an engineer'}'s node. The node playbook "
                                "never touches selling nodes, so that account stays on it: per the runbook, first export with "
                                f"{name} reserved and run the node playbook (4.7), then make it selling.")
            return respond(con, changed=True, warnings=warnings)

    @app.post(base + "/owner")
    async def allocation_owner(request: Request):
        admin = current_user(request, admin=True)
        body = await body_json(request)
        email = validate_email(body.get("ownerEmail"))
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
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
        admin = current_user(request, admin=True)
        now = int(time.time())
        with store.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            result = build_export(con, now)
            con.execute("UPDATE alloc_meta SET last_export_revision=?,last_export_at=? WHERE id=1", (result["revision"], now))
            store.audit(con, "alloc.export", admin["id"], "revision:%d" % result["revision"],
                        {"revision": result["revision"], "excluded": [i["username"] for i in result["excluded"]],
                         "renderReady": result["renderReady"], "missingKeys": result["missingKeys"]})
        if request.query_params.get("format") == "yaml":
            return PlainTextResponse(result["yaml"], media_type="application/yaml",
                                     headers={"Content-Disposition": 'attachment; filename="engineers.yaml"'})
        return {"filename": "engineers.yaml", "yaml": result["yaml"], "revision": result["revision"],
                "generatedAt": result["generatedAt"], "warnings": result["warnings"], "excluded": result["excluded"],
                "renderReady": result["renderReady"], "monitoringReady": result["monitoringReady"],
                "missingKeys": result["missingKeys"]}
