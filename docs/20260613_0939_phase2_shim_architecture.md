# 阶段二实现记录：Shim 层 + esbuild Alias 架构

**文档版本**: 1.0.0
**创建时间**: 2026-06-13 09:39
**所属阶段**: 阶段二 - 核心重构
**状态**: 链路已搭通，bundle 可构建；待真机校准桥接
**关联文档**: [macOS 移植实施方案](20260612_0915_macos_port_plan.md)、[Node.js 依赖审计报告](20260612_1859_nodejs_dependency_audit.md)

---

## 1. 架构调整：为何放弃逐文件 MacBridge 重写

原方案（计划文档 §2.2、阶段二）打算把核心层每个 `require("fs"/"path"/"os")`、`reqnode("electron")` 调用点逐个改写为 `MacBridge.xxx()`。在「长期同步上游」的前提下，这是错误的：

- `fs`/`path`/`os`/`electron` 在核心层有数十处调用点。逐个改写 = 数十个长期 cherry-pick 冲突点，每次上游改动这些文件都要手动解冲突。

**改用 shim 层 + esbuild alias：上游调用点一行不改。**

- 写浏览器版 shim（`plugin/global/core/shims/*.js`），esbuild 把 `fs`/`path`/`os`/`electron` 别名到对应 shim。
- 上游 `require("fs")`、`reqnode("electron")` 原样保留 → i18n.js、utils/index.js、settings.js **全部零改动**。
- 测试在 Node 里跑（真实 fs + proxyquire）→ **全部测试零改动通过**（实测 568/568 pass）。
- 唯一新增成本：一个 `shims/` 目录（我们自己的文件，上游永不触碰，不产生冲突）。

> 早期曾按旧方案写过 `macBridge.ts`，现已被 shim 取代并删除；其中的桥接 API 知识整理在
> [macOS 桥接 API 参考](20260613_0943_macos_bridge_api_reference.md)。

---

## 2. 改造后的加载链路

```
TypeMark 注入的 <script src=".../bundle.js">
  → esbuild banner：建立 global / process（WKWebView 无 Node 全局）
  → plugin/macos-entry.js（入口，替代 plugin/index.js）
      → 定义 global.reqnode → shims/electron
      → 注入 global.dirname（来自 window._TYPORA_PLUGIN_CONFIG.pluginRoot）
      → 接管 utils.require → 查静态注册表
      → require("./global/core")()  运行 entry()
  → 上游核心层（i18n / utils / plugin / mixins）一行不改
      → require("fs"/"path"/"os") —— esbuild alias → shims/*.js
      → reqnode("electron") —— global.reqnode → shims/electron.js
```

---

## 3. 新增/改动文件清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `plugin/global/core/shims/path.js` | 新增 | 纯 JS POSIX path（join/resolve/dirname/basename/extname/parse/sep）。实测 36/37 对齐 Node `path.posix`，唯一差异是无 cwd 时的 resolve（macOS 下为预期行为）。 |
| `plugin/global/core/shims/fs.js` | 新增 | `fs`/`fs-extra` 替身，底层走 Typora `JSBridge`。**handler 名/返回格式需真机校准（见 §6）**。 |
| `plugin/global/core/shims/os.js` | 新增 | `os.homedir()`/`os.tmpdir()`/`platform()`，值来自注入配置 + `window._options` fallback。 |
| `plugin/global/core/shims/electron.js` | 新增 | `shell.openExternal`/`openPath`/`showItemInFolder` → JSBridge；`ipcRenderer` no-op。 |
| `plugin/macos-entry.js` | 新增 | macOS bundle 入口（见 §2）。**上游 `plugin/index.js` 不动**。 |
| `plugin/macos-registry.generated.js` | 生成（gitignore） | 静态插件注册表，构建时由 `bundle-macos.cjs` 扫描生成。 |
| `develop/build/bundle-macos.cjs` | 改写 | 生成注册表 + esbuild（alias + catch-all stub 插件）。`npm run build:macos`。 |

---

## 4. 关键技术点

### 4.1 静态插件注册表（解决动态 require）

`utils.require = (...paths) => require(joinPluginPath(...paths))`（utils/index.js:748）在运行时按路径动态 require 插件，esbuild 无法静态分析。

解法：`bundle-macos.cjs` 扫描 `plugin/*.js` ∪ `plugin/*/index.js`，以**字面量 require** 写入 `macos-registry.generated.js`；`macos-entry.js` 把 `utils.require` 重定向到查表。**上游 utils/index.js 不改**（仅 macOS 入口在运行时重新赋值该静态方法）。

### 4.2 Catch-all Stub（保证构建永不失败）

esbuild 插件对任何无法 alias 的裸模块（npm 包 / 未 alias 的 Node 内建）返回「按属性抛错」的 Proxy 占位模块。命中即在运行时抛清晰错误（被 `LoadPlugins` 的 per-plugin try/catch 捕获，不影响其它插件）。

当前被 stub 的 18 个模块：`extract-zip`（核心 unzip）、`child_process`、`zlib`、`http`/`https`/`net`/`tls`/`url`/`stream`/`stream/web`/`buffer`/`crypto`/`util`/`assert`/`tty`/`process`/`supports-color`/`worker_threads`（多数来自 vendored lib 的传递依赖）。

### 4.3 macOS 不支持插件（不入注册表）

`ripgrep`（child_process + vscode-ripgrep）、`remote_control`（http 服务）、`article_uploader`（https + selenium）。不入注册表 → 不进 esbuild 依赖图 → 其依赖也不会被解析。

**含 child_process/zlib 但保留的插件**：`commander`、`updater`、`plantUML` —— 这些走 stub，加载成功，仅在实际调用对应功能时抛错（待后续接桥接 runCommand / 用 pako 替换 zlib）。

---

## 5. 构建结果（验收）

```
$ npm run build:macos
[bundle-macos] 注册表已生成：58 个 base 插件，0 个 custom 插件
[bundle-macos] ✓ 产出 plugin/bundle.js (11465.7 KB)
```

- ✅ esbuild 零 "Could not resolve" 错误（所有依赖命中 shim 或 stub）
- ✅ `node --check plugin/bundle.js` 通过（合法 JS）
- ✅ 注册表 58 插件，黑名单 3 个均已排除
- ✅ 输出无残留 live `require("<builtin>")`（仅注释中 1 处）；`reqnode("electron")` 3 处指向我们定义的全局
- ✅ Win/Linux 测试 568/568 通过（上游零改动）
- ⚠️ bundle 11.2MB（未压缩 + 全量 vendored lib）—— 体积优化留待后续（懒加载图表库）

---

## 6. 下一步：真机桥接校准（必须在真实 Typora WKWebView devtools 中做）

`shims/fs.js` 当前的 handler 名与返回格式是**最合理推断**，需在测试版 Typora（**非主力 app**）的 devtools console 实测后回填：

```js
// 读文件返回格式？string 还是 {content}？编码？
await JSBridge.invoke("document.getDataFromFile", "/abs/path.toml")
// 写任意路径的 handler 名 / 参数顺序？
// 目录列举 handler 名 / 返回结构？
// path.isDirectory / path.moveTo / path.removeFiles 的确切签名？
```

校准后，改动集中在 `shims/fs.js` 的几个函数。随后即可验证「整个 bundle 能在 WKWebView 加载并启动核心」这个最大未知。

---

**文档负责人**: Orange
**最后更新**: 2026-06-13 09:39
