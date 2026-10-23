"""Publication gate regressions; all injected values are synthetic and temporary."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publication_scan', Path(__file__).resolve().parents[2] / 'scripts/scan_publication.py')
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class PublicationScanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return path

    def rules(self):
        return {finding['rule'] for finding in scanner.scan(self.root)['findings']}

    def test_literal_environment_reference_and_public_pin_are_not_credentials(self):
        self.write('README.md', 'export GODOT_MCP_BRIDGE_TOKEN="$DSH_GAMEDEV_BRIDGE_TOKEN"\n'
                   'https://github.com/hybridindie/godot-mcp/releases/tag/2026.10.20.1\n'
                   'sha256=' + 'a' * 64 + '\n')
        self.assertEqual(self.rules(), set())

    def test_actual_key_format_is_detected_even_in_a_test_file(self):
        value = 'gh' + 'p_' + 'a' * 36
        self.write('tests/bridge/test_native_bridge.py', 'value = "' + value + '"')
        result = scanner.scan(self.root)
        self.assertIn('github-token', {x['rule'] for x in result['findings']})
        self.assertNotIn(value, json.dumps(result))

    def test_exact_synthetic_test_token_allowed_only_in_its_known_file(self):
        field = 'auth_' + 'token'
        self.write('tests/bridge/test_native_bridge.py', json.dumps({field: 'native-test-token'}))
        self.assertEqual(self.rules(), set())
        self.write('src/runtime.py', json.dumps({field: 'native-test-token'}))
        self.assertIn('inline-credential-review', self.rules())

    def test_unknown_secret_in_known_fixture_is_not_whitelisted(self):
        field = 'auth_' + 'token'
        self.write('tests/bridge/test_native_bridge.py', json.dumps({field: 'unknown-synthetic-value'}))
        self.assertIn('inline-credential-review', self.rules())

    def test_setup_redaction_url_exception_is_exact_and_file_scoped(self):
        value = ':'.join(('http', '//localhost/?token=private&ok=1'))
        self.write('tests/setup.test.mjs', value)
        self.assertEqual(self.rules(), set())
        self.write('README.md', value)
        self.assertIn('credentialed-or-token-url', self.rules())
        (self.root / 'README.md').unlink()
        self.write('tests/setup.test.mjs', value + 'changed')
        self.assertIn('credentialed-or-token-url', self.rules())

    def test_secret_url_is_redacted_and_public_downloads_are_allowed(self):
        injected = 'synthetic-value-never-print'
        value = 'https://github.com/example/repo?token=' + injected
        self.write('README.md', value)
        result = scanner.scan(self.root)
        self.assertIn('credentialed-or-token-url', {x['rule'] for x in result['findings']})
        self.assertNotIn(injected, json.dumps(result))

    def test_private_endpoint_and_personal_home_path_are_detected(self):
        self.write('README.md', 'http://' + 'private-internal.example.net' + '/mcp\n/' + 'Users/' + 'private-person/project\n')
        self.assertTrue({'url-host-review', 'private-home-path'} <= self.rules())

    def test_caches_archives_and_oversize_files_are_detected_even_when_ignored(self):
        self.write('.gitignore', 'node_modules/\n*.whl\n')
        self.write('node_modules/pkg/package.json', '{}')
        self.write('vendor/package.whl', 'not a real wheel')
        self.write('large.txt', 'x' * 100)
        result = scanner.scan(self.root, max_bytes=50)
        self.assertTrue({'private-or-generated-directory', 'binary-or-archive-forbidden', 'large-file'} <= {x['rule'] for x in result['findings']})

    def test_symlinks_never_follow_external_files(self):
        outside = self.root.parent / ('outside-' + self.root.name)
        outside.write_text('not-public')
        try:
            (self.root / 'link').symlink_to(outside)
            self.assertEqual(self.rules(), {'symlink-forbidden'})
            self.assertEqual(scanner.scan(self.root)['filesScanned'], 0)
        finally:
            outside.unlink()

    def test_scan_is_read_only_and_deterministic(self):
        path = self.write('src/a.ts', 'export const value = 42;\n')
        before = path.stat().st_mtime_ns, path.read_bytes()
        first, second = scanner.scan(self.root), scanner.scan(self.root)
        self.assertEqual(first, second)
        self.assertEqual((path.stat().st_mtime_ns, path.read_bytes()), before)


if __name__ == '__main__':
    unittest.main()
