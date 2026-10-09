# MinerU for Zotero MCP 集成设计

## 背景与目标

当前插件已经通过 Zotero 本地 HTTP server 暴露 Markdown 与 LaTeX 查询 API，并提供 `mineru-for-zotero-cli` 作为命令行客户端。部分 MCP 客户端环境不能执行 Node CLI，但可以连接一个 HTTP MCP server，因此需要在插件内增加 MCP 协议入口。

本设计采用插件内 MCP 适配层。适配层注册一个新的 `/mineru-for-zotero/mcp` endpoint，直接调用现有 Markdown 与 LaTeX 查询 service，不通过 HTTP 回环请求插件自身的旧 endpoint。现有 HTTP endpoint、CLI 参数、存储布局和 Zotero UI 行为保持不变。

目标包括：

- 让支持 URL 配置的 MCP 客户端直接连接 Zotero；
- 复用现有的附件解析、Markdown、LaTeX、表格和图片查询逻辑；
- 让 MCP 返回结构化结果、可读文本和图片内容；
- 继续使用现有本地 API 的启用开关和 token；
- 在 Zotero 插件生命周期内可靠注册和注销 MCP endpoint。

本次不实现独立 Node MCP 进程、不新增 TCP 监听端口、不改变现有 HTTP endpoint，也不把插件数据目录直接暴露给 MCP 客户端。

## 方案决策

MCP endpoint 与现有查询 endpoint 共用 Zotero 的本地 HTTP server，外部地址为：

```text
http://127.0.0.1:<zotero-port>/mineru-for-zotero/mcp
```

Zotero 默认端口仍由 Zotero 配置决定，通常为 `23119`。插件不额外申请 MCP 端口，也不新增端口冲突处理。

MCP 工具层直接创建并持有查询 service：

```text
MCP request
  -> MCP protocol adapter
  -> tool dispatcher
  -> MarkdownQueryService / LatexQueryService
  -> storage, Zotero.Items, arXiv fetch
```

现有 HTTP endpoint 继续使用自己的参数解析和响应映射。查询 service 是两类入口的共同领域边界，因此 MCP 不复制解析、附件选择、缓存读取或 LaTeX 扫描逻辑。

如果官方 MCP TypeScript SDK 的 server 核心可以在 Zotero 插件构建和运行时加载，则复用其工具注册、schema 校验和 JSON-RPC 处理能力，只编写适配 Zotero endpoint 的 transport。SDK 的 Node 专用 transport 不使用。如果 SDK 核心无法在 Zotero 运行时加载，则使用同一套工具契约实现受限的无状态 MCP 协议适配器，并通过协议测试锁定行为；该回退不改变工具和 endpoint 设计。

## 模块边界

新增 `src/modules/mcp/`，保持每个模块只有一个主要职责：

- `apiEndpoint.ts`：创建 MCP 查询上下文，注册和注销 `/mineru-for-zotero/mcp`；
- `protocol.ts`：把 Zotero endpoint 的 POST 请求转换成 MCP 请求，并生成 JSON-RPC 响应；
- `tools.ts`：定义 `tools/list` 元数据、输入 schema 和 `tools/call` 分发；
- `services.ts`：创建 Markdown 与 LaTeX 查询 service 及其依赖；
- `resultMapper.ts`：将领域结果转换为 `content`、`structuredContent` 和图片 content block；
- `errorMapper.ts`：将领域错误转换为 MCP 可恢复错误、JSON-RPC 参数错误或认证错误。

`hooks.ts` 只负责生命周期调度：启动时在现有 Markdown/LaTeX endpoint 注册之后注册 MCP endpoint，关闭时先注销 MCP endpoint，再执行插件其余清理流程。MCP 不依赖主窗口，因此不在 `onMainWindowLoad` 中注册。

查询上下文应在 MCP endpoint 注册时创建一次，并在注销时丢弃。它包含：

- `MarkdownQueryService`；
- `LatexQueryService`；
- LaTeX 图片读取和缓存下载所需的 storage；
- 标题搜索所需的 Zotero items gateway。

现有 endpoint 可以继续各自创建 service；如果实现过程中发现依赖组装重复，应抽取一个只负责依赖注入的工厂，不改变任何现有 service 方法和 HTTP 响应。

## MCP 传输与协议

第一版使用无状态 Streamable HTTP：

- MCP 请求使用 `POST /mineru-for-zotero/mcp`；
- 请求体为 `application/json` 的 JSON-RPC/MCP 消息；
- 每个请求独立处理，不创建 MCP session；
- 支持 `initialize`、`ping`、`tools/list`、`tools/call`；
- 支持 `notifications/initialized` 等无需响应的通知；
- 对不支持的 HTTP 方法返回 `405`；
- 对无效 JSON、未知 JSON-RPC 方法和无效工具参数返回标准错误；
- 第一版不提供 SSE 推送、长轮询或 DELETE session。

工具调用是一次请求一次响应。现有 MinerU 查询是本地文件读取或短时网络读取，不需要通过 MCP progress notification 暴露内部轮询过程。LaTeX 下载仍然是工具调用期间完成的同步异步任务，成功后返回 manifest。

endpoint 应声明只接受 JSON POST，并拒绝过大的请求体。MCP 响应不得依赖 Zotero 主窗口或 DOM 状态。

## 工具契约

工具名保持领域清晰，不用一个 `source` 参数混合 Markdown 与 LaTeX 的不同规则。

### `zotero_search_items`

按标题搜索条目并返回条目摘要、PDF 附件和解析状态。

输入：`libraryId`、`title`。

### `mineru_read_markdown`

读取优先 Markdown，支持 `full`、`headings`、`section`、`search` 四种粒度。

输入：`libraryId`、`itemKey`、可选 `attachmentKey`、`granularity`、`sectionNumber`、`sectionPath`、`query`、`contextParagraphs`。MCP 层使用结构化数组表示多段 section path，再转换为查询 service 使用的路径类型。

### `mineru_query_markdown_table`

按 caption 或表格内容查询 Markdown 表格。

输入：`libraryId`、`itemKey`、可选 `attachmentKey`、`query`、`match`、`tableFormat`。

### `mineru_get_markdown_image`

读取 Markdown 中引用的图片。MCP 输入使用 `paths: string[]`，由适配层转换为现有 service 的路径参数；这样避免让 MCP 调用方处理逗号分隔字符串。

### `mineru_fetch_latex`

读取或下载 arXiv LaTeX 源码缓存。

输入：`libraryId`、`itemKey`、可选 `refresh`、`mainFile`。默认复用 ready 缓存，`refresh: true` 才重新下载。该工具在描述中明确标注有缓存写入副作用。

### `mineru_read_latex`

读取 LaTeX 全文、标题、章节或源码搜索结果。

输入：`libraryId`、`itemKey`、`granularity`、`sectionPath`、`query`、`contextParagraphs`。LaTeX 章节只接受精确完整路径或唯一末级标题，不接受 Markdown 的 section number 规则。

### `mineru_query_latex_table`

按 caption、label 或源码内容查询 LaTeX 表格，返回原始 LaTeX 表格代码。

输入：`libraryId`、`itemKey`、`query`。

### `mineru_get_latex_image`

读取 LaTeX 源码中引用的一个或多个安全相对路径。输入同样使用 `paths: string[]`，结果保留每个路径的状态。

所有工具的 `libraryId` 和 `itemKey` 在 schema 层设为必填。MCP 层参数命名使用 camelCase，调用 service 时转换为当前 TypeScript 接口命名；不修改现有 HTTP 参数名。

## 返回内容

成功的普通查询工具同时返回：

- `structuredContent`：与现有 service 结果对应的 JSON 对象；
- `content` 中的一个 `text` block：包含条目、附件、粒度和正文或查询结果的可读摘要。

标题、章节、搜索、表格和 manifest 保留现有字段。MCP 适配层不把 JSON 压平成 CLI 文本后再返回，避免丢失候选项、来源位置、解析模式和逐项状态。

图片工具返回：

- `structuredContent.images`：路径、状态、MIME 和必要的元数据；
- 成功图片对应的 MCP `image` block，使用图片 MIME 和 base64 数据；
- 失败图片保留逐项状态，不阻止同一请求中的其他成功图片。

MCP 返回不提供本地输出路径，也不允许工具参数指定任意文件系统路径。图片只来自插件 service 已验证的归档成员或结果目录。

## 认证与启用条件

MCP endpoint 复用现有本地查询 API 的两个设置：

1. 本地 Markdown 查询 API 必须启用；
2. 如果启用了 token 校验，MCP 请求必须提供 `Authorization: Bearer <token>`。

认证在 `tools/list` 和 `tools/call` 前执行，避免未认证客户端枚举工具或探测条目。认证失败返回 MCP 可识别的错误文本和稳定错误码，不把 token 写入日志或响应。

第一版不增加独立 MCP token。未来若需要区分 CLI、HTTP 和 MCP 权限，再增加独立设置，但不属于本设计范围。

## 错误模型

JSON-RPC 层错误和领域查询错误分开处理：

- JSON 无法解析、缺少 JSON-RPC 字段、工具参数 schema 不匹配：返回协议级 invalid request 或 invalid params；
- 工具不存在：返回 unknown tool；
- `api-disabled`、`invalid-token`：返回认证/服务不可用错误；
- `ambiguous-attachment`、`ambiguous-section`：返回 `isError: true`，并保留候选列表，方便模型重新调用；
- `parse-result-not-found`、`section-not-found`、`tex-source-not-found`、`arxiv-id-not-found`、`invalid-path`：返回 `isError: true` 及稳定错误码；
- 未预期异常：返回 `internal-error`，对客户端提供可操作的简短信息，详细异常只写 Zotero 调试日志。

错误结果仍应包含一个文本 block，使不支持 `structuredContent` 的 MCP 客户端可以读取错误原因。不得把 Zotero 内部路径、token 或完整堆栈泄露给调用方。

## 运行时与安全边界

MCP endpoint 继续绑定 Zotero 本地 HTTP server 的 loopback 地址，不主动开放局域网访问。远程访问不属于第一版部署契约；用户如果需要远程 MCP，应通过已有的安全隧道或受控代理访问本机端口。

适配层不读取 `ProfD/mineru-copy` 或 LaTeX 缓存目录，也不复制 service 内部的附件选择和路径检查。所有数据读取、图片路径验证和 arXiv 下载都经过现有 service/storage 边界。

MCP 处理器不依赖 `window`、reader overlay 或偏好设置页面，因此 Zotero 无主窗口时仍可以处理请求，只要插件已完成启动。

## 测试与验收

新增测试应覆盖以下回归风险：

- `initialize`、`ping`、`tools/list`、`tools/call` 和 initialized notification；
- 不支持 HTTP 方法、非法 JSON、未知工具和无效参数；
- API disabled、缺失 token、错误 token 和有效 token；
- Markdown 全文、标题、章节、搜索、表格及附件歧义；
- LaTeX fetch 缓存命中、refresh、章节路径、搜索和表格；
- 单图、多图、部分失败、重复路径以及图片 MIME/base64 映射；
- `structuredContent` 与 `content` 同时存在，且不丢失候选项和来源位置；
- 未预期异常被转换为稳定 MCP 错误，不泄露内部堆栈；
- 插件启动后 endpoint 已注册，关闭后 endpoint 已注销，重复启动不会留下旧 endpoint。

实现完成后运行：

```powershell
node --test test/querySourceCli.test.mjs
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
npm run lint:check
npm run build
```

另外需要用一个实际支持 URL MCP server 的客户端验证：连接、工具发现、Markdown 查询、LaTeX 查询和图片展示。验证时确认 MCP endpoint 使用的端口与 Zotero 本地 server 端口一致，且关闭插件后请求不再成功。

## 分阶段实施

1. 抽取或复用查询 service 的依赖工厂，建立 `McpQueryContext`。
2. 实现 MCP protocol adapter 和最小工具注册，先覆盖 `initialize`、`tools/list`、`zotero_search_items`。
3. 加入 Markdown 工具和结构化结果映射。
4. 加入 LaTeX 工具、缓存 fetch 和图片 content block。
5. 加入认证、错误映射、生命周期测试和真实 MCP 客户端验证。
6. 更新 README 中的 MCP 地址、启用条件、token 配置和工具说明。

每个阶段都保持现有 HTTP API 和 CLI 测试通过。MCP 功能异常时不应阻止插件启动；注册失败应记录调试信息并让现有 Zotero 功能继续可用。
