#!/bin/bash
# install-macos.sh — 首次安装 typora_plugin 到 macOS（仅 Apple Silicon）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
source "$SCRIPT_DIR/lib-macos.sh"

c_cyan "=== Typora Plugin · macOS 安装程序 (Apple Silicon) ==="

# 1. 前置检查
check_arch
check_typora
check_typora_not_running

# 2. 备份用户配置（首次安装才做）
BACKUP_TS="$(date +%Y%m%d_%H%M%S)"
CONFIG_BACKUP="$HOME/Desktop/typora-config-backup-$BACKUP_TS.tar.gz"
if [ -d "$HOME/Library/Application Support/abnerworks.Typora" ]; then
  tar -czf "$CONFIG_BACKUP" \
    -C "$HOME/Library/Application Support" "abnerworks.Typora" 2>/dev/null || true
  c_green "✓ 已备份 Typora 配置 → $CONFIG_BACKUP"
fi

# 3. 复制插件到独立目录（与 Typora.app 解耦，升级不影响）
mkdir -p "$PLUGIN_INSTALL_DIR"
# 注：bundle.js 由 esbuild 构建产生；此处复制 plugin/ 资源 + bundle
if [ -f "$REPO_ROOT/plugin/bundle.js" ]; then
  cp "$REPO_ROOT/plugin/bundle.js" "$PLUGIN_INSTALL_DIR/bundle.js"
  c_green "✓ 已复制 bundle.js"
else
  c_yellow "⚠ 未找到 plugin/bundle.js（阶段二完成后才会有），暂跳过"
fi
# 复制运行时需要的资源。核心路径以 pluginRoot + "./plugin/..." 解析，
# 因此安装目录内必须保留 plugin/ 这一层。
mkdir -p "$PLUGIN_INSTALL_DIR/plugin"
for d in global/locales global/styles global/settings global/user_styles preferences; do
  if [ -d "$REPO_ROOT/plugin/$d" ]; then
    mkdir -p "$PLUGIN_INSTALL_DIR/plugin/$d"
    cp -R "$REPO_ROOT/plugin/$d/." "$PLUGIN_INSTALL_DIR/plugin/$d/"
  fi
done
c_green "✓ 已复制插件资源到 $PLUGIN_INSTALL_DIR"

# 4. 备份 + 注入 index.html
backup_index_html
inject_script

# 5. 去签名
remove_signature

# 6. 安装 daemon + launchd
if [ -f "$REPO_ROOT/daemon/build/typora-plugin-daemon" ]; then
  sudo cp "$REPO_ROOT/daemon/build/typora-plugin-daemon" "$DAEMON_BIN_DEST"
  sudo chmod +x "$DAEMON_BIN_DEST"
  sudo cp "$SCRIPT_DIR/reinstall-macos.sh" "$REINSTALL_SCRIPT_DEST"
  sudo chmod +x "$REINSTALL_SCRIPT_DEST"
  sudo cp "$SCRIPT_DIR/lib-macos.sh" "$LIB_SCRIPT_DEST"
  sudo chmod +x "$LIB_SCRIPT_DEST"
  mkdir -p "$HOME/Library/LaunchAgents"
  cp "$REPO_ROOT/daemon/com.typora.plugin.watcher.plist" "$LAUNCH_AGENT_DEST"
  launchctl unload "$LAUNCH_AGENT_DEST" 2>/dev/null || true
  launchctl load "$LAUNCH_AGENT_DEST"
  c_green "✓ 已安装并启动自动重注入 daemon"
else
  c_yellow "⚠ 未找到 daemon 二进制，请先运行 daemon/build-daemon.sh"
fi

# 7. 记录版本
record_version

c_green ""
c_green "=========================================="
c_green " 安装完成！请启动 Typora。"
c_yellow " 首次启动：右键 Typora.app → 打开 → 确认"
c_green "=========================================="
