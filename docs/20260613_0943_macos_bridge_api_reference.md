# macOS 桥接 API 参考（JSBridge）

**文档版本**: 1.0.0
**创建时间**: 2026-06-13 09:43
**来源**: 由早期 `plugin/global/core/macBridge.ts` 整理而来（该方案已被 shim 层取代，知识保留于此）
**关联文档**: [阶段二实现记录：Shim 层 + esbuild Alias 架构](20260613_0939_phase2_shim_architecture.md)

---

## 1. 背景

macOS 版 Typora 是原生 Cocoa + WKWebView，**无 Node.js 运行时**。Win/Linux 版插件依赖的
`require("fs"/"path"/"os")`、`reqnode("electron")` 全部不可用。本文档记录可用于替代的 Typora 桥接原语。

最终架构不再用单独的 `MacBridge` 类，而是把这些桥接调用封装进 `plugin/global/core/shims/*.js`，
由 esbuild alias 接管上游的 `require`。本文档作为 shim 实现与真机校准的依据。

---

## 2. JSBridge（核心桥接对象）

- Typora 本体已暴露全局对象 **`JSBridge`**（`TypeMark/appsrc/main.js` 中出现约 264 次）。
- 提供 `JSBridge.invoke(handler: string, ...args): Promise<any>`，底层封装 WKWebView ↔ ObjC 的
  `window.bridge.callHandler`。插件代码本就在用（如 utils 的下载逻辑）。
- 因此 shim **不必从零封装 `callHandler`**，优先复用 `JSBridge.invoke`。
- 另有便捷方法（非 invoke）：`JSBridge.showInBrowser(url)`、`JSBridge.showInFinder(file)`（需真机确认存在性）。

---

## 3. 已知/候选 Handler（⚠️ 均需真机 devtools 实测确认）

| 用途 | 候选 handler | Node 等价 | 状态 |
|------|--------------|-----------|------|
| 读任意文件 | `document.getDataFromFile` / `document.loadData` | `fs.readFile` | ✅ 名称见于 main.js，**返回格式待测**（string? `{content}`? 编码?） |
| 写任意文件 | 候选 `controller.writeDataToFile` / `library.newFile` / `document.setContent` | `fs.writeFile` | ⚠️ handler 名 + 参数顺序待测 |
| 判断目录 | `path.isDirectory` | `fs.stat().isDirectory()` | ✅ 名称见于 main.js |
| 列目录 | 候选 `path.listDirectory` / `library.fetchAllDocs` | `fs.readdir` | ⚠️ 返回结构待测（string[]? object[]?） |
| 移动 | `path.moveTo` | `fs.move` | ✅ 名称见于 main.js |
| 删除 | `path.removeFiles`（数组？单值？） | `fs.remove` | ⚠️ 签名待测 |
| 用默认程序打开 | 候选 `path.openFile` / `app.openFileOrFolder` | `shell.openPath` | ⚠️ 待测 |
| 打开外部链接 | `JSBridge.showInBrowser` / `path.openURL` | `shell.openExternal` | ⚠️ 待测 |
| Finder 中显示 | `JSBridge.showInFinder` | `shell.showItemInFolder` | ⚠️ 待测 |

> 实测方式：在**测试版 Typora**（非主力 app）devtools console 运行，例如
> `await JSBridge.invoke("document.getDataFromFile", "/abs/path.toml")`，观察返回值类型/结构。

---

## 4. 环境信息注入

shim 的环境信息（`os.homedir()`/`os.tmpdir()`、插件根目录）来源：

1. 安装脚本注入 `window._TYPORA_PLUGIN_CONFIG = { pluginRoot, homeDir, tempDir }`。
2. fallback 到 Typora 自带的 `window._options`（`userPath` / `tempPath`）。

对应实现见 `shims/os.js`、`plugin/macos-entry.js`（注入 `global.dirname`）。

---

## 5. Path 语义

macOS 仅 POSIX（分隔符 `/`）。纯 JS 实现见 `shims/path.js`，已实测 36/37 对齐 Node `path.posix`，
唯一差异是无 `cwd` 时的 `resolve`（macOS bundle 下无 cwd，为预期行为；核心层 resolve 调用均传绝对路径）。

---

**最后更新**: 2026-06-13 09:43
