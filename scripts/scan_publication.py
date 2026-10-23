#!/usr/bin/env python3
"""Read-only source publication gate. JSON stdout never contains a matched value.

Scan the exact clean export, not the developer's workspace. This deliberately
does not respect .gitignore: an accidentally copied ignored file is a failure.
Use --tracked only for an already reviewed Git tree. Heuristics cannot certify
that arbitrary text contains no personal data; a human manifest review remains
necessary. No network calls and no file modifications are made.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
from urllib.parse import urlsplit, parse_qsl

FORBIDDEN_DIRS = {
    'node_modules', 'dist', 'build', 'coverage', '__pycache__', '.godot', '.cache', '.npm', '.pnpm-store',
    '.venv', 'venv', '.dsh', 'dsh-home', 'agents-home', 'profiles', 'sessions',
    'editor_data', 'export_templates', 'evidence', 'outputs', 'work',
}
ARCHIVES = {'.tgz', '.zip', '.whl', '.dmg', '.pkg', '.7z', '.tar', '.gz'}
BINARY = {'.exe', '.dll', '.dylib', '.so', '.pck', '.sqlite', '.db', '.har'}
FORBIDDEN_NAMES = {'.private-ui-url', '.credentials.yaml', '.credentials.yml',
                   '.env', 'auth-readonly.mjs', 'native-action.mjs', 'native-driver.mjs',
                   'acceptance-results.json'}
PUBLIC_HOSTS = {
    'github.com', 'api.github.com', 'raw.githubusercontent.com',
    'pypi.org', 'files.pythonhosted.org', 'docs.pypi.org',
    'registry.npmjs.org', 'registry.npmmirror.com',
    'godotengine.org', 'docs.godotengine.org', 'json-schema.org', 'www.w3.org',
}
TEST_HOSTS = {'example.com', '127.0.0.1.example.com', 'remote.invalid', 'remote.example'}
KEY_PATTERNS = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----'),
    'github-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b'),
    'provider-key': re.compile(r'\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b'),
    'jwt': re.compile(r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'),
}
PRIVATE_PATH = re.compile(r'(?:/(?:Users|home)/[^/\s"\'<>]+(?:/|\b)|[A-Za-z]:[\\/]Users[\\/][^\\/\s"\'<>]+|' + '/private/' + 'var/folders/)')
EMAIL = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')
# A quoted *value*, not a variable/property name or environment reference.
ASSIGNMENT = re.compile(r'''(?ix)
    ["']?(?P<key>(?:[a-z][a-z0-9_\-]*_)?(?:api[_\-]?key|authorization|access[_\-]?token|auth[_\-]?token|bridge[_\-]?token|password|client[_\-]?secret|token|secret))["']?
    \s*[:=]\s*["'](?P<value>[^"'\r\n]{1,})["']
''')
URL = re.compile(r'(?:https?|wss?)://[^\s<>"\'`，、。]+')
SENSITIVE_QUERY = re.compile(r'(?i)(?:token|api[_-]?key|secret|password|authorization|code|signature|credential)')
ENV_VALUE = re.compile(r'\$\{?[A-Z][A-Z0-9_]*\}?\Z')

# Exact finite synthetic values in committed test code only. Never exempt an
# entire test file, a prefix such as sk-, or arbitrary high-entropy strings.
TEST_LITERALS = {
    'tests/bridge/test_guarded_main.py': {'private-test-value-do-not-echo', 'synthetic-secret', 'synthetic-secret-not-for-output'},
    'tests/bridge/test_native_bridge.py': {'native-test-token', 'wrong'},
    'tests/bridge/test_loopback_bridge.py': {'loopback-test-token', 'wrong-token'},
    'tests/bridge/test_failure_outcome.py': {'native-test-token', 'synthetic-secret-not-for-output', 'synthetic-secret'},
    'tests/config.test.mjs': {'secret'},
}
TEST_URLS = {
    'tests/setup.test.mjs': {
        ':'.join(('http', '//localhost/?token=private&ok=1')),
    },
    'tests/config.test.mjs': {
        ':'.join(('http', '//user:secret@127.0.0.1:19876/mcp')),
        ':'.join(('ws', '//user:secret@127.0.0.1:19876')),
        ':'.join(('http', '//127.0.0.1:19876/mcp?token=x')),
    },
}


def digest(value: str | bytes) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def scan(root: Path, *, tracked=False, max_bytes=2 * 1024 * 1024) -> dict:
    root = root.resolve()
    findings, allowed, manifest = [], [], []

    def add(path, rule, line=None, match=None, detail=None):
        item = {'path': path, 'rule': rule}
        if line is not None:
            item['line'] = line
        if match is not None:
            item['matchSha256'] = digest(match)  # No raw secret, path or URL.
        if detail:
            item['detail'] = detail
        findings.append(item)

    def permit(path, rule, line):
        allowed.append({'path': path, 'rule': rule, 'line': line})

    if tracked:
        result = subprocess.run(['git', '-C', str(root), 'ls-files', '-z'], check=True, capture_output=True)
        entries = [root / os.fsdecode(p) for p in result.stdout.split(b'\0') if p]
    else:
        entries = []
        for current, directories, files in os.walk(root, followlinks=False):
            directories[:] = sorted(d for d in directories if d != '.git')
            entries.extend(Path(current) / f for f in files)
            for name in directories[:]:
                path = Path(current) / name
                if path.is_symlink():
                    entries.append(path)
                    directories.remove(name)

    for path in sorted(entries):
        rel = path.relative_to(root).as_posix()
        parts = PurePosixPath(rel).parts
        if path.is_symlink():
            add(rel, 'symlink-forbidden')
            continue
        bad_dirs = [x for x in parts[:-1] if x in FORBIDDEN_DIRS or x.endswith('.app')]
        if bad_dirs:
            add(rel, 'private-or-generated-directory')
        name = path.name.lower()
        if (name in FORBIDDEN_NAMES or name.startswith('.credentials') or
                (name.startswith('.env.') and name != '.env.example') or
                name.endswith(('.pem', '.key', '.log', '.jsonl')) or
                'model-session' in name or 'model-live' in name):
            add(rel, 'private-or-runtime-file')
        if path.suffix.lower() in ARCHIVES | BINARY or '.app' in path.suffixes:
            add(rel, 'binary-or-archive-forbidden')
        data = path.read_bytes()
        manifest.append({'path': rel, 'size': len(data), 'sha256': digest(data)})
        if len(data) > max_bytes:
            add(rel, 'large-file', detail=f'Exceeds {max_bytes} bytes; require explicit separate asset review.')
        # Detect Mach-O / ELF / PE even when files have misleading extensions.
        if data[:4] in {b'\x7fELF', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe'} or data.startswith(b'MZ'):
            add(rel, 'executable-magic')
        try:
            content = data.decode('utf-8')
        except UnicodeDecodeError:
            add(rel, 'unreviewed-binary')
            continue
        for number, line in enumerate(content.splitlines(), 1):
            for rule, pattern in KEY_PATTERNS.items():
                for match in pattern.finditer(line):
                    add(rel, rule, number, match.group())
            for match in PRIVATE_PATH.finditer(line):
                add(rel, 'private-home-path', number, match.group())
            for match in EMAIL.finditer(line):
                if match.group().endswith(('@example.com', '@example.invalid')):
                    permit(rel, 'reserved-example-email', number)
                else:
                    add(rel, 'email-review', number, match.group())
            for match in ASSIGNMENT.finditer(line):
                value = match.group('value')
                if ENV_VALUE.fullmatch(value):
                    permit(rel, 'literal-environment-reference', number)
                elif value in TEST_LITERALS.get(rel, set()):
                    permit(rel, 'exact-synthetic-test-value', number)
                elif re.fullmatch(r'[A-Z][A-Z0-9_]*', value) and ('REF' in value or value.startswith(('DSH_', 'GAMEDEV_', 'GODOT_MCP_'))):
                    permit(rel, 'reference-name-only', number)
                else:
                    add(rel, 'inline-credential-review', number, value)
            for match in URL.finditer(line):
                value = match.group().rstrip('.,);]') if not match.group().endswith(']') else match.group()
                # Preserve closing bracket on bracketed IPv6, strip prose punctuation.
                value = value.rstrip('.,);')
                if value in TEST_URLS.get(rel, set()):
                    permit(rel, 'exact-invalid-endpoint-test', number)
                    continue
                # Documentation intentionally includes bare ws://localhost.
                if value.endswith(','):
                    value = value[:-1]
                try:
                    parsed = urlsplit(value)
                    host = parsed.hostname
                    has_secret_query = any(SENSITIVE_QUERY.search(k) and v for k, v in parse_qsl(parsed.query))
                    if parsed.username or parsed.password or has_secret_query:
                        add(rel, 'credentialed-or-token-url', number, value)
                        continue
                    loopback = host == 'localhost'
                    try:
                        loopback = loopback or ipaddress.ip_address(host or '').is_loopback
                    except ValueError:
                        pass
                    if host in PUBLIC_HOSTS or loopback:
                        continue
                    if rel.startswith('tests/') and host in TEST_HOSTS:
                        permit(rel, 'reserved-invalid-endpoint-test', number)
                    else:
                        add(rel, 'url-host-review', number, value)
                except ValueError:
                    add(rel, 'malformed-url-review', number, value)
    return {
        'status': 'PASS' if not findings else 'FAIL',
        'mode': 'tracked-files' if tracked else 'whole-clean-export',
        'filesScanned': len(manifest), 'findings': findings, 'allowedSyntheticOrReferences': allowed,
        'manifestSha256': digest(json.dumps(manifest, sort_keys=True, separators=(',', ':'))),
        'manifest': manifest,
        'limitations': [
            'Heuristic scan plus explicit manifest review; not proof that all personal data or unknown secret formats are absent.',
            'No source rewriting or automatic redaction; any finding requires review and a clean re-export.',
            '.git history is excluded; create a new publication repository from the reviewed export, or separately review full history.',
            'Binary media requires independent visual/metadata/license review before it may be published.',
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--tracked', action='store_true')
    parser.add_argument('--max-bytes', type=int, default=2 * 1024 * 1024)
    args = parser.parse_args()
    result = scan(args.root, tracked=args.tracked, max_bytes=args.max_bytes)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
