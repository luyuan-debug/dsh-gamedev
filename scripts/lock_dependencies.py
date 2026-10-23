"""Inventory the active isolated venv against the shipped hash lock and PyPI.

Metadata only: no package downloads, installations, model calls or secret reads.
Run with the isolated CPython on the target machine. Cache is development-only.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from importlib import metadata
import json
from pathlib import Path
import platform
import re
import sys
from urllib.request import Request, urlopen

from packaging.tags import parse_tag, sys_tags
from packaging.utils import canonicalize_name, parse_wheel_filename


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def parse_lock(path: Path) -> dict:
    result, current = {}, None
    for line in path.read_text().splitlines():
        match = re.match(r"^([A-Za-z0-9._-]+)==([^\s\\;]+)", line)
        if match:
            current = canonicalize_name(match[1])
            result[current] = {"version": match[2], "hashes": []}
        for value in re.findall(r"--hash=sha256:([0-9a-f]{64})", line):
            if current is not None:
                result[current]["hashes"].append(value)
    return result


def license_details(dist) -> tuple[str, dict]:
    files = []
    text = []
    for item in dist.files or []:
        if re.search(r"(^|/)(licen[sc]e[^/]*|copying[^/]*|notice[^/]*)$", str(item), re.I):
            path = dist.locate_file(item)
            if path.is_file():
                files.append({"path": str(item), "sha256": digest(path)})
                text.append(path.read_text(errors="replace"))
    expression = dist.metadata.get("License-Expression")
    evidence = "installed METADATA: License-Expression"
    if not expression:
        raw = (dist.metadata.get("License") or "").strip()
        if raw in {"MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "Unlicense", "ISC"}:
            expression, evidence = raw, "installed METADATA: License"
        elif raw == "ISC License":
            expression, evidence = "ISC", "installed METADATA License and installed ISC license text"
        else:
            classifiers = dist.metadata.get_all("Classifier", [])
            if any("MIT License" in value for value in classifiers):
                expression, evidence = "MIT", "installed METADATA: MIT license classifier"
            elif any("BSD License" in value for value in classifiers) and any("Neither the name" in value for value in text):
                expression, evidence = "BSD-3-Clause", "installed license text: three BSD conditions including non-endorsement"
            else:
                raise ValueError(f"Specific license has not been resolved for {dist.metadata['Name']}")
    return expression, {"source": evidence, "files": files}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--upstream-root", type=Path)
    args = parser.parse_args()
    package = args.package_root.resolve()
    cache = args.cache or package.parent / "deps/pypi-metadata"
    upstream = args.upstream_root or package.parent / "upstream"
    cache.mkdir(parents=True, exist_ok=True)
    lock_path = package / "locks/bridge-requirements.lock"
    lock = parse_lock(lock_path)
    manifest_path = package / "resolved-dependencies.json"
    manifest = json.loads(manifest_path.read_text())
    supported = list(sys_tags())
    ranks = {tag: index for index, tag in enumerate(supported)}
    installed = sorted(metadata.distributions(), key=lambda dist: canonicalize_name(dist.metadata["Name"]))
    if len(installed) != 79:
        raise ValueError(f"Expected 79 isolated installed distributions, found {len(installed)}")

    def fetch(dist):
        name, version = canonicalize_name(dist.metadata["Name"]), dist.version
        if name == "godot-editor-mcp":
            return name, None
        path = cache / f"{name}-{version}.json"
        if path.exists():
            return name, json.loads(path.read_text())
        url = f"https://pypi.org/pypi/{name}/{version}/json"
        request = Request(url, headers={"User-Agent": "dsh-gamedev-dependency-inventory/0.1.0", "Accept": "application/json"})
        with urlopen(request, timeout=30) as response:
            data = json.load(response)
        path.write_text(json.dumps(data))
        return name, data

    with ThreadPoolExecutor(max_workers=8) as executor:
        remote = dict(executor.map(fetch, installed))
    core = {item["name"]: item for item in manifest["core"]}
    if core["godot-editor-mcp"]["sha256"] != "cb32961dd87d983a55ba94ea3357e3ebdb540f5fe9e543e41e35353fbe51b640":
        raise ValueError("Core bridge pin must not change")
    if core["godot-mcp-addon"]["sha256"] != "7173bb197eca2a8522b2173342ce474052d7746c3b36a9d404e554ae8cc1fbaf":
        raise ValueError("Addon pin must not change")
    for item in core.values():
        filename = item["url"].rsplit("/", 1)[1]
        if digest(upstream / filename) != item["sha256"]:
            raise ValueError(f"Pinned upstream archive changed: {filename}")
        item["archiveHashVerified"] = True
        item["licenseEvidence"] = "Complete upstream MIT notice retained in THIRD_PARTY_NOTICES.md"
        item["macosArm64Validation"] = {
            "archiveHashVerified": True, "engineVersionPin": "4.7.2 stable",
            "businessCoverage": "Actual engine and protocol outcomes are owned by the separate acceptance evidence; this inventory verifies archive identity."
        }
    core["godot-mcp-addon"]["status"] = "ARCHIVE_HASH_VERIFIED_ENGINE_RESULTS_IN_ACCEPTANCE_EVIDENCE"

    distributions, source_builds = [], []
    for dist in installed:
        name, version = canonicalize_name(dist.metadata["Name"]), dist.version
        if name not in lock or lock[name]["version"] != version:
            raise ValueError(f"Installed version does not match shipped lock: {name} {version}")
        license_expression, license_evidence = license_details(dist)
        wheel_text = dist.read_text("WHEEL") or ""
        installed_tags = [line[5:].strip() for line in wheel_text.splitlines() if line.startswith("Tag: ")]
        installed_compatible = any(set(parse_tag(value)) & ranks.keys() for value in installed_tags)
        if not installed_compatible:
            raise ValueError(f"Installed WHEEL tags are incompatible with this interpreter: {name}")
        if name == "godot-editor-mcp":
            pinned = core[name]
            artifact = {"filename": pinned["url"].rsplit("/", 1)[1], "url": pinned["url"], "sha256": pinned["sha256"], "type": "wheel", "hashSource": "pinned GitHub release; local archive SHA-256 verified", "archiveHashVerified": True}
            metadata_url = "https://github.com/hybridindie/godot-mcp/releases/tag/2026.10.20.1"
        else:
            data = remote[name]
            candidates = []
            for item in data["urls"]:
                if item["packagetype"] != "bdist_wheel" or item.get("yanked"):
                    continue
                tags = parse_wheel_filename(item["filename"])[3]
                matching = [ranks[tag] for tag in tags if tag in ranks]
                if matching and item["digests"]["sha256"] in lock[name]["hashes"]:
                    candidates.append((min(matching), item["filename"], item))
            if candidates:
                selected = min(candidates)[2]
                kind = "wheel"
            else:
                sources = [item for item in data["urls"] if item["packagetype"] == "sdist" and not item.get("yanked") and item["digests"]["sha256"] in lock[name]["hashes"]]
                if not sources:
                    raise ValueError(f"No compatible locked wheel or locked source distribution: {name}")
                selected, kind = sorted(sources, key=lambda item: item["filename"])[0], "sdist"
                source_builds.append(name)
            artifact = {"filename": selected["filename"], "url": selected["url"], "sha256": selected["digests"]["sha256"], "type": kind, "hashSource": "official PyPI version JSON intersected with shipped lock", "archiveHashVerified": False}
            metadata_url = f"https://pypi.org/pypi/{name}/{version}/json"
        if artifact["sha256"] not in lock[name]["hashes"]:
            raise ValueError(f"Artifact SHA-256 absent from lock: {name}")
        if artifact["type"] == "wheel":
            selected_tags = parse_wheel_filename(artifact["filename"])[3]
            artifact["wheelTags"] = sorted(str(tag) for tag in selected_tags)
            artifact["publishedWheelTagsCompatible"] = bool(selected_tags & ranks.keys())
        files = list(dist.files or [])
        metadata_file = next((item for item in files if str(item).endswith(".dist-info/METADATA")), None)
        wheel_file = next((item for item in files if str(item).endswith(".dist-info/WHEEL")), None)
        distributions.append({
            "name": dist.metadata["Name"], "version": version,
            "url": artifact["url"], "sha256": artifact["sha256"], "artifact": artifact,
            "metadataURL": metadata_url, "license": license_expression, "licenseEvidence": license_evidence,
            "macosArm64Validation": {
                "status": "INSTALLED_LOCK_MATCH_AND_COMPATIBLE_WHEEL_TAGS" if artifact["type"] == "wheel" else "INSTALLED_SOURCE_BUILD_LOCK_MATCH",
                "pythonVersion": platform.python_version(), "machine": platform.machine(), "macosVersion": platform.mac_ver()[0],
                "installedVersionMatchesLock": True, "artifactHashAllowedByLock": True,
                "installedWheelTags": installed_tags, "installedWheelTagsCompatible": installed_compatible,
                "metadataSha256": digest(dist.locate_file(metadata_file)) if metadata_file else None,
                "wheelMetadataSha256": digest(dist.locate_file(wheel_file)) if wheel_file else None,
                "businessCoverage": "Core Bridge protocol and integration coverage is recorded separately; this distribution was not individually business-tested."
            }
        })

    manifest["schemaVersion"] = 2
    manifest["pythonDistributions"] = distributions
    manifest["dependencyInventory"] = {
        "generatedAtUTC": datetime.now(timezone.utc).isoformat(), "installedDistributionCount": len(distributions),
        "lockFile": "locks/bridge-requirements.lock", "lockFileSha256": digest(lock_path),
        "target": {"os": platform.system(), "macosVersion": platform.mac_ver()[0], "machine": platform.machine(), "python": platform.python_version()},
        "metadataSource": "https://docs.pypi.org/api/json/", "sourceDistributionFallbacks": source_builds,
        "verificationLimits": [
            "Each exact installed version and selected artifact SHA-256 matches the shipped lock.",
            "Published wheel tags were selected against this interpreter's supported tags; installed WHEEL tags were checked independently.",
            "PyPI artifact hashes were cross-checked as metadata; package archives were not re-downloaded for this inventory.",
            "Only the two pinned upstream core archives were locally rehashed here.",
            "Installation and tag compatibility do not claim every transitive distribution was imported or business-tested."
        ]
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    bridge_dist = next(dist for dist in installed if canonicalize_name(dist.metadata["Name"]) == "godot-editor-mcp")
    upstream_license = next(bridge_dist.locate_file(item).read_text() for item in bridge_dist.files if str(item).endswith(".dist-info/licenses/LICENSE"))
    table = "\n".join(f"| {item['name']} | {item['version']} | {item['license']} |" for item in distributions)
    notices = f'''# Third party notices

The package includes dsh-gamedev, its local setup helper, editor connection checks, and a tool schema inventory derived from Godot Editor MCP. DSH, Godot, the Godot Editor MCP server and addon, Python dependencies, and optional command-line tools are installed separately and retain their own licenses. No model account, third-party font, or game asset is bundled.

## Godot Editor MCP and addon notice

Source: https://github.com/hybridindie/godot-mcp/tree/2026.10.20.1

The pinned bridge/addon version is 2026.10.20.1. The derived schema inventory retains this complete upstream MIT copyright and permission notice:

```text
{upstream_license.rstrip()}
```

## Separately installed runtime and build components

DeepSeek Harness runtime peers use MIT: https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317 . Godot Engine uses MIT: https://godotengine.org/license/ . TypeScript 5.9.3 uses Apache-2.0; esbuild 0.25.12 and its platform package use MIT. Exact build archive URLs and integrity values remain in `locks/build-package-lock.json` and `resolved-dependencies.json`.

ImageMagick 7.1.2-25 uses the ImageMagick license. The existing FFmpeg 8.1.1 build enables GPL components. These optional external programs are not redistributed, and their absence does not block unrelated core features. No third-party fonts or game assets are bundled.

### Godot installation

The setup helper copies a user-selected Godot application into the development directory. It does not download, re-sign, or modify the original engine. Engine test and signing details are documented in [VERIFICATION.md](docs/VERIFICATION.md).

## Python distributions in the isolated macOS arm64 environment

The following {len(distributions)} versions are recorded in `locks/bridge-requirements.lock`. `resolved-dependencies.json` includes the selected wheel URLs, SHA-256 values, metadata sources and license-file hashes. The installer checks the selected files against those values before installation. Compatibility was checked for macOS arm64 with CPython 3.14; this is not a claim that every library feature was tested. The project MIT license does not change these dependencies' licenses.

| Distribution | Exact version | License |
| --- | --- | --- |
{table}
'''
    (package / "THIRD_PARTY_NOTICES.md").write_text(notices)
    print(json.dumps({"result": "PASS", "distributions": len(distributions), "sourceDistributionFallbacks": source_builds, "licenseExpressionsMissing": 0, "artifactHashesInLock": len(distributions), "corePinsUnchanged": True}))


if __name__ == "__main__":
    main()
