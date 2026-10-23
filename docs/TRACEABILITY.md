# 测试用例覆盖表

这份清单列出 49 个检查目标，其中 38 个为核心要求。编号对应 [cases.json](../acceptance/cases.json)，供维护者定位测试；它不是逐项通过报告。

当前发行版已经执行的检查与未验证功能见 [测试说明](VERIFICATION.md)。空白结果模板保持 `NOT_RUN`，重新测试时另存一份，并记录实际结果与证据。源码检查、编辑器运行和模型开发分别记录，不能互相替代。

| 编号 | 适用范围 | 检查目标 | 源码或检查方式 |
| --- | --- | --- | --- |
| P01 | 核心 | 安装包可安装 | [插件入口](../src/index.ts) / [结构检查](../tests/contracts/README.md) |
| P02 | 核心 | 一个 Godot 2D 预设与一个工作流 | [插件入口](../src/index.ts) / [结构检查](../tests/contracts/README.md) |
| P03 | 核心 | 保留 DSH 文件、搜索与终端工具 | [插件入口](../src/index.ts) / [结构检查](../tests/contracts/README.md) |
| P04 | 核心 | 其他开发模式保持原状 | [插件入口](../src/index.ts) / [结构检查](../tests/contracts/README.md) |
| P05 | 核心 | 包内不含个人路径、密钥或缓存 | [插件入口](../src/index.ts) / [结构检查](../tests/contracts/README.md) |
| C01 | 核心 | 缺少配置时不自动安装 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C02 | 核心 | 检查必要设置 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C03 | 核心 | 错误设置不覆盖有效值 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C04 | 核心 | 可选工具缺失或关闭 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C05 | 核心 | 配置变更后不切换旧会话目标 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C06 | 核心 | 关闭连接后拒绝新调用 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C07 | 核心 | 只修改本插件设置 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| C08 | 核心 | 设置页与配置文件操作 | [设置校验](../src/config.ts) / [设置页](../src/client.tsx) / `tests/config.test.mjs` |
| M01 | 核心 | 连接初始化与离线状态 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M02 | 核心 | 默认可用的编辑器工具 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M03 | 核心 | 开启工具组后能实际调用 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M04 | 核心 | 拒绝修改错误工程 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M05 | 核心 | 重连时拒绝替换编辑器 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M06 | 核心 | 端口与重复连接冲突 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M07 | 核心 | 检查和服务进程退出后清理 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M08 | 核心 | 工具组开关不扩大会话权限 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M09 | 核心 | 保留 DSH 操作审批 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M10 | 核心 | 写操作超时后先检查结果 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M11 | 核心 | 模型实际收到运行画面 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M12 | 核心 | 模型不能看图时明确说明 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M13 | 核心 | 取消输入后释放按键 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M14 | 核心 | 多个会话的连接限制 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| M15 | 核心 | 卸载时不关闭用户已有进程 | [会话连接](../src/session.ts) / [连接保护](../bridge/README.md) / `tests/bridge/` |
| F01 | 核心 | 通过对话创建可运行的 2D 示例 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F02 | 核心 | 保存场景后重新打开 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F03 | 核心 | 修改已有工程 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F04 | 核心 | 复现、修复并重新测试错误 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F05 | 核心 | 界面、分辨率和输入 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F06 | 核心 | 资源处理与导入 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F07 | 核心 | 脚本错误与失败结果 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| F08 | 核心 | 导出并运行同平台调试版 | [开发工作流](../skills/godot-2d-workflow/SKILL.md) / 真实编辑器与模型测试 |
| L01 | 按项目或环境选择 | 保留并构建 C# 工程 | [构建参考](../skills/godot-2d-workflow/references/testing.md) / 对应语言工具链 |
| L02 | 按项目或环境选择 | 保留并构建 C++ 工程 | [构建参考](../skills/godot-2d-workflow/references/testing.md) / 对应语言工具链 |
| O01 | 按项目或环境选择 | 调用已有可选命令行工具 | [工具目录](../catalog/README.md) / 可选工具测试 |
| O02 | 按项目或环境选择 | 使用已有测试框架 | [工具目录](../catalog/README.md) / 可选工具测试 |
| O03 | 按项目或环境选择 | Gua 交互测试 | [工具目录](../catalog/README.md) / 可选工具测试 |
| O04 | 按项目或环境选择 | 创作工具连接测试 | [工具目录](../catalog/README.md) / 可选工具测试 |
| X01 | 按项目或环境选择 | 与 Projects 共存时互不干扰 | [功能约定](../contracts/README.md) / 独立应用环境测试 |
| X02 | 按项目或环境选择 | 与 Agent Team 共存时保持各自功能 | [功能约定](../contracts/README.md) / 独立应用环境测试 |
| X03 | 按项目或环境选择 | 遵守 Projects 的工具限制 | [功能约定](../contracts/README.md) / 独立应用环境测试 |
| X04 | 按项目或环境选择 | DSH 子会话中选择 Godot 2D | [功能约定](../contracts/README.md) / 独立应用环境测试 |
| R01 | 核心 | 重启后采用当前配置 | [安装程序](technical/SETUP.md) / `tests/setup.test.mjs` |
| R02 | 核心 | 安装、停用与卸载 | [安装程序](technical/SETUP.md) / `tests/setup.test.mjs` |
| R03 | 按项目或环境选择 | 其他操作系统单独测试 | [安装程序](technical/SETUP.md) / `tests/setup.test.mjs` |

## 测试时注意

- 核对 DSH 会话、打开的 Godot 工程与配置目录一致。切换目标或重连后重新检查。
- 超时、取消或断开后，先确认文件和场景实际发生了什么，再决定是否重试。
- 模型识图需要确认图像实际传给了支持图片的模型，并检查其观察结果；截图路径本身不够。
- 模型开发测试要记录模型实际完成的修改，测试脚本直接写入代码属于另外一类检查。
- 安装、停用和卸载只操作测试环境，保留已有游戏、配置与其他进程。
- 所有结果注明安装包校验值。重新构建后，重做受影响的测试。
