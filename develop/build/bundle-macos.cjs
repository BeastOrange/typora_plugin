/**
 * build/bundle-macos.cjs — 把 plugin/ 入口打包成单个 bundle.js（macOS 用，无 Node 运行时）
 *
 * 阶段一：仅搭建骨架并验证 esbuild 可产出 bundle。
 * 真正的入口（plugin/index.ts → MacBridge 改造）在阶段二完成后接入。
 */
const path = require("path")
const esbuild = require("esbuild")

const ROOT = path.dirname(__dirname) // develop/ 的上级 = 仓库根
const REPO_ROOT = path.dirname(ROOT)

async function build() {
  const entry = path.join(REPO_ROOT, "plugin", "index.ts")
  const outfile = path.join(REPO_ROOT, "plugin", "bundle.js")

  const fs = require("fs")
  if (!fs.existsSync(entry)) {
    console.warn(`[bundle-macos] 入口 ${entry} 尚不存在（阶段二创建）。跳过。`)
    process.exit(0)
  }

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile,
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    sourcemap: false,
    metafile: true,
    // macOS 无 Node：禁止打包进任何 Node 内建模块，发现即报错
    external: [],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  })

  const size = (require("fs").statSync(outfile).size / 1024).toFixed(1)
  console.log(`[bundle-macos] ✓ 产出 ${outfile} (${size} KB)`)
  return result
}

build().catch((e) => {
  console.error("[bundle-macos] 构建失败:", e)
  process.exit(1)
})
