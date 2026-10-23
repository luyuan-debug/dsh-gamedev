# 关闭与卸载

## 结束本次开发

1. 在 Godot 编辑器中停止游戏。
2. 回到运行 `launch` 命令的终端，按 `Ctrl+C`。

这会关闭本次启动的 DSH 和 Godot。下次使用时重新运行 `launch` 即可。

## 卸载插件

先按上面步骤结束开发，再使用安装包中解压得到的安装程序：

```sh
node package/scripts/setup.mjs uninstall \
  --workspace '/path/to/your-gamedev-workspace'
```

将路径换成这次安装创建的开发目录。程序只在该目录对应的 DSH 环境中卸载 dsh-gamedev。

卸载后会保留：

- 游戏工程、脚本和场景。
- 游戏存档。
- 日志、Godot 副本及下载的依赖。
- 其他插件及其设置。

卸载命令不会删除整个开发目录。存档还可能保存在 macOS 的 Application Support 下；需要彻底清理时，请先备份游戏，并按 [目录说明](technical/UNINSTALL.md#回退与保留数据) 核对实际位置。

## 卸载失败时

若提示仍在运行，先确认游戏和启动终端已经正常关闭，再重试。若此前强制退出或断电，可能留有启动记录；请按 [故障处理说明](technical/SETUP.md#第三步检查并启动) 核对，保留日志，不要直接删除整个开发目录。

若提示设置文件有冲突或无法解析，请保留错误信息和备份文件，提交 [Issue](https://github.com/luyuan-debug/dsh-gamedev/issues)。手动卸载和版本回退步骤见 [高级说明](technical/UNINSTALL.md)。
