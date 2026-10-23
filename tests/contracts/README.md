# 交付合同检查

使用 Python 3.10+ 标准库；只读取文件并向 stdout 输出 JSON，不联网、不安装依赖、不启动 DSH/Godot、不修改验收结果。

```sh
python3 tests/contracts/check_contracts.py
python3 tests/contracts/check_contracts.py --package /absolute/path/dsh-gamedev-0.1.0.tgz
```

可将 stdout 保存到外部交付证据目录。报告中的 sourceFingerprint 是按排序后的生产/构建输入路径和内容 SHA-256 形成的摘要；排除构建产物、依赖、缓存、测试、验收结果和 VERIFICATION.md，以避免报告自引用。tarballSha256 则覆盖交付包全部字节。

`--expected-source-fingerprint HEX` 可检查该定义的源码输入是否发生变化。它不替代 tarball SHA-256 或安装记录。

唯一 preset、唯一 Skill、零新增业务工具必须进一步查询实际 DSH registry；静态源码扫描不能证明运行注册行为。可传入实际原生宿主测试产生的 inventory：

```sh
python3 tests/contracts/check_contracts.py --native-inventory /absolute/path/native-inventory.json
```

inventory 要包含 `hostVersion`、证据引用 `evidence`、`ownedPresets: ["godot-2d"]`、`ownedSkills: ["godot-2d-workflow"]`、`newModelCallableTools: []` 及 `engineeringCapabilities` 中实际执行的 `read/search/edit/terminal/skill` 布尔结果。不要手写该文件来制造运行证据。

检查器 PASS 只表示被检查的交付合同通过，不能回填模型开发、图像链、GUI、Godot 或导出用例。`acceptance/acceptance-results.template.json` 保持全部 NOT_RUN；实际验收逐项填写证据。
