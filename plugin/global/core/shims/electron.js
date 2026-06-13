/**
 * shims/electron.js — 浏览器版 Electron 替身（仅 macOS bundle 经 esbuild alias 生效）
 *
 * 审计确认核心层只用到：
 *   - reqnode("electron").shell.openExternal(url)   → 打开外部链接
 *   - reqnode("electron").shell.openPath(path)      → 用默认程序打开文件/目录
 *   - reqnode("electron").ipcRenderer.on("didRename", ...)  → window_tab 监听重命名
 *
 * 全部映射到 Typora 的 JSBridge。ipcRenderer 在 macOS 无等价物，提供 no-op 占位，
 * window_tab 的重命名监听改走 eventHub（阶段二处理该插件时接入）。
 */

/* global JSBridge */

const shell = {
  openExternal: async (url) => {
    if (typeof JSBridge === "undefined") return
    if (typeof JSBridge.showInBrowser === "function") {
      JSBridge.showInBrowser(url)
    } else {
      await JSBridge.invoke("path.openURL", url)
    }
  },
  openPath: async (p) => {
    if (typeof JSBridge === "undefined") return ""
    await JSBridge.invoke("path.openFile", p)
    return ""
  },
  showItemInFolder: (p) => {
    if (typeof JSBridge !== "undefined" && typeof JSBridge.showInFinder === "function") {
      JSBridge.showInFinder(p)
    }
  },
}

// macOS 无 ipcRenderer：提供安全 no-op，避免 .on/.send 调用崩溃。
const ipcRenderer = {
  on: () => ipcRenderer,
  once: () => ipcRenderer,
  off: () => ipcRenderer,
  removeListener: () => ipcRenderer,
  removeAllListeners: () => ipcRenderer,
  send: () => {},
  invoke: async () => undefined,
}

module.exports = {
  shell,
  ipcRenderer,
}
