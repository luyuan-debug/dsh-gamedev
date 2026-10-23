# 需求追踪表

本表保存执行包全部 49 项需求；38 项为核心。此表是验收基线模板，未逐项填入本版状态；不从 0.1.0 继承通过。实际发行结果以本版 VERIFICATION.md、独立 acceptance-results.json 及其证据为准。源码中的 acceptance-results.template.json 保持 NOT_RUN 初态。

0.2.0 的新增回归重点为生命周期与隔离安装：见 LIFECYCLE.md、SETUP.md、tests/lifecycle.test.mjs 与 tests/setup.test.mjs。纯检查不能代替同一最终 tarball 的实际原生宿主和 Godot 验收。

静态、原生宿主确定性、真实引擎、真实模型开发、GUI/运行五层分别报告；测试程序直接调用工具不能算作 Agent 自主开发。

| ID | 要求 | 验收目标 | 所需层 | 实现责任 | 源码/测试/证据 |
|---|---|---|---|---|---|
| P01 | core | 同一 tarball 可安装 | static, native-host | bundle / preset / native engineering composition / package files | 待实测填写 |
| P02 | core | 只有一个预设和一个自有 Skill | static, native-host | bundle / preset / native engineering composition / package files | 待实测填写 |
| P03 | core | 保留原生工程工具 | native-host | bundle / preset / native engineering composition / package files | 待实测填写 |
| P04 | core | 普通预设不被污染 | native-host | bundle / preset / native engineering composition / package files | 待实测填写 |
| P05 | core | 包内容无路径凭据与缓存 | static | bundle / preset / native engineering composition / package files | 待实测填写 |
| C01 | core | 未配置不自动安装 | native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C02 | core | 显式有效配置 | static, native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C03 | core | 无效配置回滚 | static, native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C04 | core | 可选项缺失/关闭 | static, native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C05 | core | 配置变化无静默漂移 | native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C06 | core | 禁用后的调用拒绝 | native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C07 | core | 只修改自己的设置 | native-host | native settings namespace / client / validation / effective configuration | 待实测填写 |
| C08 | core | Web 与无 GUI 路径 | native-host, gui-runtime | native settings namespace / client / validation / effective configuration | 待实测填写 |
| M01 | core | 初始化与离线状态 | native-host, engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M02 | core | 默认工具面 | native-host, engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M03 | core | 按需 Toolset 真正可调用 | native-host, engine-integration, real-model | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M04 | core | 错误项目拒写 | engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M05 | core | 重连和 peer replacement | engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M06 | core | 端口和双挂冲突 | engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M07 | core | 协议 probe/serve 清理 | native-host, engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M08 | core | 共享 Toolset 非独立授权 | native-host | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M09 | core | 原生审批保持 | native-host | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M10 | core | 写超时不盲重试 | engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M11 | core | 截图到模型的真实图像链 | real-model, gui-runtime | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M12 | core | 非视觉模型诚实降级 | native-host | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M13 | core | 输入取消会释放 | engine-integration, gui-runtime | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M14 | core | 多会话边界 | native-host, engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| M15 | core | 卸载不关闭借用进程 | native-host, engine-integration | native MCP mount / bridge startup safety adapter / dispatch guards / lifecycle | 待实测填写 |
| F01 | core | 一个预设创建可玩 2D 小样 | real-model, gui-runtime | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F02 | core | 场景保存并重开 | engine-integration, gui-runtime | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F03 | core | 已有工程增量修改 | real-model, engine-integration | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F04 | core | 复现修复回归 | real-model, engine-integration, gui-runtime | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F05 | core | UI 与分辨率输入 | gui-runtime | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F06 | core | 资源处理和导入 | engine-integration, gui-runtime | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F07 | core | 解析和失败状态真实 | engine-integration | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| F08 | core | 同平台 debug export | engine-integration, gui-runtime | Godot 2D Agent / disposable game fixtures / actual engine / debug export | 待实测填写 |
| L01 | conditional-csharp | 保持 C# 工程 | engine-integration, gui-runtime | existing language pipeline / actual compiler and engine loading | 待实测填写 |
| L02 | conditional-cpp | 保持 C++ 工程 | engine-integration, gui-runtime | existing language pipeline / actual compiler and engine loading | 待实测填写 |
| O01 | optional-cli | CLI 基本项真实使用 | engine-integration | allowlist / probes / existing optional tools and project addons | 待实测填写 |
| O02 | optional-project-framework | 已有测试框架继续用 | engine-integration | allowlist / probes / existing optional tools and project addons | 待实测填写 |
| O03 | optional-gua | Gua 单独验收 | engine-integration, gui-runtime | allowlist / probes / existing optional tools and project addons | 待实测填写 |
| O04 | optional-dcc | DCC 单独验收 | engine-integration | allowlist / probes / existing optional tools and project addons | 待实测填写 |
| X01 | conditional-projects | Projects 共存不干扰 | native-host | isolated Profile coexistence / upstream tool policy | 待实测填写 |
| X02 | conditional-team | Team 共存不接管 | native-host | isolated Profile coexistence / upstream tool policy | 待实测填写 |
| X03 | conditional-projects | 不绕过 Projects 的 MCP 拒绝 | native-host | isolated Profile coexistence / upstream tool policy | 待实测填写 |
| X04 | conditional-subagent | 原生 fresh child 可选验证 | native-host | isolated Profile coexistence / upstream tool policy | 待实测填写 |
| R01 | core | 重启恢复不伪称旧 revision | native-host | restart / installed-tarball lifecycle / platform-specific evidence | 待实测填写 |
| R02 | core | 真实安装/禁用/卸载完整闭环 | native-host, engine-integration | restart / installed-tarball lifecycle / platform-specific evidence | 待实测填写 |
| R03 | secondary-platform | 第二平台单独报告 | native-host, engine-integration, real-model, gui-runtime | restart / installed-tarball lifecycle / platform-specific evidence | 待实测填写 |

## 特别检查

- scope：普通 preset 无污染；禁用/排队调用重查；旧会话不漂移到新目标；Toolset 全局开启不授予其他 scope 权限。
- 项目身份：配置 realpath、会话工作区、真实 editor 项目一致；连接代际变化重新验证；错误项目或身份未知拒写。
- 审批：沿用原生批准/拒绝链；不直接调用底层 handler；confirm 参数不能替代批准。
- 图像：M11 必须记录图像 content block/附件到达授权模型及模型对随机画面标记的观察；只有 PNG 或工具文本路径不够。M12 单独验证非视觉降级。
- 模型开发：F01、F03、F04 保存 Godot 2D Agent 轨迹与差异；Codex 或测试脚本编写完成代码不能冒充该层。
- 进程：probe/serve、取消、失败、禁用、卸载均核对拥有关系；不停止借用 editor/HTTP 服务。
- 构建一致性：源码指纹、tarball、实际安装记录、GUI/模型证据属于同一构建；改变构建后重测受影响项。
- 最终检查两轮：需求→源码→测试→证据；按安装文档对交付同一 tarball 进行干净隔离安装。
