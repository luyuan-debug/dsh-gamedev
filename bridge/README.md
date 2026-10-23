# Godot 编辑器连接保护

`guarded_main.py` 在启动固定版 Godot Editor MCP 时增加工程检查，防止命令发往错误游戏，或第二个编辑器替换正在使用的连接。它还保留部分错误结果中的“可能已修改”和“是否保存”信息，便于中断后检查项目状态。

该文件供插件和安装程序调用；日常启动请使用 [安装指南](../docs/SETUP.md) 中的 `launch`。

## 启动条件

需要在独立 Python 环境中安装 `godot-editor-mcp==2026.10.20.1`，并提供：

| 环境变量 | 内容 |
| --- | --- |
| `DSH_GAMEDEV_PROJECT_ROOT` | 允许操作的工程绝对路径 |
| `GODOT_MCP_PROJECT_DIR` | 同一个工程路径，按解析后的真实路径比较 |
| `GODOT_MCP_BRIDGE_TOKEN` | 与该工程 Godot 进程使用的同一个连接令牌 |

调用方式：

```sh
/absolute/path/to/bridge-venv/bin/python -I -B /absolute/path/to/plugin/bridge/guarded_main.py
```

目标目录需包含 `project.godot`。连接的编辑器需报告 Godot **4.7.2 stable** 和编辑器插件 **2026.10.20.1**。连接地址、日志和工具组设置沿用原服务端配置，令牌值不要写入日志。

## 工程检查

发送命令前先同步检查编辑器报告的项目和版本；身份未知或不匹配时拒绝发送。断开后需要重新报告并核对相同目标。若要切换目标，需重启连接程序。

连接接纳锁会拒绝第二个编辑器，包括同时认证的情况。每个被接纳的连接仍经过原服务端认证。若错误编辑器已经连接，先正常断开它，再连接正确编辑器。

这些检查用于避免误连接。拿到令牌的本机程序仍可能伪造编辑器身份；它们不能替代 DSH 审批和文件访问控制。

## 实现与错误信息

程序调用原包的 `mcp_server.main.main()`，只在内存中包装三个 `Bridge` 方法。不修改安装的 wheel 或编辑器插件，不增加模型工具，也不另写 MCP 传输协议。

原服务端转换工具错误时，会只保留错误、提示及必要字段。这里将已知操作结果附加到提示中，使纯文本错误仍可说明修改是否可能生效；保留原始错误和提示，不重试命令。

保留的字段为 `may_have_applied`、`persisted`、`partial`、`partial_success`、`applied`、`rollback`、`completed`、`failed`、`succeeded`、`rolled_back`、`rollback_failed`、`skipped`、`count`、`total`、`cancelled`、`completed_count`、`failed_count`、`applied_count`。仅复制受限的简单数值、布尔值、空值和固定状态词；复杂字段会注明省略，未知内容、脚本和密钥不复制。

因此，超时或断开后仍应先读取实际文件和场景，再决定是否重新执行。详细操作见 [故障排查](../docs/LIFECYCLE.md)。

## 测试

在源码目录中使用已有 Python 环境运行：

```sh
python -I -B -m unittest discover -s tests/bridge -v
```

测试覆盖连接竞争、重连、错误项目和版本拒绝、参数与超时传递、错误信息保留及令牌遮蔽。完整协议测试需要已经安装的固定依赖；缺失时会显示跳过，请在结果中注明。

本机通信测试只绑定 `127.0.0.1` 的临时端口，检查认证、命令往返及错误编辑器拒绝，结束后关闭连接，不启动 Godot。真实编辑器测试结果见 [测试说明](../docs/VERIFICATION.md)。
