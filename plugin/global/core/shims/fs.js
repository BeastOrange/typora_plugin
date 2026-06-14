/**
 * shims/fs.js — 浏览器版 Node `fs` / `fs-extra` 替身（仅 macOS bundle 经 esbuild alias 生效）
 *
 * 上游代码 `require("fs")` / `require("fs-extra")` 原样不改；esbuild 把二者别名到本文件。
 *
 * 底层依赖：
 *   - fetch(file://...)         读取插件安装目录下文件
 *   - JSBridge.path.isDirectory 判断目录
 *   - JSBridge.path.moveTo / path.removeFiles 移动 / 删除
 *
 * 实机探针结论：
 *   - document.getDataFromFile 对任意路径返回空字符串，不能作为通用读文件原语。
 *   - fetch(file://...) 可读取插件目录下 settings.default.toml / locales/*.json。
 *   - path.isDirectory 可用；path.listDirectory 不存在。
 *
 * 限制：
 *   - 浏览器无同步 IO。*Sync 方法无法真正同步走桥接；审计显示核心层 readFileSync/statSync/
 *     accessSync 仅出现在 vendored 库或非关键路径，这里提供抛错占位，命中即在阶段二定位替换。
 */

/* global JSBridge */

let resourceManifest = {}
try {
  resourceManifest = require("../../../macos-resource-manifest.generated.js")
} catch (_error) {
  resourceManifest = {}
}

function bridge() {
  if (typeof JSBridge === "undefined") {
    throw new Error("[fs-shim] JSBridge 不可用：本 shim 仅能在 Typora WKWebView 运行时使用")
  }
  return JSBridge
}

function makeENOENT(path) {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`)
  err.code = "ENOENT"
  err.errno = -2
  err.path = path
  return err
}

function makeENOSYS(path, syscall) {
  const err = new Error(`ENOSYS: function not implemented, ${syscall} '${path}'`)
  err.code = "ENOSYS"
  err.errno = -78
  err.path = path
  err.syscall = syscall
  return err
}

function toFileURL(path) {
  if (typeof path !== "string") throw new TypeError("Path must be a string")
  if (path.startsWith("file://")) return path
  return "file://" + path.split("/").map(encodeURIComponent).join("/")
}

function getPluginRoot() {
  const cfg = (typeof window !== "undefined" && window._TYPORA_PLUGIN_CONFIG) || {}
  return cfg.pluginRoot || global.dirname || ""
}

function toManifestKey(path) {
  const root = getPluginRoot().replace(/\/+$/, "")
  if (!root || typeof path !== "string") return ""
  const normalized = path.replace(/\/+$/, "")
  if (normalized === root) return ""
  if (!normalized.startsWith(root + "/")) return ""
  return normalized.slice(root.length + 1)
}

function normalizeEncoding(encoding) {
  if (encoding && typeof encoding === "object") encoding = encoding.encoding
  if (encoding == null) return null
  return String(encoding).toLowerCase().replace("-", "")
}

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function bytesToBase64(bytes) {
  let result = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    result += BASE64_CHARS[(n >> 18) & 63]
    result += BASE64_CHARS[(n >> 12) & 63]
    result += i + 1 < bytes.length ? BASE64_CHARS[(n >> 6) & 63] : "="
    result += i + 2 < bytes.length ? BASE64_CHARS[n & 63] : "="
  }
  return result
}

function makeBinary(bytes) {
  if (typeof Buffer !== "undefined" && Buffer.from) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  return {
    length: bytes.byteLength,
    byteLength: bytes.byteLength,
    slice: (start, end) => makeBinary(bytes.slice(start, end)),
    toString: (encoding) => {
      if (String(encoding || "utf8").toLowerCase() === "base64") return bytesToBase64(bytes)
      if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes)
      return Array.from(bytes, b => String.fromCharCode(b)).join("")
    },
    valueOf: () => bytes,
    [Symbol.iterator]: () => bytes[Symbol.iterator](),
  }
}

async function fetchFile(path) {
  let response
  try {
    response = await fetch(toFileURL(path))
  } catch (error) {
    const err = makeENOENT(path)
    err.cause = error
    throw err
  }
  if (!response || (response.ok === false && response.status !== 0)) {
    throw makeENOENT(path)
  }
  return response
}

// ============ 异步读 ============
async function readFile(path, encoding) {
  const response = await fetchFile(path)
  const normalized = normalizeEncoding(encoding)
  if (normalized === "base64") {
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()))
  }
  if (normalized === "utf8" || normalized === "utf16le" || normalized === "latin1" || normalized === "ascii" || normalized === "binary" || normalized === "string") {
    return response.text()
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return makeBinary(bytes)
}

async function readJson(path) {
  const text = await readFile(path, "utf-8")
  return JSON.parse(text)
}

// ============ 异步写 ============
async function writeFile(path, content) {
  // TODO[实测]：确认写入任意路径的 handler。候选：library.newFile / 专用写 handler。
  // 暂用 invoke，参数顺序 (path, content) 为推断。
  await bridge().invoke("controller.writeDataToFile", path, content)
}

async function writeJson(path, obj, opts) {
  const space = opts && opts.spaces != null ? opts.spaces : 2
  await writeFile(path, JSON.stringify(obj, null, space))
}

// ============ 存在性 / 目录 ============
async function access(path) {
  // fs.access 成功 = resolve，失败 = reject。文件用 fetch 探测；目录用 JSBridge 探测。
  const fileOk = await fetchFile(path).then(() => true).catch(() => false)
  if (fileOk) return
  const isDir = await bridge().invoke("path.isDirectory", path).catch(() => false)
  if (!isDir) throw makeENOENT(path)
}

async function readdir(path) {
  const key = toManifestKey(path)
  const list = resourceManifest[key]
  if (Array.isArray(list)) return list.slice()
  throw makeENOSYS(path, "readdir")
}

async function stat(path) {
  const isDir = await bridge().invoke("path.isDirectory", path).catch(() => false)
  if (!isDir) await fetchFile(path)
  return makeStats(!!isDir)
}
const lstat = stat

function makeStats(isDir) {
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
    size: 0,
    mtime: new Date(0),
  }
}

// ============ 删除 / 移动 ============
async function remove(path) {
  await bridge().invoke("path.removeFiles", [path]).catch(async () => {
    // 单文件 handler 的另一种可能签名
    await bridge().invoke("path.removeFiles", path)
  })
}

async function move(src, dest) {
  await bridge().invoke("path.moveTo", src, dest)
}

// ============ 同步占位（命中即在阶段二定位）============
function syncNotSupported(name) {
  return function () {
    throw new Error(`[fs-shim] ${name} 同步 IO 在 macOS WKWebView 不可用，需改为异步或内联`)
  }
}

module.exports = {
  // 异步
  readFile,
  writeFile,
  readJson,
  writeJson,
  access,
  readdir,
  stat,
  lstat,
  remove,
  move,
  // 同步占位
  readFileSync: syncNotSupported("readFileSync"),
  readJsonSync: syncNotSupported("readJsonSync"),
  statSync: syncNotSupported("statSync"),
  accessSync: syncNotSupported("accessSync"),
  // promises 命名空间（i18n.js 用 require("fs").promises.readFile）
  promises: {
    readFile,
    writeFile,
    access,
    readdir,
    stat,
    lstat,
  },
}
