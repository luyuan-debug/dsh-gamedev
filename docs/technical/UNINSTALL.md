# 卸载与回退参考

普通卸载步骤见 [关闭与卸载](../UNINSTALL.md)。本页解释目录确认、设置保留和手动恢复方法。

## 卸载程序如何保留设置

安装程序先核对安装记录、启动锁和端口，确认目标是自己创建且已经停止的开发目录，再在该目录的 DSH 配置中运行 `dsh plugin remove dsh-gamedev`。

程序备份当前配置，然后只移除根列表中同时匹配 `id: gamedev-settings` 和 `name: dsh-gamedev` 的条目。其他插件、审批设置、注释和格式会保留。

配置文件使用固定 Python 环境中的 PyYAML 检查。若有重复标识、重复键、名称冲突、锚点或无法解析的内容，程序会停止并保留当前文件。它不会猜测应该删除哪一项。发现其他程序同时修改文件时，也会停止，以免覆盖新改动。

首次备份名为 `cordis.patch.yml.before-uninstall`，再次操作会用新名称保存，不覆盖旧备份。失败后请保留错误和备份，核对相关编辑器或 DSH 进程已停止，再决定重试或手动处理。

## 手动卸载

仅在你明确知道开发目录对应的 DSH Home 和 Profile 时使用。以下路径和名称都是占位符，不能用于日常配置：

```sh
export DSH_HOME='/absolute/path/to/isolated/dsh-home'
export DSH_AGENTS_HOME='/absolute/path/to/isolated/agents-home'
export GAMEDEV_PROFILE='gamedev-sandbox'
export GAMEDEV_DSH_BIN='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
"$GAMEDEV_DSH_BIN" plugin --profile "$GAMEDEV_PROFILE" remove dsh-gamedev
```

若配置文件仍有本插件条目，备份后只移除 `id: gamedev-settings`、`name: dsh-gamedev` 对应的那一项，保留其他内容。还需检查 DSH Home 根配置及启动时的额外配置文件。空列表用 `[]` 表示，不清空整个文件。

重新启动该 DSH 环境，确认 Godot 2D 入口和设置页消失，其他功能仍可使用。不要因为端口仍被占用就结束未知进程。

## 回退与保留数据

回退前保留旧安装包、源码和校验值。在停止的专用 DSH 环境中卸载新版，再按已经核对的旧包路径安装；不要用新内容覆盖同名包，以免包管理器复用缓存。

卸载会保留游戏、编辑器插件、存档、日志、Godot 副本、Python 环境和开发目录。若确实需要删除这些文件，请先备份并核对内容。

macOS 游戏存档可能位于 Application Support 下的 `DSH-GameDev/<workspace-name>-<random>`；具体名称在安装记录与准备输出中。临时引擎检查使用独立子目录或随机名称。`_sc_` 只控制编辑器数据位置，不控制运行时存档。清理时逐一确认实际路径，避免误删其他游戏数据。

异常退出留下的 `state/launch.lock` 不会自动删除。请核对其 PID、终端和进程均已结束，再只移除该旧锁；PID 文件本身不能说明某个进程可以被终止。
