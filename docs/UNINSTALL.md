# dsh-gamedev 0.2.0 关闭、卸载与回退

操作前核对隔离工作区及 ownership；下列命令不能套用于日常 Profile。卸载插件不需要删除游戏、存档或整个工作目录。

## 关闭连接

在 **Settings → Godot 2D** 关闭桥接，或将对应原生设置的 `enabled` 改为 `false`。接受关闭后立即拒绝后续派发，再等待该实例拥有的原生 MCP 清理；`STOPPING` 期间不允许新连接重叠启动。

已经派发的写入可能生效。取消、关闭或超时不提供事务回滚，也不授权自动重试；读取实际场景/文件/节点状态后再决定下一步。有限次原生重连只恢复连接，不重放写操作。

先在 Godot 正常停止游戏，再正常结束本次启动终端。辅助程序只结束它直接启动的两个子进程，不按程序名搜索、不抢端口、不结束未知编辑器。如果游戏经系统启动器成为独立进程，应先在编辑器中停止它。

## 辅助程序创建的工作区

关闭 `launch` 后运行：

```sh
node /path/to/setup.mjs uninstall --workspace '/path/to/owned-gamedev-workspace'
```

程序核对 ownership、活跃 launch lock 和端口，拒绝运行中卸载。它用既有锁定 venv 的安全 YAML AST 验证唯一 `id: gamedev-settings`、`name: dsh-gamedev` 条目，精确备份后对该隔离 Home/Profile 调用原生 `dsh plugin remove dsh-gamedev`，再重读并仅剪除自己的条目。其他设置、onboarding、注释和格式保留；用户改过自己的配置也可卸载。重复身份、改绑其他插件、锚点/别名、损坏或歧义文档会拒绝；并发修改会保留当前文件和备份，待相关写入停止后重试。详细边界见 [SETUP.md](SETUP.md)。

卸载保留 `project/`、addon、存档、源码、日志、venv、Godot 副本、隔离 Home 及其他插件。不会递归删除 workspace 或清理 Application Support。异常退出留下的 `state/launch.lock` 不自动删除：先核对其中 PID、终端和本次进程确实已退出，再由用户移除这一个陈旧锁。PID 文件本身不构成终止进程的授权。

## 原生手动卸载

仅在确认变量指向本次隔离环境后执行。不要覆盖 HOME 或修改日常启动器。

```sh
export DSH_HOME='/absolute/path/to/isolated/dsh-home'
export DSH_AGENTS_HOME='/absolute/path/to/isolated/agents-home'
export GAMEDEV_PROFILE='gamedev-sandbox'
export GAMEDEV_DSH_BIN='/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh'
"$GAMEDEV_DSH_BIN" plugin --profile "$GAMEDEV_PROFILE" remove dsh-gamedev
```

检查该 Profile 的 package/bundle 不再包含本插件。若自行创建了 `gamedev-settings` patch，备份后仅移除 `name: dsh-gamedev` 的对应行，保留 sandbox、approval、Web 和其他插件设置。空 patch 写为 `[]`。另行检查隔离 Home 根 patch 与启动 overlay 中是否也有自己添加的条目，不清空整个配置。

重新启动隔离宿主，确认本插件的预设、Skill 与设置页消失，其他预设仍可使用。仅核查残余端口归属，不因残留就结束外部进程。原 Godot、日常 DSH 配置及用户原工程不属于卸载范围。

## 回退与保留数据

保留旧版本 `.tgz`、独立摘要及对应源码/锁。在停止的隔离 Profile 原生卸载新版，再从已核验的旧包新摘要路径安装。不要覆盖同路径 tarball；包管理器缓存可能使安装字节与预期不同。已有旧源码和证据保留，旧验收结果不自动适用于新构建。

macOS `user://` 仍在 Application Support 下。辅助程序只为新建测试工程设置唯一 `DSH-GameDev/<workspace-name>-<random>` 命名空间，确切名称在该工作区 ownership 和 prepare 输出中；编辑器探针另有子名称。`_sc_` 不隔离 runtime 存档，卸载不删除这些路径。需要清理时先逐一核对命名与内容，不使用覆盖其他游戏的通配删除。
