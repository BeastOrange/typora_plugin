const { describe, it, afterEach } = require("node:test")
const assert = require("node:assert")

const shimPath = "../../plugin/global/core/shims/fs.js"

const resetGlobals = () => {
  delete global.fetch
  delete global.JSBridge
  delete global.window
  delete global.dirname
}

const loadShim = () => {
  delete require.cache[require.resolve(shimPath)]
  return require(shimPath)
}

afterEach(resetGlobals)

describe("macOS fs shim", () => {
  it("reads text files through encoded file URLs", async () => {
    const requests = []
    global.fetch = async (url) => {
      requests.push(url)
      return {
        ok: true,
        text: async () => "hello",
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }
    }

    const fs = loadShim()
    const text = await fs.readFile("/tmp/a b/%23?file.txt", "utf-8")

    assert.strictEqual(text, "hello")
    assert.deepStrictEqual(requests, ["file:///tmp/a%20b/%2523%3Ffile.txt"])
  })

  it("accepts readable file responses with status 0", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 0,
      text: async () => "local file",
      arrayBuffer: async () => new ArrayBuffer(0),
    })

    const fs = loadShim()
    assert.strictEqual(await fs.readFile("/tmp/local.txt", "utf8"), "local file")
  })

  it("returns binary-compatible data when encoding is omitted", async () => {
    global.fetch = async () => ({
      ok: true,
      text: async () => "ignored",
      arrayBuffer: async () => Uint8Array.from([0x3c, 0x73, 0x76, 0x67]).buffer,
    })

    const fs = loadShim()
    const bin = await fs.readFile("/tmp/icon.svg")

    assert.strictEqual(bin.slice(0, 4).toString(), "<svg")
    assert.strictEqual(bin.toString("base64"), "PHN2Zw==")
  })

  it("returns base64 text for base64 encoding", async () => {
    global.fetch = async () => ({
      ok: true,
      text: async () => "ignored",
      arrayBuffer: async () => Uint8Array.from([0x3c, 0x73, 0x76, 0x67]).buffer,
    })

    const fs = loadShim()
    assert.strictEqual(await fs.readFile("/tmp/icon.svg", "base64"), "PHN2Zw==")
  })

  it("uses JSBridge directory probing as access fallback", async () => {
    global.fetch = async () => {
      throw new Error("not a file")
    }
    global.JSBridge = {
      invoke: async (name, path) => name === "path.isDirectory" && path === "/tmp/dir",
    }

    const fs = loadShim()
    await assert.doesNotReject(() => fs.access("/tmp/dir"))
    await assert.rejects(() => fs.access("/tmp/missing"), { code: "ENOENT" })
  })

  it("checks file existence when stat reports a non-directory", async () => {
    global.fetch = async () => {
      throw new Error("not found")
    }
    global.JSBridge = {
      invoke: async () => false,
    }

    const fs = loadShim()
    await assert.rejects(() => fs.stat("/tmp/missing"), { code: "ENOENT" })
  })

  it("fails readdir explicitly because Typora has no directory listing bridge", async () => {
    const fs = loadShim()
    await assert.rejects(() => fs.readdir("/tmp/dir"), { code: "ENOSYS" })
  })

  it("reads bundled plugin directory entries from the generated manifest", async () => {
    global.window = {
      _TYPORA_PLUGIN_CONFIG: {
        pluginRoot: "/Users/test/Library/Application Support/Typora-Plugin",
      },
    }

    const fs = loadShim()
    const entries = await fs.readdir("/Users/test/Library/Application Support/Typora-Plugin/plugin/fence_enhance/resource/fold/")

    assert.ok(entries.includes("foldcode.js"))
    assert.ok(entries.includes("markdown-fold.js"))
  })
})
