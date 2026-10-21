"""Admin Engineers overview (read-only): the 機台分配 roster joined with the gateway's cluster activity.

One GET route. The roster comes from the allocation tables and is always returned; the activity part
(GPU usage, last interactive login, firing alerts, deploy marks) comes from the gateway's
GET /api/engineers/activity and degrades to a status when the gateway is missing, old or failing.
Every field is copied through an explicit allowlist: no SSH key text, email, account, IP, command line or
token is ever part of the response. Reads are not audited (same as the other admin reads)."""
import math
import re
from urllib.parse import quote

from fastapi import Request

from .allocation import CLUSTER_ID, state_json
from .gateway import ACTIVITY_STATUSES, GatewayError
from .support import PREFIX, UNSAFE_TEXT, gateway_error_code, safe_iso

COLLECTOR_FRESH_S = 120
STALE_AFTER_S = 300
DEPLOYS_PER_ENGINEER = 10
UNMATCHED_LIMIT = 50
TEXT_MAX = 300
# Same shapes the gateway enforces; anything else is dropped and the snapshot marked truncated.
NODE = re.compile(r"^b300-[0-9]{1,3}$")
USERNAME = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$|^uid_[0-9]{1,10}$")
ALERTNAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
GPU = re.compile(r"^[0-9]{1,2}$")
MOUNTPOINT = re.compile(r"^/[^\x00-\x1f]{0,127}$")
OWNER = re.compile(r"^eng[0-9]{1,6}$")
MODEL = re.compile(r"^[A-Za-z0-9._:/-]{1,128}$")
ERROR_CODE = re.compile(r"^[a-z0-9_]{1,32}$")
SEVERITIES = ("critical", "warning", "info", "other")
ERROR_SOURCES = ("prometheus", "annotations")
# Deploy text is the engineer's own one-line note. Addresses and credential-looking values are masked so the
# page never shows an IP, a token or a --key argument even if someone typed one into `b300-mark`.
IPV4 = re.compile(r"\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]{1,5})?\b")
IPV6 = re.compile(r"(?<![0-9A-Za-z:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Za-z:])")
SECRET = re.compile(r"(?i)\b(?:sk-|glsa_|ghp_|xox[abp]-|bearer\s+)\S+|(?<![\w-])--?[a-z-]*(?:key|token|password|secret)[a-z-]*(?:[= ]\S+)?")


class _Dropped(Exception):
    """An item that does not match the expected shape."""


def _number(value, minimum=0, maximum=2 ** 53 - 1, required=True):
    if value is None and not required:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise _Dropped()
    return value


def _count(value, required=True):
    value = _number(value, required=required)
    if value is not None and value != int(value):
        raise _Dropped()
    return None if value is None else int(value)


def _text(value, pattern, required=True):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise _Dropped()
    return value


def _flag(value):
    if value is None:
        return None
    if not isinstance(value, bool):
        raise _Dropped()
    return value


def _ipv6(match):
    # "::" or five or more colons: an IPv6 address, not a clock time such as 12:30:45.
    text = match.group(0)
    return "[address]" if "::" in text or text.count(":") >= 5 else text


def _masked(value):
    return SECRET.sub("[redacted]", IPV6.sub(_ipv6, IPV4.sub("[address]", value)))


def _plain_text(value):
    if not isinstance(value, str):
        return ""
    return _masked(UNSAFE_TEXT.sub("", value.split("\n", 1)[0])[:TEXT_MAX])[:TEXT_MAX]


def _model(value):
    model = _text(value, MODEL, required=False)
    # A model id is a name like qwen3-8b or org/Model:tag, never a URL or an address.
    return None if model is None or "//" in model or _masked(model) != model else model


def _parse(items, parser, flags, dropped=None):
    """Valid rows; a dropped row sets truncated, and its (node, username) goes to `dropped` when both are strings,
    so that node shows "no data" instead of a false zero."""
    parsed = []
    for item in items if isinstance(items, list) else []:
        try:
            if not isinstance(item, dict):
                raise _Dropped()
            parsed.append(parser(item))
        except _Dropped:
            flags["truncated"] = True
            if dropped is not None and isinstance(item, dict) and isinstance(item.get("node"), str) and isinstance(item.get("username"), str):
                dropped.add((item["node"], item["username"]))
    return parsed


def _node(item):
    return {"node": _text(item.get("node"), NODE), "engineer": _text(item.get("engineer"), USERNAME, required=False),
            "up": _flag(item.get("up")), "gpu_count": _count(item.get("gpu_count"), required=False),
            "collector_ok": _flag(item.get("collector_ok")), "collector_age_s": _number(item.get("collector_age_s"), required=False)}


def _usage(item):
    return {"node": _text(item.get("node"), NODE), "username": _text(item.get("username"), USERNAME),
            # The gateway may send null for any of the three numbers (a query that returned no series).
            "gpus": _count(item.get("gpus"), required=False), "processes": _count(item.get("processes"), required=False),
            "memory_bytes": _count(item.get("memory_bytes"), required=False)}


def _login(item):
    return {"node": _text(item.get("node"), NODE), "username": _text(item.get("username"), USERNAME),
            "last_login": _number(item.get("last_login"), required=False), "sessions": _count(item.get("sessions"), required=False)}


def _alert(item):
    severity = item.get("severity")
    return {"alertname": _text(item.get("alertname"), ALERTNAME), "severity": severity if severity in SEVERITIES else "other",
            "node": _text(item.get("node"), NODE, required=False), "username": _text(item.get("username"), USERNAME, required=False),
            "gpu": _text(item.get("gpu"), GPU, required=False), "mountpoint": _text(item.get("mountpoint"), MOUNTPOINT, required=False),
            "since": _number(item.get("since"), required=False)}


def _deploy(item):
    port = item.get("port")
    return {"id": _count(item.get("id"), required=False), "at": _number(item.get("at")), "node": _text(item.get("node"), NODE, required=False),
            "owner": _text(item.get("owner"), OWNER, required=False), "user": _text(item.get("user"), USERNAME, required=False),
            "verified": item.get("verified") is True, "model": _model(item.get("model")),
            "port": None if port is None else int(_number(port, 1, 65535)), "text": _plain_text(item.get("text"))}


def _usage_json(row):
    return {"node": row["node"], "username": row["username"], "gpus": row["gpus"], "processes": row["processes"], "memoryBytes": row["memory_bytes"]}


def _login_json(row):
    return {"node": row["node"], "username": row["username"], "lastLoginAt": safe_iso(row["last_login"]), "sessions": row["sessions"]}


def _alert_json(row, reason=None):
    value = {"alertname": row["alertname"], "severity": row["severity"], "node": row["node"], "gpu": row["gpu"],
             "mountpoint": row["mountpoint"], "username": row["username"], "since": safe_iso(row["since"])}
    if reason:
        value["reason"] = reason
    return value


def _deploy_json(row, with_owner=False):
    value = {"id": row["id"], "at": safe_iso(row["at"]), "node": row["node"], "user": row["user"], "verified": row["verified"],
             "model": row["model"], "port": row["port"], "text": row["text"]}
    if with_owner:
        value["owner"] = row["owner"]
    return value


def _collector(node):
    if node is None or node["collector_ok"] is None:
        return None
    if node["collector_ok"] is False:
        return "failed"
    age = node["collector_age_s"]
    return "ok" if age is not None and age <= COLLECTOR_FRESH_S else "stale"


def _key_status(engineer):
    if not engineer.get("sshPubkey"):
        return "missing"
    return "pending" if engineer.get("keyPendingSync") else "synced"


def _grafana_url(base, username):
    if not base:
        return None
    return base.rstrip("/") + "/d/b300-engineers?var-engineer=" + quote(username, safe="") + "&from=now-24h&to=now"


def _activity_summary(activity, failure, configured):
    if not configured:
        status = "gateway_unconfigured"
    elif failure is not None:
        status = "gateway_outdated" if failure.code == "rejected" and failure.status == 404 else "gateway_error"
    else:
        status = activity["status"]
    if status.startswith("gateway_"):
        return {"status": status, "stale": False, "generatedAt": None, "ageSeconds": None, "errors": {},
                "error": gateway_error_code(failure) if status == "gateway_error" else None, "truncated": False}
    errors = activity.get("errors") if isinstance(activity.get("errors"), dict) else {}
    try:
        age = _number(activity.get("age_s"), required=False)
    except _Dropped:
        age = None
    return {"status": status,
            # The gateway sets stale when it serves an older snapshot after a failed refresh; data older
            # than STALE_AFTER_S is shown as stale whatever the flag says.
            "stale": activity.get("stale") is True or (age is not None and age > STALE_AFTER_S),
            "generatedAt": safe_iso(activity.get("generated_at")), "ageSeconds": None if age is None else round(age, 1),
            # A source the gateway reports as failed stays failed even when its code is unexpected.
            "errors": {k: errors[k] if isinstance(errors[k], str) and ERROR_CODE.fullmatch(errors[k]) else "unknown"
                       for k in ERROR_SOURCES if errors.get(k) is not None},
            "error": None, "truncated": activity.get("truncated") is True}


def _engineer_order(engineer):
    match = CLUSTER_ID.fullmatch(engineer.get("clusterId") or "")
    return (not engineer.get("active"), int(match.group(1)) if match else 10 ** 9, engineer.get("clusterId") or "")


def compose(state, activity, failure, configured, grafana_url):
    """Pure: the admin Engineers response from the allocation state and the gateway activity (or its failure)."""
    summary = _activity_summary(activity, failure, configured)
    usable = summary["status"] in ("ok", "partial") and activity is not None
    flags = {"truncated": False}
    dropped = {"gpu_usage": set(), "logins": set()}
    data = {name: _parse(activity.get(name) if usable else [], parser, flags, dropped.get(name))
            for name, parser in (("nodes", _node), ("gpu_usage", _usage), ("logins", _login), ("alerts", _alert), ("deploys", _deploy))}
    summary["truncated"] = summary["truncated"] or flags["truncated"]
    # GPU and login columns are "—" (null) when Prometheus data did not arrive; 0 only when it did.
    prometheus_ok = usable and (summary["stale"] or "prometheus" not in summary["errors"])

    prom_nodes = {n["node"]: n for n in data["nodes"]}
    usage = {(u["node"], u["username"]): u for u in data["gpu_usage"]}
    logins = {(item["node"], item["username"]): item for item in data["logins"]}
    node_owner = {}
    for node in state.get("nodes", []):
        if node.get("role") == "engineer" and node.get("engineerId"):
            node_owner[node["name"]] = node["engineerId"]

    engineers, claimed_usage, claimed_logins = [], set(), set()
    for engineer in state.get("engineers", []):
        username = engineer["username"]
        names = [name for name, owner in node_owner.items() if owner == engineer["id"]]
        nodes = []
        for name in names:
            prom = prom_nodes.get(name)
            used, login = usage.get((name, username)), logins.get((name, username))
            # A row the gateway sent but that failed validation is "no data" for this node, not a zero.
            usage_known = prometheus_ok and (name, username) not in dropped["gpu_usage"]
            login_known = prometheus_ok and (name, username) not in dropped["logins"]
            claimed_usage.add((name, username))
            claimed_logins.add((name, username))
            nodes.append({"name": name, "up": prom["up"] if prom else None, "gpuCount": prom["gpu_count"] if prom else None,
                          "collector": _collector(prom), "labelEngineer": prom["engineer"] if prom else None,
                          "labelMatches": (prom["engineer"] == username) if prom else None,
                          "gpusInUse": used["gpus"] if used else (0 if usage_known else None),
                          "processes": used["processes"] if used else (0 if usage_known else None),
                          "memoryBytes": used["memory_bytes"] if used else (0 if usage_known else None),
                          "lastLoginAt": safe_iso(login["last_login"]) if login else None,
                          "sessions": login["sessions"] if login and login["sessions"] is not None else (0 if login_known else None)})
        usage_total = prometheus_ok and not any((n, username) in dropped["gpu_usage"] for n in names)
        login_times = [login["last_login"] for login in (logins.get((n, username)) for n in names) if login and login["last_login"] is not None]
        alerts = []
        for alert in data["alerts"]:
            if alert["username"] == username:
                alerts.append(_alert_json(alert, "user"))
            elif alert["node"] in names:
                alerts.append(_alert_json(alert, "node"))
        deploys = sorted((d for d in data["deploys"] if d["owner"] is not None and d["owner"] == engineer["clusterId"]),
                         key=lambda d: d["at"], reverse=True)[:DEPLOYS_PER_ENGINEER]
        engineers.append({
            "id": engineer["id"], "clusterId": engineer["clusterId"], "username": username, "displayName": engineer["displayName"],
            "active": bool(engineer["active"]), "keyStatus": _key_status(engineer),
            "keyFingerprint": engineer.get("keyFingerprint"), "keyType": engineer.get("keyType"),
            "grafanaUrl": _grafana_url(grafana_url, username),
            "lastLoginAt": safe_iso(max(login_times)) if login_times else None,
            "loggedIn": any((n["sessions"] or 0) > 0 for n in nodes) if prometheus_ok else None,
            "gpusInUse": sum(n["gpusInUse"] or 0 for n in nodes) if usage_total else None,
            "memoryBytes": sum(n["memoryBytes"] or 0 for n in nodes) if usage_total else None,
            "nodes": nodes, "alerts": alerts, "deploys": [_deploy_json(d) for d in deploys]})
    engineers.sort(key=_engineer_order)

    usernames = {e["username"] for e in engineers}
    cluster_ids = {e["clusterId"] for e in engineers}
    unmatched = {
        "gpuUsage": [_usage_json(u) for u in data["gpu_usage"] if (u["node"], u["username"]) not in claimed_usage],
        "logins": [_login_json(item) for item in data["logins"] if (item["node"], item["username"]) not in claimed_logins],
        "alerts": [_alert_json(a) for a in data["alerts"] if a["username"] not in usernames and a["node"] not in node_owner],
        "deploys": [_deploy_json(d, with_owner=True) for d in sorted(data["deploys"], key=lambda d: d["at"], reverse=True)
                    if d["owner"] not in cluster_ids],
    }
    for name, items in unmatched.items():
        if len(items) > UNMATCHED_LIMIT:
            unmatched[name] = items[:UNMATCHED_LIMIT]
            summary["truncated"] = True
    return {"gatewayConfigured": bool(configured), "activity": summary, "lastExport": state.get("lastExport"),
            "engineers": engineers, "unmatched": unmatched}


def attach_admin_engineers(application, ctx):
    @application.get(PREFIX + "/admin/engineers")
    async def admin_engineers(request: Request):
        ctx.current_user(request, admin=True)
        with ctx.store.connect() as con:
            state = state_json(con)
        activity, failure = None, None
        configured = bool(ctx.gateway.configured)
        if configured:
            try:
                activity = await ctx.gateway.engineer_activity()
            except GatewayError as error:
                failure = error
            except (TypeError, ValueError, KeyError, AttributeError):
                # A malformed payload must never take the roster down with it.
                activity, failure = None, GatewayError("invalid_response")
            else:
                status = activity.get("status") if isinstance(activity, dict) else None
                if not isinstance(status, str) or status not in ACTIVITY_STATUSES:
                    activity, failure = None, GatewayError("invalid_response")
        return compose(state, activity, failure, configured, ctx.settings.grafana_url)
