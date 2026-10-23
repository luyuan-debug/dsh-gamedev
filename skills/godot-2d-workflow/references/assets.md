# 资产处理参考

资源不限定像素风。优先用户已有素材和工具，原图不覆盖，派生输出放项目现有约定目录；记录来源/许可。开源程序许可不代表它附带示例素材、模型权重或生成资产使用权。

- ImageMagick：尺寸、alpha、裁切、缩放、合成、批处理。只使用已允许程序，确认资源/解码策略，避免任意网络输入或无上限像素解码。参考 [ImageMagick](https://github.com/ImageMagick/ImageMagick)。
- FFmpeg/ffprobe：媒体时长、格式、声道、采样率、转码/裁切与录制后处理。转换不能证明音乐美学或循环无缝，需播放/听觉检查。参考 [FFmpeg](https://github.com/FFmpeg/FFmpeg)。
- Pixelorama：已有工程的像素动画/图集导出。CLI 适用范围按版本 `--help` 核查，不能声称它能通过 CLI 自动完成全部绘画。参考 [Pixelorama](https://github.com/Orama-Interactive/Pixelorama)。
- Tiled/LDtk：现有项目采用才接续；地图导出不代表 Godot 已导入，还要验证导入器版本、坐标、碰撞、实体字段和资源路径。参考 [Tiled](https://github.com/mapeditor/tiled)、[LDtk](https://github.com/deepnight/ldtk)。
- Gua/DCC：使用用户已配置连接，不因本 Skill 提到就启动软件。DCC 内部再发现能力即可，不再安装第二个发现系统。参考 [Gua](https://github.com/gua-project/gua)、[DCC-MCP](https://github.com/dcc-mcp/dcc-mcp-core)。

Godot 内检查资源实际导入和运行效果，包括 filtering、mipmap、像素缩放、atlas bleeding、字体回退、中文文本溢出、音频总线。改 UI 时检查容器/锚点、比例、窗口大小和输入焦点，不仅看 `.tscn`。

可选工程插件只在需要时建议，不自动安装：Dialogue Manager 用于对话、State Charts 用于状态组织、LimboAI 用于复杂行为。新依赖必须解释成本、许可和目标 Godot 版本，不能为了工具目录完整而把它们全装上。参考 [Dialogue Manager](https://github.com/nathanhoad/godot_dialogue_manager)、[Godot State Charts](https://github.com/derkork/godot-statecharts)、[LimboAI](https://github.com/limbonaut/limboai)。
