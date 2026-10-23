# Third party notices

The npm package contains the dsh-gamedev implementation, a small guarded launcher, an explicitly invoked local setup helper, and schema inventory derived from Godot Editor MCP. Godot Editor MCP, its Godot addon, all Python dependencies, DSH native runtime peers, Godot Engine, and optional command-line programs are installed separately; their executables and Python packages are not embedded in the npm package. Model accounts and test-only credential overlays are excluded.

## Godot Editor MCP and addon notice

Source: https://github.com/hybridindie/godot-mcp/tree/2026.10.20.1

The pinned bridge/addon version is 2026.10.20.1. The derived schema inventory retains this complete upstream MIT copyright and permission notice:

```text
MIT License

Copyright (c) 2026 Johnny D

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Separately installed runtime and build components

DeepSeek Harness runtime peers use MIT: https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317 . Godot Engine uses MIT: https://godotengine.org/license/ . TypeScript 5.9.3 uses Apache-2.0; esbuild 0.25.12 and its platform package use MIT. Exact build archive URLs and integrity values remain in `locks/build-package-lock.json` and `resolved-dependencies.json`.

ImageMagick 7.1.2-25 uses the ImageMagick license. The existing FFmpeg 8.1.1 build enables GPL components. These optional external programs are not redistributed, and their absence does not block unrelated core features. No third-party fonts or game assets are bundled.

### Engine copies and test provenance

The setup helper copies a user-selected existing engine into a new owned workspace. It does not re-sign the engine, download another engine or change the original application. A copied engine can retain an existing signature failure; a doctor warning does not establish that the whole app is vendor-signed or notarized. Any separate local repair performed for acceptance must be disclosed in that release's verification report. Neither an engine nor its export templates or local signing metadata are embedded in this npm package or source repository.

Editor self-contained mode and runtime user data have different locations. The helper verifies actual editor paths and records the new fixture's unique runtime namespace; uninstall retains saves. This is an installation behavior statement, not an engine licensing grant.

## Python distributions in the isolated macOS arm64 environment

All 79 exact installed versions are matched to `locks/bridge-requirements.lock`. `resolved-dependencies.json` records each selected distribution URL, SHA-256, official metadata URL, concrete license, installed license-file hashes, wheel tags, and macOS arm64 validation limits. Compatible published artifact hashes are intersected with the lock. The setup helper accepts only the selected pinned wheels and refuses a missing compatible artifact; it does not build a source distribution or substitute another version. Installed/compatible does not claim that every dependency was individually business-tested. The ledger distinguishes upstream metadata from independently verified local artifact bytes. These dependencies keep their own licenses; the project MIT license does not relicense them.

| Distribution | Exact version | License |
| --- | --- | --- |
| aiofile | 3.12.3 | Apache-2.0 |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anyio | 4.15.1 | MIT |
| attrs | 26.1.0 | MIT |
| Authlib | 1.9.1 | BSD-3-Clause |
| beartype | 0.23.1 | MIT |
| burner-redis | 0.1.7 | MIT |
| cachetools | 7.2.4 | MIT |
| caio | 0.12.10 | Apache-2.0 |
| cffi | 2.1.1 | MIT-0 |
| click | 8.5.0 | BSD-3-Clause |
| cloudpickle | 3.1.2 | BSD-3-Clause |
| cronsim | 2.7 | BSD-3-Clause |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| cyclopts | 5.3.0 | Apache-2.0 |
| dnspython | 2.9.0 | ISC |
| docstring_parser | 0.18.0 | MIT |
| email-validator | 2.3.0 | Unlicense |
| exceptiongroup | 1.3.1 | MIT |
| fastmcp | 4.1.0 | Apache-2.0 |
| fastmcp-slim | 4.1.0 | Apache-2.0 |
| fastmcp-tasks | 4.1.0 | Apache-2.0 |
| godot-editor-mcp | 2026.10.20.1 | MIT |
| griffelib | 2.4.1 | ISC |
| h11 | 0.16.0 | MIT |
| httpcore2 | 2.16.0 | BSD-3-Clause |
| httpx2 | 2.16.0 | BSD-3-Clause |
| idna | 3.20 | BSD-3-Clause |
| jaraco.classes | 3.4.0 | MIT |
| jaraco.context | 6.1.2 | MIT |
| jaraco.functools | 4.6.0 | MIT |
| joserfc | 1.7.7 | BSD-3-Clause |
| jsonref | 1.1.0 | MIT |
| jsonschema | 4.26.0 | MIT |
| jsonschema-path | 0.5.0 | Apache-2.0 |
| jsonschema-specifications | 2025.9.1 | MIT |
| keyring | 25.7.0 | MIT |
| markdown-it-py | 4.2.0 | MIT |
| mcp | 2.3.0 | MIT |
| mcp-types | 2.3.0 | MIT |
| mdurl | 0.1.2 | MIT |
| more-itertools | 11.2.1 | MIT |
| openapi-pydantic | 0.6.0 | MIT |
| opentelemetry-api | 1.45.1 | Apache-2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pathable | 0.6.0 | Apache-2.0 |
| platformdirs | 4.13.5 | MIT |
| prometheus_client | 0.26.0 | Apache-2.0 AND BSD-2-Clause |
| py-key-value-aio | 0.4.6 | Apache-2.0 |
| pycparser | 3.12 | BSD-3-Clause |
| pydantic | 2.14.1 | MIT |
| pydantic_core | 2.50.1 | MIT |
| pydantic-settings | 2.16.1 | MIT |
| pydocket | 0.27.0 | MIT |
| Pygments | 2.21.0 | BSD-2-Clause |
| PyJWT | 2.15.1 | MIT |
| pyperclip | 1.11.0 | BSD-3-Clause |
| pypng | 0.20220715.0 | MIT |
| python-dotenv | 1.2.4 | BSD-3-Clause |
| python-json-logger | 4.2.0 | BSD-2-Clause |
| python-multipart | 0.0.32 | Apache-2.0 |
| PyYAML | 6.0.3 | MIT |
| redis | 8.1.0 | MIT |
| referencing | 0.37.0 | MIT |
| rich | 15.0.0 | MIT |
| rich-rst | 2.2.0 | MIT |
| rpds-py | 2026.9.1 | MIT |
| shellingham | 1.5.4 | ISC |
| sse-starlette | 3.5.0 | BSD-3-Clause |
| starlette | 1.9.0 | BSD-3-Clause |
| truststore | 0.10.5 | MIT |
| typer | 0.27.3 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| uncalled-for | 0.4.1 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| watchfiles | 1.3.0 | MIT |
| websockets | 17.3 | BSD-3-Clause |
