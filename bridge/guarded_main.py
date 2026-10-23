"""Run the pinned, unmodified Godot MCP server with target admission guards.

This is an accidental cross-editor protection, not a sandbox against malicious
local processes: the upstream authenticated addon announces its own identity.
No MCP tools, schemas, transports, or timeout code are replaced. Known safe
failure-outcome flags are copied into hint text before upstream drops result.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import wraps
from importlib.metadata import version
import json
import logging
import math
import os
from pathlib import Path
import re
from typing import Any, Mapping

UPSTREAM_VERSION = "2026.10.20.1"
GODOT_VERSION = "4.7.2"
# Engine.get_version_info()["string"] uses "4.7.2-stable (official)";
# the CLI uses "4.7.2.stable.mono.official.<hash>". Pin the same stable build.
_ENGINE = re.compile(r"4\.7\.2(?:\.stable(?:\.[A-Za-z0-9_-]+)*|-stable(?: \([A-Za-z0-9 ._-]+\))?)?")
_LOG = logging.getLogger(__name__)
_OUTCOME_FIELDS = (
    "may_have_applied", "persisted", "partial", "partial_success", "applied",
    "rollback", "completed", "failed", "succeeded", "rolled_back",
    "rollback_failed", "skipped", "count", "total", "cancelled",
    "completed_count", "failed_count", "applied_count",
)
_OUTCOME_STATES = frozenset({
    "complete", "completed", "partial", "failed", "succeeded", "success",
    "rolled_back", "rollback_failed", "not_started", "not_attempted", "unknown",
    "pending", "cancelled", "canceled", "skipped", "applied", "not_applied",
    "persisted", "not_persisted", "none", "true", "false",
})


def _append_failure_outcome(response: Any) -> Any:
    """Bounded allowlist projection; never serialize scripts or arbitrary metadata.

    Keep response.result untouched. Only known scalar outcome values enter hint;
    known complex/unsafe fields are named as omitted, not claimed as preserved.
    Unknown fields are ignored without walking their possibly large contents.
    """
    if getattr(response, "ok", None) is not False or not isinstance(response.result, dict):
        return response
    fields, omitted = {}, []
    for key in _OUTCOME_FIELDS:
        if key not in response.result:
            continue
        value = response.result[key]
        safe = value is None or type(value) is bool
        safe |= type(value) is int and value.bit_length() <= 64
        safe |= type(value) is float and math.isfinite(value)
        safe |= type(value) is str and len(value) <= 32 and value.lower() in _OUTCOME_STATES
        if safe:
            fields[key] = value
        else:
            omitted.append(key)
    if fields or omitted:
        projection = {"fields": fields}
        if omitted:
            projection["omitted_fields"] = omitted
        suffix = "[bridge_outcome=" + json.dumps(projection, sort_keys=True, separators=(",", ":"), allow_nan=False) + "]"
        hint = response.hint or ""
        if not hint.endswith(suffix):
            response.hint = hint + ("\n" if hint else "") + suffix
    return response


class TargetGuardError(RuntimeError):
    """A controlled diagnostic; never includes peer input or secret values."""


@dataclass(frozen=True)
class Target:
    """Immutable target, shared by all bridge instances of one launcher."""

    project: Path

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> Target:
        try:
            root = Path(env["DSH_GAMEDEV_PROJECT_ROOT"])
            upstream = Path(env["GODOT_MCP_PROJECT_DIR"])
            if not root.is_absolute() or not upstream.is_absolute():
                raise ValueError
            root = root.resolve(strict=True)
            if upstream.resolve(strict=True) != root or not (root / "project.godot").is_file():
                raise ValueError
        except (KeyError, OSError, ValueError, RuntimeError):
            raise TargetGuardError("Project environment must name the same existing Godot project.") from None
        if not env.get("GODOT_MCP_BRIDGE_TOKEN", "").strip():
            raise TargetGuardError("GODOT_MCP_BRIDGE_TOKEN must be configured.")
        return cls(root)

    def refusal(self, bridge: Any) -> str | None:
        """Synchronous: no event-loop handoff before upstream captures _conn."""
        if bridge._conn is None:
            return None  # Preserve upstream's disconnected result and notify no-op.
        identity = bridge.peer_identity
        if not isinstance(identity, dict):
            return "Godot target identity is unavailable; wait for its authenticated hello."
        try:
            path = identity.get("project_path")
            if not isinstance(path, str) or not Path(path).is_absolute():
                raise ValueError
            if Path(path).resolve(strict=True) != self.project:
                return "Godot target project does not match the locked project."
        except (OSError, ValueError, RuntimeError):
            return "Godot target project identity is invalid."
        engine = identity.get("godot_version")
        if not isinstance(engine, str) or not _ENGINE.fullmatch(engine):
            return "Godot target engine must be pinned to 4.7.2 stable."
        if identity.get("addon_version") != UPSTREAM_VERSION:
            return "Godot target addon must be pinned to 2026.10.20.1."
        return None


def install_guard(bridge_type: type, target: Target, response_type: Any, error_code: Any) -> None:
    """Wrap three entry points; admitted calls continue through original code.

    The admission lock covers the upstream auth/adoption await points. It never
    holds a send/response lock, so upstream's on_peer_ready callbacks still work.
    A connected peer owns the slot until upstream detects its disconnect.
    """
    if "_dsh_target_guard" in bridge_type.__dict__:
        raise TargetGuardError("Target guard is already installed; restart to change the target.")
    original_send, original_notify, original_attach = (
        bridge_type.send, bridge_type.notify, bridge_type._attach
    )

    @wraps(original_send)
    async def send(self: Any, command: str, params: Any = None, timeout: Any = None) -> Any:
        reason = target.refusal(self)
        if reason is not None:
            return response_type.failure("-", error_code.PRECONDITION_FAILED, reason, "target_identity")
        # Do not insert an await between the check and entering upstream send:
        # its first statements synchronously capture this exact connection.
        return _append_failure_outcome(await original_send(self, command, params, timeout))

    @wraps(original_notify)
    async def notify(self: Any, command: str, params: Any = None) -> Any:
        reason = target.refusal(self)
        if reason is not None:
            raise TargetGuardError(reason)
        return await original_notify(self, command, params)

    @wraps(original_attach)
    async def attach(self: Any, conn: Any) -> Any:
        # Creation and lookup are synchronous on upstream's one event loop.
        lock = self.__dict__.setdefault("_dsh_admission_lock", asyncio.Lock())
        async with lock:
            if self._conn is not None:
                _LOG.warning("Godot bridge admission refused: a single editor already owns this bridge.")
                await conn.close()
                return None
            # The original _attach retains token auth, identity reset, reader,
            # pending-request handling, and on_peer_ready callback behavior.
            return await original_attach(self, conn)

    bridge_type.send, bridge_type.notify, bridge_type._attach = send, notify, attach
    bridge_type._dsh_target_guard = target


def main() -> None:
    target = Target.from_env()
    if version("godot-editor-mcp") != UPSTREAM_VERSION:
        raise TargetGuardError("Install the pinned godot-editor-mcp 2026.10.20.1 distribution.")
    from mcp_server import __version__
    from mcp_server.bridge import Bridge
    from mcp_server.models.envelope import ErrorCode, ResponseEnvelope

    if __version__ != UPSTREAM_VERSION:
        raise TargetGuardError("The imported Godot MCP source does not match the pinned version.")
    install_guard(Bridge, target, ResponseEnvelope, ErrorCode)
    from mcp_server.main import main as upstream_main

    upstream_main()


if __name__ == "__main__":
    main()
