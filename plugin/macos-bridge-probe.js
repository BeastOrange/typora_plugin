const path = require("./global/core/shims/path")

const cfg = () => (typeof window !== "undefined" && window._TYPORA_PLUGIN_CONFIG) || {}

function createPanel() {
  const existing = document.getElementById("typora-plugin-bridge-probe")
  if (existing) return existing

  const panel = document.createElement("div")
  panel.id = "typora-plugin-bridge-probe"
  panel.style.cssText = [
    "position: fixed",
    "right: 16px",
    "bottom: 16px",
    "z-index: 2147483647",
    "width: min(720px, calc(100vw - 32px))",
    "max-height: min(640px, calc(100vh - 32px))",
    "overflow: auto",
    "padding: 12px",
    "box-sizing: border-box",
    "background: #111827",
    "color: #f9fafb",
    "border: 1px solid #374151",
    "border-radius: 6px",
    "font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    "box-shadow: 0 18px 45px rgba(0,0,0,.35)",
    "white-space: pre-wrap",
  ].join(";")
  document.body.appendChild(panel)
  return panel
}

function stringify(value) {
  if (typeof value === "string") {
    return value.length > 500 ? value.slice(0, 500) + "...[truncated]" : value
  }
  try {
    const text = JSON.stringify(value, null, 2)
    return text.length > 800 ? text.slice(0, 800) + "...[truncated]" : text
  } catch (error) {
    return String(value)
  }
}

function resultLine(result) {
  const status = result.ok ? "PASS" : "FAIL"
  const detail = result.ok
    ? `${result.type}: ${stringify(result.value)}`
    : `${result.errorName || "Error"}: ${result.error}`
  return `[${status}] ${result.name}\n${detail}\n`
}

async function runCase(name, fn) {
  try {
    const value = await fn()
    return {
      name,
      ok: true,
      type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      value,
    }
  } catch (error) {
    return {
      name,
      ok: false,
      errorName: error && error.name,
      error: error && (error.stack || error.message) || String(error),
    }
  }
}

async function invoke(name, ...args) {
  if (typeof JSBridge === "undefined" || typeof JSBridge.invoke !== "function") {
    throw new Error("JSBridge.invoke is not available")
  }
  return JSBridge.invoke(name, ...args)
}

async function runBridgeProbe() {
  const panel = createPanel()
  const config = cfg()
  const files = {
    pluginRoot: config.pluginRoot || "",
    indexHtml: config.indexHtmlPath || "",
    settings: config.pluginRoot ? path.join(config.pluginRoot, "plugin/global/settings/settings.default.toml") : "",
    locale: config.pluginRoot ? path.join(config.pluginRoot, "plugin/global/locales/en.json") : "",
  }

  panel.textContent = [
    "Typora Plugin macOS Bridge Probe",
    `time: ${new Date().toISOString()}`,
    `pluginRoot: ${files.pluginRoot}`,
    `indexHtml: ${files.indexHtml}`,
    "",
    "Running...",
  ].join("\n")

  const cases = [
    ["JSBridge presence", async () => ({
      hasJSBridge: typeof JSBridge !== "undefined",
      hasInvoke: typeof JSBridge !== "undefined" && typeof JSBridge.invoke === "function",
      hasShowInBrowser: typeof JSBridge !== "undefined" && typeof JSBridge.showInBrowser === "function",
      hasShowInFinder: typeof JSBridge !== "undefined" && typeof JSBridge.showInFinder === "function",
    })],
    ["document.getDataFromFile(index.html)", () => invoke("document.getDataFromFile", files.indexHtml)],
    ["document.getDataFromFile(settings.default.toml)", () => invoke("document.getDataFromFile", files.settings)],
    ["document.getDataFromFile(en.json)", () => invoke("document.getDataFromFile", files.locale)],
    ["path.isDirectory(pluginRoot)", () => invoke("path.isDirectory", files.pluginRoot)],
    ["path.isDirectory(index.html)", () => invoke("path.isDirectory", files.indexHtml)],
    ["path.listDirectory(pluginRoot)", () => invoke("path.listDirectory", files.pluginRoot)],
  ]

  const results = []
  for (const [name, fn] of cases) {
    const result = await runCase(name, fn)
    results.push(result)
    panel.textContent = [
      "Typora Plugin macOS Bridge Probe",
      `time: ${new Date().toISOString()}`,
      `pluginRoot: ${files.pluginRoot}`,
      `indexHtml: ${files.indexHtml}`,
      "",
      ...results.map(resultLine),
      "",
      "Copy or screenshot this panel.",
    ].join("\n")
  }

  window.__typoraPluginBridgeProbeResults = results
  if (config.probeReportUrl) {
    await fetch(config.probeReportUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        time: new Date().toISOString(),
        files,
        results,
      }),
    }).catch((error) => {
      panel.textContent += `\n[FAIL] report\n${error && error.message || String(error)}\n`
    })
  }
  return results
}

module.exports = runBridgeProbe
