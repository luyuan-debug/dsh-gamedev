"""Exercise the pinned real route() and FastMCP error-to-text conversion."""

import asyncio
import importlib.util
import json
from pathlib import Path
import unittest

import test_guarded_main as fixtures
import test_native_bridge as native

if importlib.util.find_spec("mcp_server") is not None:
    from fastmcp import FastMCP
    from fastmcp.client import Client
    from fastmcp.exceptions import ToolError
    from mcp_server.tools._route import route


@unittest.skipIf(native.Bridge is None, "Isolated upstream dependencies are not installed on this Python.")
class FailureOutcomeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.fixture = fixtures.GuardTests("test_native_auth_is_still_required_for_admission")
        self.fixture.setUp()
        self.bridges = []
        self.result = {
            "may_have_applied": True, "persisted": False, "partial": True,
            "completed": 2, "rollback": "failed", "failed_count": 1,
            "applied": [{"token": "synthetic-secret-not-for-output"}],
            "token": "synthetic-secret-not-for-output", "secret": "synthetic-secret-not-for-output",
            "script_content": "synthetic-secret-not-for-output" * 20000,
            "private_metadata": {"secret": "synthetic-secret-not-for-output"},
        }

    async def asyncTearDown(self):
        for bridge in self.bridges:
            await bridge.close()
        self.fixture.tearDown()

    async def bridge(self, guarded):
        class ScopedBridge(native.Bridge):
            pass
        if guarded:
            fixtures.guard.install_guard(ScopedBridge, self.fixture.target, native.ResponseEnvelope, native.ErrorCode)
        bridge = ScopedBridge(native.BridgeConfig(auth_token="native-test-token"))
        self.bridges.append(bridge)
        peer = native.MemoryPeer()
        self.assertIsNotNone(await bridge._attach(peer))
        await bridge.adopt_identity(self.fixture.identity())
        def reply(message):
            bridge._resolve(json.dumps({
                "id": message["id"], "ok": False, "error": "TIMEOUT",
                "hint": "Original upstream hint.", "required": "edited_scene",
                "result": self.result,
            }))
        peer.on_send = reply
        return bridge, peer

    async def test_pinned_original_route_drops_failure_result_baseline(self):
        bridge, peer = await self.bridge(guarded=False)
        with self.assertRaises(ToolError) as caught:
            await route(bridge, "cmd_outcome_fixture", {})
        text = str(caught.exception)
        self.assertEqual(text, "TIMEOUT: Original upstream hint. [required=edited_scene]")
        for field in ("may_have_applied", "persisted", "partial"):
            self.assertNotIn(field, text)
        self.assertEqual(len(peer.sent), 1)

    async def test_wrapper_keeps_raw_result_error_required_and_safe_text(self):
        bridge, peer = await self.bridge(guarded=True)
        response = await bridge.send("cmd_outcome_fixture", {})
        self.assertEqual(response.result, self.result)
        self.assertEqual(response.error, "TIMEOUT")
        self.assertEqual(response.required, "edited_scene")
        self.assertTrue(response.hint.startswith("Original upstream hint.\n"))
        projected = json.loads(response.hint.split("[bridge_outcome=", 1)[1][:-1])
        self.assertEqual(projected["fields"], {"may_have_applied": True, "persisted": False, "partial": True, "completed": 2, "rollback": "failed", "failed_count": 1})
        self.assertEqual(projected["omitted_fields"], ["applied"])
        self.assertNotIn("synthetic-secret", response.hint)
        self.assertNotIn("script_content", response.hint)
        self.assertNotIn("private_metadata", response.hint)
        self.assertLess(len(response.hint), 1500)
        self.assertEqual(len(peer.sent), 1)  # The wrapper never retries.
        with self.assertRaises(ToolError) as caught:
            await route(bridge, "cmd_outcome_fixture", {})
        self.assertTrue(str(caught.exception).endswith("[required=edited_scene]"))
        self.assertIn('"may_have_applied":true', str(caught.exception))
        self.assertEqual(len(peer.sent), 2)  # One send for each caller invocation.

    async def test_real_fastmcp_text_projection_retains_safe_outcome(self):
        bridge, peer = await self.bridge(guarded=True)
        server = FastMCP("Failure outcome fixture")

        @server.tool(name="outcome_fixture")
        async def outcome_fixture() -> dict:
            return await route(bridge, "cmd_outcome_fixture", {})

        async with Client(server) as client:
            result = await client.call_tool("outcome_fixture", {}, raise_on_error=False)
        self.assertTrue(result.is_error)
        text = "\n".join(block.text for block in result.content if block.type == "text")
        self.assertIn("TIMEOUT: Original upstream hint.", text)
        self.assertIn('"may_have_applied":true', text)
        self.assertIn('"persisted":false', text)
        self.assertIn('"partial":true', text)
        self.assertIn("[required=edited_scene]", text)
        self.assertNotIn("synthetic-secret", text)
        self.assertLess(len(text), 1500)
        self.assertEqual(len(peer.sent), 1)
        # This exact, small MCP text fixture is consumed by native DSH adapter
        # tests. It intentionally contains no structured/raw error result.
        path = Path(__file__).with_name("outcome-fixture.json")
        path.write_text(json.dumps({"isError": True, "content": [{"type": "text", "text": text}]}, indent=2) + "\n")

    async def test_success_unknown_metadata_and_idempotence(self):
        success = native.ResponseEnvelope.success("1", {"may_have_applied": True})
        self.assertIs(fixtures.guard._append_failure_outcome(success), success)
        self.assertIsNone(success.hint)
        response = native.ResponseEnvelope(id="2", ok=False, error="TIMEOUT", hint="kept", result={"script_content": "synthetic-secret"})
        fixtures.guard._append_failure_outcome(response)
        self.assertEqual(response.hint, "kept")
        response.result = {"may_have_applied": True}
        fixtures.guard._append_failure_outcome(response)
        first = response.hint
        fixtures.guard._append_failure_outcome(response)
        self.assertEqual(response.hint, first)
        self.assertEqual(response.result, {"may_have_applied": True})

    async def test_unsafe_outcome_values_are_explicitly_omitted(self):
        response = native.ResponseEnvelope(id="1", ok=False, error="INTERNAL_ERROR", result={
            "persisted": "synthetic-secret", "partial": {"token": "synthetic-secret"},
            "completed": float("nan"), "applied_count": 1 << 10000,
        })
        fixtures.guard._append_failure_outcome(response)
        self.assertNotIn("synthetic-secret", response.hint)
        self.assertNotIn("NaN", response.hint)
        self.assertIn('"omitted_fields":["persisted","partial","completed","applied_count"]', response.hint)
        self.assertEqual(response.result["persisted"], "synthetic-secret")
        self.assertEqual(response.result["applied_count"], 1 << 10000)


if __name__ == "__main__":
    unittest.main()
