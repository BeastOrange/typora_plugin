/**
 * shims/os.js — 浏览器版 Node `os` 替身（仅 macOS bundle 经 esbuild alias 生效）
 *
 * 审计确认核心层只用到 os.homedir() 和 os.tmpdir()。
 * 值来自安装脚本注入的 window._TYPORA_PLUGIN_CONFIG，fallback 到 Typora 的 window._options。
 */

function cfg() {
  return (typeof window !== "undefined" && window._TYPORA_PLUGIN_CONFIG) || {}
}
function options() {
  return (typeof window !== "undefined" && window._options) || {}
}

function homedir() {
  return cfg().homeDir || options().userPath || "/Users/Shared"
}

function tmpdir() {
  return cfg().tempDir || options().tempPath || "/tmp"
}

module.exports = {
  homedir,
  tmpdir,
  platform: () => "darwin",
  type: () => "Darwin",
  EOL: "\n",
}
