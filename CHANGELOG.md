# Changelog

## [0.2.0] — 2026-10-23

首个 GitHub 公开发行版，重点改进连接生命周期、隔离安装和日常诊断。

### Added

- `doctor`、`prepare`、`launch`、`uninstall` 隔离安装辅助流程。
- 编辑器数据路径核查与 Mono headless 游戏运行探针。
- 设置页中的连接拥有者、配置代次和最近健康检查信息。
- 锁定依赖、公开验证摘要及源码检查 CI。

### Improved

- 将编辑器连接绑定到确切的会话对象与当前预设定义。
- 在停用、会话关闭和插件重载时，先撤销新调用，再等待原生连接释放。
- 提供有界的原生传输恢复，避免重放失败的写操作。
- 卸载只移除自有设置项，保留其他配置、注释、工程与存档。

### Validation

- 112 项源码回归、25 项桥接回归、59 项源码 / 原生合同检查。
- 13 项真实生命周期场景，含 20 轮连接停用 / 启用。
- 2 轮真实应用启动 / 停止与原生卸载。
- 一次真实模型增量修改、游戏回归及完整宿主重启复验。
- 10 项独立 C# 编译 / 引擎运行基线。

验证数据、支持范围和固定资产摘要见 [v0.2.0 Release] 与 [验证说明](docs/VERIFICATION.md)。

[0.2.0]: https://github.com/luyuan-debug/dsh-gamedev/releases/tag/v0.2.0
[v0.2.0 Release]: https://github.com/luyuan-debug/dsh-gamedev/releases/tag/v0.2.0
