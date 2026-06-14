#!/bin/bash
# reinstall-macos.sh — 幂等重注入（Typora 升级后由 daemon 自动调用，也可手动运行）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# daemon 调用时 SCRIPT_DIR 可能是 /usr/local/bin，lib 需从同目录或 fallback 加载
if [ -f "$SCRIPT_DIR/lib-macos.sh" ]; then
  source "$SCRIPT_DIR/lib-macos.sh"
elif [ -f "$SCRIPT_DIR/typora-plugin-lib-macos.sh" ]; then
  source "$SCRIPT_DIR/typora-plugin-lib-macos.sh"
else
  # daemon 部署场景：函数库内联在重注入脚本里不便维护，改为最小内联
  TYPORA_APP="${TYPORA_APP:-/Applications/Typora.app}"
  INDEX_HTML="$TYPORA_APP/Contents/Resources/TypeMark/index.html"
  PLUGIN_INSTALL_DIR="$HOME/Library/Application Support/Typora-Plugin"
  INJECT_MARKER="typora-plugin-macos"
  INJECT_START="${INJECT_MARKER}:start"
  INJECT_END="${INJECT_MARKER}:end"
  CONFIG_MARKER="${INJECT_MARKER}-config"
  BACKUP_SUFFIX=".typora-plugin.bak"
  c_green()  { printf "\033[0;32m%s\033[0m\n" "$1"; }
  c_yellow() { printf "\033[0;33m%s\033[0m\n" "$1"; }
  panic() { printf "\033[0;31mERROR: %s\033[0m\n" "$1" >&2; exit 1; }
  is_injected() { grep -q "$INJECT_MARKER" "$INDEX_HTML" 2>/dev/null; }
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
          fi
          ;;
      esac
    done
  }
  backup_index_html() {
    local b="$INDEX_HTML$BACKUP_SUFFIX"
    [ -f "$b" ] || cp "$INDEX_HTML" "$b"
  }
  inject_script() {
    grep -qi '</body>' "$INDEX_HTML" || panic "注入失败，未找到 </body> 标签"
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
<script id="$INJECT_MARKER" src="$bundle_url_attr" defer></script>
<!-- $INJECT_END -->
EOF
)"
    remove_injection
    INJECTION_BLOCK="$block" perl -0pi -e '$block = $ENV{"INJECTION_BLOCK"}; s|</body>|$block . "\n</body>"|ie' "$INDEX_HTML"
    is_injected || panic "注入失败"
  }
  re_sign_bundle() {
    repair_bundle_symlinks
    codesign --force --deep --sign - "$TYPORA_APP" 2>/dev/null || panic "重新签名失败，请先检查 bundle 结构"
    xattr -dr com.apple.quarantine "$TYPORA_APP" 2>/dev/null || true
  }
  remove_signature() { re_sign_bundle; }
  record_version() {
    local v
    v="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TYPORA_APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
    defaults write com.typora.plugin LastKnownTyporaVersion "$v" 2>/dev/null || true
  }
fi

c_green "=== Typora Plugin · 重注入 ==="

# 升级后 index.html 被替换：备份新原版、重新注入、重新 ad-hoc 签名
[ -f "$INDEX_HTML" ] || panic "未找到 index.html"
backup_index_html
inject_script
remove_signature
record_version

c_green "✓ 重注入完成"
