/**
 * macos-entry.js — macOS bundle 入口（替代依赖 Electron 全局的 plugin/index.js）
 *
 * 职责：
 *   1. 建立 reqnode 全局（Win/Linux 由 Electron 注入；macOS 无，这里映射到 shim）。
 *   2. 注入 global.dirname（插件根目录，安装脚本经 window._TYPORA_PLUGIN_CONFIG 提供）。
 *   3. 用静态注册表接管 utils.require —— esbuild 无法解析运行时的
 *      utils.require(path, fixedName)，故改为查表（注册表由 bundle-macos.cjs 生成）。
 *   4. 运行核心 entry()。
 *
 * 注意：global/process 由 esbuild banner 在所有模块前建立（见 bundle-macos.cjs）。
 * 上游 plugin/index.js、utils/index.js 等一行不改 —— 改造只发生在这个新增入口里。
 */

const electronShim = require("./global/core/shims/electron")
const pathShim = require("./global/core/shims/path")

// reqnode：Win/Linux 是 Electron 全局；macOS 映射到 shim。实际用到的只有 "electron"。
const REQNODE = { electron: electronShim, path: pathShim }
global.reqnode = (id) => {
  if (Object.prototype.hasOwnProperty.call(REQNODE, id)) return REQNODE[id]
  throw new Error(`[macos] reqnode("${id}") 在 macOS bundle 中不可用`)
}

// global.dirname：getDirname() 读取它；安装脚本注入插件根目录。
const cfg = (typeof window !== "undefined" && window._TYPORA_PLUGIN_CONFIG) || {}
global.dirname = global.dirname || cfg.pluginRoot || ""

const utils = require("./global/core/utils")
const registry = require("./macos-registry.generated.js")

// 接管 utils.require：上游 plugin.js 以 utils.require("./plugin", fixedName) /
// utils.require("./plugin/custom/plugins", fixedName) 动态加载插件。改为查注册表。
const CUSTOM_DIR = "./plugin/custom/plugins"
utils.require = (...paths) => {
  const fixedName = paths[paths.length - 1]
  const dir = paths.length > 1 ? paths[0] : null
  const table = dir === CUSTOM_DIR ? registry.custom : registry.base
  const mod = table[fixedName]
  if (!mod) {
    throw new Error(`[macos] 插件 "${fixedName}" 不在注册表中（dir=${dir}）—— 可能为 macOS 不支持插件`)
  }
  return mod
}

const entry = require("./global/core")

window.addEventListener("load", () => {
  Promise.resolve()
    .then(entry)
    .catch((e) => console.error("[Typora-Plugin][macos] 启动失败:", e))
})
