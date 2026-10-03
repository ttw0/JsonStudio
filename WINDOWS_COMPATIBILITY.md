# Windows 兼容性分析报告

## 执行时间
2024-10-03

## 问题背景
Issue #76 报告了 Windows 11 上压缩功能失效的问题，通过深入调查发现根本原因是 Windows CRLF 行尾符与 macOS/Linux LF 行尾符不一致导致的字符串比较失败。

---

## ✅ 已修复的问题

### 1. 行尾符不一致（已全面修复）
**问题描述：**
- Windows 使用 CRLF (`\r\n`)，macOS/Linux 使用 LF (`\n`)
- 所有字符串严格比较都会因行尾差异而失败
- 导致压缩、转义、格式化等功能失效

**影响范围：**
- JsonEditorToolbar.svelte - 压缩/转义/排序等操作验证
- JsonEditor.svelte - 粘贴自动格式化状态验证
- MonacoEditor.svelte - 编辑器内容同步检查（2 处）
- MonacoDiffEditor.svelte - Diff 模式值同步和粘贴（3 处）
- CodeGenView.svelte - 代码生成输入同步

**解决方案：**
- 创建统一的 `src/lib/services/lineEndings.ts` 工具模块
- 所有内容比较前使用 `normalizeLineEndings()` 规范化为 LF
- Prettier 格式化强制使用 `endOfLine: 'lf'`

**相关提交：**
- `807923e` - 初始修复 JsonEditorToolbar
- `6545479` - 全面修复所有编辑器组件

---

## ✅ 已正确处理的问题

### 2. 文件路径分隔符
**差异：**
- Windows: `\` (反斜杠)
- Unix/macOS: `/` (正斜杠)

**处理状态：** ✅ 正确
- Rust 代码统一使用 `PathBuf` 和 `Path::join()`，自动处理平台差异
- JavaScript 代码在需要时使用 `split(/[\/\\]/)` 兼容两种分隔符 (FolderSidebar.svelte:12)

### 3. 文件扩展名大小写
**差异：**
- Windows: 不区分大小写 (.JSON == .json)
- Unix/macOS: 区分大小写 (.JSON != .json)

**处理状态：** ✅ 正确
- 使用 `eq_ignore_ascii_case()` 进行扩展名比较 (file.rs:171)

### 4. 文本编码和 BOM
**差异：**
- Windows: 可能使用 GBK 编码，UTF-8 文件常带 BOM (`EF BB BF`)
- Unix/macOS: 默认 UTF-8 无 BOM

**处理状态：** ✅ 正确
- `file_encoding.rs` 正确处理：
  - UTF-8 with BOM: 自动移除 BOM (line 25-27)
  - UTF-16 LE/BE: 检测并解码 (line 2-21)
  - 纯 UTF-8: 直接使用
- 有完整的单元测试覆盖

### 5. 文件名合法性验证
**差异：**
- Windows: 禁止 `< > : " / \ | ? *` 和保留名称 (CON, PRN 等)
- Unix/macOS: 只禁止 `/` 和 null

**处理状态：** ✅ 正确
- `rename_file()` 验证文件名不包含路径字符 (file.rs:72-77)
- 前端限制在合理范围内

### 6. GitHub Actions 构建
**差异：**
- PowerShell 和 cmd 对 JSON 字符串转义处理不同
- bash 使用单引号原样传递字符串

**处理状态：** ✅ 已修复
- 强制使用 `shell: bash` 避免 PowerShell 转义问题
- JSON config 使用单引号包裹

---

## ⚠️ 需要监控的潜在问题

### 7. 剪贴板行尾符转换
**问题：**
- Windows 剪贴板可能自动将 LF 转换为 CRLF
- 用户从外部复制 JSON 粘贴到编辑器时可能带有 CRLF

**当前状态：** ⚠️ 部分处理
- Monaco Editor 粘贴事件触发自动格式化
- 格式化过程使用 Prettier `endOfLine: 'lf'` 统一行尾
- **建议：** 在 Windows 云电脑上测试从记事本/Word/浏览器复制粘贴的行为

### 8. 文件路径长度限制
**差异：**
- Windows: 传统 MAX_PATH = 260 字符（可通过组策略解除）
- Unix/macOS: PATH_MAX = 4096 字符

**当前状态：** ⚠️ 未处理
- 深层嵌套的文件夹结构可能触发 260 字符限制
- **建议：** 添加路径长度检查，超过 200 字符时给出警告

### 9. 文件独占锁定
**差异：**
- Windows: 打开文件时默认独占锁定，其他进程无法写入
- Unix/macOS: 允许多进程同时读写（除非显式锁定）

**当前状态：** ⚠️ 未特殊处理
- 如果文件被其他程序占用（如 Excel 打开 .json），保存可能失败
- **当前行为：** 显示错误信息 "Failed to save file"
- **建议：** 可接受，用户理解 Windows 文件锁定行为

### 10. 时区和文件时间戳
**差异：**
- Windows: 文件时间可能使用本地时区
- Unix/macOS: 通常使用 UTC

**当前状态：** ⚠️ 低风险
- 应用不依赖文件修改时间做业务逻辑
- 文件监控器 (file_watcher.rs) 使用系统原生 API
- **建议：** 无需特殊处理

---

## ✅ 不适用的问题

### 11. 环境变量
- 应用不读取或依赖环境变量

### 12. 外部命令执行
- 应用不执行外部 shell 命令

### 13. 文件权限
- 应用只读写文件，不修改权限位

### 14. 符号链接
- 应用不创建或解析符号链接

---

## 测试建议

### 优先级 1: 必须测试（核心功能）
1. ✅ 压缩功能（Issue #76 的原始问题）
2. ✅ 格式化功能
3. ✅ 转义/反转义功能
4. ✅ 排序键功能
5. ✅ 粘贴自动格式化

### 优先级 2: 应该测试（常用功能）
1. ⚠️ 从外部应用复制粘贴 JSON（记事本、Word、浏览器）
2. ⚠️ 打开带 BOM 的 UTF-8 文件
3. ⚠️ 打开 GBK/GB2312 编码的中文 JSON 文件
4. ⚠️ Diff 模式下的粘贴和格式化
5. ⚠️ 代码生成功能（JSON ↔ TypeScript/Go/etc）

### 优先级 3: 边缘情况
1. 📝 260+ 字符的超长文件路径
2. 📝 文件被其他程序占用时的保存行为
3. 📝 包含 Windows 保留名称的文件（CON.json, PRN.json）

---

## 总结

### 已修复
- ✅ **行尾符问题**（最关键）- 已全面修复
- ✅ **文本编码和 BOM** - 已正确处理
- ✅ **路径分隔符** - 使用 PathBuf 自动处理
- ✅ **GitHub Actions 构建** - 强制使用 bash

### 需要验证
- ⚠️ **剪贴板粘贴** - 理论上已处理，需要实际测试
- ⚠️ **长路径** - 边缘情况，暂时可接受
- ⚠️ **文件锁定** - Windows 固有行为，当前错误提示可接受

### 建议下一步
1. 在 Windows 云电脑上安装最新构建版本
2. 系统性测试优先级 1 和 2 的所有场景
3. 如果测试通过，发布修复版本并关闭 Issue #76
