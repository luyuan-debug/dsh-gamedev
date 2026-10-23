# 日常隔离安装与启动

`dsh-gamedev-setup` 是用户显式运行的本地安装辅助程序，不进入 Agent 工具目录，不常驻，也不管理团队或任务。它用一个新工作目录承载一个原生 DSH Profile、一份 Godot 副本、固定桥接 venv 和一个空白游戏工程。不会把现有游戏复制进去或修改它，不改变日常 DSH Home、账户连接、原 Godot 或全局包管理配置。

本版已支持的安装组合为 **macOS arm64、DSH 0.2.1-rc.2、Godot 4.7.2 stable、已有 CPython 3.14、Node ≥24.14**。Python wheel 清单针对这个组合锁定，其他组合会明确拒绝，不自动找另一版引擎、解释器或依赖。安装原生 DSH/Godot/Python 不属于这个辅助程序。gdtoolkit、ImageMagick、FFmpeg 等可选项默认关闭，其缺失不影响核心准备。

源码中可用 `node scripts/setup.mjs`；插件包中的入口相同。若发布包提供了 `dsh-gamedev-setup` bin，可以用该命令替代下文的 `node /path/to/setup.mjs`。不需要全局 npm 安装。

## 第一步：只读检查已有程序

所有程序路径显式填写。**Mono Godot 必须另外给出已有 SDK 的 `--dotnet` 绝对路径**；标准版 Godot 不要求 .NET。辅助程序保留该调用路径，并只向该程序查询 `--list-runtimes`，把唯一的真实 Core runtime 根目录设为 `DOTNET_ROOT`（兼容 Homebrew 的 `bin/` 启动脚本），不自动查找、下载或升级 SDK。Godot 应指向完整 `.app/Contents/MacOS/Godot`，因为 .NET 版本运行还需要同版 Resources，不能只复制一个二进制。

```sh
node /path/to/setup.mjs doctor \
  --dsh '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
  --godot '/path/to/Godot_mono.app/Contents/MacOS/Godot' \
  --python '/path/to/python3.14' \
  --dotnet '/path/to/dotnet'
```

输出为 JSON。Mono 缺少显式 SDK、SDK 无法执行或版本输出无效都会返回 `NO_GO`。这里的 `GO` 只表示所列程序符合准备条件，不能代替编辑器、模型连接、图像与导出验收。`NO_GO` 会列出明确的缺项或版本问题。不会为修复检查结果而升级软件。

## 第二步：准备一个全新目录

从发行页取得插件 `.tgz` 及独立 `SHA256SUMS`，先核对摘要，再把确切 64 位摘要填给命令。目录父路径必须存在，`--workspace` 指向的目录必须尚不存在；即使空目录也不复用。参数中的路径包含空格时须引用。

默认端口为 DSH `53190`、桥接 `19090`。可用 `--port` 与 `--bridge-port` 改成其他未占用的 loopback 端口。发现占用直接停止，不终止原进程。

可选两种依赖来源。

**离线安装**需要本地 wheelhouse 已包含 `resolved-dependencies.json` 所列每个 wheel，以及固定版 `godot_mcp_addon.zip`。同名文件仍逐个核验摘要；缺任何核心依赖会停止并保留诊断。

```sh
node /path/to/setup.mjs prepare \
  --workspace '/path/to/NEW-gamedev-workspace' \
  --dsh '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
  --godot '/path/to/Godot_mono.app/Contents/MacOS/Godot' \
  --python '/path/to/python3.14' \
  --dotnet '/path/to/dotnet' \
  --package '/path/to/dsh-gamedev-0.2.0-HASH.tgz' \
  --package-sha256 'REPLACE_WITH_INDEPENDENT_64_HEX_DIGEST' \
  --offline --find-links '/path/to/wheelhouse'
```

**允许联网下载**时，将最后一行换成 `--allow-download`。可以同时给 `--find-links`，优先复用已核验的本地文件，只下载缺失文件。下载仅对网络超时、HTTP 429 与 5xx 重试，最多三次；摘要不符、越界重定向及其他 HTTP 错误立即拒绝。准备进程遵守既有 HTTP(S)_PROXY/NO_PROXY，不改系统代理，也不把代理值写入工作区或传给运行时。仅使用包内锁定的官方 GitHub Release/PyPI wheel 直链与摘要，不解析 `latest`，不安装源码发行包。下载先完成核验，再从本地目录执行 `pip --no-index --only-binary --require-hashes --no-deps`。不会在插件运行时自动补装。

准备阶段会执行以下确定动作：

1. 独立核对 tarball SHA、包名、宿主版本，以及归档路径与类型；拒绝归档链接、越界文件和安装生命周期脚本。
2. 在新目录写入专属 ownership manifest。创建独立 `DSH_HOME`、`DSH_AGENTS_HOME`、pnpm store/cache/config，关闭 pnpm 11 的 peer 自动安装，使用原生 `dsh plugin add` 安装本地摘要命名包，然后逐文件比较实际安装字节。
3. 复制传入 Godot `.app` 的程序与 Resources，不复制原编辑器的 `editor_data`。只在副本位置创建 `_sc_`，再真实运行一个短暂 headless 编辑器探针。`EditorPaths` 报告的 data/config/cache/marker 都必须实际位于新 workspace；仅有 `_sc_` 文件不算通过。没有签名修复、绕过校验或修改原应用的操作。随后在独立 state 探针工程实际启动 headless 游戏运行时；必须在 20 秒内返回本次随机身份、引擎版本、Mono 状态与唯一 `user://` 路径的准备标记。仅 `--version` 或退出码 0 不算通过，脚本解析错误或 hostfxr 未初始化也不会放行。
4. 以已有 Python 创建独立 venv，安装固定桥接并实际隔离导入其依赖，校验版本 `2026.10.20.1`。
5. 将同版原始 addon 安装到**新建空白工程**，记录每个文件的摘要，启用该工程插件。只创建一个 Godot 2D 的原生设置 override，保留 workspace-write 与 ask 审批。

准备成功返回 `READY`。失败返回非零并把目录标为 `FAILED`，保留日志和已下载文件，不清理或复用该目录，不改为较低保护级别继续。查明原因后可以选另一个全新目录重试。

## 第三步：检查并启动

```sh
node /path/to/setup.mjs doctor --workspace '/path/to/owned-gamedev-workspace'
node /path/to/setup.mjs launch --workspace '/path/to/owned-gamedev-workspace'
```

workspace 检查核对 ownership、显式 .NET 路径和真实根目录、固定桥接导入、addon、已安装插件字节、Godot 副本与已观测的编辑器路径，以及两个端口。只读版本检查不会启动游戏；针对已有 owned workspace 的 doctor 会在确认工作区空闲、Godot 副本路径与摘要通过后，为此次检查新建 `state/runtime-probe-*` 与单独日志，实际重做有时限的 headless 运行时探针，不接触游戏工程。macOS 主程序 standalone 签名也会单独检查；其 WARN 不等于 GUI 已通过，也不代表整个 `.app` 资源 seal 或 notarization 成功。辅助程序绝不自动重签。需要解决引擎启动问题时先保留证据，单独处理任务副本。

`launch` 只在进程内生成桥接随机令牌，以环境变量同时交给 DSH 和该工作区 Godot 副本。令牌不进入参数、YAML、ownership manifest 或日志；输出按行脱敏，包括跨输出分块的值。原生 DSH 在浏览器打开鉴权入口；`--no-open` 可抑制自动打开。终端只显示不含令牌的 loopback 地址。

在原生 DSH 界面自行选择/配置账户和模型连接；辅助程序不复制账户凭据、不开通付费 API、不自动发模型请求。新建普通会话，工作目录选择 `project/`，选择 **Godot 2D**。先执行原生桥接健康检查，再开始开发。一个隔离工作区绑定一个项目与一个写通道；另一个项目用另一全新工作区，不把活会话转向新游戏。

Mono 工作区的 DSH、编辑器及其运行时子进程只继承已选择的 `DOTNET_ROOT` 与 dotnet 调用目录。`DOTNET_CLI_HOME`、NuGet 包/HTTP 缓存和 MSBuild 用户扩展目录均指向本工作区，并关闭 SDK 遥测和首次体验提示；不复制全局 NuGet 配置或密钥，`HOME` 保持原值。

终端保持打开。`Ctrl+C` 正常结束本次直接启动的 DSH 和 Godot 子进程；任一子进程提前退出也会结束另一子进程。不会按名称搜索或 `pkill` 用户其他编辑器，不把 PID 文件当成终止外部进程的授权。若游戏通过系统启动器成为独立进程，先在 Godot 正常停止游戏；辅助程序不猜测或终止失去可证归属的进程。日志保留在 `logs/`。

`state/launch.lock` 防止并行启动与运行中卸载。异常断电或强制结束安装辅助程序可能留下锁；先核查其中 PID 和对应终端，确认该次宿主已停止，再由用户移除这**一个**陈旧锁。程序不凭 PID 相同就自动终止进程或删除锁。

## 卸载与保留数据

关闭游戏，正常结束 `launch`，再运行：

```sh
node /path/to/setup.mjs uninstall --workspace '/path/to/owned-gamedev-workspace'
```

只对 ownership 对应的隔离 Home 执行原生 `dsh plugin remove dsh-gamedev`。安装程序不再要求整个 Profile patch 与安装时完全一致：DSH onboarding 增加的 welcome 设置、其他插件 override，以及用户修改的本预设配置都可保留到卸载时。它使用固定桥接 venv 中已经锁定的 PyYAML 安全 AST 检查，**只移除 root sequence 中 `id: gamedev-settings` 且 `name: dsh-gamedev` 的条目**，按原文字跨度剪除，不重新序列化剩余 YAML。sandbox、approval、web、onboarding、其他插件及它们的注释和格式保留。重复 id/键、歧义名称、id 被改绑其他插件、别名/锚点、多文档、损坏 YAML 或不支持的标签会在原生 remove 前拒绝；错误只输出固定诊断代码，不输出配置内容。

执行前精确备份当前 patch，首次使用 `cordis.patch.yml.before-uninstall`，重试保留旧备份并创建带随机后缀的新备份。原生 CLI 完成后重新读取并解析它实际留下的文件；如果 CLI 已删掉自己的 override，直接保留它的当前文件；否则在再次检查源摘要后原子替换自己的条目，不覆盖 CLI 或其他写入者的新改动。发现并发修改会停止，保留当前 patch 与备份。失败不会删除游戏，也不会自动回滚 CLI 已执行的包管理动作；先查看诊断并确认相关写入者已停止，再重试或按 [UNINSTALL.md](UNINSTALL.md) 使用原生 CLI 审阅那一个 override。

卸载保留游戏、addon、源码、日志、存档、venv、Godot 副本及整个隔离 Home；不会递归删除 workspace，不删除其他插件或 Profile。需要回退时保留旧包及摘要，按原生卸载/安装步骤在停止的隔离 Profile 操作，勿覆盖同一路径不同 tarball。

**运行时存档不全在 workspace。** macOS `user://` 的基目录仍是 Application Support，不能由 `_sc_` 或绝对 `custom_user_dir_name` 重定向。辅助程序只为新建工程写入随机且唯一的 `DSH-GameDev/<workspace-name>-<random>` 名称，ownership 与 prepare/launch 输出均记录它；editor-probe 使用其下的独立子名称；每次运行时探针另用 `DSH-GameDev/runtime-probe-<uuid>`，确切路径记入本地结果和日志。HOME 保持原值。卸载不会清这些目录或任何原有存档。清理前应核对确切命名与内容。

## 验证边界

`tests/setup.test.mjs` 覆盖拒覆盖、路径与归档保护、摘要不符、分块脱敏、无 Shell 参数执行、端口占用、ownership/concurrency、Mono 缺少显式 .NET、SDK 根目录与环境隔离、运行时准备标记拒绝错误或假阳性，以及卸载保留工程和其他设置。真实 `prepare → doctor → launch → stop → relaunch → uninstall` 仍必须针对确切发行包记录原生宿主与 Godot 证据；单元/fixture 检查不能代替这条闭环。完整 AST/卸载 fixture 检查需要显式设置 `DSH_GAMEDEV_SETUP_TEST_PYTHON` 为已有且含锁定 PyYAML 的 Python 绝对路径；测试不自动寻找或安装 Python。缺少该变量时这些项目会明确 SKIP，不能当作完整验收通过。详见发行版 [VERIFICATION.md](../VERIFICATION.md)。

Godot 路径语义可核对官方 [EditorPaths 文档](https://docs.godotengine.org/en/4.4/classes/class_editorpaths.html)，实际 4.7.2 返回值由准备探针直接记录。
