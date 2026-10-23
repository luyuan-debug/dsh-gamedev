"""Real localhost WebSockets; upstream listener, auth, reader and send methods."""

import asyncio
import importlib.util
import json
import unittest

import test_guarded_main as fixtures

if importlib.util.find_spec("mcp_server") is not None:
    from mcp_server.bridge import Bridge, _default_serve
    from mcp_server.config import BridgeConfig
    from mcp_server.models.envelope import ErrorCode, ResponseEnvelope
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed
else:
    Bridge = None


@unittest.skipIf(Bridge is None, "Isolated upstream dependencies are not installed on this Python.")
class LoopbackBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fixture = fixtures.GuardTests("test_native_auth_is_still_required_for_admission")
        self.fixture.setUp()
        class ScopedBridge(Bridge):
            pass
        fixtures.guard.install_guard(ScopedBridge, self.fixture.target, ResponseEnvelope, ErrorCode)

        async def ephemeral_listener(handler, host, port, max_size):
            # Use the actual upstream listener on a kernel-selected free port.
            return await _default_serve(handler, "127.0.0.1", 0, max_size)

        self.bridge = ScopedBridge(BridgeConfig(auth_token="loopback-test-token"), serve=ephemeral_listener)
        await self.bridge.serve()
        port = self.bridge._server.sockets[0].getsockname()[1]
        self.url = f"ws://127.0.0.1:{port}"
        self.clients = []

    async def asyncTearDown(self):
        for client in self.clients:
            await client.close()
        await self.bridge.close()
        self.fixture.tearDown()

    async def wait_until(self, predicate):
        async def wait():
            while not predicate():
                await asyncio.sleep(0.001)
        await asyncio.wait_for(wait(), timeout=1.0)

    async def editor(self, identity=True):
        client = await connect(self.url)
        self.clients.append(client)
        await client.send(json.dumps({"command": "cmd_auth", "params": {"token": "loopback-test-token"}}))
        if identity is not False:
            await client.send(json.dumps({"command": "cmd_peer_hello", "params": self.fixture.identity() if identity is True else identity}))
            await self.wait_until(lambda: self.bridge.peer_identity is not None)
        else:
            await self.wait_until(lambda: self.bridge.connected)
        return client

    async def roundtrip(self, client):
        task = asyncio.create_task(self.bridge.send("cmd_read", {"path": "res://main.tscn"}, timeout=0.5))
        command = json.loads(await asyncio.wait_for(client.recv(), timeout=0.5))
        self.assertEqual(command["command"], "cmd_read")
        self.assertEqual(command["params"], {"path": "res://main.tscn"})
        await client.send(json.dumps({"id": command["id"], "ok": True, "result": {"from_editor": "preserved"}}))
        result = await task
        self.assertTrue(result.ok)
        self.assertEqual(result.result, {"from_editor": "preserved"})

    async def test_first_editor_authenticated_hello_and_native_roundtrip(self):
        client = await self.editor()
        self.assertEqual(self.bridge.peer_identity["godot_version"], "4.7.2-stable (official)")
        self.assertTrue(self.bridge._authed)
        await self.roundtrip(client)

    async def test_second_editor_is_closed_without_replacing_first(self):
        first = await self.editor()
        owner = self.bridge._conn
        second = await connect(self.url)
        self.clients.append(second)
        try:
            await second.send(json.dumps({"command": "cmd_auth", "params": {"token": "loopback-test-token"}}))
            await second.send(json.dumps({"command": "cmd_peer_hello", "params": self.fixture.identity()}))
        except ConnectionClosed:
            pass  # Refusal may reach the client before its hello is sent.
        await asyncio.wait_for(second.wait_closed(), timeout=1.0)
        self.assertIs(self.bridge._conn, owner)
        await self.roundtrip(first)

    async def test_unknown_and_wrong_project_commands_never_reach_socket(self):
        client = await self.editor(identity=False)
        self.assertEqual((await self.bridge.send("cmd_mutate")).error, "PRECONDITION_FAILED")
        with self.assertRaises(fixtures.guard.TargetGuardError):
            await self.bridge.notify("cmd_push")
        wrong = self.fixture.identity(project_path=str(self.fixture.root.parent))
        await client.send(json.dumps({"command": "cmd_peer_hello", "params": wrong}))
        await self.wait_until(lambda: self.bridge.peer_identity == wrong)
        self.assertEqual((await self.bridge.send("cmd_mutate")).error, "PRECONDITION_FAILED")
        with self.assertRaises(fixtures.guard.TargetGuardError):
            await self.bridge.notify("cmd_push")
        with self.assertRaises(TimeoutError):
            await asyncio.wait_for(client.recv(), timeout=0.03)


if __name__ == "__main__":
    unittest.main()
