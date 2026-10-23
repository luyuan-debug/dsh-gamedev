# 导出与交付参考

读取 `export_presets.cfg`、引擎完整版本和同版 export templates。不存在的 preset 不猜名字；不存在的模板不自动升级引擎。先同平台 debug export，再谈发行。

结构示意，执行前确认目标 CLI 支持：

```sh
"$GODOT_BIN" --headless --path "$PROJECT_ROOT" --export-debug "$PRESET_NAME" "$OUTPUT_PATH"
```

外层限定墙钟超时。OUTPUT_PATH 必须位于明确授权输出目录，检查 symlink 和是否覆盖已有文件；参数数组传递，不把自由输入拼成 shell。来源 S09。

导出成功要验证文件存在、非空、类型/平台正确、hash，能运行时实际启动并完成烟测。退出码 0 不是全部验收。签名、公证、上传 Steam/Itch/npm/GitHub 是独立授权，不由“导出”隐含允许。

C# / C++ 项目额外验证程序集/原生库及对应平台依赖被打包；不能复制上一平台构建结果。Godot 运行时自动生成的 `user://` 存档放隔离环境，清理时只删测试拥有的数据。

CI 模板可参考 godot-ci，但不自动给项目加远程 Actions/Secrets 或发布作业。开源模板不是当前 Godot 4.7.2 镜像已经存在的证据。来源 S20。

交付修改摘要、真实测试结果、未测项、产物 hash 和必要操作。不要为任务结束编造一份“全部通过”报告。
