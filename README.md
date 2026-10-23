<p align="center">
  <img src="icon.svg" width="72" height="72" alt="dsh-gamedev">
</p>

<h1 align="center">dsh-gamedev</h1>

<p align="center"><strong>用对话开发 Godot 2D 游戏。</strong></p>

<p align="center">
  <a href="https://github.com/luyuan-debug/dsh-gamedev/releases/latest">下载</a> ·
  <a href="docs/SETUP.md">安装指南</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="LICENSE">MIT</a>
</p>

**dsh-gamedev 是 DSH 的 Godot 2D 游戏开发插件。** 告诉它你想做的玩法，或把遇到的问题描述给它，它可以修改游戏脚本和场景、运行游戏，并根据报错继续修复。你可以在 Godot 编辑器中查看和调整结果。

从讨论玩法到动手实现，都在同一个开发对话里完成。

## 可以用它做什么

- **尝试一个游戏点子**：把玩法拆成可实现的小步骤，编写脚本、搭建场景，逐步做出原型。
- **继续完善游戏**：调整角色移动、交互、界面或游戏规则，并检查修改后的表现。
- **排查运行问题**：结合项目文件、编辑器状态和运行日志查找原因，修改后再运行检查。

例如，可以这样开始：

> 做一个俯视角 2D 原型，先实现角色移动和墙壁碰撞。完成后运行检查。

> 角色落地后偶尔还会播放跳跃动画，帮我找到原因并修复。

> 给当前游戏加一个暂停菜单，让我能继续游戏或返回主界面。

这些是任务示例。具体结果取决于所用模型、项目情况，以及你对运行效果的检查。

## 开始使用

1. 从 [Releases](https://github.com/luyuan-debug/dsh-gamedev/releases/latest) 下载安装包，按 [安装指南](docs/SETUP.md) 准备开发目录。
2. 启动后，在 DSH 中配置模型连接，新建会话，选择 **Godot 2D**，将工作目录设为安装目录内的 `project/`。
3. 描述一个具体的小目标，让它修改项目、运行检查，再根据你看到的效果继续调整。

安装程序会新建空白游戏工程，使用单独的 DSH 设置和 Godot 副本。已有游戏和日常配置会保留。每个开发目录对应一个游戏项目。

## 使用要求

当前发行版面向 **Apple Silicon Mac**，已验证的组合是：

| 软件 | 版本 |
| --- | --- |
| DSH | 0.2.1-rc.2 |
| Godot | 4.7.2 stable |
| Python | CPython 3.14 |
| Node.js | 24.14 及以上；25.x 需 25.4 及以上 |

请先安装这些软件。使用 Godot .NET 版时，还需要已有的 .NET SDK。详细路径和命令见 [安装指南](docs/SETUP.md)。

模型服务需要在 DSH 中自行配置；本插件不包含模型账户或订阅。当前主要面向 GDScript 开发，Windows、Linux 和完整 C# 开发流程尚未完成验证。

## 帮助与反馈

- [安装、启动与日常使用](docs/SETUP.md)
- [关闭与卸载](docs/UNINSTALL.md)
- [版本更新](CHANGELOG.md)
- [报告问题或提出建议](https://github.com/luyuan-debug/dsh-gamedev/issues)

报告问题时，请说明 DSH 和 Godot 版本、操作步骤、预期结果与实际现象。附日志前请去掉密钥和其他私人信息。

<details>
<summary>开发者资料</summary>

- [从源码构建与测试](docs/INSTALL.md#从源码进行锁定构建)
- [编辑器连接与故障恢复](docs/LIFECYCLE.md)
- [安装程序工作原理](docs/technical/SETUP.md)
- [卸载程序工作原理](docs/technical/UNINSTALL.md)
- [测试范围与记录](docs/VERIFICATION.md)
- [第三方依赖与许可](THIRD_PARTY_NOTICES.md)

</details>

## 开源许可

本项目采用 [MIT 许可证](LICENSE)。DSH、Godot 及其他依赖遵循各自的许可。
