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
LAUNCH_AGENT_DEST="$HOME/Library/LaunchAgents/com.typora.plugin.watcher.plist"
INJECT_MARKER="typora-plugin-macos"
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

backup_index_html() {
  local backup="$INDEX_HTML$BACKUP_SUFFIX"
  if [ ! -f "$backup" ]; then
    cp "$INDEX_HTML" "$backup"
    c_green "✓ 已备份原始 index.html → $backup"
  fi
}

inject_script() {
  # 在 </body> 前插入插件 bundle 的 <script> 标签
  local bundle_url="file://$PLUGIN_INSTALL_DIR/bundle.js"
  local tag="<script id=\"$INJECT_MARKER\" src=\"$bundle_url\" defer></script>"
  if is_injected; then
    c_yellow "已注入，跳过 HTML 修改"
    return
  fi
  # 用 perl 做安全替换（避免 sed 的转义地狱）
  perl -i -pe "s|</body>|$tag\n</body>|" "$INDEX_HTML"
  is_injected || panic "注入失败，未找到 </body> 标签"
  c_green "✓ 已注入插件脚本到 index.html"
}

remove_signature() {
  # 去除签名（修改 bundle 后签名失效，主动移除避免崩溃）
  codesign --remove-signature "$TYPORA_APP" 2>/dev/null || true
  xattr -dr com.apple.quarantine "$TYPORA_APP" 2>/dev/null || true
  c_green "✓ 已移除签名与隔离属性"
}

record_version() {
  local ver
  ver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TYPORA_APP/Contents/Info.plist" 2>/dev/null || echo "unknown")"
  defaults write com.typora.plugin LastKnownTyporaVersion "$ver" 2>/dev/null || true
  c_cyan "当前 Typora 版本: $ver"
}
