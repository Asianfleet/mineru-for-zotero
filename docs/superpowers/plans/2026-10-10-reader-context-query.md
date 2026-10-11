# 阅读上下文查询实施计划

> 执行方式：使用 executing-plans 技能，在当前会话逐项实施并验证；用户已要求直接完成，无需另行选择执行方式。

**目标：** CLI 与 MCP 支持所有/激活 tab 的条目及解析状态、所有/激活 Reader 的已选 box Markdown。

**架构：** 新建 readerQuery 服务，通过运行时适配器获取同步快照，注入 storage 完成内容查询。HTTP 与 MCP 共用服务，CLI 保持 HTTP 薄包装。

**技术栈：** TypeScript、Zotero 8/9、现有 storage 与 copyFormatter、Node ESM CLI、Mocha/Chai。

## 全局约束

- scope 默认为 active，允许 all 和 active；不限制可视区域。
- tab 状态针对实际打开附件；Ready 和 Running 可同时为 true。
- 无选择不回退全文，不写剪贴板，不创建 overlay state。
- 接口共用现有 API 开关和 token；MCP 不经 HTTP 回环。
- 不修改原有查询参数和缓存目录，不引入依赖，不自动提交。

## 任务 1：查询服务与运行时快照

文件：新增 `src/modules/readerQuery/types.ts`、`queryService.ts`、`runtime.ts`、`test/readerQuery.test.ts`、`test/readerQueryRuntime.test.ts`；修改 `src/modules/readerOverlay/state.ts`、`src/modules/itemTreeColumn.ts`、`src/modules/storage.ts` 和 `test/storage.test.ts`。

接口：`createReaderQueryService(deps)` 返回 `listTabs(scope?)` 与 `selectedBoxes(scope?)`。运行时提供同步 `snapshot(scope)`，复制 tab 标识、条目标识、PDF 属性、运行状态与选择索引；service 注入 storage 的 readParseStatus 和 readBoxes。

- [x] 添加回归测试：未加载 tab 与父文献标识、运行/就绪并存、空选择、rawIndex 排序、单组失败、失效索引和选择快照。
- [x] 确认新增测试因缺少查询行为失败，然后实现服务和只读状态接口。
- [x] 运行时使用 `Zotero.getMainWindows()`、`getMainWindow()`、tab `_tabs` 和 `Zotero.Reader._readers`；通过 tab 元数据匹配存活 Reader，独立窗口 reader 无 tabId。
- [x] 验证多主窗口、图书馆激活、独立 Reader、非 PDF 和关闭 Reader 不被残留 state 纳入。

实施记录：service 与 runtime 的 14 项隔离测试通过；snapshot 在异步读取前复制索引，空选择不读存储。官方源码确认 getState 不含 tab ID，使用 \_tabs 并加入回归。storage 新增可选 strict 状态读取，仅新查询开启，损坏 manifest 回归先失败后通过。

核心调用约定：

```typescript
const service = createReaderQueryService({ snapshot, storage });
const tabs = await service.listTabs("all");
const selection = await service.selectedBoxes("active");
```

## 任务 2：HTTP 与 MCP

文件：新增 `src/modules/readerQuery/apiEndpoint.ts`、`test/readerQueryEndpoint.test.ts`、`test/readerQueryIntegration.test.ts`；修改 `src/hooks.ts`、`src/modules/mcp/services.ts`、`tools.ts`、`src/modules/markdownQuery/apiEndpoint.ts` 和 `test/mcpTools.test.ts`。

- [x] 添加 API 关闭、token、scope 非法、正常空结果与 MCP partial error 测试。
- [x] 实现 GET `/mineru-for-zotero/tabs` 和 `/mineru-for-zotero/boxes/selected`；参数错误 400、鉴权失败 403、逐项状态 200、内部错误 500 且不泄漏详情。
- [x] 增加 MCP `zotero_list_tabs` 与 `mineru_get_selected_boxes`，默认 active，无条目标识参数，保留结构化状态与文本。
- [x] startup 注册 HTTP 后注册 MCP，shutdown 先注销 MCP，再注销上下文 endpoint。

实施记录：复用 authorizeMarkdownQueryApi；HTTP 与 MCP 的 12 项隔离测试通过，真实鉴权、只读 getter 与 startup 测试在完整 scaffold 中通过。

工具调用验证：

```typescript
await callMcpTool("zotero_list_tabs", { scope: "all" }, context);
await callMcpTool("mineru_get_selected_boxes", {}, context);
```

## 任务 3：CLI

文件：修改 `mineru-for-zotero-cli/scripts/query-source.mjs`、`test/querySourceCli.test.mjs`。

- [x] 先添加 CLI 测试并执行，确认 tabs/boxes 子命令未实现而失败。
- [x] 添加 `tabs list` 和 `boxes selected`；scope 默认 active，允许 all，不要求 library-id/key，拒绝无关参数。
- [x] text 按来源分组，JSON 沿用 envelope；失效选择或结果不可用返回保留成功内容的退出码 1，正常空选择退出 0，参数错误退出 2。
- [x] 更新 help，说明运行时范围、所有已选 box 及解析状态。

实施记录：新增 CLI 回归测试先失败后通过，31 项独立 Node 测试通过。

验证命令：

```powershell
node --test test/querySourceCli.test.mjs scripts/*.test.mjs
```

预期：新旧 CLI 与 Connector 测试全部通过。

## 任务 4：文档与最终验证

文件：修改 `README.md`、`README_zh.md`、`mineru-for-zotero-cli/SKILL.md`、`mineru-for-zotero-mcp/SKILL.md` 和本计划。

- [x] 同步四种调用示例、字段含义、默认 scope、空结果、partial error、非 PDF 状态和当前主窗口语义。
- [x] 检查官方源码中的 getMainWindow、tab 与 Reader 生命周期契约，并以 scaffold 运行时测试验证可访问性。
- [x] 构建并检查类型，执行完整 scaffold 和独立 Node 测试。
- [x] 格式化全部变更文件，执行最终 lint，检查 diff 只含相关改动。
- [x] 勾选完成项并记录实际验证结果，报告无法自动覆盖的手动 Zotero 8/9 场景。

实施记录：构建和类型检查通过；完整 scaffold 418 项通过；独立 Node 31 项通过；最终 lint 与 diff 检查通过。首次启动测试未配置 Zotero 路径，通过安装记录定位 `D:/Apps/zotero/zotero.exe`，以命令环境变量指定，仅启动隔离测试 profile。两次测试发现并修正新增 fixture 和真实存储状态问题，最终套件全部通过。

尚未手动验证两个 Zotero 版本各自的真实多窗口 PDF 阅读与 Shift/Ctrl 选择交互；该范围通过运行时边界测试覆盖，不等同于分别完成 Zotero 8/9 手动验证。selected box 查询复用 storage.readBoxes 的既有 normalized 缓存刷新行为，可能更新旧 normalized 文件；它不更改 UI、剪贴板或选择。

```powershell
npm run build
node scripts/fix-test-profile.mjs
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
node --test test/querySourceCli.test.mjs scripts/*.test.mjs
npm run lint:check
git diff --check
```

构建和测试会生成 `.scaffold/` 忽略目录中的文件；最终检查 tracked diff，避免带入生成输出。
