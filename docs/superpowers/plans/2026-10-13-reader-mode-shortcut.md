# 阅读器模式循环快捷键实施计划

**目标：** 可配置快捷键切换模式，并自动展开菜单显示实际状态。

**架构：** 使用独立快捷键模块处理按键和生命周期，工具栏绑定负责模式命令和菜单刷新，偏好页负责录入。复用现有 overlay 和同源窗口枚举。

**技术：** TypeScript、DOM KeyboardEvent、Zotero Prefs、Mocha/Chai。

- [x] 添加回归测试，先验证默认快捷键缺失时失败。首次实际 Zotero 测试为 237 通过、1 预期失败。
- [x] 实现 `src/modules/readerToolbar/shortcut.ts` 的模式循环、按键序列化、输入保护和监听清理；接入 `binding.ts`。每个 reader 独立绑定，并随同步刷新 iframe 窗口集合。
- [x] 在 `addon/prefs.js`、`src/utils/prefs.ts` 添加偏好；在 `preferences.xhtml`、`preferenceScript.ts` 和双语 Fluent 中添加录入与清除。默认 `Alt+Shift+B`，修改立即生效。
- [x] 测试快捷键匹配、动态配置、多窗口监听、销毁清理、菜单打开和异步刷新。补齐 scaffold 测试作用域的插件全局对象后，完整测试 427 项通过。
- [x] 格式化本次文件，运行生产构建、完整 scaffold 测试、`npm run lint:check`，检查最终差异。生产构建及类型检查通过；首次完整 lint 通过，收尾改动后再运行最终验证。

验证命令：`npm run build`、`.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`、`npm run lint:check`。构建会更新生成类型和 `.scaffold` 输出，最终检查只保留任务相关的生成类型差异。

本机测试需要显式设置 `ZOTERO_PLUGIN_ZOTERO_BIN_PATH=D:\Apps\zotero\zotero.exe`。该路径只用于本次命令，没有写入项目配置。未提交或修改正式 Zotero 配置。
