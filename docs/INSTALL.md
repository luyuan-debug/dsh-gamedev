# 高级配置与源码构建

通常只需按 [安装指南](SETUP.md) 创建开发目录。本页供需要手动调整设置或修改源码的开发者使用。

## 连接设置

打开 **Settings → Godot 2D**。安装程序已填写基本连接参数，手动调整时注意：

| 设置 | 填写方式 |
| --- | --- |
| 游戏工程根目录 | 包含 `project.godot` 的绝对路径，与会话工作目录及打开的 Godot 工程一致 |
| Godot 可执行文件 | 已有 Godot 程序的绝对路径，例如 `.app/Contents/MacOS/Godot` |
| 连接方式 | 当前使用本地桥接；HTTP 连接尚不支持 |
| 桥接 Python | 安装程序创建的 Python 环境内的 `bin/python` 路径；保留符号链接，不改成全局 Python |
| 编辑器地址 | 带明确端口的本机 `ws://` 地址，与 Godot 插件设置一致 |
| 令牌环境变量名 | 只填变量名称，例如 `DSH_GAMEDEV_BRIDGE_TOKEN`，不填密钥值 |

桥接是 DSH 与 Godot 编辑器之间的连接程序。v0.2.0 使用 Godot Editor MCP **2026.10.20.1**，服务端和编辑器插件需要同版。`launch` 会为本次启动生成令牌并同时传给 DSH 和 Godot，无需复制密钥。

保存后，字段错误会显示在页面中，原有有效配置继续保留。若提示其他窗口已经修改设置，先核对并合并最新值。修改项目、引擎或连接地址后，请新建 **Godot 2D** 会话。更多操作见 [连接与故障排查](LIFECYCLE.md)。

## 手动配置文件

DSH 用 Profile 区分配置。安装程序为开发目录创建专用 Profile，设置位于该目录的 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。根目录配置和启动时的 `--patch` 也可能覆盖它，请先确认正在使用的文件。

下面是配置结构示例。替换所有占位路径，初始保持 `enabled: false`，检查完成后再启用：

```yaml
- id: sandbox-policy
  config:
    mode: workspace-write
    workspaceRoot: /absolute/path/to/game-project
- id: approval
  config:
    policy: ask
- id: gamedev-settings
  name: dsh-gamedev
  config:
    enabled: false
    projectRoot: /absolute/path/to/game-project
    godotExecutable: /absolute/path/to/Godot_mono.app/Contents/MacOS/Godot
    bridgeMode: stdio
    bridgeExecutable: /absolute/path/to/bridge-venv/bin/python
    bridgeUrl: ws://127.0.0.1:19090
    bridgeSecretRef: DSH_GAMEDEV_BRIDGE_TOKEN
    bridgeEndpoint: ""
    httpSecretRef: ""
    allowedOptionalTools: []
    gdtoolkitExecutable: ""
    imagemagickExecutable: ""
    ffmpegExecutable: ""
    testFrameworkPreference: existing
```

同一条目的 `config` 会整体替换，因此手动修改时需保留仍要使用的字段。JSON 示例和 YAML 配置格式不同，不能直接混用。请在专用开发目录中操作，避免改动日常 DSH 配置。

## 可选工具

可以填写已经安装的 GDScript Toolkit、ImageMagick 或 FFmpeg 路径，并允许使用。插件确认程序可用后才会向模型提供对应指引，勾选不会安装软件。这些开关不代替 DSH 的终端权限和操作审批。

已有 GUT、gdUnit4 或其他测试脚本时，沿用项目自己的入口。C# 和 C++ 项目可保留原有语言，但完整开发流程的支持范围见 [测试说明](VERIFICATION.md)。

## 从源码进行锁定构建

需要 Node.js 和 npm。先创建单独的构建依赖目录，按 `locks/build-package-lock.json` 安装 esbuild **0.25.12** 和 TypeScript **5.9.3**。这样不会安装全局包，也不会额外下载 DSH 本体。

以下路径均需换成真实绝对路径；源码目录中不能已有 `node_modules`：

```sh
export GAMEDEV_SOURCE='/absolute/path/to/dsh-gamedev-source'
export GAMEDEV_BUILD_DIR='/absolute/path/to/NEW-build-dependencies'
mkdir "$GAMEDEV_BUILD_DIR"
cp "$GAMEDEV_SOURCE/locks/build-package-lock.json" "$GAMEDEV_BUILD_DIR/package-lock.json"
node --input-type=module - "$GAMEDEV_BUILD_DIR" <<'JS'
import {readFileSync, writeFileSync} from 'node:fs';
const root = process.argv[2];
const lock = JSON.parse(readFileSync(root + '/package-lock.json', 'utf8'));
writeFileSync(root + '/package.json', JSON.stringify({
  name: lock.name, private: true, type: 'module',
  devDependencies: lock.packages[''].devDependencies,
}, null, 2) + '\n');
JS
npm ci --prefix "$GAMEDEV_BUILD_DIR" --include=dev --cache "$GAMEDEV_BUILD_DIR/npm-cache"
test ! -e "$GAMEDEV_SOURCE/node_modules"
test ! -L "$GAMEDEV_SOURCE/node_modules"
ln -s "$GAMEDEV_BUILD_DIR/node_modules" "$GAMEDEV_SOURCE/node_modules"
cd "$GAMEDEV_SOURCE"
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" run build
# 指向已安装锁定依赖的 Python 环境，供安装程序测试使用。
export DSH_GAMEDEV_SETUP_TEST_PYTHON='/absolute/path/to/bridge-venv/bin/python'
"$DSH_GAMEDEV_SETUP_TEST_PYTHON" -I -c 'import yaml; assert yaml.__version__ == "6.0.3"'
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" test
python3 -B -m unittest discover -s tests/publication -p 'test_*.py' -v
python3 -B -m unittest discover -s tests/bridge -p 'test_guarded_main.py' -v
python3 -B tests/contracts/check_contracts.py
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" pack --dry-run
npm --cache "$GAMEDEV_BUILD_DIR/npm-cache" pack
```

完整的安装程序测试需要 PyYAML **6.0.3**。用 `DSH_GAMEDEV_SETUP_TEST_PYTHON` 指定已经装好该依赖的 Python，可复用安装程序创建的环境。不指定时，相关检查会显示 `SKIP`，应在测试报告中注明。

桥接协议测试的完整运行方法见 [bridge/README.md](../bridge/README.md)。GitHub Actions 使用临时环境执行源码检查，不启动 DSH 或 Godot，也不调用模型服务。

构建后，`dist/build-info.json` 记录输入文件摘要；`npm pack` 生成可安装的 `.tgz`。重建包会改变文件校验值，请使用带摘要的新文件名，避免包管理器复用同名缓存。现有发行包的测试结果不自动适用于重建包。发布前检查见 [发布维护](PUBLICATION.md)。
