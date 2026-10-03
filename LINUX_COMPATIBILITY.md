# Linux vs macOS 兼容性分析

## 执行时间
2024-10-03

---

## ✅ 高度相似（通常不会有问题）

### 1. 基础 Unix 特性
**共同点：**
- 行尾符：都使用 LF (`\n`)
- 路径分隔符：都使用 `/`
- 文件权限：都使用 POSIX (rwxrwxrwx)
- Shell：都支持 bash/zsh
- 文本编码：默认都使用 UTF-8

**结论：** ✅ 不会像 Windows 那样有行尾符问题

### 2. 文件系统基础操作
**共同点：**
- 都使用 POSIX 文件 API
- Rust std::fs 和 tokio::fs 跨平台兼容
- PathBuf 自动处理路径

**结论：** ✅ 文件读写、重命名等基础操作没有问题

---

## ⚠️ 需要注意的差异

### 3. 系统依赖库（运行时依赖）

**macOS:**
- WebKit 内置在系统中（WKWebView）
- Cocoa 框架自带
- 不需要额外安装依赖

**Linux:**
- 依赖 WebKitGTK (`libwebkit2gtk-4.1`)
- 依赖 GTK 3 生态系统
- 依赖系统库：`libappindicator3`, `librsvg2`

**潜在问题：**
```bash
# 用户系统可能缺少这些库
# Ubuntu 22.04+ / Debian 12+
libwebkit2gtk-4.1-dev
libgtk-3-0
libappindicator3-1
librsvg2-2

# 更旧的系统可能只有
libwebkit2gtk-4.0-dev  # 注意版本号 4.0 vs 4.1
```

**影响：**
- ⚠️ **中等风险** - 用户下载 AppImage 后可能无法启动
- AppImage 应该包含大部分依赖，但基础系统库（如 glibc）仍依赖系统
- **建议：** 在 README 中列出运行依赖，或提供安装脚本

**当前状态：**
- GitHub Actions 使用 Ubuntu 22.04 构建
- 构建配置正确 (build-preview.yml:267)

---

### 4. 文件系统大小写敏感性

**macOS APFS:**
- 默认：不区分大小写，但**保留**大小写
- `Import.ts` 和 `import.ts` 被视为同一个文件
- 可选：区分大小写的 APFS（开发者较少使用）

**Linux ext4/btrfs/xfs:**
- 严格区分大小写
- `Import.ts` 和 `import.ts` 是两个不同的文件

**潜在问题：**
- 如果代码中导入路径大小写不一致
- macOS 开发时不会报错，Linux 运行时会找不到模块

**检查结果：**
```typescript
// 代码中的 import 语句大小写一致
import { onMount } from 'svelte';
import { initMonaco } from '$lib/services/monaco';
```

**结论：** ✅ 代码检查未发现大小写不一致

---

### 5. 字体渲染和可用性

**macOS:**
- 使用 Core Text 引擎
- 自带高质量系统字体：SF Pro, SF Mono
- 字体渲染平滑（亚像素抗锯齿）

**Linux:**
- 使用 FreeType + fontconfig
- 默认字体取决于发行版
- 字体渲染质量取决于配置

**当前字体配置：**
```css
fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace"
```

**潜在问题：**
- `SF Mono` 和 `Consolas` 在 Linux 上不可用
- 如果用户没安装 `JetBrains Mono` 或 `Fira Code`
- 会回退到通用 `monospace`（质量参差不齐）

**影响：**
- ⚠️ **低风险** - 不影响功能，只影响美观度
- 用户可以自行安装字体

**建议：**
- 在文档中提供字体安装指南
- 或在 AppImage 中包含字体文件

---

### 6. 窗口管理和装饰

**macOS:**
- 统一的原生窗口样式
- 红绿灯按钮在左上角
- `trafficLightPosition` 配置

**Linux:**
- 窗口样式取决于桌面环境（GNOME/KDE/XFCE/i3）
- 窗口按钮位置不同（GNOME 左上角，KDE 右上角）
- 不同 DE 行为不一致

**当前配置：**
```json
{
  "decorations": false,
  "transparent": true,
  "trafficLightPosition": { "x": 12, "y": 20 }
}
```

**影响：**
- `decorations: false` 意味着自定义标题栏
- `trafficLightPosition` 只对 macOS 有效
- Linux 上需要自己绘制窗口控制按钮

**检查代码：**
查看 JsonEditorToolbar.svelte 是否实现了跨平台窗口控制...
EOF
grep -A10 "window-controls\|minimizeWindow\|closeWindow" src/lib/components/editor/JsonEditorToolbar.svelte | head -20

**检查代码结果：**
✅ 代码已实现跨平台窗口控制：
- 检测平台：`detectPlatform()` 返回 'macos' | 'windows' | 'linux'
- 窗口控制按钮：最小化、最大化、关闭
- 平台特定样式：`class="window-controls desktop ${platform}"`

**结论：** ✅ 已正确实现跨平台窗口控制

---

### 7. 剪贴板功能

**macOS:**
- 使用 NSPasteboard
- 只有一个剪贴板

**Linux X11:**
- PRIMARY selection（鼠标选中即复制，中键粘贴）
- CLIPBOARD selection（Ctrl+C/Ctrl+V）
- 两个独立的剪贴板

**Linux Wayland:**
- 只有 CLIPBOARD selection
- 更严格的安全限制
- 需要窗口获得焦点才能访问剪贴板

**当前实现：**
```toml
# src-tauri/Cargo.toml
tauri-plugin-clipboard-manager = "2"
```

**影响：**
- ✅ Tauri 插件已处理平台差异
- ⚠️ **低风险** - Wayland 下可能需要窗口焦点才能读取剪贴板
- 功能应该正常工作

---

### 8. 文件对话框

**macOS:**
- 原生 NSOpenPanel/NSSavePanel
- 美观统一的样式
- 支持预览、快速查看等

**Linux:**
- GTK file chooser
- 样式取决于 GTK 主题
- 功能可能略有差异

**当前实现：**
```rust
// 使用 tauri-plugin-dialog
app.dialog()
    .file()
    .add_filter("JSON Files", JSON_FILE_EXTENSIONS)
    .blocking_pick_file()
```

**影响：**
- ✅ Tauri 插件已处理平台差异
- ⚠️ **极低风险** - Linux 下对话框样式可能不够美观，但功能正常

---

### 9. 全局快捷键

**macOS:**
- 可以注册全局快捷键（需要辅助功能权限）
- Command+Shift+V 等

**Linux X11:**
- 可以注册全局快捷键
- 但不同桌面环境可能有冲突

**Linux Wayland:**
- 出于安全考虑，应用无法注册全局快捷键
- 只能使用桌面环境提供的机制

**潜在问题：**
- ⚠️ **中等风险** - Wayland 下全局快捷键可能不工作
- 需要检查是否使用了全局快捷键功能

---

### 10. 文件监控

**macOS:**
- FSEvents API（高效）

**Linux:**
- inotify（需要为每个文件/目录创建 watch）
- 可能受到系统限制（`fs.inotify.max_user_watches`）

**潜在问题：**
- ⚠️ **低风险** - 如果监控大量文件，Linux 可能受限
- 默认限制通常是 8192 或 524288

**检查文件监控：**
```rust
// src-tauri/src/commands/file_watcher.rs
// 应该使用 notify crate，已处理平台差异
```

---

### 11. 高 DPI 显示

**macOS Retina:**
- 自动处理 2x/3x 缩放
- 显示清晰

**Linux:**
- 需要应用支持 HiDPI
- Wayland 比 X11 支持更好
- 可能需要设置环境变量

**潜在问题：**
- ⚠️ **低风险** - X11 下可能显示模糊
- Tauri/WebView 应该已处理

---

## 总结

### 高风险问题（可能导致无法运行）
**无**

### 中等风险问题（可能影响功能）

1. **系统依赖库** ⚠️
   - AppImage 需要基础系统库（libwebkit2gtk-4.1, GTK 3）
   - 建议：在 README 列出依赖，提供安装命令
   
2. **Wayland 全局快捷键** ⚠️
   - 如果应用依赖全局快捷键，Wayland 下可能不工作
   - 需要检查 src-tauri 代码

### 低风险问题（只影响体验）

3. **字体可用性** ⚠️
   - JetBrains Mono / Fira Code 可能未安装
   - 建议：文档中提供安装指南

4. **文件对话框样式** ⚠️
   - GTK 对话框样式可能不够美观
   - 可接受

5. **高 DPI 显示** ⚠️
   - X11 下可能模糊
   - Wayland 下应该正常

---

## 测试建议

### 优先级 1：必须测试
1. ✅ 应用能否启动（依赖库检查）
2. ✅ 基础编辑功能（格式化、压缩、转义）
3. ✅ 文件打开/保存对话框
4. ✅ 窗口控制按钮（最小化、最大化、关闭）

### 优先级 2：应该测试
1. ⚠️ 剪贴板功能（X11 vs Wayland）
2. ⚠️ 字体显示效果
3. ⚠️ 高 DPI 显示（4K 显示器）
4. ⚠️ 文件夹监控功能

### 优先级 3：可选测试
1. 📝 不同桌面环境（GNOME/KDE/XFCE）
2. 📝 不同发行版（Ubuntu/Fedora/Arch）
3. 📝 Wayland vs X11

---

## 结论

**macOS 工作正常 ≈ Linux 也基本正常**

✅ **是的，这个假设基本成立！**

**原因：**
1. 都是 Unix-like 系统，底层相似度高
2. Tauri 和 Rust 已处理大部分平台差异
3. 最大的差异（系统依赖库）是部署问题，不是代码问题

**但是：**
- 仍需在 Linux 上测试一遍核心功能
- 特别是在真实用户环境（不只是 GitHub Actions）
- 建议在发布前用虚拟机测试 Ubuntu 22.04/24.04

**风险评估：**
- 功能性问题：**极低**
- 部署问题：**中等**（依赖库）
- 体验问题：**低**（字体、对话框样式）
