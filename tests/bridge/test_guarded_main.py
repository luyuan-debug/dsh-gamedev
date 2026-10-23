"""Standard-library tests; neither dependencies nor a real server are started."""

from __future__ import annotations

import asyncio
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

PACKAGE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("guarded_main", PACKAGE / "bridge/guarded_main.py")
guard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guard
spec.loader.exec_module(guard)


class Response:
    @staticmethod
    def failure(identifier, error, hint, required):
        return {"id": identifier, "error": error, "hint": hint, "required": required}


class Peer:
    def __init__(self, *, authenticated=True):
        self.closed = False
        self.authenticated = authenticated

    async def close(self):
        self.closed = True


def bridge_type():
    """Each test gets fresh, patchable stand-ins with an upstream-shaped seam."""
    class Bridge:
        def __init__(self):
            self._conn = None
            self.peer_identity = None
            self.auth_started = asyncio.Event()
            self.finish_auth = asyncio.Event()
            self.finish_auth.set()
            self.auth_calls = 0
            self.sent = []
            self.notifications = []
            self.result = object()

        async def send(self, command, params=None, timeout=None):
            conn = self._conn
            self.sent.append((conn, command, params, timeout))
            await asyncio.sleep(0)
            return self.result

        async def notify(self, command, params=None):
            conn = self._conn
            self.notifications.append((conn, command, params))
            await asyncio.sleep(0)

        async def _attach(self, conn):
            self.auth_calls += 1
            self.auth_started.set()
            await self.finish_auth.wait()
            if not conn.authenticated:
                await conn.close()
                return None
            self.peer_identity = None
            self._conn = conn
            return conn

    return Bridge


class GuardTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        (self.root / "project.godot").write_text("config_version=5\n")
        self.env = {
            "DSH_GAMEDEV_PROJECT_ROOT": str(self.root),
            "GODOT_MCP_PROJECT_DIR": str(self.root),
            "GODOT_MCP_BRIDGE_TOKEN": "private-test-value-do-not-echo",
        }
        self.target = guard.Target.from_env(self.env)
        self.Bridge = bridge_type()
        guard.install_guard(self.Bridge, self.target, Response, SimpleNamespace(PRECONDITION_FAILED="PRECONDITION_FAILED"))
        self.bridge = self.Bridge()
        self.peer = Peer()
        self.bridge._conn = self.peer
        self.bridge.peer_identity = self.identity()

    def tearDown(self):
        self.temp.cleanup()

    def identity(self, **changes):
        return {
            "project_path": str(self.root),
            "godot_version": "4.7.2-stable (official)",
            "addon_version": guard.UPSTREAM_VERSION,
            **changes,
        }

    async def test_original_result_and_timeout_are_unmodified(self):
        params = {"value": 42}
        result = await self.bridge.send("cmd_test", params, timeout=0.17)
        self.assertIs(result, self.bridge.result)
        self.assertEqual(self.bridge.sent[0], (self.peer, "cmd_test", params, 0.17))
        await self.bridge.notify("cmd_notify", params)
        self.assertEqual(self.bridge.notifications[0], (self.peer, "cmd_notify", params))

    async def test_wrong_project_and_missing_identity_never_dispatch(self):
        other = self.root / "other"
        other.mkdir()
        for identity in (None, {}, self.identity(project_path=str(other))):
            self.bridge.peer_identity = identity
            result = await self.bridge.send("cmd_mutation")
            self.assertEqual(result["error"], "PRECONDITION_FAILED")
            with self.assertRaises(guard.TargetGuardError):
                await self.bridge.notify("cmd_push")
        self.assertEqual(self.bridge.sent, [])
        self.assertEqual(self.bridge.notifications, [])

    async def test_versions_are_pinned(self):
        identities = [
            self.identity(godot_version="4.7.20.stable"),
            self.identity(godot_version="4.8.0.stable"),
            self.identity(godot_version="4.7.2.rc1"),
            self.identity(godot_version="4.7.2-stablex"),
            self.identity(addon_version="2026.10.21"),
            self.identity(addon_version=None),
        ]
        for identity in identities:
            self.bridge.peer_identity = identity
            result = await self.bridge.send("cmd_test")
            self.assertEqual(result["error"], "PRECONDITION_FAILED")
        self.assertEqual(self.bridge.sent, [])
        for engine in ("4.7.2", "4.7.2.stable.mono.official.ed1daf0bf", "4.7.2-stable (official)"):
            self.bridge.peer_identity = self.identity(godot_version=engine)
            self.assertIs(await self.bridge.send("cmd_test"), self.bridge.result)

    async def test_realpath_alias_is_the_same_project(self):
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        self.bridge.peer_identity = self.identity(project_path=str(alias))
        self.assertIs(await self.bridge.send("cmd_test"), self.bridge.result)

    async def test_invalid_path_fails_closed(self):
        link = self.root / "loop"
        link.symlink_to(link)
        for path in ("relative/path", str(link), "\x00bad"):
            self.bridge.peer_identity = self.identity(project_path=path)
            result = await self.bridge.send("cmd_test")
            self.assertEqual(result["error"], "PRECONDITION_FAILED")
        self.assertEqual(self.bridge.sent, [])

    async def test_second_editor_cannot_replace_owner(self):
        second = Peer()
        with self.assertLogs("guarded_main", level="WARNING") as messages:
            self.assertIsNone(await self.bridge._attach(second))
        self.assertIn("a single editor already owns this bridge", messages.output[0])
        self.assertTrue(second.closed)
        self.assertFalse(self.peer.closed)
        self.assertIs(self.bridge._conn, self.peer)
        self.assertEqual(self.bridge.auth_calls, 0)

    async def test_simultaneous_admission_has_one_winner(self):
        self.bridge._conn = None
        self.bridge.finish_auth.clear()
        first, second = Peer(), Peer()
        first_task = asyncio.create_task(self.bridge._attach(first))
        await self.bridge.auth_started.wait()
        second_task = asyncio.create_task(self.bridge._attach(second))
        await asyncio.sleep(0)
        self.assertEqual(self.bridge.auth_calls, 1)
        self.bridge.finish_auth.set()
        winner, loser = await asyncio.gather(first_task, second_task)
        self.assertIs(winner, first)
        self.assertIsNone(loser)
        self.assertTrue(second.closed)
        self.assertIs(self.bridge._conn, first)
        self.assertEqual(self.bridge.auth_calls, 1)

    async def test_native_auth_is_still_required_for_admission(self):
        self.bridge._conn = None
        denied = Peer(authenticated=False)
        self.assertIsNone(await self.bridge._attach(denied))
        self.assertTrue(denied.closed)
        self.assertIsNone(self.bridge._conn)
        admitted = Peer()
        self.assertIs(await self.bridge._attach(admitted), admitted)
        self.assertEqual(self.bridge.auth_calls, 2)

    async def test_reconnect_resets_identity_and_rechecks_project(self):
        self.bridge._conn = None  # Upstream reader observed a disconnect.
        reconnected = Peer()
        self.assertIs(await self.bridge._attach(reconnected), reconnected)
        self.assertEqual((await self.bridge.send("cmd_test"))["error"], "PRECONDITION_FAILED")
        self.bridge.peer_identity = self.identity(project_path=str(self.root.parent))
        self.assertEqual((await self.bridge.send("cmd_test"))["error"], "PRECONDITION_FAILED")
        self.bridge.peer_identity = self.identity()
        self.assertIs(await self.bridge.send("cmd_test"), self.bridge.result)
        self.assertIs(self.bridge.sent[0][0], reconnected)

    async def test_check_and_original_connection_capture_have_no_yield(self):
        async def change_identity():
            self.bridge.peer_identity = self.identity(project_path=str(self.root.parent))
        mutation = asyncio.create_task(change_identity())
        self.assertIs(await self.bridge.send("cmd_test"), self.bridge.result)
        await mutation
        self.assertIs(self.bridge.sent[0][0], self.peer)
        self.assertEqual((await self.bridge.send("cmd_test"))["error"], "PRECONDITION_FAILED")

    async def test_disconnected_behavior_is_delegated(self):
        self.bridge._conn = None
        self.bridge.peer_identity = None
        self.assertIs(await self.bridge.send("cmd_test"), self.bridge.result)
        await self.bridge.notify("cmd_notify")
        self.assertEqual(len(self.bridge.sent), 1)
        self.assertEqual(len(self.bridge.notifications), 1)

    async def test_target_cannot_be_rebound(self):
        with self.assertRaises(guard.TargetGuardError):
            guard.install_guard(self.Bridge, self.target, Response, None)
        with self.assertRaises(AttributeError):
            self.target.project = self.root.parent

    async def test_errors_and_output_do_not_echo_secrets_or_peer_input(self):
        capture = io.StringIO()
        secret = self.env["GODOT_MCP_BRIDGE_TOKEN"]
        with redirect_stdout(capture), redirect_stderr(capture):
            self.bridge.peer_identity = self.identity(project_path=secret)
            result = await self.bridge.send("cmd_test")
            with self.assertRaises(guard.TargetGuardError) as raised:
                await self.bridge.notify("cmd_test")
        self.assertNotIn(secret, json.dumps(result) + str(raised.exception) + capture.getvalue())
        bad_env = {**self.env, "GODOT_MCP_PROJECT_DIR": secret}
        with self.assertRaises(guard.TargetGuardError) as raised:
            guard.Target.from_env(bad_env)
        self.assertNotIn(secret, str(raised.exception))

    def test_launcher_requires_project_and_auth_environment(self):
        for key in self.env:
            env = dict(self.env)
            del env[key]
            with self.assertRaises(guard.TargetGuardError):
                guard.Target.from_env(env)

    def test_upstream_files_still_match_pinned_wheel(self):
        work = PACKAGE.parent
        wheel = work / "upstream/godot_editor_mcp-2026.10.20.1-py3-none-any.whl"
        source = work / "bridge-source"
        if not wheel.exists() or not source.exists():
            self.skipTest("Pinned upstream extraction is an integration-workspace fixture.")
        with zipfile.ZipFile(wheel) as archive:
            files = [name for name in archive.namelist() if name.startswith("mcp_server/") and not name.endswith("/")]
            self.assertGreater(len(files), 100)
            for name in files:
                self.assertEqual((source / name).read_bytes(), archive.read(name), name)


if __name__ == "__main__":
    unittest.main()
