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
global.__dirname = global.__dirname || pathShim.join(global.dirname, "plugin/global/core")

const reportProbe = (payload) => {
  if (!cfg.probeMode || !cfg.probeReportUrl || typeof fetch !== "function") return
  fetch(cfg.probeReportUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: new Date().toISOString(), ...payload }),
  }).catch(() => undefined)
}

const collectStartupState = (phase) => {
  const container = global.__plugin_service_container__
  const basePlugins = container && container.getAllBasePlugins && container.getAllBasePlugins()
  return {
    phase,
    enabledPluginCount: basePlugins ? Object.keys(basePlugins).length : null,
    enabledPlugins: basePlugins ? Object.keys(basePlugins).slice(0, 120) : [],
    hasRightClickPlugin: !!(basePlugins && basePlugins.right_click_menu),
    hasPreferencesPlugin: !!(basePlugins && basePlugins.preferences),
    contextMenuChildren: document.querySelector("#context-menu")?.children.length ?? null,
    pluginMenuItems: document.querySelectorAll('[data-key="typora-plugin"], [data-key="typora-plugin-no-extra"], .plugin-menu-second, .plugin-menu-third').length,
    preferenceDialogExists: !!document.querySelector(".plugin-preferences-mask"),
    errors: window.__typoraPluginMacosErrors || [],
  }
}

if (cfg.probeMode && typeof window !== "undefined") {
  window.__typoraPluginMacosErrors = []
  window.addEventListener("error", (event) => {
    const error = event.error
    window.__typoraPluginMacosErrors.push({
      type: "error",
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: error && error.stack,
    })
    reportProbe({ phase: "window-error", error: window.__typoraPluginMacosErrors.at(-1) })
  })
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    window.__typoraPluginMacosErrors.push({
      type: "unhandledrejection",
      message: reason && reason.message || String(reason),
      stack: reason && reason.stack,
    })
    reportProbe({ phase: "window-unhandledrejection", error: window.__typoraPluginMacosErrors.at(-1) })
  })
  reportProbe({
    phase: "macos-entry-loaded",
    dirname: global.dirname,
    readyState: document.readyState,
    hasFile: typeof File !== "undefined",
    hasJQuery: typeof $ !== "undefined",
    hasOptions: typeof window._options !== "undefined",
  })
}

const utils = require("./global/core/utils")
const registry = require("./macos-registry.generated.js")

// 接管 utils.require：上游 plugin.js 以 utils.require("./plugin", fixedName) /
// utils.require("./plugin/custom/plugins", fixedName) 动态加载插件。改为查注册表。
const CUSTOM_DIR = "./plugin/custom/plugins"
utils.require = (...paths) => {
  const fixedName = paths[paths.length - 1]
  const dir = paths.length > 1 ? paths[0] : null
  const table = dir === CUSTOM_DIR ? registry.custom : registry.base
  const loader = table[fixedName]
  if (!loader) {
    throw new Error(`[macos] 插件 "${fixedName}" 不在注册表中（dir=${dir}）—— 可能为 macOS 不支持插件`)
  }
  return loader()
}

const GHOST_HINT_TEXTS = ["关闭将直接退出程序", "请先保存重要数据"]
const GHOST_HINT_ATTRS = ["data-hint", "ty-hint", "title"]

const containsGhostHintText = (value = "") => {
  return GHOST_HINT_TEXTS.some(text => value.includes(text))
}

const visitElementTrees = (root, callback) => {
  if (!root?.querySelectorAll) return
  root.querySelectorAll("*").forEach(el => {
    callback(el)
    if (el.shadowRoot) visitElementTrees(el.shadowRoot, callback)
  })
}

const hideTyporaTooltip = (el) => {
  el.classList.remove("shown")
  el.textContent = ""
  el.style.left = "0"
  el.style.top = "0"
  el.style.removeProperty("visibility")
  el.style.removeProperty("opacity")
}

const suppressMacosHintAttributes = () => {
  visitElementTrees(document, el => {
    if (el.matches?.(".title-buttons .button")) {
      el.removeAttribute("data-hint")
    }
    if (el.id === "typora-plugin-macos-actions-toggle") {
      el.removeAttribute("title")
      el.removeAttribute("ty-hint")
    }
  })
}

const isFloatingGhostNode = (el) => {
  if (!containsGhostHintText(el.textContent || "")) return false
  if (el.closest?.("#write, .plugin-preferences-mask, fast-window")) return false

  const style = window.getComputedStyle(el)
  return style.position === "fixed" || style.position === "absolute" || el.parentElement === document.body
}

const cleanupMacosGhostHints = ({ aggressive = false } = {}) => {
  const nativeTooltips = [...document.querySelectorAll("#ty-tooltip, .ty-tooltip[role='tooltip']")]
  const primaryTooltip = document.getElementById("ty-tooltip")

  nativeTooltips.forEach(el => {
    if (primaryTooltip && el !== primaryTooltip && el.parentElement === document.body) {
      el.remove()
      return
    }

    if (aggressive || el.classList.contains("shown") || containsGhostHintText(el.textContent || "") || nativeTooltips.length > 1) {
      hideTyporaTooltip(el)
    }
  })

  document.querySelectorAll(".md-tooltip-remove").forEach(el => el.remove())

  if (!cfg.probeMode) {
    document.querySelectorAll("#typora-plugin-bridge-probe").forEach(el => el.remove())
  }

  document.querySelectorAll("body *").forEach(el => {
    if (isFloatingGhostNode(el)) el.remove()
  })

  visitElementTrees(document, el => {
    GHOST_HINT_ATTRS.forEach(attr => {
      if (containsGhostHintText(el.getAttribute?.(attr) || "")) {
        el.removeAttribute(attr)
      }
    })
  })
  suppressMacosHintAttributes()
}

const installMacosGhostHintCleanup = () => {
  if (window.__typoraPluginMacosGhostHintCleanupInstalled) return
  window.__typoraPluginMacosGhostHintCleanupInstalled = true
  document.documentElement.classList.add("typora-plugin-macos-suppress-hints")
  document.body?.classList.add("typora-plugin-macos-suppress-hints")
  window.addEventListener("DOMContentLoaded", () => {
    document.body?.classList.add("typora-plugin-macos-suppress-hints")
  }, { once: true })

  const style = document.createElement("style")
  style.id = "typora-plugin-macos-ghost-hint-cleanup-style"
  style.textContent = `
html.typora-plugin-macos-suppress-hints #ty-tooltip,
body.typora-plugin-macos-suppress-hints #ty-tooltip,
html.typora-plugin-macos-suppress-hints .ty-tooltip[role="tooltip"],
body.typora-plugin-macos-suppress-hints .ty-tooltip[role="tooltip"] {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
fast-window[hidden],
fast-window.hiding,
fast-window[style*="display: none"] {
  pointer-events: none !important;
}
${cfg.probeMode ? "" : `
#typora-plugin-bridge-probe {
  display: none !important;
  pointer-events: none !important;
}
`}
`
  document.head.appendChild(style)

  const runAggressiveCleanup = () => cleanupMacosGhostHints({ aggressive: true })
  const scheduleCleanup = () => {
    if (window.__typoraPluginMacosGhostHintCleanupScheduled) return
    window.__typoraPluginMacosGhostHintCleanupScheduled = true
    requestAnimationFrame(() => {
      window.__typoraPluginMacosGhostHintCleanupScheduled = false
      cleanupMacosGhostHints()
    })
  }

  runAggressiveCleanup()
  ;[80, 300, 1000, 2500].forEach(delay => setTimeout(runAggressiveCleanup, delay))

  const attrObserver = new MutationObserver(scheduleCleanup)
  attrObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-hint", "ty-hint", "title", "hidden", "window-buttons"],
  })

  ;["mousemove", "pointermove", "pointerdown", "dragstart", "scroll", "blur"].forEach(type => {
    window.addEventListener(type, scheduleCleanup, true)
  })
}

const installMacosActionToggle = () => {
  if (document.getElementById("typora-plugin-macos-actions-toggle")) return
  if (!document.getElementById("plugin-action-buttons")) return

  const style = document.createElement("style")
  style.id = "typora-plugin-macos-actions-toggle-style"
  style.textContent = `
body.typora-plugin-macos-actions-collapsed #plugin-action-buttons {
  display: none !important;
}
#typora-plugin-macos-actions-toggle {
  position: fixed;
  z-index: 100000;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: #1f2937;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font: 15px/38px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: center;
  cursor: grab;
  user-select: none;
  touch-action: none;
  opacity: 0.92;
  transition: opacity 120ms ease, transform 160ms ease, box-shadow 120ms ease;
}
body.plugin-dark-mode #typora-plugin-macos-actions-toggle {
  border-color: rgba(255, 255, 255, 0.2);
  background: rgba(31, 41, 55, 0.94);
  color: #f9fafb;
}
#typora-plugin-macos-actions-toggle:hover {
  opacity: 1;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}
#typora-plugin-macos-actions-toggle.dragging {
  cursor: grabbing;
  opacity: 1;
  transition: none;
}
#typora-plugin-macos-actions-toggle.edge-left {
  transform: translateX(-20px);
}
#typora-plugin-macos-actions-toggle.edge-right {
  transform: translateX(20px);
}
#typora-plugin-macos-actions-toggle.edge-top {
  transform: translateY(-20px);
}
#typora-plugin-macos-actions-toggle.edge-bottom {
  transform: translateY(20px);
}
#typora-plugin-macos-actions-toggle.edge-left:hover,
#typora-plugin-macos-actions-toggle.edge-right:hover,
#typora-plugin-macos-actions-toggle.edge-top:hover,
#typora-plugin-macos-actions-toggle.edge-bottom:hover,
#typora-plugin-macos-actions-toggle.dragging {
  transform: translate(0, 0);
}
`
  document.head.appendChild(style)

  const collapsedKey = "typora-plugin-macos-actions-collapsed"
  const positionKey = "typora-plugin-macos-actions-toggle-position"
  const ballSize = 38
  const edgeThreshold = 24
  const button = document.createElement("button")
  const icon = document.createElement("i")
  const readPosition = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey) || "null")
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) return saved
    } catch (_error) {
      // localStorage may be unavailable or contain stale data.
    }
    return {
      left: Math.max(0, window.innerWidth - ballSize - 16),
      top: Math.max(0, Math.round(window.innerHeight / 2 - ballSize / 2)),
      edge: "",
    }
  }
  const writePosition = (position) => {
    try {
      localStorage.setItem(positionKey, JSON.stringify(position))
    } catch (_error) {
      // localStorage may be unavailable in some embedded contexts.
    }
  }
  const clampPosition = (left, top) => ({
    left: Math.max(0, Math.min(left, window.innerWidth - ballSize)),
    top: Math.max(0, Math.min(top, window.innerHeight - ballSize)),
  })
  const clearEdge = () => button.classList.remove("edge-left", "edge-right", "edge-top", "edge-bottom")
  const applyPosition = ({ left, top, edge = "" }, save = false) => {
    const clamped = clampPosition(left, top)
    clearEdge()
    if (edge) button.classList.add(`edge-${edge}`)
    button.style.left = `${clamped.left}px`
    button.style.top = `${clamped.top}px`
    if (save) writePosition({ ...clamped, edge })
  }
  const detectEdge = (left, top) => {
    const distances = [
      ["left", left],
      ["right", window.innerWidth - ballSize - left],
      ["top", top],
      ["bottom", window.innerHeight - ballSize - top],
    ]
    const [edge, distance] = distances.sort((a, b) => a[1] - b[1])[0]
    return distance <= edgeThreshold ? edge : ""
  }
  const settlePosition = (left, top) => {
    const edge = detectEdge(left, top)
    const clamped = clampPosition(left, top)
    if (edge === "left") clamped.left = 0
    if (edge === "right") clamped.left = window.innerWidth - ballSize
    if (edge === "top") clamped.top = 0
    if (edge === "bottom") clamped.top = window.innerHeight - ballSize
    applyPosition({ ...clamped, edge }, true)
  }
  const setCollapsed = (collapsed) => {
    document.body.classList.toggle("typora-plugin-macos-actions-collapsed", collapsed)
    const label = collapsed ? "展开插件按钮" : "收起插件按钮"
    button.removeAttribute("title")
    button.setAttribute("aria-label", label)
    icon.className = collapsed ? "fa fa-plus" : "fa fa-minus"
    try {
      localStorage.setItem(collapsedKey, collapsed ? "1" : "0")
    } catch (_error) {
      // localStorage may be unavailable in some embedded contexts.
    }
  }

  button.id = "typora-plugin-macos-actions-toggle"
  button.type = "button"
  button.appendChild(icon)
  document.body.appendChild(button)

  let drag = null
  let suppressClick = false
  const move = (ev) => {
    if (!drag) return
    const dx = ev.clientX - drag.startX
    const dy = ev.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
    if (!drag.moved) return
    ev.preventDefault()
    clearEdge()
    button.classList.add("dragging")
    const next = clampPosition(drag.left + dx, drag.top + dy)
    button.style.left = `${next.left}px`
    button.style.top = `${next.top}px`
  }
  const stop = (ev) => {
    if (!drag) return
    window.removeEventListener("pointermove", move, true)
    window.removeEventListener("pointerup", stop, true)
    window.removeEventListener("pointercancel", stop, true)
    button.classList.remove("dragging")
    if (drag.moved) {
      ev.preventDefault()
      suppressClick = true
      const rect = button.getBoundingClientRect()
      settlePosition(rect.left, rect.top)
      setTimeout(() => suppressClick = false, 0)
    }
    drag = null
  }
  button.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return
    const rect = button.getBoundingClientRect()
    drag = { startX: ev.clientX, startY: ev.clientY, left: rect.left, top: rect.top, moved: false }
    button.setPointerCapture?.(ev.pointerId)
    window.addEventListener("pointermove", move, true)
    window.addEventListener("pointerup", stop, true)
    window.addEventListener("pointercancel", stop, true)
  })
  button.addEventListener("click", (ev) => {
    if (suppressClick) {
      ev.preventDefault()
      ev.stopPropagation()
      return
    }
    setCollapsed(!document.body.classList.contains("typora-plugin-macos-actions-collapsed"))
  })
  window.addEventListener("resize", () => {
    const saved = readPosition()
    settlePosition(saved.left, saved.top)
  })

  let initialCollapsed = false
  try {
    initialCollapsed = localStorage.getItem(collapsedKey) === "1"
  } catch (_error) {
    initialCollapsed = false
  }
  applyPosition(readPosition(), false)
  setCollapsed(initialCollapsed)
}

const entry = require("./global/core")
const runBridgeProbe = require("./macos-bridge-probe")

window.addEventListener("load", () => {
  reportProbe({ phase: "window-load", readyState: document.readyState })
  installMacosGhostHintCleanup()
  Promise.resolve()
    .then(() => {
      if (cfg.probeMode) runBridgeProbe().catch((e) => console.error("[Typora-Plugin][macos] Bridge probe failed:", e))
    })
    .then(() => {
      reportProbe({
        phase: "entry-before",
        hasContextMenu: !!document.querySelector("#context-menu"),
        hasContent: !!document.querySelector("content"),
        hasWrite: !!document.querySelector("#write"),
        typoraVersion: window._options && window._options.appVersion,
      })
      return entry()
    })
    .then(() => {
      reportProbe(collectStartupState("entry-after"))
      cleanupMacosGhostHints({ aggressive: true })
      installMacosActionToggle()
      if (cfg.probeMode) {
        setTimeout(() => reportProbe(collectStartupState("entry-after-delayed")), 1200)
      }
    })
    .catch((e) => {
      reportProbe({ phase: "entry-error", error: { message: e && e.message || String(e), stack: e && e.stack } })
      console.error("[Typora-Plugin][macos] 启动失败:", e)
    })
})
