# MinerU MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Zotero 现有本地 HTTP server 上增加无状态 Streamable HTTP MCP endpoint，让不能执行 CLI 的 MCP 客户端可以发现并调用 MinerU 查询工具。

**Architecture:** 新增 `src/modules/mcp/` 作为协议适配层。它在插件启动时创建一次 Markdown/LaTeX 查询上下文，直接调用现有 query service 和 storage，不回环请求旧 HTTP endpoint；`protocol.ts` 处理 JSON-RPC，`tools.ts` 负责输入校验和分发，`resultMapper.ts` 负责文本、结构化数据和图片 block 映射。endpoint 复用现有本地 API 的启用开关与 Bearer token，并在关闭时注销。

**Tech Stack:** TypeScript ES modules、Zotero `Server.Endpoints`、现有 Markdown/LaTeX query service、Mocha/Chai scaffold tests、Prettier/ESLint。

## Global Constraints

- 不修改现有 Markdown/LaTeX HTTP endpoint、CLI 参数、存储布局和 Zotero UI 行为。
- 不新增 Node 进程、TCP 监听端口或独立 MCP token。
- MCP endpoint 固定为 `/mineru-for-zotero/mcp`，只接受 POST JSON 请求，第一版无状态处理。
- API 未启用或 token 不匹配时，不允许通过 MCP 枚举工具或调用工具。
- 新增的 class/function 必须有中文 docstring；所有文件使用 UTF-8 和现有两空格格式。
- 图片只能由现有 storage/service 验证路径后读取，不接受任意本地文件路径。

---

### Task 1: 建立查询上下文与 MCP endpoint 生命周期

**Files:**

- Create: `src/modules/mcp/services.ts`
- Create: `src/modules/mcp/apiEndpoint.ts`
- Modify: `src/hooks.ts`
- Modify: `src/addon.ts`
- Test: `test/mcpApiEndpoint.test.ts`
- Test: `test/startup.test.ts`

**Interfaces:**

- `createMcpQueryContext()` 返回 `{ markdown, latex, markdownStorage, texStorage }`，其中 `markdown` 是 `MarkdownQueryService`，`latex` 是 `createLatexQueryService` 返回的 service。
- `registerMcpApiEndpoint()` 在 `Zotero.Server.Endpoints["/mineru-for-zotero/mcp"]` 写入 endpoint class，并保存上下文；`unregisterMcpApiEndpoint()` 删除路由并释放上下文。

- [x] **Step 1: Write the failing test**

  在 `mcpApiEndpoint.test.ts` 中断言 endpoint 注册路径、`supportedMethods` 为 `POST`，注销后路由删除；用依赖注入测试 `createMcpQueryContext` 能把现有 storage、Zotero item gateway 和 query service 组合起来。

- [x] **Step 2: Run test to verify it fails**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "mcp endpoint"`

  Expected: FAIL because `src/modules/mcp/apiEndpoint.ts` and its registration functions do not exist.

- [x] **Step 3: Write minimal implementation**

  `services.ts` 使用 `getMinerUStorageRoot()`、`createStorage()`、`createTexSourceStorage()`、`createMarkdownQueryService()` 和 `createLatexQueryService()`；标题检索调用 `Zotero.Search`，LaTeX 图片/下载复用 `fetchLatex` 和 storage。`apiEndpoint.ts` 创建 endpoint class，注册单一路径，并将上下文清空。`hooks.ts` 在两个旧 endpoint 注册后注册 MCP，shutdown 时先注销 MCP；`addon.ts` 增加可选 `mcp` 状态字段。

- [x] **Step 4: Run test to verify it passes**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "mcp endpoint"`

  Expected: PASS with the route present after startup and absent after shutdown.

- [x] **Step 5: Record completion**

  Record the task as complete in the shared working tree; use the final feature commit after all tasks pass.

### Task 2: 实现 JSON-RPC/MCP 协议适配器

**Files:**

- Create: `src/modules/mcp/protocol.ts`
- Create: `src/modules/mcp/errorMapper.ts`
- Modify: `src/modules/mcp/apiEndpoint.ts`
- Test: `test/mcpProtocol.test.ts`

**Interfaces:**

- `createMcpProtocol(deps)` 返回 `{ handle(options): Promise<HttpResponse> }`。
- `HttpResponse` 为现有 Zotero endpoint 三元组 `[status, contentType, body]`。
- `handle` 支持 `initialize`、`ping`、`tools/list`、`tools/call` 和无响应 notification；未知 method、非法 JSON、缺失 id/method 或非 POST 产生稳定 JSON-RPC 错误。

- [x] **Step 1: Write the failing test**

  覆盖 initialize 协议版本/能力、ping、initialized notification、非法 JSON、未知 method、非 POST 405，以及 `tools/list` 在认证前不可枚举。

- [x] **Step 2: Run test to verify it fails**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP protocol"`

  Expected: FAIL because the protocol handler is not defined.

- [x] **Step 3: Write minimal implementation**

  从 `options.data` 接受已解析对象或 JSON 字符串，限制请求体最大 1 MiB；返回 JSON-RPC 2.0。请求先调用 `authorizeMcp(headers)`，再进入 method dispatcher；notification 返回 204 空体。错误统一为 `{ jsonrpc: "2.0", id, error: { code, message, data? } }`，不把 token、路径或堆栈写入响应。

- [x] **Step 4: Run test to verify it passes**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP protocol"`

  Expected: PASS for all protocol and authorization-gate cases.

- [x] **Step 5: Record completion**

  Record the task as complete in the shared working tree; use the final feature commit after all tasks pass.

### Task 3: 添加工具 schema、分发和普通结果映射

**Files:**

- Create: `src/modules/mcp/tools.ts`
- Create: `src/modules/mcp/resultMapper.ts`
- Modify: `src/modules/mcp/protocol.ts`
- Test: `test/mcpTools.test.ts`

**Interfaces:**

- `listMcpTools()` 返回 8 个工具的 MCP metadata 和 JSON Schema。
- `callMcpTool(name, arguments, context)` 分发 `zotero_search_items`、`mineru_read_markdown`、`mineru_query_markdown_table`、`mineru_fetch_latex`、`mineru_read_latex`、`mineru_query_latex_table`。
- `mapQueryResult(value)` 返回 `{ content: [{ type: "text", text }], structuredContent: value }`。

- [x] **Step 1: Write the failing test**

  测试工具列表的必填字段和稳定名称；测试 Markdown full/headings/section/search、Markdown table、LaTeX fetch/read/table 的 camelCase 参数转换、结构化结果保留候选项和来源字段；未知工具和缺少必填参数返回 invalid params/unknown tool。

- [x] **Step 2: Run test to verify it fails**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP tools"`

  Expected: FAIL because tool metadata and dispatcher do not exist.

- [x] **Step 3: Write minimal implementation**

  手写轻量 JSON Schema 校验，所有 `libraryId`、`itemKey` 和工具特定必填值在进入 service 前验证；`sectionPath` 只接受字符串数组并转换为 Markdown service 的数组，LaTeX 使用 `/` 拼接。普通成功结果同时放入 `content` 文本 block 与 `structuredContent`，文本使用 JSON pretty-print 以避免字段丢失。

- [x] **Step 4: Run test to verify it passes**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP tools"`

  Expected: PASS for all six ordinary query/fetch tools and validation cases.

- [x] **Step 5: Record completion**

  Record the task as complete in the shared working tree; use the final feature commit after all tasks pass.

### Task 4: 添加图片工具与 MCP image content block

**Files:**

- Modify: `src/modules/mcp/tools.ts`
- Modify: `src/modules/mcp/resultMapper.ts`
- Modify: `src/modules/mcp/services.ts`
- Test: `test/mcpTools.test.ts`

**Interfaces:**

- `mineru_get_markdown_image` 和 `mineru_get_latex_image` 接受 `paths: string[]`。
- `mapImageResult(images)` 返回 `structuredContent.images`、逐项状态 text block，以及每个成功图片的 `{ type: "image", data, mimeType }` block。

- [x] **Step 1: Write the failing test**

  覆盖单图、多图、重复路径、部分失败、MIME 映射和 base64 dataURL 解码；断言失败项保留状态且成功图片仍返回。

- [x] **Step 2: Run test to verify it fails**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP image"`

  Expected: FAIL because image tools and content block mapper are absent.

- [x] **Step 3: Write minimal implementation**

  将 `paths` 校验为非空字符串数组，按请求顺序调用现有 Markdown `readImages` 和 LaTeX storage reader；重复路径产生 `duplicate-path`，每个成功项从 bytes/dataURL 转为 base64 image block；不把 bytes 放进 JSON structured content。

- [x] **Step 4: Run test to verify it passes**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP image"`

  Expected: PASS with all image statuses and blocks preserved.

- [x] **Step 5: Record completion**

  Record the task as complete in the shared working tree; use the final feature commit after all tasks pass.

### Task 5: 接入生命周期、错误回归测试和 README 文档

**Files:**

- Modify: `src/modules/mcp/apiEndpoint.ts`
- Modify: `src/hooks.ts`
- Modify: `test/mcpProtocol.test.ts`
- Modify: `test/startup.test.ts`
- Modify: `README_zh.md`
- Modify: `README.md`

**Interfaces:**

- 启动后 `/mineru-for-zotero/mcp` 可通过 Zotero endpoint 调用；重复启动不会覆盖成多个旧上下文；shutdown 后请求不可用。
- README 中说明地址、端口、启用开关、Bearer token、无状态连接和工具清单，并给出 MCP 客户端 JSON 配置示例。

- [x] **Step 1: Write the failing test**

  增加 API disabled、缺失 token、错误 token、领域错误候选项和未预期异常不泄露堆栈的回归断言；startup 测试确认路由注销。

- [x] **Step 2: Run test to verify it fails**

  Run: `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "MCP (auth|startup|error)"`

  Expected: FAIL until final authentication/error/lifecycle wiring is complete.

- [x] **Step 3: Write minimal implementation**

  完成 endpoint class 的 protocol wiring，确保 API disabled/token 错误在 tools/list 前返回；更新中英文 README 的 MCP 小节，保持现有 HTTP API 与 CLI 文档原样可用。

- [x] **Step 4: Run focused and full verification**

  Run: `node --test scripts/*.test.mjs`; `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`; `npm run lint:check`; `npm run build`; `git diff --check`

  Expected: all commands exit 0; no unrelated files are changed. In this environment the scaffold test command builds successfully but cannot launch because no Zotero binary is installed; the MCP tests were run separately as bundled Mocha tests.

- [x] **Step 5: Record completion**

  Record the final verification result and leave the working tree ready for the feature commit.

## Self-review checklist

- [x] 覆盖设计文档中的 endpoint、协议、八个工具、图片 block、认证、错误和生命周期要求。
- [x] 检查计划中没有 TBD、TODO 或“适当处理”类占位语句。
- [x] 后续任务使用的接口名称与前序任务定义一致。
