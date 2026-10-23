"""Offline checks against the actual pinned Bridge, once root installs its venv."""

import asyncio
import importlib.util
import json
import unittest

import test_guarded_main as fixtures

guard = fixtures.guard

if importlib.util.find_spec("mcp_server") is not None:
    from mcp_server import __version__
    from mcp_server.bridge import Bridge
    from mcp_server.config import BridgeConfig
    from mcp_server.models.envelope import ErrorCode, ResponseEnvelope
else:
    Bridge = None


class MemoryPeer:
    def __init__(self, authenticated=True):
        self.messages = asyncio.Queue()
        self.messages.put_nowait(json.dumps({"command": "cmd_auth", "params": {"token": "native-test-token" if authenticated else "wrong"}}))
        self.sent = []
        self.closed = False
        self.on_send = None

    async def recv(self):
        value = await self.messages.get()
        if isinstance(value, Exception):
            raise value
        return value

    async def send(self, message):
        payload = json.loads(message)
        self.sent.append(payload)
        if self.on_send is not None:
            self.on_send(payload)

    async def close(self):
        self.closed = True
        self.messages.put_nowait(ConnectionError("closed"))


@unittest.skipIf(Bridge is None, "Isolated upstream dependencies are not installed on this Python.")
class NativeBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Reuse only fixture setup, avoiding dependence on installed credentials.
        self.fixture = fixtures.GuardTests("test_native_auth_is_still_required_for_admission")
        self.fixture.setUp()
        self.assertEqual(__version__, guard.UPSTREAM_VERSION)
        class ScopedBridge(Bridge):
            pass
        guard.install_guard(ScopedBridge, self.fixture.target, ResponseEnvelope, ErrorCode)
        self.bridge = ScopedBridge(BridgeConfig(auth_token="native-test-token", request_timeout=0.01))
        self.peer = MemoryPeer()
        self.assertIsNotNone(await self.bridge._attach(self.peer))
        await self.bridge.adopt_identity(self.fixture.identity())

    async def asyncTearDown(self):
        await self.bridge.close()
        self.fixture.tearDown()

    async def test_native_success_image_payload_and_timeout_semantics(self):
        payload = {"text": "kept", "image": {"base64": "unchanged", "mime_type": "image/png"}}
        def reply(message):
            self.bridge._resolve(json.dumps({"id": message["id"], "ok": True, "result": payload}))
        self.peer.on_send = reply
        response = await self.bridge.send("cmd_read", {"path": "res://main.tscn"}, timeout=0.5)
        self.assertIsInstance(response, ResponseEnvelope)
        self.assertTrue(response.ok)
        self.assertEqual(response.result, payload)
        self.assertEqual(self.peer.sent[-1]["params"], {"path": "res://main.tscn"})
        self.peer.on_send = None
        self.bridge.set_mutating_commands(frozenset({"cmd_mutate"}))
        timeout = await self.bridge.send("cmd_mutate", timeout=0.001)
        self.assertEqual(timeout.error, "TIMEOUT")
        self.assertEqual(timeout.result, {"may_have_applied": True})
        self.assertIn("0.001s", timeout.hint)

    async def test_native_auth_second_editor_and_reconnect(self):
        second = MemoryPeer()
        self.assertIsNone(await self.bridge._attach(second))
        self.assertTrue(second.closed)
        self.assertIs(self.bridge._conn, self.peer)
        await self.peer.close()
        await self.bridge._reader
        self.assertIsNone(self.bridge._conn)
        bad_auth = MemoryPeer(authenticated=False)
        self.assertIsNone(await self.bridge._attach(bad_auth))
        self.assertTrue(bad_auth.closed)
        next_peer = MemoryPeer()
        self.assertIsNotNone(await self.bridge._attach(next_peer))
        refused = await self.bridge.send("cmd_mutate")
        self.assertEqual(refused.error, "PRECONDITION_FAILED")
        self.assertEqual(next_peer.sent, [])
        await self.bridge.adopt_identity(self.fixture.identity(project_path=str(self.fixture.root.parent)))
        self.assertEqual((await self.bridge.send("cmd_mutate")).error, "PRECONDITION_FAILED")
        self.assertEqual(next_peer.sent, [])


if __name__ == "__main__":
    unittest.main()
