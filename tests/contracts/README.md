# 源码与安装包结构检查

`check_contracts.py` 检查插件名称、导出文件、依赖、配置、测试用例和安装包内容是否符合项目约定。它使用 Python 3.10+ 标准库，只读取文件并向终端输出 JSON，不启动 DSH、Godot 或模型服务。

从源码目录运行：

```sh
python3 -B tests/contracts/check_contracts.py
python3 -B tests/contracts/check_contracts.py --package /absolute/path/to/dsh-gamedev-0.2.0-HASH.tgz
```

请先构建源码，以生成检查所需的 `dist/` 文件。`HASH` 是文件名示意，请替换为实际包名。

报告中的 `sourceFingerprint` 根据源码和构建输入生成，用来检查输入是否变化；`tarballSha256` 覆盖整个安装包。可以用 `--expected-source-fingerprint HEX` 与先前记录的源码摘要比较，两种摘要不能混用。

## 检查 DSH 中实际注册的内容

实际运行 DSH 后，可以向检查器提供测试程序导出的注册清单：

```sh
python3 -B tests/contracts/check_contracts.py --native-inventory /absolute/path/to/native-inventory.json
```

清单需要包含 `hostVersion`、`evidence`、`ownedPresets: ["godot-2d"]`、`ownedSkills: ["godot-2d-workflow"]`、`newModelCallableTools: []`，以及 `engineeringCapabilities` 中实际执行的 `read/search/edit/terminal/skill` 结果。它应来自实际运行记录，不能用手写声明代替。

检查通过只说明本次检查的源码和安装包结构符合约定。游戏运行、画面、模型开发和导出需要单独测试，见 [测试说明](../../docs/VERIFICATION.md)。
