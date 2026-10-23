#!/usr/bin/env python3
"""Read-only delivery contract checks, not DSH/Godot/model acceptance.

Run from any directory. JSON goes to stdout; no files are written. Package
members are read in memory, never extracted. An optional native inventory must
come from an actual host test, not a hand-written declaration.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import tarfile
from pathlib import Path, PurePosixPath

EXPECTED_IDS = (
    [f"P{i:02}" for i in range(1, 6)]
    + [f"C{i:02}" for i in range(1, 9)]
    + [f"M{i:02}" for i in range(1, 16)]
    + [f"F{i:02}" for i in range(1, 9)]
    + [f"L{i:02}" for i in range(1, 3)]
    + [f"O{i:02}" for i in range(1, 5)]
    + [f"X{i:02}" for i in range(1, 5)]
    + [f"R{i:02}" for i in range(1, 4)]
)
STATES = {"NOT_RUN", "PASS", "FAIL", "BLOCKED", "NOT_APPLICABLE"}
EXCLUDED_DIRS = {"node_modules", ".git", ".godot", "__pycache__", ".cache", "coverage"}
SOURCE_EXCLUDED_DIRS = EXCLUDED_DIRS | {"dist", "lib", "evidence", "reports"}
SOURCE_EXCLUDED_FILES = {"acceptance-results.json", "VERIFICATION.md", "source-fingerprint.json"}
TEXT_SUFFIXES = {".json", ".jsonl", ".map", ".yml", ".yaml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".gd", ".cfg", ".sh", ".bash", ".zsh", ".md", ".txt", ".toml", ".lock"}
HOST_PACKAGE = re.compile(r"^(?:@deepseek-ai/|@cordisjs/|cordis$|react$|react-dom$)")
EXACT_VERSION = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
PRIVATE_PATH = re.compile(rb"/(?:Users|home)/[^/\s\x00\"'<>]+/")
INLINE_CREDENTIAL = re.compile(rb"[\"']?(?:[A-Za-z_]*?(?:api[_-]?key|authorization|access[_-]?token|bridge[_-]?token|password|client[_-]?secret))[\"']?\s*[=:]\s*[\"'][^\"'\r\n]{16,}[\"']", re.I)
FORBIDDEN_BUSINESS_TOOLS = ("gamedev_verify", "gamedev_export", "spawn_game_agent")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--package", type=Path, help="Exact delivery .tgz to inspect")
    parser.add_argument("--expected-source-fingerprint", help="Previously recorded production source digest")
    parser.add_argument("--native-inventory", type=Path, help="Actual native host inventory JSON, optional")
    args = parser.parse_args()
    root = args.root.resolve()
    checks: list[dict] = []
    limitations = [
        "Static source and package checks do not prove native registry, scope, approval, engine, GUI, or model behavior.",
        "Source declaration checks do not establish that no tools were registered at runtime.",
        "Credential scan is a heuristic; source/package review remains required.",
        "Source fingerprint covers production/build inputs; generated output, tests, acceptance results and verification reports are excluded.",
    ]

    def check(name: str, ok: bool, detail=None) -> None:
        checks.append({"id": name, "status": "PASS" if ok else "FAIL", "detail": detail})

    def read_json(relative: str):
        try:
            result = json.loads((root / relative).read_text(encoding="utf-8"))
            check(f"json:{relative}", True)
            return result
        except (OSError, ValueError) as error:
            check(f"json:{relative}", False, str(error))
            return {}

    def files_under(directory: Path):
        if not directory.exists():
            return []
        return sorted(p for p in directory.rglob("*") if p.is_file() and not any(x in EXCLUDED_DIRS for x in p.relative_to(root).parts))

    package = read_json("package.json")
    check("package.identity", package.get("name") == "dsh-gamedev" and package.get("version") == "0.2.0", {"name": package.get("name"), "version": package.get("version")})
    check("package.esm", package.get("type") == "module")
    exports = package.get("exports", {})

    def export_target(value):
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            return export_target(value.get("import") or value.get("default"))
        return None

    expected_exports = {".": "./dist/index.js", "./session": "./dist/session.js", "./client": "./dist/client.js", "./package.json": "./package.json"}
    export_paths = []
    for key, expected in expected_exports.items():
        target = export_target(exports.get(key)) if isinstance(exports, dict) else None
        check(f"package.export:{key}", target == expected and (root / expected).is_file(), target)
        if target:
            export_paths.append(target.removeprefix("./"))
    icon_target = export_target(exports.get("./icon")) if isinstance(exports, dict) else None
    check("package.icon", bool(icon_target) and (root / icon_target).is_file(), icon_target)
    if icon_target:
        export_paths.append(icon_target.removeprefix("./"))
    runtime_deps = package.get("dependencies", {})
    duplicate_host = sorted(x for x in runtime_deps if HOST_PACKAGE.match(x))
    check("package.no-bundled-host-dependencies", not duplicate_host, duplicate_host)
    peers = package.get("peerDependencies", {})
    host_peers = {name: version for name, version in peers.items() if HOST_PACKAGE.match(name)}
    check("package.host-peers-declared", bool(host_peers), host_peers)
    check("package.exact-dsh-peers", all(EXACT_VERSION.fullmatch(str(v)) for k, v in host_peers.items() if k.startswith("@deepseek-ai/")), host_peers)
    lockfiles = [name for name in ["package-lock.json", "pnpm-lock.yaml", "npm-shrinkwrap.json", "yarn.lock", "locks/build-package-lock.json"] if (root / name).is_file()]
    check("dependencies.lockfile-present", bool(lockfiles), lockfiles)
    node_locks = [name for name in lockfiles if name.endswith(".json")]
    for name in node_locks:
        lock = read_json(name)
        entries = lock.get("packages", {})
        registry_entries = {key: value for key, value in entries.items() if key and isinstance(value, dict) and not value.get("link") and str(value.get("resolved", "")).startswith("https://")}
        missing_integrity = [key for key, value in registry_entries.items() if not value.get("integrity") or not value.get("version")]
        check(f"dependencies.node-lock-integrity:{name}", bool(registry_entries) and not missing_integrity, {"registryEntries": len(registry_entries), "missing": missing_integrity})
    python_lock = root / "locks/bridge-requirements.lock"
    python_text = python_lock.read_text(encoding="utf-8") if python_lock.is_file() else ""
    check("dependencies.bridge-release-pinned", bool(re.search(r"(?m)^godot-editor-mcp==2026\.10\.20\.1(?:\s|$)", python_text)))
    python_blocks = re.findall(r"(?m)^([A-Za-z0-9_.-]+==[^\n]+(?:\n(?:    .*|\s*))*)", python_text)
    unhashed_python = [block.splitlines()[0] for block in python_blocks if not re.search(r"--hash=sha256:[0-9a-f]{64}", block)]
    check("dependencies.python-lock-hashes", bool(python_blocks) and not unhashed_python, {"pinnedPackages": len(python_blocks), "missingHashes": unhashed_python})
    check("dependencies.license-present", any((root / name).is_file() for name in ["LICENSE", "LICENSE.md", "LICENSE.txt"]))
    notices = root / "THIRD_PARTY_NOTICES.md"
    check("dependencies.third-party-notices", notices.is_file() and notices.stat().st_size > 80)
    resolved = read_json("resolved-dependencies.json")
    dependencies = resolved.get("dependencies", resolved.get("artifacts", resolved.get("core", []))) if isinstance(resolved, dict) else []
    if isinstance(dependencies, dict):
        dependencies = [dict(value, name=key) if isinstance(value, dict) else {"name": key} for key, value in dependencies.items()]
    check("dependencies.resolution-ledger-present", bool(dependencies))
    bad_resolutions = []
    for row in dependencies:
        if not isinstance(row, dict):
            bad_resolutions.append("non-object entry")
            continue
        status = str(row.get("status", row.get("verificationStatus", ""))).upper()
        if status in {"NOT_INSTALLED", "MISSING", "NOT_RUN", "CANDIDATE", "BLOCKED"} and not row.get("installed", False):
            continue
        name = row.get("name", row.get("id"))
        version = row.get("version", row.get("release"))
        origin = row.get("url", row.get("source", row.get("distributionUrl", row.get("path"))))
        digest = row.get("sha256", row.get("hash", row.get("integrity", row.get("commit"))))
        license_info = row.get("license", row.get("licenseNote"))
        if not all([name, version, origin, digest, license_info]):
            bad_resolutions.append({"name": name, "missing": [key for key, value in {"version": version, "origin": origin, "digest": digest, "license": license_info}.items() if not value]})
    check("dependencies.installed-artifact-provenance", not bad_resolutions, bad_resolutions)
    # The implementation's ledger groups external core, Python and Node build
    # artifacts rather than duplicating them in a single dependencies array.
    # Validate those groups against their bundled locks without inventing URLs
    # or pretending candidate wheel hashes identify the selected installed wheel.
    if isinstance(resolved, dict) and "pythonDistributions" in resolved:
        normalized = lambda name: re.sub(r"[-_.]+", "-", name).lower()
        python_pins = {}
        for block in python_blocks:
            name, version = block.splitlines()[0].rstrip(" \\").split("==", 1)
            python_pins[normalized(name)] = {"version": version, "hashes": re.findall(r"--hash=sha256:([0-9a-f]{64})", block)}
        mismatches = []
        missing_licenses = []
        no_selected_origin = []
        for row in resolved.get("pythonDistributions", []):
            name = row.get("name", "")
            pin = python_pins.get(normalized(name))
            if not pin or pin["version"] != row.get("version") or not pin["hashes"]:
                mismatches.append({"name": name, "version": row.get("version")})
            license_info = str(row.get("license", ""))
            if not license_info or license_info in {"See distribution metadata", "UNKNOWN", "UNVERIFIED"}:
                missing_licenses.append(name)
            if not row.get("url", row.get("distributionUrl")) or not row.get("sha256", row.get("integrity")):
                no_selected_origin.append(name)
        check("dependencies.python-ledger-matches-hashed-lock", bool(python_pins) and not mismatches, {"pinnedPackages": len(python_pins), "mismatches": mismatches})
        check("dependencies.python-license-identities", not missing_licenses, missing_licenses)
        if no_selected_origin:
            limitations.append(f"Python ledger has {len(no_selected_origin)} installed rows without selected distribution URL/hash; hashed lock verifies permitted artifacts for exact versions, not which candidate wheel was installed.")
    if isinstance(resolved, dict) and "nodeBuild" in resolved:
        build_lock = root / "locks/build-package-lock.json"
        actual_lock = json.loads(build_lock.read_text(encoding="utf-8")) if build_lock.is_file() else None
        check("dependencies.node-ledger-matches-lock", resolved["nodeBuild"] == actual_lock)

    required_files = ["cordis.patch.yml", "prompts/godot-2d.md", "skills/godot-2d-workflow/SKILL.md", "bridge/guarded_main.py", "docs/INSTALL.md", "docs/UNINSTALL.md", "docs/VERIFICATION.md"]
    for name in required_files:
        check(f"file:{name}", (root / name).is_file())
    skills = list((root / "skills").rglob("SKILL.md")) if (root / "skills").exists() else []
    check("declaration.single-owned-skill", len(skills) == 1 and skills[0].relative_to(root).as_posix() == "skills/godot-2d-workflow/SKILL.md", [p.relative_to(root).as_posix() for p in skills])
    prompt = (root / "prompts/godot-2d.md").read_text(encoding="utf-8") if (root / "prompts/godot-2d.md").is_file() else ""
    check("declaration.short-prompt", 0 < len(prompt) <= 2600, {"characters": len(prompt)})
    check("declaration.prompt-uses-owned-skill", "godot-2d-workflow" in prompt)
    src_files = files_under(root / "src")
    src_text = "\n".join(p.read_text(encoding="utf-8") for p in src_files if p.suffix in TEXT_SUFFIXES)
    check("declaration.preset-id-in-source", "godot-2d" in src_text)
    prohibited = [name for name in FORBIDDEN_BUSINESS_TOOLS if name in src_text]
    check("declaration.no-prohibited-new-business-tools", not prohibited, prohibited)
    check("declaration.no-unverified-preset-inheritance", not re.search(r"extends\s*:\s*['\"]?standard", src_text))
    check("declaration.no-task-time-installers", not re.search(r"(?:npx\s+-y|uvx\s+|@latest)", src_text))
    patch = (root / "cordis.patch.yml").read_text(encoding="utf-8") if (root / "cordis.patch.yml").is_file() else ""
    check("declaration.native-settings-entry", "gamedev-settings" in patch and "dsh-gamedev" in patch)
    link_targets = []
    broken_links = []
    markdown = [root / "prompts/godot-2d.md"] + [p for p in files_under(root / "skills") if p.suffix == ".md"]
    for path in markdown:
        if not path.is_file():
            continue
        for link in re.findall(r"\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
            if "://" in link or link.startswith(("#", "mailto:")):
                continue
            target = (path.parent / link.split("#", 1)[0]).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                broken_links.append({"source": path.relative_to(root).as_posix(), "link": link})
            else:
                link_targets.append(target.relative_to(root).as_posix())
    check("declaration.skill-references-resolve", not broken_links, broken_links)

    matrix = read_json("acceptance/cases.json")
    template = read_json("acceptance/acceptance-results.template.json")
    matrix_cases = matrix.get("cases", [])
    template_cases = template.get("cases", [])
    check("acceptance.all-49-case-ids", [row.get("id") for row in matrix_cases] == EXPECTED_IDS)
    check("acceptance.38-core-cases", sum(row.get("requirement") == "core" for row in matrix_cases) == 38)
    check("acceptance.template-preserves-all-cases", [row.get("id") for row in template_cases] == EXPECTED_IDS)
    check("acceptance.template-not-prepassed", template.get("status") == "NOT_RUN" and all(row.get("status") == "NOT_RUN" for row in template_cases))
    result_path = root / "acceptance/acceptance-results.json"
    if result_path.is_file():
        results = read_json("acceptance/acceptance-results.json")
        result_cases = results.get("cases", [])
        check("acceptance.actual-ids", [row.get("id") for row in result_cases] == EXPECTED_IDS)
        check("acceptance.actual-statuses", all(row.get("status") in STATES for row in result_cases))
        unsupported_passes = [row.get("id") for row in result_cases if row.get("status") == "PASS" and not row.get("evidence")]
        check("acceptance.pass-has-evidence-references", not unsupported_passes, unsupported_passes)
        if results.get("status") == "PASS":
            check("acceptance.core-pass-rule", all(row.get("status") == "PASS" for row in result_cases if row.get("requirement") == "core"))

    production_files = []
    for path in files_under(root):
        rel = path.relative_to(root)
        if any(part in SOURCE_EXCLUDED_DIRS for part in rel.parts) or rel.parts[0] in {"tests", "acceptance"} or path.name in SOURCE_EXCLUDED_FILES or path.suffix in {".tgz", ".zip", ".pyc"}:
            continue
        production_files.append((rel.as_posix(), sha256(path.read_bytes())))
    fingerprint = sha256("".join(f"{digest}  {name}\n" for name, digest in production_files).encode())
    if args.expected_source_fingerprint:
        check("source.fingerprint-matches-recorded", fingerprint == args.expected_source_fingerprint, {"actual": fingerprint, "expected": args.expected_source_fingerprint})

    package_digest = None
    if args.package:
        package_digest = sha256(args.package.read_bytes())
        try:
            with tarfile.open(args.package, "r:gz") as archive:
                names = []
                package_files = {}
                unsafe = []
                cache = []
                private_paths = []
                credentials = []
                env_reference_exceptions = []
                for member in archive.getmembers():
                    rel = PurePosixPath(member.name)
                    if rel.is_absolute() or ".." in rel.parts or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                        unsafe.append(member.name)
                        continue
                    if not member.isfile():
                        continue
                    name = member.name.removeprefix("package/")
                    names.append(name)
                    if any(part in EXCLUDED_DIRS or part in {"fonts", ".DS_Store"} for part in rel.parts) or Path(name).suffix in {".pyc", ".pem", ".key", ".p12", ".pfx", ".kdbx"} or Path(name).name.startswith(".env") or Path(name).name in {"id_rsa", "id_ed25519"}:
                        cache.append(name)
                    content = archive.extractfile(member).read()
                    package_files[name] = content
                    if Path(name).suffix in TEXT_SUFFIXES:
                        if PRIVATE_PATH.search(content):
                            private_paths.append(name)
                        for candidate in INLINE_CREDENTIAL.finditer(content):
                            quoted = re.search(rb"[=:]\s*([\"'])(.*?)\1$", candidate.group())
                            # A shell variable reference in documentation is
                            # not a secret value. This exception is deliberately
                            # exact, documentation-only, and does not admit a
                            # generated/random value or compound shell command.
                            if name.startswith("docs/") and Path(name).suffix == ".md" and quoted and re.fullmatch(rb"\$(?:[A-Z_][A-Z0-9_]*|\{[A-Z_][A-Z0-9_]*\})", quoted.group(2)):
                                env_reference_exceptions.append(name)
                            else:
                                credentials.append(name)
                check("tarball.safe-member-paths", not unsafe, unsafe)
                check("tarball.no-caches-or-sensitive-files", not cache, cache)
                check("tarball.no-private-absolute-user-paths", not private_paths, private_paths)
                check("tarball.no-obvious-inline-credentials", not credentials, {"suspiciousFiles": sorted(set(credentials)), "strictDocumentationEnvironmentReferenceExceptions": env_reference_exceptions})
                packed_required = required_files + export_paths + link_targets + ["resolved-dependencies.json", "THIRD_PARTY_NOTICES.md"]
                missing = sorted(set(packed_required) - set(names))
                check("tarball.runtime-and-references-included", not missing, missing)
                packed_skills = [n for n in names if PurePosixPath(n).name == "SKILL.md"]
                check("tarball.exactly-one-owned-skill", packed_skills == ["skills/godot-2d-workflow/SKILL.md"], packed_skills)
                if "package.json" in package_files:
                    check("tarball.manifest-matches-source", json.loads(package_files["package.json"]) == package)
                else:
                    check("tarball.manifest-matches-source", False, "package.json missing")
                different = [name for name, content in package_files.items() if (root / name).is_file() and (root / name).read_bytes() != content]
                check("tarball.bytes-match-source-tree", not different, different)
        except (OSError, ValueError, tarfile.TarError) as error:
            check("tarball.readable", False, str(error))
    else:
        limitations.append("No --package supplied: delivery tarball contents and installed identity were not checked.")

    if args.native_inventory:
        inventory = json.loads(args.native_inventory.read_text(encoding="utf-8"))
        check("native-inventory.actual-host-provenance", bool(inventory.get("hostVersion")) and bool(inventory.get("evidence")))
        check("native-inventory.one-owned-preset", inventory.get("ownedPresets") == ["godot-2d"])
        check("native-inventory.one-owned-skill", inventory.get("ownedSkills") == ["godot-2d-workflow"])
        check("native-inventory.zero-new-business-tools", inventory.get("newModelCallableTools") == [])
        check("native-inventory.native-engineering-tools", all(inventory.get("engineeringCapabilities", {}).get(key) for key in ["read", "search", "edit", "terminal", "skill"]))
    else:
        limitations.append("No --native-inventory supplied: actual preset/Skill/tool counts and engineering capability execution remain unverified by this checker.")

    passed = sum(item["status"] == "PASS" for item in checks)
    failed = len(checks) - passed
    report = {"schemaVersion": 1, "scope": "delivery-contracts-only", "status": "PASS" if failed == 0 else "FAIL", "summary": {"passed": passed, "failed": failed, "checks": len(checks)}, "sourceFingerprint": {"sha256": fingerprint, "files": [{"path": name, "sha256": digest} for name, digest in production_files]}, "tarballSha256": package_digest, "checks": checks, "limitations": limitations, "productAcceptanceUpdated": False}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return int(failed != 0)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"scope": "delivery-contracts-only", "status": "FAIL", "error": str(error), "productAcceptanceUpdated": False}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
