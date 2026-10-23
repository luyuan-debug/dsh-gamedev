# 安装程序参考

本页说明 `scripts/setup.mjs` 的命令、文件布局和失败处理，供排查安装问题或修改安装程序时使用。首次安装请先阅读 [操作指南](../SETUP.md)。

## 命令

| 命令 | 作用 |
| --- | --- |
| `doctor` 加软件路径 | 检查指定的 DSH、Godot、Python 和可选 .NET SDK |
| `prepare` | 在尚不存在的目录中安装插件、依赖和 Godot 副本，并创建空白工程 |
| `doctor --workspace PATH` | 核对开发目录中的文件，并运行一个临时测试工程检查引擎能否启动 |
| `launch --workspace PATH` | 启动该目录的 DSH 和 Godot |
| `uninstall --workspace PATH` | 从该目录的 DSH 配置中移除本插件，保留工程和数据 |

用 `node package/scripts/setup.mjs --help` 查看参数。程序需要已有的软件，不负责安装或升级 DSH、Godot、Python 和 .NET SDK。

## 软件路径与版本

当前安装组合为 macOS arm64、DSH **0.2.1-rc.2**、Godot **4.7.2 stable**、CPython **3.14** 和 Node.js **24.14+**（25.x 需 25.4+）。下载清单中的 Python wheel 针对此系统与解释器锁定，其他组合会停止安装。

Godot 路径需要指向完整 `.app/Contents/MacOS/Godot`；程序和 `Resources` 必须同版。使用 .NET 版时，需显式提供已有 SDK 的 `--dotnet` 路径。安装程序查询其 runtime 目录并设置 `DOTNET_ROOT`，不会另外查找或下载 SDK。

编辑器检查会读取实际 `EditorPaths`，确认配置、缓存和数据目录位于新开发目录中。随后启动一个独立的无窗口测试工程，要求它在 20 秒内报告引擎版本、运行环境和自己的存档路径。仅 `--version` 成功或退出码为零，不足以证明游戏运行环境可用。

## 依赖下载与离线安装

`prepare --allow-download` 允许下载 [依赖清单](../../resolved-dependencies.json) 中已经锁定的 GitHub Release 文件与 PyPI wheel。文件会先核对 SHA-256，再从本地安装；不下载源码包，也不改用其他版本。

离线安装时，将操作指南中命令末尾的 `--allow-download` 换成：

```sh
--offline --find-links '/absolute/path/to/wheelhouse'
```

该目录需包含全部选定 wheel 和固定版 `godot_mcp_addon.zip`。也可同时使用 `--allow-download --find-links PATH`，复用已核对的本地文件，只下载缺失项。

下载遵守已有代理设置，不修改系统代理。网络超时、HTTP 429 和 5xx 最多重试三次；摘要错误、其他 HTTP 错误和不允许的重定向会停止。插件运行时不会自动补装依赖。

## 新建目录中保存什么

- `project/`：新建的 Godot 游戏工程和同版编辑器插件。
- `deps/`：Godot 副本和依赖文件。
- 独立的 DSH Home、Profile、Python 环境及包缓存。
- `logs/`：安装、检查和运行日志。
- `state/`：启动锁与临时引擎测试数据。
- 安装记录：用于确认此目录由安装程序创建，并记录安装内容、路径和校验值。

安装前会核对 `.tgz` 的摘要、包名、DSH 版本、归档路径与文件类型。程序拒绝归档链接、目录越界文件和安装脚本；安装后再次比较包内文件与实际安装内容。

Godot 副本只复制程序及资源，不复制原有编辑器数据，也不修改原应用。程序创建 `_sc_` 以启用编辑器独立数据模式，但仍会读取实际路径检查结果。签名或启动失败会保留日志，不自动重签。测试使用的特定引擎副本签名情况见 [测试说明](../VERIFICATION.md#引擎副本与数据位置)。

Python 依赖安装在独立环境中。DSH 的配置、缓存和插件安装也使用这个开发目录。安装程序保留 DSH 的工作区与审批设置。

## 启动、关闭与运行数据

`launch` 每次在内存中生成连接令牌，同时交给它启动的 DSH 和 Godot。令牌不写入命令行参数或配置文件，日志会遮去该值。`--no-open` 可关闭自动打开浏览器页面的行为。

模型连接仍需在 DSH 中配置。安装程序不复制账户、不自动发送模型请求。

启动终端应保持打开。先在 Godot 中停止游戏，再按 `Ctrl+C`；程序只结束自己直接启动的 DSH 和 Godot 子进程。若其中一个退出，也会结束另一个。通过系统启动器独立运行的游戏需在编辑器中正常停止，程序不会按名称搜索或终止其他编辑器。

.NET 工作目录、NuGet 缓存和 MSBuild 用户目录均指向开发目录，SDK 遥测与首次体验提示关闭；不复制全局 NuGet 密钥，系统 `HOME` 保持原值。

游戏的 `user://` 存档仍可能位于 macOS Application Support 下，名称为 `DSH-GameDev/<workspace-name>-<random>`。临时引擎检查使用另外的随机名称，路径记在检查结果中。编辑器独立模式不会把这些存档迁回开发目录，卸载也不会删除它们。

## 失败与恢复

- `NO_GO`：软件路径、版本或必要条件不满足；按输出修正后重试。
- `FAILED`：准备中途失败；保留目录和日志，解决原因后选择另一个尚不存在的目录。
- 端口占用：选择其他空闲端口，不终止原进程。
- `state/launch.lock` 已存在：先确认是否仍有启动终端或进程运行。强制退出可能留下旧锁；核对其中 PID 与对应进程，确认已经结束后，只移除这一个旧锁。

检查已有开发目录时，`doctor` 会在确认空闲后创建临时测试数据和日志，不修改游戏工程。命令结果用于诊断，编辑器画面、模型连接与游戏导出还需单独检查。

## 自动化测试

`tests/setup.test.mjs` 覆盖路径、归档、摘要、端口、日志遮蔽、并发启动、.NET 目录和卸载设置保留等情况。完整设置文件测试需要通过 `DSH_GAMEDEV_SETUP_TEST_PYTHON` 指定含 PyYAML **6.0.3** 的 Python。

安装到真实 DSH、操作真实 Godot 和模型修改游戏的测试结果，见 [测试说明](../VERIFICATION.md)。
