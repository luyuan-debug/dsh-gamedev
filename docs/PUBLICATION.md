# 公开源码范围

本项目原创插件、保护适配器、安装辅助程序、测试与作者文档按根目录 MIT LICENSE 开源。独立安装的 DSH、Godot、桥接、Python 依赖和可选工具保留各自许可，完整来源见 THIRD_PARTY_NOTICES.md 与锁定清单。无需把第三方二进制放进仓库才能重建本插件。

从一个全新目录按正向文件清单导出可复现源码，不把整个开发工作区或旧版完整交付包上传。公开树可含 `src/`、`bridge/`、`prompts/`、`skills/`、`catalog/`、`contracts/`、`locale/`、`locks/`、`scripts/`、合成 `tests/`、`docs/`、`.github/`、原始验收用例/未运行模板，以及根 package、patch、图标、LICENSE 和依赖账本。

排除本地依赖和缓存、DSH Home/Profile、账户、鉴权 URL、凭据 overlay、原始模型会话、个人路径、原游戏、编辑器状态、引擎副本、wheel、导出应用和私有完整验收日志。`acceptance/acceptance-results.json` 属于本地结果，不自动随模板发布。媒体、截图或 demo 如需公开，须先独立检查画面、元数据与许可，默认扫描拒绝未经审阅的二进制。

对确切的干净公开树运行：

```sh
python3 -B scripts/scan_publication.py /absolute/path/to/clean-public-export
```

然后人工审阅 scanner 的完整 manifest 与每一处 finding。扫描器只读，报告匹配值的摘要，不打印可能的私密值；它不自动改写或脱敏文件，也不忽略误复制的 `.gitignore` 项。合成测试的例外按确切文件和值限定，不给整个测试目录豁免。启发式扫描通过不能证明任意文本完全没有私有信息。

已经审阅的 Git 树可用 `python3 -B scripts/scan_publication.py . --tracked`。该选项只检查已跟踪文件；`.git` 历史不在扫描范围，所以首发从审阅后的新树建立全新历史。复用已有历史时必须另行审阅完整历史。

GitHub Actions 仅运行锁定构建、纯 Node/标准库测试、发布扫描回归和只读合同。它不持有模型账户、不发送模型请求、不启动真实 DSH/Godot，不表示 Linux 引擎或桌面支持。真实验收使用最终 tarball，公开报告只放必要版本、摘要、结果和限制；私有详细轨迹留在授权本地交付。
