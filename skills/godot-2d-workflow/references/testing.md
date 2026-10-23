# 测试与构建参考

先读项目自己的测试/构建脚本、CI 与目标 Godot 的 `--help`。下列命令是结构示意，变量必须来自已确认环境，不能把占位符当可执行路径。

```sh
"$GODOT_BIN" --version
"$GODOT_BIN" --help
"$GODOT_BIN" --headless --editor --path "$PROJECT_ROOT" --import
"$GODOT_BIN" --headless --path "$PROJECT_ROOT" --quit-after 120
```

`--quit-after` 是引擎迭代数，不是秒。外层需要有真实墙钟超时与只清理自身进程的取消。Godot 可能忽略未知参数而不报警，所以先确认 help；退出码和日志要一起看。`--check-only --script …` 是指定脚本检查，不是保证整个工程编译成功。headless import 会写缓存，也可能运行工具脚本/插件，不是对不可信项目的安全只读扫描。来源 S09。

不要使用 `godot -s addons/gdUnit4/runtest.sh`：shell 脚本不是 GDScript。GUT/gdUnit4 调用方式按锁定版本官方说明核对，使用工程已有的正确入口；保留返回码，JUnit/HTML 为附加证据。没有框架时不要强装，先验证可运行和关键行为。来源 S10–S11。

C#：识别 .sln/.csproj、Godot.NET SDK 版本和真实 .NET editor，运行项目的 `dotnet build`/测试，再实际启动加载目标程序集；GDScript parse 不能替代 C# build。

C++：读取项目既有 SCons/CMake/godot-cpp/GDExtension 版本，编译对应平台/架构，验证 Godot 实际加载新库；不自动从 master 下载绑定，不把本机产物当其他平台可用。

gdtoolkit 的 lint/format 是辅助，不是引擎类型检查。默认 `gdformat --check`，修改格式前看 diff，限定触及文件。兼容 Godot 4 的表述不能代替目标新语法测试。来源 S12。

新项目样例应包含输入、胜负、HUD、暂停/恢复/重开和至少一个存取状态；测试行为不只看窗口能否出现。大型模拟加入固定种子、不变量与规模/耗时基线；性能结论必须记录硬件、构建模式和负载。
