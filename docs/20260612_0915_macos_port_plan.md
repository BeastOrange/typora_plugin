# macOS 移植实施方案

**文档版本**: 1.0.0
**创建时间**: 2026-06-12 09:15
**目标发布版本**: v1.0.0-macos-beta.1
**当前状态**: 规划阶段
**支持范围**: 仅 Apple Silicon（M 系列芯片），Intel 暂不在计划内

---

## 1. 概述

### 1.1 目标
将 obgnail/typora_plugin 移植到 macOS，用 WKWebView 桥接 API 替换 Electron 的 Node.js 依赖，让这套 50+ 插件能够在 macOS 版 Typora（v1.1 及以上）上运行。

### 1.2 核心难点
- **架构不一致**：Windows/Linux 版基于 Electron，带 Node.js 集成；macOS 版 Typora 是原生 Cocoa + WKWebView，**没有 Node.js 运行时**
- **注入机制**：修改已签名的 app bundle 会破坏签名，需要配套的处理策略
- **维护问题**：Typora 每次升级都会替换 app bundle，用户需要重新注入

### 1.3 方案总览
- **插件核心**：用 TypeScript 重写，把所有 `reqnode()` 调用替换为封装了 `window.bridge.callHandler()` 的 `MacBridge`
- **注入方式**：直接修改 `TypeMark/index.html`，并自动去除签名
- **自动重注入**：后台常驻 daemon（Swift 编写）监控 Typora 版本，版本变化时自动触发重注入
- **分发方式**：预编译 daemon 二进制 + 打包好的 JS + 安装脚本

### 1.4 平台限制说明
- **仅支持 Apple Silicon**：daemon 二进制只编译 arm64，不做 universal binary
- **Intel 暂不支持**：如未来有需求，再单独评估编译 x86_64 版本的成本
- **macOS 版本要求**：13 Ventura 及以上（依赖 WKWebView 相关 API）

---

## 2. 技术架构

### 2.1 改造前（Windows/Linux）
```
window.html
  → <script src="plugin/index.js">
    → global.reqnode("path") / global.dirname
    → plugin/global/core/index.js
      → require("fs"), require("child_process"), require("electron")
```

### 2.2 改造后（macOS）
```
TypeMark/index.html
  → <script src="file:///~/Library/Application Support/Typora-Plugin/bundle.js">
    → MacBridge.callHandler("document.getDataFromFile", ...)
    → plugin/global/core/index.js（TypeScript → esbuild 打包）
      → 不使用任何 Node.js API，纯浏览器 JS + 桥接
```

### 2.3 技术栈
| 组件 | 技术 | 选型理由 |
|------|------|----------|
| 插件核心 | TypeScript | 5000+ 行重构需要类型安全；反正已经要用 esbuild |
| 构建工具 | esbuild | 打包快、支持 TS 编译、tree-shaking |
| 后台 daemon | Swift | 原生、零依赖、内存 <5MB、易于集成 launchd；仅编译 arm64 |
| 注入脚本 | Bash | 直接用 sed 修改 index.html、去除 codesign 签名 |
| 分发 | GitHub Releases | 预编译二进制 + zip 包 |

---

## 3. 实施阶段

### 阶段一：基础设施搭建（第 1 天）
**交付物**：
- Fork 仓库到个人账号（保留 git history）
- 添加 `tsconfig.json` + 更新 `develop/package.json` 构建脚本
- 创建目录结构：
  ```
  daemon/              # Swift daemon 源码
  daemon/build/        # 编译产物（仅 arm64）
  scripts/macos/       # install-macos.sh, reinstall-macos.sh
  docs/                # 本方案 + 进度跟踪
  ```
- 编写初版 `install-macos.sh`（备份 + 注入 + 去签名）

**验收标准**：
- 能编译 daemon：`swiftc -target arm64-apple-macos13 daemon/main.swift -o daemon/build/typora-plugin-daemon`
- 能注入测试 HTML：修改后的 `index.html` 能加载外部 JS

---

### 阶段二：核心重构 - MacBridge（第 2-3 天）
**范围**：用桥接调用替换所有 Node.js API 用法

> ⚠️ **架构已调整（2026-06-13）**：本节描述的「逐文件改写为 MacBridge 调用」方案已**放弃**。
> 在「长期同步上游」前提下，逐个改写调用点会产生数十个 cherry-pick 冲突点。
> 实际采用 **Shim 层 + esbuild alias + 静态插件注册表**：上游调用点一行不改。
> 详见 [阶段二实现记录：Shim 层 + esbuild Alias 架构](20260613_0939_phase2_shim_architecture.md)。
> 以下内容保留作历史参考。

**需要修改的文件**：
1. `plugin/index.js` → `plugin/index.ts`
   - 移除 `global.reqnode/dirname` 依赖
   - 加入 MacBridge 初始化，传入插件根目录路径

2. `plugin/global/core/utils/index.js` → `.ts`
   - `reqnode("electron").shell.openPath()` → `MacBridge.openPath()`
   - `reqnode("path").join()` → `MacBridge.joinPath()`

3. 新建 `plugin/global/core/macBridge.ts`：
   ```typescript
   class MacBridge {
     static callHandler(name: string, data?: any): Promise<any>
     static getDataFromFile(path: string): Promise<string>
     static writeDataToFile(path: string, data: string): Promise<void>
     static openPath(path: string): Promise<void>
     static joinPath(...parts: string[]): string
   }
   ```

**需要移除/禁用的文件**：
- `plugin/ripgrep.js`（使用 `child_process.spawn`，没有桥接等价物，**先砍掉**）
- `plugin/window_tab.js` 中的 ipcRenderer 用法（改用纯 DOM 实现）

**验收标准**：
- TypeScript 编译无错误
- esbuild 产出单个 `bundle.js`（minify 后 <2MB）
- 输出 bundle 中不含任何 `require()` 或 `reqnode()` 调用

---

### 阶段三：Daemon 实现（第 3-4 天）
**交付物**：

1. **Swift Daemon**（`daemon/main.swift`）：
   - 监控 `/Applications/Typora.app/Contents/Info.plist` 的版本号
   - 与上次记录的版本对比（存在 UserDefaults）
   - 版本不一致时：执行 `reinstall-macos.sh`，更新记录的版本
   - 每 6 小时检查一次（可配置）

2. **LaunchAgent plist**（`daemon/com.typora.plugin.watcher.plist`）：
   ```xml
   <key>ProgramArguments</key>
   <array>
     <string>/usr/local/bin/typora-plugin-daemon</string>
   </array>
   <key>RunAtLoad</key>
   <true/>
   <key>KeepAlive</key>
   <true/>
   ```

3. **安装集成**：
   - `install-macos.sh` 把 daemon 复制到 `/usr/local/bin/`
   - 把 plist 复制到 `~/Library/LaunchAgents/`
   - 执行 `launchctl load` 启动 daemon

**验收标准**：
- daemon 能在 6 小时内检测到 Typora 版本变化
- 自动重注入无需用户干预
- daemon 能在系统重启后存活

---

### 阶段四：安装脚本（第 4 天）
**交付物**：

1. **`scripts/macos/install-macos.sh`**：
   ```bash
   #!/bin/bash
   # 1. 备份用户的 Typora 配置
   # 2. 复制 plugin/ 到 ~/Library/Application Support/Typora-Plugin/
   # 3. 备份原始 index.html
   # 4. 向 index.html 注入 <script> 标签
   # 5. 去除 app 签名 + 移除隔离属性
   # 6. 安装 daemon + launchd plist
   # 7. 记录已安装的 Typora 版本
   ```

2. **`scripts/macos/reinstall-macos.sh`**（幂等）：
   ```bash
   # 与 install 类似，但：
   # - 跳过配置备份（已存在）
   # - 修改 HTML 前先检查是否已注入
   # - 总是重新去除签名（升级后签名会恢复）
   ```

3. **`scripts/macos/uninstall-macos.sh`**：
   ```bash
   # 1. 从备份恢复原始 index.html
   # 2. 停止 + 移除 launchd daemon
   # 3. 删除插件文件
   # 4. 询问用户：保留配置还是删除？
   ```

**验收标准**：
- 安装在 30 秒内完成
- 卸载能完全还原所有改动
- 重装幂等（可多次安全运行）

---

### 阶段五：测试与调试（第 5-6 天）
**测试矩阵**：

| 插件类别 | 测试插件 | 关键功能 |
|----------|----------|----------|
| 核心 | preferences, updater | 配置加载/保存、版本检查 |
| 编辑 | fence_enhance, md_padding | 代码折叠、文本格式化 |
| 界面 | command_palette, right_click_menu | 菜单注册、快捷键 |
| 组件 | markmap, echarts, chart | 图表渲染、懒加载 |
| 文件操作 | templater, resource_manager | 读写文件、路径解析 |

**测试环境**（仅 Apple Silicon）：
- macOS 13 Ventura（Apple Silicon）
- macOS 14 Sonoma（Apple Silicon）
- macOS 15 Sequoia（Apple Silicon）
- Typora 版本：1.8.10、1.9.5、1.10.0

**待修复的已知问题**：
- bundle 体积优化（当前 vendor 库 50MB）
- 桥接 API 覆盖度（部分 Node API 可能缺少桥接等价物）
- 性能（WKWebView JS 执行 vs Node.js）

**验收标准**：
- 40+ 核心插件正常工作无报错
- 配置能跨 app 重启持久化
- WKWebView inspector 中无 console 错误

---

## 4. 版本策略

### 4.1 版本号格式
遵循语义化版本 2.0.0：`MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]`

**示例**：
- `1.0.0-macos-beta.1` — macOS 移植首个 beta
- `1.0.0-macos-rc.1` — 候选发布版
- `1.0.0` — macOS 首个稳定版
- `1.1.0` — 小功能新增
- `1.1.1` — bug 修复
- `2.0.0` — 破坏性变更（如要求 macOS 14+）

### 4.2 发布渠道
| 分支 | 用途 | 更新频率 |
|------|------|----------|
| `main` | 仅稳定版 | 每 2-4 周 |
| `develop` | 活跃开发 | 每日提交 |
| `release/v1.x` | 维护分支 | 回合关键修复 |

### 4.3 Changelog 格式
```markdown
## [1.0.0-macos-beta.1] - 2026-06-20

### 新增
- 40+ 插件的 macOS 支持
- 自动重注入 daemon

### 变更
- 核心用 TypeScript 重写
- 用桥接调用替换 Node.js API

### 移除
- ripgrep 插件（依赖 Node child_process）

### 修复
- 大小写敏感 APFS 上的路径解析

### 破坏性变更
- 要求 macOS 13+（依赖 WKWebView API）
- 仅支持 Apple Silicon
```

---

## 5. 分发与打包

### 5.1 GitHub Release 产物
```
typora-plugin-v1.0.0-macos-beta.1.zip
├── plugin/                    # 打包好的 JS + 资源
├── daemon/
│   └── typora-plugin-daemon   # 预编译二进制（仅 arm64）
├── scripts/macos/
│   ├── install-macos.sh
│   ├── reinstall-macos.sh
│   └── uninstall-macos.sh
├── README-macos.md            # 安装指南
└── CHANGELOG.md
```

### 5.2 安装说明（写入 README）
```bash
# 1. 下载并解压
curl -L https://github.com/BeastOrange/typora_plugin/releases/download/v1.0.0-macos-beta.1/typora-plugin-v1.0.0-macos-beta.1.zip -o plugin.zip
unzip plugin.zip && cd typora-plugin

# 2. 运行安装脚本（需先关闭 Typora）
./scripts/macos/install-macos.sh

# 3. 启动 Typora
# 首次启动需右键 app → 选择"打开"（因为修改后变成未签名应用）
```

### 5.3 更新流程
```bash
# 方案 A：用户手动下载新版 + 重新运行 install（覆盖旧版）
# 方案 B：内置 updater 插件（通过 GitHub API 检查最新 release）
```

---

## 6. 风险管理

### 6.1 技术风险
| 风险 | 影响 | 概率 | 应对 |
|------|------|------|------|
| 桥接 API 不完整 | 高 | 中 | 记录缺失 API，尽可能加 polyfill |
| 性能下降 | 中 | 低 | 用 WKWebView inspector 做性能分析，优化热点路径 |
| Typora 升级破坏注入 | 高 | 高 | daemon 自动检测并重注入 |
| 用户误删 daemon | 中 | 低 | 安装脚本每次运行检查 daemon 健康状态 |

### 6.2 用户体验风险
| 风险 | 影响 | 应对 |
|------|------|------|
| "未签名应用"警告吓到用户 | 高 | README 配截图清晰说明"打开"流程 |
| Typora 升级后需手动重装 | 中 | 自动重注入 daemon（已规划） |
| 卸载时丢失配置 | 中 | 卸载脚本删除前询问，并备份到桌面 |

---

## 7. 成功指标

### 7.1 发布标准（v1.0.0-macos-beta.1）
- [ ] 35+ 插件可用（覆盖率 70%+）
- [ ] 零严重 bug（app 崩溃、数据丢失）
- [ ] 安装成功率 >90%（基于 beta 测试反馈）
- [ ] 自动重注入 daemon 在 macOS 13-15 上正常工作

### 7.2 稳定版标准（v1.0.0）
- [ ] 45+ 插件可用（覆盖率 90%+）
- [ ] 未解决 bug <5 个（P0/P1 优先级）
- [ ] 文档完整（README、CHANGELOG、故障排查指南）
- [ ] 社区反馈：>80% 正面（GitHub issues、discussions）

---

## 8. 时间线与里程碑

| 里程碑 | 目标日期 | 交付物 |
|--------|----------|--------|
| **M1：基础设施** | 2026-06-13 | Fork 仓库、加 TS 配置、daemon 骨架 |
| **M2：核心重构** | 2026-06-15 | MacBridge 完成、bundle.js 可构建 |
| **M3：Daemon + 脚本** | 2026-06-16 | 安装/重装/卸载脚本可用 |
| **M4：内测** | 2026-06-17 | 在 3 个 macOS 版本上内部测试 |
| **M5：Beta 发布** | 2026-06-20 | v1.0.0-macos-beta.1 上线 GitHub Releases |
| **M6：稳定版发布** | 2026-07-10 | 3 周 beta 反馈后发布 v1.0.0 |

**缓冲**：预留 20% 时间应对意外问题（如桥接 API 限制、WKWebView 怪异行为）

---

## 9. 待解决问题

1. **Bundle 体积**：能否压缩 50MB 的 vendor 库？（懒加载图表、剔除未用代码）
2. **桥接 API 覆盖度**：哪些 Node API 缺少桥接等价物？（需要审计）
3. **代码签名**：能否自签名修改后的 app 以避免 Gatekeeper 警告？（需要 Apple 开发者证书）
4. **上游同步**：如何从 obgnail/typora_plugin cherry-pick bug 修复？（单独建跟踪文档）
5. **社区 fork**：是否最终向上游提议 macOS 支持？（等 v1.0.0 稳定后）

---

## 10. 下一步

### 立即行动（本周）
1. ✅ 编写本方案
2. ⬜ Fork 仓库（保留 git history）
3. ⬜ 执行环境隔离（备份 Typora 配置）
4. ⬜ 审计所有 `reqnode()` 用法（生成文件清单）
5. ⬜ 搭建 TypeScript 构建流水线
6. ⬜ 编写 daemon v0.1（基础版本检查）

### 需要决策
- **批准本方案？**（如批准，立即进入阶段一）
- **调整时间线？**（如需要可压缩到 4 天）
- **技术栈变更？**（如 daemon 改用 Python）

---

**文档负责人**: Orange
**GitHub 账号**: BeastOrange
**最后更新**: 2026-06-12 09:15
**下次评审**: 2026-06-13（阶段一完成后）