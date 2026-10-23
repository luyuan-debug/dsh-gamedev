# dsh-gamedev 0.2.0 安装与配置

推荐使用 [SETUP.md](SETUP.md) 的隔离辅助程序。它只接受一个尚不存在的工作目录，创建专用原生 Profile、Godot 副本、固定桥接和空白工程，完成摘要与实际路径核查。已有软件和日常配置保持原状。本文件补充包的用途、原生设置语义和源码构建。

## 固定版本与包边界

目标为 macOS arm64、DSH `0.2.1-rc.2`、Godot `4.7.2 stable`、已有 CPython `3.14`、Node ≥24.14。Python wheel 清单具体针对 macOS arm64 CPython 3.14；辅助程序对其他组合明确拒绝。其他平台的纯函数测试通过不能代替原生宿主或引擎支持声明。 Mono 版 Godot 还需显式指定已有 `--dotnet`；安装准备与每次启动前均实际运行隔离的 headless 游戏探针，不能只凭 `--version` 或编辑器窗口判断可用。

安装使用 `.tgz`，源码供阅读、修改和重建。包内包括编译后的插件、设置页、Prompt、Skill、目录、锁、文档和显式运行的 `dsh-gamedev-setup`。Godot、导出模板、DSH、Python、上游桥接/addon 及可选工具均独立安装，不嵌入 npm 包。精确版本、官方来源、摘要与许可见 `resolved-dependencies.json`、`locks/`、[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

固定上游为 [Godot MCP 2026.10.20.1](https://github.com/hybridindie/godot-mcp/releases/tag/2026.10.20.1)。服务端和 addon 必须同版。准备阶段按明确的离线/联网选择处理精确依赖；插件运行时不执行 `latest`、`uvx`、`npx -y` 或自动补装。

DSH 的包管理器可能缓存同路径 tarball，因此每个构建采用摘要命名的新路径，例如 `dsh-gamedev-0.2.0-<sha256>.tgz`。版本号相同不表示字节相同。辅助程序独立校验传入摘要，并逐文件比较 tarball 与实际安装内容；手动维护安装时也应保留这两项检查。升级前先停止该隔离 Profile，再原生卸载旧包、安装新摘要路径，不覆盖原包重装。

## 原生设置

在 **Settings → Godot 2D** 保存项目根、Godot 程序、桥接 venv Python、loopback WebSocket 地址和令牌环境引用。设置保存先完整校验再提交；错误保留旧有效值，版本冲突保留草稿并要求核对合并。健康诊断只读，不作为用户设置保存。

`bridgeExecutable` 必须填 venv 的 `bin/python` 调用路径。不要填 console entrypoint，也不要把 venv symlink 展开成全局 Python；展开后会失去 venv 依赖。原生 MCP 以 `python -I -B <plugin>/bridge/guarded_main.py` 启动固定上游。

设置只保存桥接令牌的环境变量名称，不能保存令牌值。Godot addon 与 DSH 必须在启动时获得同一个令牌；后来更改终端环境不会改变已运行的编辑器。辅助程序每次 `launch` 在内存生成令牌并传给它直接启动的两个子进程，不把值写入参数、YAML 或日志。手动启动时采用同样的环境引用方式，并保持 loopback 端口一致。

下列是原生 Profile patch 的最小字段形状。占位路径须替换为已经批准的测试环境，初始保持 `enabled: false`，核查后再启用。JSON schema 示例不能直接当作 DSH YAML 导入。

```yaml
- id: sandbox-policy
  config:
    mode: workspace-write
    workspaceRoot: /absolute/path/to/approved-project
- id: approval
  config:
    policy: ask
- id: gamedev-settings
  name: dsh-gamedev
  config:
    enabled: false
    projectRoot: /absolute/path/to/approved-project
    godotExecutable: /absolute/path/to/Godot_mono.app/Contents/MacOS/Godot
    bridgeMode: stdio
    bridgeExecutable: /absolute/path/to/bridge-venv/bin/python
    bridgeUrl: ws://127.0.0.1:19090
    bridgeSecretRef: DSH_GAMEDEV_BRIDGE_TOKEN
    bridgeEndpoint: ""
    httpSecretRef: ""
    allowedOptionalTools: []
    gdtoolkitExecutable: ""
    imagemagickExecutable: ""
    ffmpegExecutable: ""
    testFrameworkPreference: existing
```

设置所在文件为隔离 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。隔离 Home 根 patch 或启动 `--patch` 也可能覆盖它；修改前核对实际配置来源。patch 中同一条目的完整 `config` 会被替换，不是逐字段深合并，因此手动编辑时保留需要的全部字段。不要为本插件改变日常 Profile、全局启动器、账户或 HOME。

Web 设置页与 Host 使用同一原生配置。已有受支持的终端/TUI 宿主可使用同一文件路径；本机桌面分发没有现成 TUI Profile，不能把没有实际运行的 `dsh tui` 当作已验收入口。插件不为此引入新的工具平台。

## 保存后的行为

- **关闭桥接**立即拒绝后续派发，然后等待原生 MCP 释放连接与子进程。界面可短暂显示 `STOPPING`；清理完成前不启动第二条连接。
- **原目标重新启用**可由仍有效的当前定义会话重新连接；不承诺恢复被取消的写操作。
- **改变项目、引擎、桥接程序或端点**使旧会话失去调用权。新建采用已保存目标的 Godot 2D 会话，等待旧连接释放后接管。
- **插件热重载**使旧定义会话保持失效。新建采用当前定义的会话；无需借旧会话绕过原生 preset 生命周期。

`MCP_READY` 表示该次原生 MCP 初始化完成。编辑器是否在线由最近一次真实健康调用及其时间另行报告，不能把 MCP 状态当作持续在线监控或开发验收完成。细节见 [LIFECYCLE.md](LIFECYCLE.md)。

## 可选工具与引擎数据

只有显式允许且绝对路径探测为 `READY` 的 gdtoolkit、ImageMagick、FFmpeg 才进入插件能力提示。关闭会撤下提示，不承诺限制普通 Bash 的全部行为。工具缺失单独报告；GUT/gdUnit4 沿用工程已有框架，新增安装另行决定。C#/C++ 工程保留现有语言，不因使用预设迁移为 GDScript。

Godot 编辑器的 `_sc_` 和实际 `EditorPaths` 核查只隔离编辑器数据。macOS runtime `user://` 仍在 Application Support 下；辅助程序仅为新建工程分配唯一命名空间并在 ownership 中记录，卸载不会删除存档。不要向原 Godot 写 `_sc_`，不要把任务副本的签名处理套用于原应用。引擎签名或启动失败保留 stderr 并单独处理，不自动重签或升级。

## 从源码进行锁定构建

使用一个干净源码目录和新的外部构建依赖目录。`locks/build-package-lock.json` 锁定 esbuild `0.25.12`、TypeScript `5.9.3`，对应独立构建目录，不冒充源码根的 package-lock。下面命令不安装宿主 peer 或全局包。

```sh
export GAMEDEV_SOURCE='/absolute/path/to/dsh-gamedev-source'
export GAMEDEV_BUILD_DIR='/absolute/path/to/NEW-build-dependencies'
mkdir "$GAMEDEV_BUILD_DIR"
cp "$GAMEDEV_SOURCE/locks/build-package-lock.json" "$GAMEDEV_BUILD_DIR/package-lock.json"
node --input-type=module - "$GAMEDEV_BUILD_DIR" <<'JS'
import {readFileSync, writeFileSync} from 'node:fs';
const root = process.argv[2];
const lock = JSON.parse(readFileSync(root + '/package-lock.json', 'utf8'));
writeFileSync(root + '/package.json', JSON.stringify({
  name: lock.name, private: true, type: 'module',
  devDependencies: lock.packages[''].devDependencies,
}, null, 2) + '\n');
JS
npm ci --prefix "$GAMEDEV_BUILD_DIR" --include=dev --cache "$GAMEDEV_BUILD_DIR/npm-cache"
test ! -e "$GAMEDEV_SOURCE/node_modules"
test ! -L "$GAMEDEV_SOURCE/node_modules"
ln -s "$GAMEDEV_BUILD_DIR/node_modules" "$GAMEDEV_SOURCE/node_modules"
cd "$GAMEDEV_SOURCE"
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" run build
# Select an existing locked bridge venv for the complete installer AST tests.
export DSH_GAMEDEV_SETUP_TEST_PYTHON='/absolute/path/to/bridge-venv/bin/python'
"$DSH_GAMEDEV_SETUP_TEST_PYTHON" -I -c 'import yaml; assert yaml.__version__ == "6.0.3"'
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" test
python3 -B -m unittest discover -s tests/publication -p 'test_*.py' -v
python3 -B -m unittest discover -s tests/bridge -p 'test_guarded_main.py' -v
python3 -B tests/contracts/check_contracts.py
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" pack --dry-run
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" pack
```

插件构建本身只需锁定 Node 构建工具。完整安装器 AST 回归另需已有 Python 和 PyYAML `6.0.3`，通过 `DSH_GAMEDEV_SETUP_TEST_PYTHON` 显式选择；可复用已经按桥接锁安装的 venv。`locks/setup-test-requirements.lock` 是从桥接锁逐字复制的完整 PyYAML 包块，供 CI 临时 venv 按摘要安装，不是新增版本或全局依赖。没有选定 Python 时，这部分 Node 检查会明确 SKIP；不能把带 SKIP 的纯检查报告当作完整安装器验收。正式本机全量验收须使用已锁定环境并确认零 SKIP。

纯测试使用合成 fixture；bridge 测试需注明实际执行及跳过项。完整固定上游协议测试还需要锁定 Python 环境和本机 socket 权限。源码 CI 在临时 venv 中安装上述精确测试依赖，只验证其执行的纯检查，不发送模型请求，也不声明 Linux 原生 DSH/Godot/GUI 验收通过。

`dist/build-info.json` 标识生产输入指纹，tarball SHA-256 覆盖包全部字节。安装和真实验收必须绑定同一个最终 tarball，不能把另一个构建的结果沿用为本版通过。卸载与回退见 [UNINSTALL.md](UNINSTALL.md)。
