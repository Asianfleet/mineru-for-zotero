# Markdown 查询 Skill 设计

## 背景

当前分支已经实现 Zotero 插件内的本地 Markdown 查询 API，外部调用方可以通过 Zotero 本地 HTTP server 访问 `/mineru-for-zotero/search` 与 `/mineru-for-zotero/markdown`。API 能按标题检索候选条目，并按 `libraryID + key` 读取已保存的 MinerU Markdown 解析结果，支持 `full`、`headings`、`section`、`search` 四种粒度。

下一步需要在仓库中新增一个面向 agent 的 skill，让 agent 不必记忆 HTTP endpoint、参数编码、token 传递和响应排版细节。Skill 应提供一个可直接执行的 CLI 脚本，并在 `SKILL.md` 中说明调用方式。

## 目标

- 在 `skill/scripts/` 下提供一个 CLI 脚本，用于调用当前插件暴露的 Markdown 查询 API。
- CLI 支持 `--format text` 和 `--format json` 两种输出格式。
- `--format text` 输出经过排版的 agent 友好文本，便于直接阅读和引用。
- `--format json` 输出格式化后的稳定 JSON，便于管道调用、后续脚本处理或结构化解析。
- 在 `skill/SKILL.md` 中写明 skill 的触发场景、前置条件、CLI 参数和典型示例。
- CLI 只做本地 HTTP API 的薄封装，不重新实现 Zotero item 解析、attachment 选择、Markdown parsing 或错误语义。

## 非目标

- 不新增新的 Zotero 插件 HTTP endpoint。
- 不改变现有 Markdown 查询 API 的响应模型、认证策略或偏好设置。
- 不触发 MinerU 解析任务；CLI 只查询已有解析结果。
- 不在 CLI 中直接读取 Zotero profile、storage 目录或解析结果文件。
- 不把 skill 做成独立 npm 包或全局安装工具。
- 不新增额外长文档；skill 目录只保留 `SKILL.md` 和必要脚本。

## 目录结构

新增目录结构：

```text
skill/
├── SKILL.md
└── scripts/
    └── query-markdown.mjs
```

`skill/` 是仓库内随插件维护的 skill 源目录。后续如需安装到用户级 Codex skills，可由用户或发布流程复制该目录，但本任务不负责安装。

## CLI 语言选择

CLI 使用 Node.js ESM 单文件脚本：`skill/scripts/query-markdown.mjs`。

选择原因：

- 当前仓库已经是 Node/TypeScript 项目，`package.json` 使用 `"type": "module"`。
- Node 18+ 内置 `fetch`、`URL` 和 `URLSearchParams`，足够完成 HTTP 调用和参数编码。
- `.mjs` 脚本无需编译，agent 可以直接用 `node skill/scripts/query-markdown.mjs ...` 调用。
- 避免引入新的运行时依赖或 package script。

## CLI 命令模型

CLI 提供两个子命令：

```powershell
node skill/scripts/query-markdown.mjs search --library-id 1 --title "keyword" --format text
node skill/scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity headings --format json
```

### 通用参数

- `--base-url <url>`：Zotero 本地 HTTP server 地址，默认 `http://127.0.0.1:23119`。
- `--token <token>`：Markdown 查询 API token。传入后使用 `Authorization: Bearer <token>`。
- `--format <text|json>`：输出格式，默认 `text`。
- `--timeout-ms <number>`：请求超时，默认 `30000`。
- `--help`：输出帮助文本。

### `search` 参数

- `--library-id <number>`：Zotero library ID，必填。
- `--title <text>`：标题关键词，必填。

调用 endpoint：

```text
GET /mineru-for-zotero/search?libraryID=<id>&title=<title>
```

### `markdown` 参数

- `--library-id <number>`：Zotero library ID，必填。
- `--key <key>`：Zotero item key 或 PDF attachment key，必填。
- `--attachment-key <key>`：指定普通条目下的 PDF attachment，可选。
- `--granularity <full|headings|section|search>`：查询粒度，默认 `full`。
- `--section-path <path>`：章节路径，仅 `section` 使用。原样传给 API，支持 `Introduction/Background` 或 JSON 数组字符串。
- `--query <text>`：关键词，仅 `search` 使用，对应 API 的 `q`。
- `--context-paragraphs <number>`：搜索命中上下文段落数，仅 `search` 使用。

调用 endpoint：

```text
GET /mineru-for-zotero/markdown?libraryID=<id>&key=<key>&granularity=<granularity>...
```

## Text 输出格式

`--format text` 面向 agent 直接阅读，应避免输出原始 JSON 噪音。所有 text 输出都遵循：

- 先输出请求和目标摘要。
- 再输出与粒度对应的主体内容。
- 错误输出到 stderr，并使用清晰的 `Error: <code>` 标题。
- 长 Markdown 内容不截断，由调用方决定是否分页或重定向。

### Search 文本格式

示例：

```text
Markdown Query Search
Library: 1
Title: retrieval
Candidates: 2

1. Example Paper
   itemID: 123
   key: ABCD1234
   type: regular
   attachments:
   - paper.pdf
     itemID: 456
     key: PDFKEY01
     parsed: precise=yes lite=no

2. Another Paper
   itemID: 789
   key: WXYZ5678
   type: attachment
   attachments:
   - another.pdf
     itemID: 789
     key: WXYZ5678
     parsed: precise=no lite=yes
```

### Full 文本格式

示例：

```text
Markdown Query Result
Library: 1
Item: ABCD1234
Attachment: PDFKEY01 paper.pdf
Title: Example Paper
Granularity: full
Mode: precise

[Content]
# Example Paper

Body...
```

### Headings 文本格式

示例：

```text
Markdown Query Result
Library: 1
Item: ABCD1234
Attachment: PDFKEY01 paper.pdf
Title: Example Paper
Granularity: headings
Mode: precise

[Headings]
- # Example Paper
  path: Example Paper
  line: 1
- ## Introduction
  path: Example Paper / Introduction
  line: 8
```

### Section 文本格式

示例：

```text
Markdown Query Result
Library: 1
Item: ABCD1234
Attachment: PDFKEY01 paper.pdf
Title: Example Paper
Granularity: section
Mode: precise

[Section]
Heading: Introduction
Path: Example Paper / Introduction
Line: 8

## Introduction

Section body...
```

### Search 文本格式

示例：

```text
Markdown Query Result
Library: 1
Item: ABCD1234
Attachment: PDFKEY01 paper.pdf
Title: Example Paper
Granularity: search
Mode: precise
Query: retrieval
Matches: 1

[Match 1]
Paragraph: 3

Previous paragraph.

>> This paragraph mentions retrieval.

Next paragraph.
```

### Error 文本格式

示例：

```text
Error: parse-result-not-found
Message: Target PDF has no available parse result
HTTP Status: 404

Hint: Parse this PDF in Zotero first, or choose another attachment with attachmentKey.
```

CLI 可以为常见错误提供简短 hint：

- `api-disabled`：提示在 Zotero 偏好页启用 Markdown 查询 API。
- `invalid-token`：提示检查 `--token`。
- `ambiguous-attachment`：提示改用 `--attachment-key`，并列出候选附件。
- `parse-result-not-found`：提示先解析 PDF。
- `section-not-found`：提示先用 `--granularity headings` 查看路径。
- `missing-query`：提示传入 `--query`。

## JSON 输出格式

`--format json` 面向脚本和管道。CLI 不直接透传原始 API 响应，而是包装为稳定 envelope。

成功响应：

```json
{
  "ok": true,
  "request": {
    "command": "markdown",
    "baseUrl": "http://127.0.0.1:23119",
    "endpoint": "/mineru-for-zotero/markdown",
    "params": {
      "libraryID": "1",
      "key": "ABCD1234",
      "granularity": "headings"
    }
  },
  "status": 200,
  "data": {
    "granularity": "headings",
    "headings": []
  }
}
```

错误响应：

```json
{
  "ok": false,
  "request": {
    "command": "markdown",
    "baseUrl": "http://127.0.0.1:23119",
    "endpoint": "/mineru-for-zotero/markdown",
    "params": {
      "libraryID": "1",
      "key": "ABCD1234"
    }
  },
  "status": 404,
  "error": {
    "code": "parse-result-not-found",
    "message": "Target PDF has no available parse result",
    "details": {}
  }
}
```

JSON 输出规则：

- 始终输出一个 JSON object。
- 使用 2 空格缩进。
- 不在 stdout 混入说明性文本。
- HTTP/API 错误时退出码为 `1`。
- 参数错误、网络错误或非 JSON 响应时退出码为 `2`。
- 成功时退出码为 `0`。

## SKILL.md 设计

`skill/SKILL.md` 使用标准 skill frontmatter：

```yaml
---
name: mineru-markdown-query
description: Query local MinerU for Zotero Markdown parse results through the bundled CLI. Use when Codex needs to search Zotero items by title, inspect parsed Markdown headings, read a section, search parsed Markdown content, or fetch full Markdown from the plugin's local API.
---
```

正文保持短小，包含：

- 前置条件：
  - Zotero 正在运行。
  - MinerU for Zotero 插件已启用 Markdown 查询 API。
  - 如果 API 要求 token，调用 CLI 时传入 `--token`。
- 推荐流程：
  1. 不知道 key 时，先用 `search` 找候选。
  2. 已有 item key 或 attachment key 时，用 `markdown --granularity headings` 了解结构。
  3. 需要具体章节时，用 `markdown --granularity section --section-path ...`。
  4. 需要关键词上下文时，用 `markdown --granularity search --query ...`。
  5. 只有确实需要全文时再用 `markdown --granularity full`。
- CLI 示例：
  - 标题检索。
  - headings 查询。
  - section 查询。
  - search 查询。
  - JSON 管道输出。
- 错误处理建议：
  - 遇到 `ambiguous-attachment` 时改传 `--attachment-key`。
  - 遇到 `section-not-found` 时先查 headings。
  - 遇到 `parse-result-not-found` 时告知用户目标 PDF 尚无解析结果。

## 参数解析与实现约束

脚本保持无依赖实现：

- 手写轻量参数解析，只支持 `--flag value` 与布尔型 `--help`。
- 缺失必填参数时打印帮助摘要并退出 `2`。
- 使用 `AbortController` 实现请求超时。
- 使用 `URL` 和 `URLSearchParams` 拼接请求，避免手写 query string。
- token 只放入 `Authorization` header，不在命令回显、text 输出或 JSON `request.params` 中展示。
- 不读取任何环境变量中的 API key 或 `_KEY` 变量，避免触碰 secret 规则。

## 测试与验证

实现时建议补充一个 Node test 文件或代表性 smoke test，覆盖：

- `--format text` 能把 search、headings、section、search、full 响应格式化为预期文本。
- `--format json` 成功时输出稳定 envelope。
- API 错误时 text 和 json 都包含错误码与 message。
- 参数缺失时退出码为 `2`。
- token 不出现在输出中。

如果脚本测试放在 `skill/scripts/` 内，应使用 Node 内置 test runner，避免新增依赖。最终验证命令建议：

```powershell
node --test skill/scripts/*.test.mjs
npm run lint:check
```

如果只新增文档 spec，至少运行：

```powershell
npx prettier --write docs/superpowers/specs/2026-07-12-markdown-query-skill-design.md
npm run lint:check
```

## 风险与处理

- Zotero 本地 HTTP server 端口可能不是默认 `23119`。CLI 提供 `--base-url` 覆盖，不猜测用户 profile。
- API 默认关闭或需要 token。CLI 不绕过插件设置，只清晰报告 `api-disabled` 或 `invalid-token`。
- 全文 Markdown 可能很长。`text` 格式不截断，agent 应优先查询 headings、section 或 search。
- 普通条目可能有多个 PDF 附件。CLI 保留 API 的 `ambiguous-attachment` 语义，并在 text 输出中提示 `--attachment-key`。
- CLI 和 API 响应模型可能随着插件演进变化。CLI 应尽量只依赖当前稳定字段，并对缺失字段做宽容格式化。
