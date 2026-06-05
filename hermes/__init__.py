from __future__ import annotations

import fnmatch
import json
import os
import re
import shlex
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None

try:
    from agent.redact import redact_sensitive_text
except Exception:  # pragma: no cover
    redact_sensitive_text = None


PLUGIN_NAME = "charon"
PLUGIN_VERSION = "0.1.0"
_STATE_LOCK = threading.Lock()
_BLOCKED: dict[str, dict[str, Any]] = {}

_URL_RE = re.compile(r"""https?://[^\s'"`<>]+""")
_SECRET_REF_TEMPLATE = r"(?<![A-Za-z0-9_])(?:printenv\s+{name}\b|echo\s+\${name}\b|echo\s+\${{{name}}}\b|env\b[^\n]*\b{name}\b)"


def _hermes_home() -> Path:
    home = os.getenv("HERMES_HOME")
    if home:
        return Path(home).expanduser()
    return Path("~/.hermes").expanduser()


def _charon_dir() -> Path:
    return _hermes_home() / "charon"


def _receipt_dir() -> Path:
    return _charon_dir() / "receipts"


def _policy_path() -> Path:
    return _hermes_home() / "charon.yaml"


def _default_policy() -> dict[str, Any]:
    return {
        "mode": "strict",
        "red_lines": {
            "never_expose": [
                "GITHUB_TOKEN",
                "GH_TOKEN",
                "ANTHROPIC_API_KEY",
                "CLAUDE_CODE_OAUTH_TOKEN",
                "OPENAI_API_KEY",
            ],
            "never_read": [
                ".env",
                ".env.local",
                ".env.production",
                ".env.development",
                ".env.test",
                ".envrc",
                "~/.ssh/**",
                "~/.aws/**",
            ],
            "never_call": [
                "pastebin.com",
                "webhook.site",
            ],
            "irreversible": {
                "default": "block",
                "commands": [
                    "git push",
                    "gh pr merge",
                    "gh release create",
                    "npm publish",
                    "rm -rf",
                ],
            },
        },
        "terminal": {
            "allow_hosts": [
                "api.github.com",
            ],
        },
    }


def _ensure_dirs() -> None:
    _charon_dir().mkdir(parents=True, exist_ok=True)
    _receipt_dir().mkdir(parents=True, exist_ok=True)


def _load_policy() -> dict[str, Any]:
    path = _policy_path()
    if not path.exists():
        return _default_policy()
    text = path.read_text(encoding="utf-8")
    if yaml is None:
        return _default_policy()
    data = yaml.safe_load(text) or {}
    if not isinstance(data, dict):
        return _default_policy()
    merged = _default_policy()
    _deep_merge(merged, data)
    return merged


def _deep_merge(base: dict[str, Any], extra: dict[str, Any]) -> None:
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _get_block_reason(
    tool_name: str,
    args: dict[str, Any],
    policy: dict[str, Any],
) -> tuple[str | None, dict[str, Any] | None]:
    if tool_name == "terminal":
        command = str(args.get("command") or "")
        return _terminal_block(command, policy)

    if tool_name in {
        "read_file",
        "mcp_filesystem_read_file",
        "mcp_filesystem_read_text_file",
        "mcp_filesystem_get_file_info",
    }:
        target = _first_path(args)
        if target and _path_matches(target, _never_read(policy)):
            reason = f"Charon blocked read of red-line path: {target}"
            meta = {"kind": "file_read", "target": str(target)}
            return reason, meta

    return None, None


def _terminal_block(command: str, policy: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    lowered = command.lower()
    for blocked in _irreversible_commands(policy):
        if blocked and blocked in lowered:
            return (
                f"Charon blocked irreversible terminal command: {blocked}",
                {"kind": "irreversible", "match": blocked},
            )

    for secret_name in _never_expose(policy):
        pattern = re.compile(_SECRET_REF_TEMPLATE.format(name=re.escape(secret_name)))
        if pattern.search(command):
            return (
                f"Charon blocked secret exfil attempt for {secret_name}",
                {"kind": "secret_exfil", "secret": secret_name},
            )

    read_target = _terminal_read_target(command)
    if read_target and _path_matches(read_target, _never_read(policy)):
        return (
            f"Charon blocked terminal read of red-line path: {read_target}",
            {"kind": "file_read", "target": read_target},
        )

    denied_hosts = set(h.lower() for h in _never_call(policy))
    allowed_hosts = set(h.lower() for h in _allowed_hosts(policy))
    for host in _extract_hosts(command):
        host_l = host.lower()
        if host_l in denied_hosts:
            return (
                f"Charon blocked terminal network call to denied host: {host}",
                {"kind": "network", "host": host, "policy": "never_call"},
            )
        if allowed_hosts and host_l not in allowed_hosts:
            return (
                f"Charon blocked terminal network call to non-allowlisted host: {host}",
                {"kind": "network", "host": host, "policy": "allow_hosts"},
            )

    if "gh api" in lowered and allowed_hosts and "api.github.com" not in allowed_hosts:
        return (
            "Charon blocked gh api because api.github.com is not allowlisted",
            {"kind": "network", "host": "api.github.com", "policy": "allow_hosts"},
        )

    return None, None


def _never_expose(policy: dict[str, Any]) -> list[str]:
    return list(policy.get("red_lines", {}).get("never_expose", []) or [])


def _never_read(policy: dict[str, Any]) -> list[str]:
    return list(policy.get("red_lines", {}).get("never_read", []) or [])


def _never_call(policy: dict[str, Any]) -> list[str]:
    return list(policy.get("red_lines", {}).get("never_call", []) or [])


def _irreversible_commands(policy: dict[str, Any]) -> list[str]:
    return list(
        policy.get("red_lines", {})
        .get("irreversible", {})
        .get("commands", [])
        or []
    )


def _allowed_hosts(policy: dict[str, Any]) -> list[str]:
    return list(policy.get("terminal", {}).get("allow_hosts", []) or [])


def _extract_hosts(command: str) -> list[str]:
    hosts: list[str] = []
    for match in _URL_RE.findall(command):
        try:
            host = urlparse(match).hostname
        except Exception:
            host = None
        if host:
            hosts.append(host)
    return hosts


def _terminal_read_target(command: str) -> str | None:
    try:
        tokens = shlex.split(command)
    except Exception:
        return None
    if not tokens:
        return None
    if tokens[0] not in {"cat", "head", "tail", "grep", "sed", "awk", "less", "more"}:
        return None
    for token in tokens[1:]:
        if token.startswith("-"):
            continue
        return token
    return None


def _first_path(args: dict[str, Any]) -> str | None:
    for key in ("path", "file_path", "filepath", "target", "name"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _path_matches(target: str | Path, patterns: list[str]) -> bool:
    target_text = str(target)
    expanded = str(Path(target_text).expanduser())
    basename = Path(expanded).name
    for pattern in patterns:
        expanded_pattern = str(Path(pattern).expanduser())
        if fnmatch.fnmatch(expanded, expanded_pattern):
            return True
        if fnmatch.fnmatch(target_text, pattern):
            return True
        if basename == pattern:
            return True
    return False


def _store_block(tool_call_id: str, tool_name: str, reason: str, meta: dict[str, Any] | None) -> None:
    if not tool_call_id:
        return
    with _STATE_LOCK:
        _BLOCKED[tool_call_id] = {
            "tool_name": tool_name,
            "reason": reason,
            "meta": meta or {},
            "ts": time.time(),
        }


def _pop_block(tool_call_id: str) -> dict[str, Any] | None:
    if not tool_call_id:
        return None
    with _STATE_LOCK:
        return _BLOCKED.pop(tool_call_id, None)


def _write_receipt(
    *,
    tool_name: str,
    tool_call_id: str,
    session_id: str,
    task_id: str,
    status: str,
    event: str,
    detail: dict[str, Any] | None = None,
    redactions: int = 0,
) -> None:
    _ensure_dirs()
    stamp = int(time.time() * 1000)
    safe_tool = re.sub(r"[^a-zA-Z0-9_.-]+", "-", tool_name or "tool")
    safe_call = re.sub(r"[^a-zA-Z0-9_.-]+", "-", tool_call_id or "call")
    path = _receipt_dir() / f"{stamp}-{safe_tool}-{safe_call}.json"
    payload = {
        "plugin": PLUGIN_NAME,
        "version": PLUGIN_VERSION,
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "session_id": session_id,
        "task_id": task_id,
        "status": status,
        "event": event,
        "redactions": redactions,
        "detail": detail or {},
        "timestamp": stamp,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _force_redact(text: str, policy: dict[str, Any]) -> tuple[str, int]:
    redacted = text
    count = 0
    if redact_sensitive_text is not None:
        newer = redact_sensitive_text(redacted, force=True)
        if newer != redacted:
            count += 1
            redacted = newer
    for secret_name in _never_expose(policy):
        secret_value = os.getenv(secret_name)
        if secret_value and secret_value in redacted:
            redacted = redacted.replace(secret_value, f"[CHARON_REDACTED_{secret_name}]")
            count += 1
    return redacted, count


def _on_pre_tool_call(
    tool_name: str = "",
    args: dict[str, Any] | None = None,
    tool_call_id: str = "",
    session_id: str = "",
    task_id: str = "",
    **_: Any,
) -> dict[str, Any] | None:
    if not isinstance(args, dict):
        args = {}
    policy = _load_policy()
    reason, meta = _get_block_reason(tool_name, args, policy)
    if not reason:
        return None
    _store_block(tool_call_id, tool_name, reason, meta)
    _write_receipt(
        tool_name=tool_name,
        tool_call_id=tool_call_id,
        session_id=session_id,
        task_id=task_id,
        status="blocked",
        event="pre_tool_call",
        detail={"reason": reason, **(meta or {})},
    )
    return {"action": "block", "message": reason}


def _on_post_tool_call(
    tool_name: str = "",
    result: Any = None,
    tool_call_id: str = "",
    session_id: str = "",
    task_id: str = "",
    status: str = "",
    duration_ms: int = 0,
    **_: Any,
) -> None:
    blocked = _pop_block(tool_call_id)
    detail: dict[str, Any] = {"duration_ms": duration_ms}
    event = "post_tool_call"
    final_status = status or "ok"
    if blocked:
        detail.update(blocked.get("meta") or {})
        detail["reason"] = blocked.get("reason")
        final_status = "blocked"
    elif isinstance(result, str):
        detail["result_chars"] = len(result)
    _write_receipt(
        tool_name=tool_name,
        tool_call_id=tool_call_id,
        session_id=session_id,
        task_id=task_id,
        status=final_status,
        event=event,
        detail=detail,
    )


def _on_transform_tool_result(
    tool_name: str = "",
    result: Any = None,
    tool_call_id: str = "",
    session_id: str = "",
    task_id: str = "",
    **_: Any,
) -> str | None:
    if not isinstance(result, str):
        return None
    policy = _load_policy()
    redacted, count = _force_redact(result, policy)
    if redacted == result:
        return None
    _write_receipt(
        tool_name=tool_name,
        tool_call_id=tool_call_id,
        session_id=session_id,
        task_id=task_id,
        status="ok",
        event="transform_tool_result",
        detail={},
        redactions=count,
    )
    return redacted


def register(ctx) -> None:
    _ensure_dirs()
    if not _policy_path().exists():
        if yaml is not None:
            _policy_path().write_text(
                yaml.safe_dump(_default_policy(), sort_keys=False),
                encoding="utf-8",
            )
        else:  # pragma: no cover
            _policy_path().write_text(json.dumps(_default_policy(), indent=2), encoding="utf-8")
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("transform_tool_result", _on_transform_tool_result)
