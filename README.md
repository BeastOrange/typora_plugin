# Typora Plugin macOS Fork

本项目 fork 自 [obgnail/typora_plugin](https://github.com/obgnail/typora_plugin)。感谢原作者 obgnail 与社区长期维护的 Typora 插件体系。本 fork 沿用原项目的 MIT License 与版权声明，详见 [LICENSE](LICENSE)；原项目已有代码版权归原作者及贡献者所有，本 fork 新增的 macOS 适配与维护改动按同一许可发布。

当前版本：`1.0.0`

## 项目定位

这是一个面向 macOS 适配和日常使用维护的 Typora Plugin fork。它保留上游插件体系、配置体系和大部分插件能力，同时补齐 Typora macOS Electron 运行环境下的加载、文件访问、资源映射和安装脚本。

当前 fork 的核心目标很直接：

- 让 Typora Plugin 可以在 macOS 版 Typora 中稳定加载。
- 保留上游已有插件的使用方式和配置方式。
- 用可重复的构建、安装和测试流程替代手工调试步骤。
- 优先保护本机 Typora 环境，开发测试默认使用 `Typora-Test.app`。

## 当前状态

`1.0.0` 是本 fork 的第一个可用版本，适合作为 macOS 适配线的初始发布版本。

已完成的重点改动包括：

- 新增 macOS 专用入口与加载流程：`plugin/macos-entry.js`。
- 为 macOS 打包场景生成静态插件注册表，减少动态加载失败。
- 增加文件系统 shim 与资源 manifest，适配 Typora macOS 的运行限制。
- 补充 macOS 安装、重装、卸载脚本。
- 调整插件按钮交互，支持悬浮、拖动和边缘半隐藏的入口。
- 清理早期调试阶段遗留的 daemon/watch 方案，当前不建议启用后台自动守护。
- 增加 macOS fs shim 测试，保证关键文件行为可回归验证。

## 支持环境

运行环境：

- macOS，当前主要在 Apple Silicon 环境验证。
- Typora for macOS。
- 建议先使用 `/Applications/Typora-Test.app` 验证，不要直接改主力 Typora。

开发环境：

- Node.js `>= 22`
- npm

上游原项目仍提供 Windows 和 Linux 方向的能力，本 fork 当前重点是 macOS 适配。Windows/Linux 的完整说明请参考上游项目。

## 快速开始

安装开发依赖：

```bash
cd develop
npm install
```

运行测试：

```bash
cd develop
npm test
```

构建 macOS bundle：

```bash
cd develop
npm run build:macos
```

安装到测试版 Typora，从仓库根目录执行：

```bash
TYPORA_APP=/Applications/Typora-Test.app bash scripts/macos/reinstall-macos.sh
```

安装完成后启动 `Typora-Test.app`，在编辑区右键菜单、插件设置或悬浮插件入口中使用插件。

## 使用插件

常用入口包括：

- 编辑区右键菜单。
- 插件偏好设置。
- 命令面板。
- 右下角或边缘悬浮的插件入口按钮。
- 已配置的插件快捷键。

插件配置仍沿用上游结构：

- 默认配置：`plugin/global/settings/settings.default.toml`
- 用户覆盖配置：`plugin/global/settings/settings.user.toml`
- 自定义插件配置：`plugin/global/settings/custom_plugin.*.toml`

修改配置后通常需要重启 Typora，部分插件也可以通过插件偏好设置即时调整。

## macOS 安全说明

开发和验证阶段建议始终使用测试应用：

```bash
TYPORA_APP=/Applications/Typora-Test.app bash scripts/macos/reinstall-macos.sh
```

当前版本不建议启用早期调试用的后台 daemon 或 watcher。如果机器上曾经安装过相关 LaunchAgent，可以检查并清理：

```bash
launchctl list | grep typora || true
```

如果看到 `com.typora.plugin.watcher`，说明仍有旧守护进程残留，需要先停止再继续测试。

## 开发命令

所有开发命令从 `develop/` 目录执行：

```bash
cd develop
npm test
npm run build:macos
npm run build:all
npm run dev
```

常用定向测试：

```bash
cd develop
node --require ../plugin/global/core/polyfill.js --test test/macos_fs_shim.test.js
```

语法检查示例，从仓库根目录执行：

```bash
node --check plugin/macos-entry.js
node --check plugin/bundle.js
```

## 版本策略

本 fork 使用 `x.y.z` 结构的语义化版本号。

- `1.0.0`：第一个可用 macOS 适配版本。
- `1.0.x`：兼容性修复、安装脚本修复、文档修正。
- `1.x.0`：新增向后兼容能力或明显增强。
- `2.0.0`：破坏性配置变更、安装方式重做或插件加载 contract 改动。

## 与上游的关系

本 fork 尊重并保留上游项目的版权和许可。后续如果继续同步上游插件能力，应尽量保持清晰的变更边界：

- 上游通用插件能力优先保持兼容。
- macOS 特有逻辑集中在 macOS 入口、shim、构建和脚本中。
- README 以本 fork 当前状态为准，不再复制上游长篇插件清单。

上游项目地址：[https://github.com/obgnail/typora_plugin](https://github.com/obgnail/typora_plugin)

## License

本项目沿用上游项目的 MIT License。详见 [LICENSE](LICENSE)。
