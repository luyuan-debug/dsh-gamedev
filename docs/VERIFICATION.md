# dsh-gamedev 0.2.0 验收方法与发行状态

本文件规定 0.2.0 的验收方法与支持边界。确切发行包 SHA-256、实际安装字节、原生进程、Godot 与模型结果由 [v0.2.0 发行附件](https://github.com/luyuan-debug/dsh-gamedev/releases/tag/v0.2.0) 中的独立验收摘要及本地完整证据记录；文档或版本号本身不能代替这些证据。0.1.0 的通过项不自动作为新生命周期和安装代码的通过项。

## 源码回归基线

本版 macOS 源码基线已运行 112 项 Node 检查（含 16 项生命周期并发、48 项安装 fixture）、25 项固定桥接与保护适配器检查、10 项发布扫描回归，均通过；只读源码合同检查通过。最终发行还需对确切 tarball 分别完成以下真实验收。安装 fixture 的端口测试需要 loopback 权限；沙箱拒绝 listen 与产品断言失败分开记录。

这些是源码级结果，不单独证明真实 DSH 挂载/释放、安装闭环、模型开发或画面正确。完整环境与逐项结论以发行附件为准。

## 必须分别记录的证据

| 层次 | 核验内容 | 不可推定的结论 |
| --- | --- | --- |
| 静态与纯检查 | 包内容、唯一预设/Skill、配置、UI、输入、许可、锁、生产指纹及发布隐私扫描 | 不证明 native scope、MCP 或游戏行为 |
| 隔离安装闭环 | 同一 tarball 的 prepare、doctor、launch、stop、relaunch、uninstall；实际安装逐文件比较；编辑器实际路径 | doctor GO 不等于编辑器/模型可用 |
| 原生生命周期 | 精确拥有者、定义代次、禁用与清理、启动期撤销、会话交替、目标变更、热重载、有限重连与不重放 | 合成 lease 测试不代替原生进程和端口证据 |
| 真实 Godot | 固定桥接/addon、错项目拒绝、第二 peer、读写保存重开、解析错误、运行日志、输入释放、GUI 与导出 | headless 退出 0 不等于零解析错误或实际画面正确 |
| 授权模型开发 | 本版实际模型链创建/修改/修复小样，保留失败基线与回归；图片确实到达视觉模型 | 手动调用工具或仅提供图片路径不等于 Agent 完成开发或看图 |

原始执行包的 49 项 ID 与 38 项核心项保持不变，见 `acceptance/cases.json`、[TRACEABILITY.md](TRACEABILITY.md)。模板 `acceptance/acceptance-results.template.json` 保持未运行初态。实际结果使用 `PASS`、`FAIL`、`BLOCKED`、`NOT_RUN` 或有理由的 `NOT_APPLICABLE`；不得以缺少证据代替通过。

生产输入指纹位于 `dist/build-info.json`。tarball SHA-256 覆盖包全部字节；源码树摘要标识公开源码；安装审查比较 tarball 与隔离 Profile 的真实文件。这些摘要用途不同，版本号相同不能互相替代。可安装包中不包含整套私有验收日志。

## 发行支持边界

目标组合为 DSH `0.2.1-rc.2`、Godot `4.7.2 stable`、bridge/addon `2026.10.20.1`、macOS arm64、CPython 3.14。依赖精确来源、artifact 摘要和许可见 `resolved-dependencies.json`、`locks/`、`THIRD_PARTY_NOTICES.md`。如使用任务副本的本地签名处理，应记录单独 provenance；不能推定原始引擎发行包的签名或 notarization。

stdio 受支持；HTTP 因当前 native SDK 无法约束每次重定向到 loopback 而拒绝启用。只有显式允许且实际探测 `READY` 的可选 CLI 才进入能力提示。可选项缺失不阻断无关核心实现。

C#、C++、GUT/gdUnit4、Projects 深层业务、Gua、DCC、Pixelorama、Linux 第二平台、TUI、音频试听等按实际条件和证据逐项报告；Mac GDScript 结果不能替代。纯 Linux CI 不发送模型请求，也不声明原生 DSH/Godot 支持。

macOS runtime `user://` 仍在 Application Support 的唯一新建命名空间。编辑器 `_sc_` 不能把它迁回 workspace；确切名称在隔离工作区 ownership 与本地交付报告中，卸载不删存档。

## 开源发布与私有证据

公开源码使用新的正向文件清单导出并扫描。仅包含可复现源码、合成测试、文档、锁和经过审阅的汇总；不包含账户、令牌、鉴权 URL、个人路径、会话轨迹、原工程、引擎副本、wheel 或旧版完整交付包。私有完整证据仅留在授权本地交付。

GitHub Actions 运行源码检查及静态合同，不使用模型账户或秘密。CI 的实际状态以该 commit 的运行结果为准；工作流存在本身不等于已通过。发布前仍需对最终公开树运行 `scripts/scan_publication.py` 并审阅完整 manifest，启发式扫描不能保证任意文本没有私有信息。
