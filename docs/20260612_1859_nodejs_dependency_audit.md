# Node.js 依赖审计报告

**文档版本**: 1.0.0
**创建时间**: 2026-06-12 18:59
**所属阶段**: 阶段一 - 基础设施搭建
**用途**: 列出所有需要替换为 MacBridge 的 Node.js API 依赖点

---

## 1. 审计范围

- **包含**: `plugin/` 下所有 `.js` 文件
- **排除**: `plugin/global/core/lib/`（vendored 依赖，已是打包产物，内部 require 由 esbuild 处理）
- **排除**: 各插件的 `.min.js`（vendored，如 markdownlint.min.js、marp-core.min.js、aes-ecb.min.js）

---

## 2. 依赖分级

### P0 - 核心基础设施（必须改造，阻塞一切）
这些文件是框架地基，所有插件都依赖它们。

| 文件 | 行号 | Node API | 用途 | MacBridge 替换方案 |
|------|------|----------|------|---------------------|
| `plugin/index.js` | 4-5 | `reqnode("path")`, `reqnode(core)` | 入口加载核心 | 改为 esbuild 打包后的直接 import |
| `global/core/i18n.js` | 34-36 | `require("path")`, `require("fs")` | 读取 locale JSON | `MacBridge.getDataFromFile()` |
| `global/core/utils/index.js` | 1-2 | `require("path")`, `require("fs-extra")` | 路径/文件操作基础 | `MacBridge.joinPath` / `getDataFromFile` / `writeDataToFile` |
| `global/core/utils/index.js` | 32 | `require("os").tmpdir()` | 临时目录 | `MacBridge` 注入 tempPath |
| `global/core/utils/index.js` | 119-120 | `reqnode("electron").shell` | openExternal / openPath | `MacBridge.openPath()` |
| `global/core/utils/index.js` | 741 | `require("os").homedir()` | 用户目录 | `MacBridge` 注入 homeDir |
| `global/core/utils/index.js` | 748 | `require(动态路径)` | 动态加载插件资源 | esbuild 静态打包 |
| `global/core/utils/settings.js` | 30-99 | 经由 `utils.writeFile/readFiles` | TOML 配置读写 | 间接走 MacBridge（改 utils 即可） |

**关键路径解析函数**（utils/index.js）：
- `getDirname()` (740) → `global.dirname` ★ macOS 无此全局变量
- `joinPluginPath()` (745) → `PATH.join(getDirname(), ...)` ★ 依赖 Node path
- `readFiles()` (750) → `FS_EXTRA.readFile`
- `existPath()` (751) → `FS_EXTRA.access`
- `writeFile()` (752) → `FS_EXTRA.writeFile`

---

### P1 - 常用插件（需改造，影响体验）

| 文件 | 行号 | Node API | 用途 | 处理方案 |
|------|------|----------|------|----------|
| `plugin/window_tab.js` | 586 | `reqnode("electron").ipcRenderer` | 监听文件重命名 | 改用 eventHub / 桥接事件 |
| `plugin/updater.js` | 326 | `require("fs")` 读 /etc/environment | Linux 代理检测 | macOS 跳过此分支 |
| `plugin/updater.js` | 333 | `require("child_process").exec` | 执行 git 更新 | `MacBridge.runCommand()`（若桥接支持） |
| `plugin/commander.js` | 85,98 | `require("child_process")` | 命令行执行 | `MacBridge.runCommand()` 或降级 |
| `plugin/plantUML.js` | 41 | `require("zlib")` | 压缩编码 | 用 pako（已 vendored）替换 |
| `plugin/preferences/actions.js` | 119 | `require("../myopic_defocus.js")` | 内部模块引用 | esbuild 静态打包（非 Node 依赖） |

---

### P2 - 边缘/可选插件（可暂时禁用）

| 文件 | 行号 | Node API | 用途 | 处理方案 |
|------|------|----------|------|----------|
| `plugin/ripgrep.js` | 127,129 | `reqnode("vscode-ripgrep")`, `child_process.spawn` | ripgrep 搜索 | **直接砍掉**（已确认） |
| `plugin/search_multi/searcher.js` | 1 | `require("fs-extra")` | 多字段文件搜索 | 改走 MacBridge 文件 API |
| `plugin/remote_control/server.js` | 1 | `require("http")` | 启 HTTP 服务 | **禁用**（macOS 无 Node 无法起服务） |
| `plugin/article_uploader/*` | 多处 | `selenium-webdriver`, `https` | 博客自动上传 | **禁用**（依赖 Node + 浏览器驱动） |
| `plugin/markdownlint/linter-worker.js` | 8-14 | `require(动态)` | worker 加载 lib | esbuild 打包或 worker 改造 |

---

## 3. 统计汇总

| 模块 | 出现文件数 | 优先级 | 总体策略 |
|------|-----------|--------|----------|
| `fs` / `fs-extra` | 6 | P0/P1 | 全部走 MacBridge 文件 API |
| `path` | 4 | P0 | MacBridge.joinPath（纯字符串实现） |
| `os` | 3 | P0 | 注入 homeDir/tempPath |
| `electron` | 2 | P0/P1 | shell→openPath，ipcRenderer→eventHub |
| `child_process` | 3 | P1/P2 | runCommand 桥接或禁用 |
| `zlib` | 1 | P1 | 用 pako 替换 |
| `http` | 1 | P2 | 禁用 remote_control |
| `https` | 1 | P2 | 禁用 article_uploader |
| `vscode-ripgrep` | 1 | P2 | 砍掉 ripgrep |
| `selenium-webdriver` | 2 | P2 | 禁用 article_uploader |

---

## 4. MacBridge 需要实现的最小 API 集

基于以上审计，`MacBridge` 至少需要提供：

```typescript
class MacBridge {
  // === 文件操作（替换 fs/fs-extra）===
  static getDataFromFile(path: string): Promise<string>       // readFile
  static writeDataToFile(path: string, data: string): Promise<void>  // writeFile
  static existPath(path: string): Promise<boolean>            // access
  static readDir(path: string): Promise<string[]>             // readdir

  // === 路径操作（替换 path，纯 JS 实现，无需桥接）===
  static joinPath(...parts: string[]): string                 // path.join
  static dirname(path: string): string
  static basename(path: string): string
  static extname(path: string): string

  // === 环境信息（注入，替换 os）===
  static get homeDir(): string                                // os.homedir()
  static get tempDir(): string                                // os.tmpdir()
  static get pluginRoot(): string                             // global.dirname 替代

  // === 系统操作（替换 electron.shell）===
  static openPath(path: string): Promise<void>                // shell.openPath
  static openExternal(url: string): Promise<void>             // shell.openExternal

  // === 命令执行（替换 child_process，若桥接支持）===
  static runCommand(cmd: string): Promise<{stdout, stderr}>   // exec（updater/commander 用）
}
```

**注入来源**：安装脚本在注入 `<script>` 时，通过 `window._TYPORA_PLUGIN_CONFIG` 传入 `pluginRoot` / `homeDir` / `tempDir`。

---

## 5. 桥接 API 可用性（待验证）

来自 `TypeMark/appsrc/main.js` 已确认存在的 `window.bridge.callHandler` 接口：

| 桥接 handler | 可替换的 Node 功能 | 状态 |
|--------------|---------------------|------|
| `document.getDataFromFile` | fs.readFile | ✅ 已确认存在 |
| `controller.runCommand` | child_process.exec | ✅ 已确认存在 |
| `controller.openInTypora` | - | ✅ |
| `library.fetchAllDocs` | 目录遍历 | ✅ |
| 写文件 handler | fs.writeFile | ⚠️ 需进一步确认具体 handler 名 |
| `images.*` | 图片操作 | ✅ |

**待办**：在阶段二开始前，用 WKWebView inspector 实测每个 handler 的参数格式和返回值。

---

## 6. 阶段二改造顺序建议

1. **先实现 MacBridge**（path 纯 JS 部分可立即完成，无需桥接）
2. **改造 utils/index.js**（地基，改完一大半插件自动可用）
3. **改造 i18n.js**（locale 加载，UI 显示依赖）
4. **改造 settings.js**（实际只需 utils 改完即可，它走 utils.writeFile）
5. **逐个处理 P1 插件**
6. **禁用 P2 插件**（在插件注册表中标记 macOS 不支持）

---

**文档负责人**: Orange
**最后更新**: 2026-06-12 18:59