# 测试用例与结果模板

这里保存项目的 49 个测试用例，其中 38 个是核心要求。它们用于安排测试，不表示所有功能已经通过。

- `cases.json`：每个用例的编号、准备条件、操作和预期结果。
- `acceptance-results.template.json`：重新测试时使用的空白模板，初始状态均为 `NOT_RUN`。
- [测试用例覆盖表](../docs/TRACEABILITY.md)：用例与源码、自动化测试的对应位置。
- [当前发行版结果](../docs/VERIFICATION.md)：已经执行的检查与支持范围。

运行测试时，将模板另存为本地结果文件，按实际情况填写结果和证据位置。结果可使用 `PASS`（通过）、`FAIL`（失败）、`BLOCKED`（条件不足）、`NOT_RUN`（未运行）或说明原因的 `NOT_APPLICABLE`（不适用）。

本地结果与详细日志不默认上传。公开的 v0.2.0 结果在 [发布页](https://github.com/luyuan-debug/dsh-gamedev/releases/tag/v0.2.0)的 `verification.json` 和测试资料中。

用例中的 `fixture` 指可丢弃的测试工程或合成测试数据；`Profile` 指 DSH 的一组独立配置。`native-host` 检查实际 DSH，`engine-integration` 检查 Godot，`real-model` 检查模型实际操作，`gui-runtime` 检查游戏窗口与交互。
