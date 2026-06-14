#!/bin/bash
# uninstall-macos.sh — 完全卸载，还原 Typora 原状
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/lib-macos.sh"

c_cyan "=== Typora Plugin · macOS 卸载程序 ==="

check_typora_not_running

# 1. 还原 index.html
BACKUP="$INDEX_HTML$BACKUP_SUFFIX"
if [ -f "$BACKUP" ]; then
  cp "$BACKUP" "$INDEX_HTML"
  rm -f "$BACKUP"
  c_green "✓ 已还原原始 index.html"
else
  c_yellow "⚠ 未找到备份，尝试直接移除注入标记"
  remove_injection
fi

# 2. 停止并移除 daemon
if [ -f "$LAUNCH_AGENT_DEST" ]; then
  launchctl unload "$LAUNCH_AGENT_DEST" 2>/dev/null || true
  rm -f "$LAUNCH_AGENT_DEST"
  c_green "✓ 已停止并移除 daemon"
fi
sudo rm -f "$DAEMON_BIN_DEST" "$REINSTALL_SCRIPT_DEST" "$LIB_SCRIPT_DEST" 2>/dev/null || true

# 3. 重新签名（ad-hoc，恢复可启动状态）
codesign --force --deep --sign - "$TYPORA_APP" 2>/dev/null || true
c_green "✓ 已重新 ad-hoc 签名 Typora"

# 4. 询问是否删除插件文件与配置
printf "是否删除插件文件 %s ? [y/N] " "$PLUGIN_INSTALL_DIR"
read -r ans
if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
  rm -rf "$PLUGIN_INSTALL_DIR"
  c_green "✓ 已删除插件文件"
else
  c_yellow "保留插件文件: $PLUGIN_INSTALL_DIR"
fi

defaults delete com.typora.plugin 2>/dev/null || true

c_green ""
c_green "卸载完成。请重启 Typora 验证已还原。"
