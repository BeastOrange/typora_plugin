/**
 * shims/fs.js — 浏览器版 Node `fs` / `fs-extra` 替身（仅 macOS bundle 经 esbuild alias 生效）
 *
 * 上游代码 `require("fs")` / `require("fs-extra")` 原样不改；esbuild 把二者别名到本文件。
 *
 * 底层依赖 Typora 已暴露的全局 `JSBridge`（阶段一审计确认存在）。
 * 已确认的文件原语（来自 Typora main.js 的 callHandler 列表）：
 *   - document.getDataFromFile  读任意文件
 *   - path.isDirectory          判断目录
 *   - path.moveTo / path.removeFiles  移动 / 删除
 *   - library.newFile           新建文件
 *
 * ⚠️ TODO[阶段二实机校准]：以下 handler 经 JSBridge.invoke 调用时的确切参数顺序与返回格式，
 *    需在真实 Typora WKWebView devtools 中实测后回填。当前为最合理推断实现 + 防御性解析。
 *    实测命令示例（devtools console）：
 *      await JSBridge.invoke("document.getDataFromFile", "/abs/path.toml")
 *
 * 限制：
 *   - 浏览器无同步 IO。*Sync 方法无法真正同步走桥接；审计显示核心层 readFileSync/statSync/
 *     accessSync 仅出现在 vendored 库或非关键路径，这里提供抛错占位，命中即在阶段二定位替换。
 */

/* global JSBridge */

function bridge() {
  if (typeof JSBridge === "undefined") {
    throw new Error("[fs-shim] JSBridge 不可用：本 shim 仅能在 Typora WKWebView 运行时使用")
  }
  return JSBridge
}

// ---- 返回格式的防御性解析（实测前的兼容层）----
function parseFileData(data) {
  if (data == null) throw makeENOENT("unknown")
  if (typeof data === "string") return data
  if (typeof data.content === "string") return data.content
  if (typeof data.data === "string") return data.data
  throw new Error("[fs-shim] 未识别的文件数据返回格式：" + JSON.stringify(Object.keys(data)))
}

function makeENOENT(path) {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`)
  err.code = "ENOENT"
  err.errno = -2
  err.path = path
  return err
}

function decodeMaybe(content, encoding) {
  // encoding 为空 → 调用方期望 Buffer/二进制。WKWebView 桥接通常返回 string，
  // 这里在缺省时仍返回 string（绝大多数核心层调用都传 "utf-8"）。
  return content
}

// ============ 异步读 ============
async function readFile(path, encoding) {
  const raw = await bridge().invoke("document.getDataFromFile", path)
  return decodeMaybe(parseFileData(raw), encoding)
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
  // fs.access 成功 = resolve，失败 = reject。用读取探测。
  const ok = await readFile(path, "utf-8").then(() => true).catch(() => false)
  if (!ok) throw makeENOENT(path)
}

async function readdir(path) {
  // TODO[实测]：确认目录列举 handler 的返回结构（数组 of 文件名？of 对象？）。
  const list = await bridge().invoke("path.listDirectory", path)
  if (Array.isArray(list)) {
    return list.map((it) => (typeof it === "string" ? it : it.name)).filter(Boolean)
  }
  return []
}

async function stat(path) {
  const isDir = await bridge().invoke("path.isDirectory", path).catch(() => false)
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
