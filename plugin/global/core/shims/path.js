/**
 * shims/path.js — 浏览器版 Node `path` 替身（仅 macOS bundle 经 esbuild alias 生效）
 *
 * 设计：上游代码 `require("path")` 原样不改；esbuild 把 "path" 别名到本文件。
 * 仅实现 POSIX 语义（macOS 单一分隔符 "/"）。纯 JS，无桥接，可单测。
 *
 * 已审计的被用到的 API：join/resolve/dirname/basename/extname/parse/sep。
 */

const SEP = "/"

function normalizeArray(parts, allowAboveRoot) {
  const res = []
  for (const p of parts) {
    if (!p || p === ".") continue
    if (p === "..") {
      if (res.length && res[res.length - 1] !== "..") res.pop()
      else if (allowAboveRoot) res.push("..")
    } else {
      res.push(p)
    }
  }
  return res
}

function normalize(p) {
  if (typeof p !== "string") throw new TypeError("Path must be a string")
  const isAbs = p.charAt(0) === SEP
  const trailing = p.length > 1 && p.charAt(p.length - 1) === SEP
  let segs = normalizeArray(p.split(SEP), !isAbs).join(SEP)
  if (!segs && !isAbs) segs = "."
  if (segs && trailing) segs += SEP
  return (isAbs ? SEP : "") + segs
}

function join(...args) {
  const parts = args.filter((a) => {
    if (typeof a !== "string") throw new TypeError("Path must be a string")
    return a.length > 0
  })
  if (parts.length === 0) return "."
  return normalize(parts.join(SEP))
}

function resolve(...args) {
  let resolvedPath = ""
  let resolvedAbsolute = false
  for (let i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const path = i >= 0 ? args[i] : "/"
    if (typeof path !== "string") throw new TypeError("Path must be a string")
    if (!path) continue
    resolvedPath = path + SEP + resolvedPath
    resolvedAbsolute = path.charAt(0) === SEP
  }
  const normalized = normalizeArray(
    resolvedPath.split(SEP),
    !resolvedAbsolute,
  ).join(SEP)
  return (resolvedAbsolute ? SEP : "") + normalized || "."
}

function dirname(p) {
  if (typeof p !== "string") throw new TypeError("Path must be a string")
  if (!p) return "."
  const hasRoot = p.charAt(0) === SEP
  let end = -1
  let matchedSlash = true
  for (let i = p.length - 1; i >= 1; i--) {
    if (p.charAt(i) === SEP) {
      if (!matchedSlash) {
        end = i
        break
      }
    } else {
      matchedSlash = false
    }
  }
  if (end === -1) return hasRoot ? SEP : "."
  if (hasRoot && end === 1) return SEP
  return p.slice(0, end)
}

function basename(p, ext) {
  if (typeof p !== "string") throw new TypeError("Path must be a string")
  let start = 0
  let end = -1
  let matchedSlash = true
  for (let i = p.length - 1; i >= 0; i--) {
    if (p.charAt(i) === SEP) {
      if (!matchedSlash) {
        start = i + 1
        break
      }
    } else {
      if (end === -1) {
        matchedSlash = false
        end = i + 1
      }
    }
  }
  if (end === -1) return ""
  let base = p.slice(start, end)
  if (ext && base.endsWith(ext) && base !== ext) {
    base = base.slice(0, base.length - ext.length)
  }
  return base
}

function extname(p) {
  if (typeof p !== "string") throw new TypeError("Path must be a string")
  let startDot = -1
  let startPart = 0
  let end = -1
  let matchedSlash = true
  let preDotState = 0
  for (let i = p.length - 1; i >= 0; i--) {
    const code = p.charAt(i)
    if (code === SEP) {
      if (!matchedSlash) {
        startPart = i + 1
        break
      }
      continue
    }
    if (end === -1) {
      matchedSlash = false
      end = i + 1
    }
    if (code === ".") {
      if (startDot === -1) startDot = i
      else if (preDotState !== 1) preDotState = 1
    } else if (startDot !== -1) {
      preDotState = -1
    }
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return ""
  }
  return p.slice(startDot, end)
}

function parse(p) {
  if (typeof p !== "string") throw new TypeError("Path must be a string")
  const root = p.charAt(0) === SEP ? SEP : ""
  const base = basename(p)
  const ext = extname(p)
  const name = ext ? base.slice(0, base.length - ext.length) : base
  return { root, dir: dirname(p), base, ext, name }
}

module.exports = {
  sep: SEP,
  delimiter: ":",
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  parse,
  posix: null, // 占位，避免某些库探测 path.posix 报错
}
module.exports.posix = module.exports
