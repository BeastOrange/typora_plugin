#!/bin/bash
# reinstall-macos.sh — 幂等重注入（Typora 升级后由 daemon 自动调用，也可手动运行）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# daemon 调用时 SCRIPT_DIR 可能是 /usr/local/bin，lib 需从同目录或 fallback 加载
if [ -f "$SCRIPT_DIR/lib-macos.sh" ]; then
  source "$SCRIPT_DIR/lib-macos.sh"
else
  # daemon 部署场景：函数库内联在重注入脚本里不便维护，改为最小内联
  TYPORA_APP="${TYPORA_APP:-/Applications/Typora.app}"
  INDEX_HTML="$TYPORA_APP/Contents/Resources/TypeMark/index.html"
  PLUGIN_INSTALL_DIR="$HOME/Library/Application Support/Typora-Plugin"
  INJECT_MARKER="typora-plugin-macos"
  BACKUP_SUFFIX=".typora-plugin.bak"
  c_green()  { printf "\033[0;32m%s\033[0m\n" "$1"; }
  c_yellow() { printf "\033[0;33m%s\033[0m\n" "$1"; }
  panic() { printf "\033[0;31mERROR: %s\033[0m\n" "$1" >&2; exit 1; }
  is_injected() { grep -q "$INJECT_MARKER" "$INDEX_HTML" 2>/dev/null; }
  backup_index_html() {
    local b="$INDEX_HTML$BACKUP_SUFFIX"
    [ -f "$b" ] || cp "$INDEX_HTML" "$b"
  }
  inject_script() {
    local tag="<script id=\"$INJECT_MARKER\" src=\"file://$PLUGIN_INSTALL_DIR/bundle.js\" defer></script>"
    is_injected && return
    perl -i -pe "s|</body>|$tag\n</body>|" "$INDEX_HTML"
    is_injected || panic "注入失败"
  }
  remove_signature() {
    codesign --remove-signature "$TYPORA_APP" 2>/dev/null || true
    xattr -dr com.apple.quarantine "$TYPORA_APP" 2>/dev/null || true
  }
  record_version() {
    local v
    v="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TYPORA_APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
    defaults write com.typora.plugin LastKnownTyporaVersion "$v" 2>/dev/null || true
  }
fi

c_green "=== Typora Plugin · 重注入 ==="

# 升级后 index.html 被替换：备份新原版、重新注入、重新去签名
[ -f "$INDEX_HTML" ] || panic "未找到 index.html"
backup_index_html
inject_script
remove_signature
record_version

c_green "✓ 重注入完成"
