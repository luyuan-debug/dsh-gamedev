# 安装与日常使用

这份指南会为你创建一个专用开发目录，其中包含 Godot 副本、DSH 设置和一个空白游戏工程。已有游戏、原版 Godot 和日常 DSH 配置会保留。

## 安装前准备

当前支持 Apple Silicon Mac。请先准备：

- DSH **0.2.1-rc.2**。
- Godot **4.7.2 stable** 的完整 `.app`。
- CPython **3.14**。
- Node.js **24.14+**；若使用 25.x，需 **25.4+**。
- 使用 Godot .NET 版时，还需要已有的 .NET SDK；已验证版本为 **10.0.302**。

DSH 中还需要配置可用的模型连接。本插件不提供模型账户。

下文所有 `/path/to/…` 都需要换成你本机的真实绝对路径。路径含空格时保留引号。

## 1. 下载并解压

从 [v0.2.0 下载页](https://github.com/luyuan-debug/dsh-gamedev/releases/tag/v0.2.0) 下载：

- `dsh-gamedev-0.2.0-00689ce92d4e.tgz`：插件和安装程序。
- `SHA256SUMS`：用于核对下载文件。

在下载目录打开终端，核对安装包：

```sh
shasum -a 256 dsh-gamedev-0.2.0-00689ce92d4e.tgz
```

输出应与 `SHA256SUMS` 中该文件对应的一行一致：

```text
00689ce92d4e60be88f3addf486d11c4d4bc4150616e435af683c1a1952c73c2
```

然后解压：

```sh
tar -xzf dsh-gamedev-0.2.0-00689ce92d4e.tgz
```

后续命令均在这个目录中执行，使用解压得到的 `package/scripts/setup.mjs`。

## 2. 检查所需软件

下面以 Godot .NET 版为例。若使用标准版，删掉 `--dotnet` 所在的整行，并将 Godot 路径换成标准版的路径。

```sh
node package/scripts/setup.mjs doctor \
  --dsh '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
  --godot '/path/to/Godot_mono.app/Contents/MacOS/Godot' \
  --python '/path/to/python3.14' \
  --dotnet '/path/to/dotnet'
```

检查结果为 `GO` 时继续。若显示 `NO_GO`，先按输出补齐缺失软件或修正路径。检查不会自动升级已有软件。

## 3. 创建开发目录

选择一个**尚不存在的目录**，其父目录需要已经存在。安装程序会创建它；不要选现有游戏目录，也不要提前新建空目录。

```sh
node package/scripts/setup.mjs prepare \
  --workspace '/path/to/NEW-gamedev-workspace' \
  --dsh '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' \
  --godot '/path/to/Godot_mono.app/Contents/MacOS/Godot' \
  --python '/path/to/python3.14' \
  --dotnet '/path/to/dotnet' \
  --package '/path/to/dsh-gamedev-0.2.0-00689ce92d4e.tgz' \
  --package-sha256 '00689ce92d4e60be88f3addf486d11c4d4bc4150616e435af683c1a1952c73c2' \
  --allow-download
```

这一步会复制 Godot、安装插件、下载并校验所需依赖，再创建空白游戏工程。完成后显示 `READY`。标准版 Godot 同样需要删掉 `--dotnet` 一行。

默认使用本机端口 `53190` 和 `19090`。若提示端口占用，可在命令末尾增加 `--port 53191 --bridge-port 19091`，选用其他空闲端口。

安装失败时请保留输出和目录内的 `logs/`。解决问题后，换一个尚不存在的目录重试。需要离线安装时，见 [离线安装说明](technical/SETUP.md#第二步准备一个全新目录)。

## 4. 启动并开始开发

```sh
node package/scripts/setup.mjs launch \
  --workspace '/path/to/NEW-gamedev-workspace'
```

启动后：

1. 在打开的 DSH 页面中配置模型连接。
2. 新建会话，工作目录选择开发目录内的 `project/`，选择 **Godot 2D**。
3. 在 **Settings → Godot 2D** 检查编辑器连接。连接正常后，描述你要实现的功能。
4. 在 Godot 中查看运行效果，把需要调整的地方继续告诉它。

建议从一个小目标开始，例如先做角色移动，再添加碰撞和交互。修改途中遇到连接中断，先让它检查文件和场景的当前状态，再决定如何继续。

保持启动终端打开。结束开发时，先在 Godot 中停止游戏，再回到终端按 `Ctrl+C`。下次使用时，重新运行同一条 `launch` 命令即可。

## 常见问题

**连接不上编辑器怎么办？**

确认启动终端仍在运行，DSH 和 Godot 都由该开发目录启动，当前会话使用的是 `project/`。关闭旧的开发会话后再新建会话重试；仍失败时，保存设置页状态和 `logs/` 中的日志，提交 [Issue](https://github.com/luyuan-debug/dsh-gamedev/issues)。

**能同时开发两个游戏吗？**

为每个游戏创建单独的开发目录，并选择不同的端口。一个目录里的编辑器连接供一个开发会话使用。

**能直接接管现有游戏吗？**

本安装流程创建新工程，不会自动导入或修改已有游戏。首次使用请从新工程开始；迁移已有工程前应先备份。

**缺少图片、音频或格式检查工具会影响安装吗？**

这些是按需使用的可选工具，缺少它们不会阻止无关的脚本、场景修改与运行。

**如何卸载？**

见 [关闭与卸载](UNINSTALL.md)。

更详细的依赖、目录、日志和故障处理机制见 [安装程序工作原理](technical/SETUP.md)。
