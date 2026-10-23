<p align="center">
  <img src="icon.svg" width="72" height="72" alt="dsh-gamedev">
</p>

<h1 align="center">dsh-gamedev</h1>

<p align="center">
  <strong>在 DSH 中，把想法做成可运行的 Godot 2D 游戏。</strong><br>
  Design, build, debug and verify — one Godot 2D preset for DSH.
</p>

<p align="center">
  <a href="https://github.com/luyuan-debug/dsh-gamedev/actions/workflows/source-checks.yml"><img src="https://github.com/luyuan-debug/dsh-gamedev/actions/workflows/source-checks.yml/badge.svg" alt="Source checks"></a>
  &nbsp; <a href="LICENSE">MIT License</a>
  &nbsp; · &nbsp; <a href="https://github.com/luyuan-debug/dsh-gamedev/releases/tag/v0.2.0">v0.2.0</a>
  &nbsp; · &nbsp; macOS arm64
</p>

<p align="center">
  <a href="docs/SETUP.md">快速开始</a> ·
  <a href="https://github.com/luyuan-debug/dsh-gamedev/releases/latest">下载发行版</a> ·
  <a href="docs/INSTALL.md">安装与配置</a> ·
  <a href="CHANGELOG.md">版本日志</a>
</p>

## 一个预设，贯穿开发流程

**dsh-gamedev** 为 DSH 提供一个通用的 **Godot 2D** 预设，让同一 Agent 连贯完成必要设计、代码与场景修改、调试、运行和验证。它组合 DSH 原生工程工具与固定版本的 Godot MCP，提供一套工作流 Skill 和一个设置页。

- **连贯开发** — 在同一会话中理解项目、修改代码、编辑场景并检查结果。
- **直接连接编辑器** — 校验项目与编辑器身份，让会话绑定明确的开发目标。
- **可预测的连接生命周期** — 支持停用、清理、重新连接及热重载后的会话隔离；传输恢复不会重放失败的写入。
- **独立开发环境** — 专用 DSH Profile、Godot 副本和 Python venv，依赖版本与摘要均已锁定。
- **清晰的诊断** — 查看连接拥有者、已保存与已应用的配置代次，以及最近一次健康检查。

## 快速开始

### 1. 下载发行版

从 [Releases](https://github.com/luyuan-debug/dsh-gamedev/releases/latest) 下载安装包 `.tgz` 和 `SHA256SUMS`，核对安装包对应的 SHA-256。源码、公开验证摘要和证据压缩包也在同一发行页提供。

以 v0.2.0 为例，解开安装辅助程序：

```sh
tar -xzf dsh-gamedev-0.2.0-00689ce92d4e.tgz
node package/scripts/setup.mjs --help
```

### 2. 准备独立工作区

按 [隔离安装指南](docs/SETUP.md) 显式选择已有的 DSH、Godot、Python 与必要的 .NET 程序，完成 `doctor → prepare → doctor`。准备过程使用一个全新目录，可选择核验本地依赖或下载锁定的官方文件。

准备完成后，日常启动只需：

```sh
node package/scripts/setup.mjs launch \
  --workspace '/absolute/path/to/gamedev-workspace'
```

### 3. 开始开发

在原生 DSH 界面配置模型连接，新建工作目录为工作区 `project/` 的会话，选择 **Godot 2D**。先执行桥接健康检查，再开始修改项目。结束时先停止游戏，再在启动终端按 `Ctrl+C`。

> 模型账户由 DSH 管理。安装器不会复制凭据或自动发送模型请求。

## 已验证环境

| 组件 | v0.2.0 验证范围 |
| --- | --- |
| 系统 | macOS arm64 |
| DSH | `0.2.1-rc.2` |
| Godot | `4.7.2 stable`，含 Mono 运行验证 |
| Godot MCP 服务端 / addon | `2026.10.20.1` |
| Python | CPython `3.14`；依赖 wheel 针对 macOS arm64 锁定 |
| Node.js | `24.21.0` 已验证；安装器要求 `24.14+`（25.x 分支需 `25.4+`） |
| .NET | Mono 版需显式指定已有 SDK；已验证 `10.0.302` |

当前使用本机 stdio 桥接，一次由一个会话持有编辑器连接。HTTP 保留为不可启用的候选模式。gdtoolkit、ImageMagick、FFmpeg 等已有工具可按需允许使用，缺失不影响无关的核心工作。

## 版本验证

以下结果对应固定的 [v0.2.0 发布快照](https://github.com/luyuan-debug/dsh-gamedev/tree/v0.2.0)，安装包与验收摘要保持同一制品绑定。

| 范围 | 结果 |
| --- | --- |
| 源码回归 | 112 项通过，零跳过 |
| 固定桥接回归 | 25 项通过 |
| 源码、安装包与原生合同检查 | 59 项通过 |
| 真实生命周期 | 13 项通过，含 20 轮连接停用 / 启用 |
| 真实安装与卸载 | 2 轮应用启动 / 停止，并验证配置与工程保留 |
| 真实模型增量开发 | 游戏检查 47 → 47；独立检查 10 项，完整宿主重启后再验证 10 项 |
| C# 基线 | 10 项离线编译 / 引擎运行断言 |

[验证方法与支持边界](docs/VERIFICATION.md) · [发行版机器摘要](https://github.com/luyuan-debug/dsh-gamedev/blob/v0.2.0/verification.json) · [CI](https://github.com/luyuan-debug/dsh-gamedev/actions)

Linux CI 验证可移植源码检查。完整 C# Agent 工作流、C++、其他平台以及视觉、音频和导出场景的覆盖范围，以对应版本的验证记录为准。

## 文档

| 想了解什么 | 文档 |
| --- | --- |
| 安装、检查和日常启动 | [SETUP](docs/SETUP.md) |
| 原生设置与锁定构建 | [INSTALL](docs/INSTALL.md) |
| 连接归属、热重载与故障恢复 | [LIFECYCLE](docs/LIFECYCLE.md) |
| 卸载与版本回退 | [UNINSTALL](docs/UNINSTALL.md) |
| 验证方法与完整范围 | [VERIFICATION](docs/VERIFICATION.md) |
| 第三方依赖与许可 | [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md) |

## 参与改进

欢迎通过 [Issues](https://github.com/luyuan-debug/dsh-gamedev/issues) 提交问题或建议。报告问题时，请附上 DSH / Godot 版本、复现步骤以及预期和实际行为。提交代码前请参考 [锁定构建与测试说明](docs/INSTALL.md#从源码进行锁定构建)。

## License

原创源码采用 [MIT License](LICENSE)。DSH、Godot、桥接及其他独立依赖保留各自许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
