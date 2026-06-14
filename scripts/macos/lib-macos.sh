#!/bin/bash
# lib-macos.sh — install/reinstall/uninstall 脚本共用的函数库
# 仅支持 Apple Silicon (arm64) + macOS 13+

set -euo pipefail

# === 路径常量 ===
# TYPORA_APP 可由环境变量覆盖：调试时指向 Typora-Test.app，避免触碰主力 app。
# 默认值仅用于最终用户安装。
TYPORA_APP="${TYPORA_APP:-/Applications/Typora.app}"
INDEX_HTML="$TYPORA_APP/Contents/Resources/TypeMark/index.html"
PLUGIN_INSTALL_DIR="$HOME/Library/Application Support/Typora-Plugin"
DAEMON_BIN_DEST="/usr/local/bin/typora-plugin-daemon"
REINSTALL_SCRIPT_DEST="/usr/local/bin/typora-plugin-reinstall.sh"
LIB_SCRIPT_DEST="/usr/local/bin/typora-plugin-lib-macos.sh"
LAUNCH_AGENT_DEST="$HOME/Library/LaunchAgents/com.typora.plugin.watcher.plist"
INJECT_MARKER="typora-plugin-macos"
INJECT_START="${INJECT_MARKER}:start"
INJECT_END="${INJECT_MARKER}:end"
CONFIG_MARKER="${INJECT_MARKER}-config"
BACKUP_SUFFIX=".typora-plugin.bak"

# === 颜色输出 ===
c_red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
c_green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
c_cyan()  { printf "\033[0;36m%s\033[0m\n" "$1"; }
c_yellow(){ printf "\033[0;33m%s\033[0m\n" "$1"; }

panic() { c_red "ERROR: $1" >&2; exit 1; }

# === 前置检查 ===
check_arch() {
  local arch
  arch="$(uname -m)"
  if [ "$arch" != "arm64" ]; then
    panic "当前仅支持 Apple Silicon (arm64)，检测到架构: $arch"
  fi
}

check_typora() {
  [ -d "$TYPORA_APP" ] || panic "未找到 Typora，请确认已安装到 $TYPORA_APP"
  [ -f "$INDEX_HTML" ] || panic "未找到 index.html: $INDEX_HTML（可能 Typora 版本不兼容）"
}

check_typora_not_running() {
  if pgrep -x "Typora" >/dev/null 2>&1; then
    panic "请先完全退出 Typora 再运行此脚本"
  fi
}

# === 注入相关 ===
is_injected() {
  grep -q "$INJECT_MARKER" "$INDEX_HTML" 2>/dev/null
}

json_string() {
  VALUE="$1" perl -Mutf8 -e '
    my $s = $ENV{VALUE} // "";
    $s =~ s/\\/\\\\/g;
    $s =~ s/"/\\"/g;
    $s =~ s/\n/\\n/g;
    $s =~ s/\r/\\r/g;
    $s =~ s/\t/\\t/g;
    print qq{"$s"};
  '
}

file_url() {
  FILE_PATH="$1" perl -Mutf8 -e '
    my $s = $ENV{FILE_PATH} // "";
    $s =~ s/%/%25/g;
    $s =~ s/ /%20/g;
    $s =~ s/#/%23/g;
    $s =~ s/\?/%3F/g;
    print "file://$s";
  '
}

html_attr_escape() {
  VALUE="$1" perl -Mutf8 -e '
    my $s = $ENV{VALUE} // "";
    $s =~ s/&/&amp;/g;
    $s =~ s/"/&quot;/g;
    $s =~ s/</&lt;/g;
    $s =~ s/>/&gt;/g;
    print $s;
  '
}

remove_injection() {
  # Remove both the current block form and the earlier single-line script form.
  perl -0pi -e '
    s|\n?<!-- typora-plugin-macos:start -->.*?<!-- typora-plugin-macos:end -->\n?|\n|sg;
    s|^.*typora-plugin-macos.*\n?||mg;
  ' "$INDEX_HTML" 2>/dev/null || true
}

repair_bundle_symlinks() {
  local macos_dir="$TYPORA_APP/Contents/MacOS"
  [ -d "$macos_dir" ] || return 0

  find "$macos_dir" -type l 2>/dev/null | while IFS= read -r link; do
    local target base candidate
    target="$(readlink "$link" 2>/dev/null || true)"
    [ -n "$target" ] || continue

    case "$target" in
      /*)
        case "$target" in
          "$TYPORA_APP"/*) continue ;;
        esac
        base="$(basename "$target")"
        candidate="$macos_dir/$base"
        if [ -e "$candidate" ]; then
          rm -f "$link"
          ln -s "$base" "$link"
          c_yellow "✓ 已修复 bundle 符号链接: $(basename "$link") -> $base"
        fi
        ;;
    esac
  done
}

backup_index_html() {
  local backup="$INDEX_HTML$BACKUP_SUFFIX"
  if [ ! -f "$backup" ]; then
    cp "$INDEX_HTML" "$backup"
    c_green "✓ 已备份原始 index.html → $backup"
  fi
}

inject_script() {
  # 在 </head> 前插入配置 + bundle。配置必须先于 bundle，否则 global.dirname 为空。
  grep -qi '</head>' "$INDEX_HTML" || panic "注入失败，未找到 </head> 标签"

  local plugin_root_json home_dir_json temp_dir_json typora_app_json index_html_json probe_mode_json probe_report_url_json bundle_url bundle_url_attr block
  plugin_root_json="$(json_string "$PLUGIN_INSTALL_DIR")"
  home_dir_json="$(json_string "$HOME")"
  temp_dir_json="$(json_string "${TMPDIR:-/tmp}")"
  typora_app_json="$(json_string "$TYPORA_APP")"
  index_html_json="$(json_string "$INDEX_HTML")"
  probe_mode_json="false"
  case "${TYPORA_PLUGIN_PROBE:-0}" in
    1|true|TRUE|yes|YES|on|ON) probe_mode_json="true" ;;
  esac
  probe_report_url_json="$(json_string "${TYPORA_PLUGIN_PROBE_REPORT_URL:-}")"
  bundle_url="$(file_url "$PLUGIN_INSTALL_DIR/bundle.js")"
  bundle_url_attr="$(html_attr_escape "$bundle_url")"

  block="$(cat <<EOF
<!-- $INJECT_START -->
<script id="$CONFIG_MARKER">
window._TYPORA_PLUGIN_CONFIG = {
  pluginRoot: $plugin_root_json,
  homeDir: $home_dir_json,
  tempDir: $temp_dir_json,
  typoraAppPath: $typora_app_json,
  indexHtmlPath: $index_html_json,
  probeMode: $probe_mode_json,
  probeReportUrl: $probe_report_url_json,
};
</script>
<script id="${CONFIG_MARKER}-probe">
(function () {
  var config = window._TYPORA_PLUGIN_CONFIG || {};
  if (!config.probeMode) return;
  if (config.probeReportUrl) {
    fetch(config.probeReportUrl, { method: "POST", body: JSON.stringify({
      phase: "script-started",
      time: new Date().toISOString(),
      hasDocument: typeof document !== "undefined",
      readyState: document && document.readyState,
      hasJSBridge: typeof JSBridge !== "undefined"
    }) }).catch(function () {});
  }
  function write(lines) {
    var panel = document.getElementById("typora-plugin-bridge-probe");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "typora-plugin-bridge-probe";
      panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(720px,calc(100vw - 32px));max-height:min(640px,calc(100vh - 32px));overflow:auto;padding:12px;box-sizing:border-box;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:6px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;box-shadow:0 18px 45px rgba(0,0,0,.35);white-space:pre-wrap";
      document.body.appendChild(panel);
    }
    panel.textContent = lines.join("\\n");
  }
  function compact(value) {
    if (typeof value === "string") return value.slice(0, 500);
    try { return JSON.stringify(value).slice(0, 800); } catch (_e) { return String(value); }
  }
  async function invoke(name, args) {
    if (typeof JSBridge === "undefined" || typeof JSBridge.invoke !== "function") {
      throw new Error("JSBridge.invoke is not available");
    }
    return JSBridge.invoke.apply(JSBridge, [name].concat(args || []));
  }
  async function runCase(name, fn) {
    try {
      var value = await fn();
      return { name: name, ok: true, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value, value: value };
    } catch (error) {
      return { name: name, ok: false, error: error && (error.stack || error.message) || String(error) };
    }
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_resolve, reject) {
        setTimeout(function () { reject(new Error(label + " timed out after " + ms + "ms")); }, ms);
      })
    ]);
  }
  function report(payload) {
    if (!config.probeReportUrl) return Promise.resolve();
    return fetch(config.probeReportUrl, { method: "POST", body: JSON.stringify(payload) }).catch(function () {});
  }
  async function waitForJSBridge(timeoutMs) {
    var started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (typeof JSBridge !== "undefined" && typeof JSBridge.invoke === "function") {
        return true;
      }
      await sleep(250);
    }
    return false;
  }
  async function run() {
    var files = {
      pluginRoot: config.pluginRoot || "",
      indexHtml: config.indexHtmlPath || "",
      settings: (config.pluginRoot || "") + "/plugin/global/settings/settings.default.toml",
      locale: (config.pluginRoot || "") + "/plugin/global/locales/en.json"
    };
    var cases = [
      ["JSBridge presence", function () { return Promise.resolve({
        hasJSBridge: typeof JSBridge !== "undefined",
        hasInvoke: typeof JSBridge !== "undefined" && typeof JSBridge.invoke === "function",
        keys: typeof JSBridge !== "undefined" ? Object.keys(JSBridge).slice(0, 80) : []
      }); }],
      ["document.getDataFromFile(index.html)", function () { return invoke("document.getDataFromFile", [files.indexHtml]); }],
      ["document.getDataFromFile(settings.default.toml)", function () { return invoke("document.getDataFromFile", [files.settings]); }],
      ["document.getDataFromFile(en.json)", function () { return invoke("document.getDataFromFile", [files.locale]); }],
      ["fetch(settings.default.toml)", function () { return fetch("file://" + files.settings.replace(/ /g, "%20")).then(function (r) { return r.text(); }); }],
      ["fetch(en.json)", function () { return fetch("file://" + files.locale.replace(/ /g, "%20")).then(function (r) { return r.text(); }); }],
      ["path.isDirectory(pluginRoot)", function () { return invoke("path.isDirectory", [files.pluginRoot]); }],
      ["path.isDirectory(index.html)", function () { return invoke("path.isDirectory", [files.indexHtml]); }],
      ["path.listDirectory(pluginRoot)", function () { return invoke("path.listDirectory", [files.pluginRoot]); }]
    ];
    var results = [];
    write(["Typora Plugin macOS Bridge Probe", "Waiting for JSBridge...", "pluginRoot: " + files.pluginRoot, "indexHtml: " + files.indexHtml]);
    var bridgeReady = await waitForJSBridge(60000);
    await report({
      phase: "bridge-wait-finished",
      time: new Date().toISOString(),
      bridgeReady: bridgeReady,
      hasJSBridge: typeof JSBridge !== "undefined",
      hasInvoke: typeof JSBridge !== "undefined" && typeof JSBridge.invoke === "function"
    });
    for (var i = 0; i < cases.length; i++) {
      await report({ phase: "case-started", time: new Date().toISOString(), name: cases[i][0] });
      results.push(await runCase(cases[i][0], function () {
        return withTimeout(cases[i][1](), 3000, cases[i][0]);
      }));
      await report({ phase: "case-finished", time: new Date().toISOString(), result: results[results.length - 1] });
      write(["Typora Plugin macOS Bridge Probe", "pluginRoot: " + files.pluginRoot, "indexHtml: " + files.indexHtml, ""].concat(results.map(function (r) {
        return "[" + (r.ok ? "PASS" : "FAIL") + "] " + r.name + "\\n" + (r.ok ? r.type + ": " + compact(r.value) : r.error);
      })));
    }
    window.__typoraPluginBridgeProbeResults = results;
    await report({ phase: "complete", time: new Date().toISOString(), files: files, results: results });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
</script>
<script id="$INJECT_MARKER" src="$bundle_url_attr" defer></script>
<!-- $INJECT_END -->
EOF
)"

  remove_injection
  INJECTION_BLOCK="$block" perl -0pi -e '$block = $ENV{"INJECTION_BLOCK"}; s|</head>|$block . "\n</head>"|ie' "$INDEX_HTML"
  is_injected || panic "注入失败，未写入插件脚本标记"
  c_green "✓ 已注入插件配置与 bundle 到 index.html"
}

re_sign_bundle() {
  # bundle 修改后需要重新 ad-hoc 签名；同时修复从主 app 复制出来的绝对 symlink。
  repair_bundle_symlinks
  codesign --force --deep --sign - "$TYPORA_APP" 2>/dev/null || panic "重新签名失败，请先检查 bundle 结构"
  xattr -dr com.apple.quarantine "$TYPORA_APP" 2>/dev/null || true
  c_green "✓ 已重新 ad-hoc 签名并移除隔离属性"
}

remove_signature() {
  re_sign_bundle
}

record_version() {
  local ver
  ver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TYPORA_APP/Contents/Info.plist" 2>/dev/null || echo "unknown")"
  defaults write com.typora.plugin LastKnownTyporaVersion "$ver" 2>/dev/null || true
  c_cyan "当前 Typora 版本: $ver"
}
