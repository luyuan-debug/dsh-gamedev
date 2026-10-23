# Guarded upstream launcher

Run this file with the isolated Python environment containing the locked
`godot-editor-mcp==2026.10.20.1` wheel. It calls that distribution's original
`mcp_server.main.main()` and changes only three `Bridge` entry points in memory.
It does not rewrite the wheel or addon, register tools, proxy MCP, or implement
another transport.

The installer must provide these environment variables without logging values:

- `DSH_GAMEDEV_PROJECT_ROOT`: absolute path to the approved project directory.
- `GODOT_MCP_PROJECT_DIR`: the same project (realpath comparison).
- `GODOT_MCP_BRIDGE_TOKEN`: the secret also passed to this project's Godot process.

Launch with `<isolated-venv>/bin/python -I -B <plugin>/bridge/guarded_main.py`.
Existing upstream transport, bridge URL, logging and toolset environment
configuration still apply. The launcher requires an existing `project.godot`,
the exact upstream distribution and module versions, an announced Godot
`4.7.2` stable identity, and addon `2026.10.20.1`.

`send` and `notify` check the peer identity synchronously before entering the
original method, which synchronously captures its connection before yielding.
An unavailable identity or wrong project/version causes a controlled refusal;
no addon command is sent. After a disconnect the upstream resets identity, so
the reconnect must announce and satisfy the same immutable target again.
The per-instance admission lock prevents a second editor from replacing any
connected editor, including during overlapping authentication attempts. The
original `_attach` authentication still runs for every admitted connection.
If a wrong editor owns the connection, disconnect it before connecting the
approved editor. Restart the launcher to choose another target.

This guards accidental cross-editor routing. It is **not a security sandbox
against malicious local processes**: a process that obtains the secret can
impersonate the self-reported addon identity. It does not change upstream
filesystem/tool authorization or DSH approval policy.

On failed commands, upstream `tools._route.route()` retains only the error,
hint and required field when building its tool error. The send wrapper appends
known outcome diagnostics to hint text so those values survive text-only MCP
error projection. It keeps original error/required/result, keeps the original
hint as a prefix, and never retries. The allowlist covers `may_have_applied`,
`persisted`, `partial`, `partial_success`, `applied`, `rollback`, `completed`,
`failed`, `succeeded`, `rolled_back`, `rollback_failed`, `skipped`, `count`,
`total`, `cancelled`, `completed_count`, `failed_count` and `applied_count`.
Only booleans, null, bounded integers, finite numbers and fixed status words are
projected. Known complex/unsafe fields are listed as omitted; unknown metadata,
scripts and secret/token fields are not copied. This preserves these diagnostic
flags, not arbitrary structured error results. A second editor refusal emits a
constant warning without peer identity or secret values.

Run offline tests with:

```sh
python -I -B -m unittest discover -s tests/bridge -v
```

The standard-library suite verifies admission races, reconnects, target and
version refusals, exact forwarding of original values/timeouts and absence of
secret values in adapter diagnostics. In the development workspace it also
compares extracted upstream package files byte for byte with the pinned wheel.
Native bridge tests run when its dependencies are available. The memory tests
verify original response and timeout handling. The loopback tests bind only
`127.0.0.1` on kernel-selected temporary ports and close every listener/client
afterward; they verify an authenticated hello, a native command round trip,
second-editor refusal, and no command frames for unknown/wrong identities.
They need local socket permissions and never start Godot.
