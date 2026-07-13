# Markdown 查询 API 设计

## 背景

当前插件已经能解析 Zotero PDF attachment，并把 MinerU 结果保存到 Zotero profile 下的 `ProfD/mineru-copy`。完整解析结果包含 `manifest.json`、`mineru-result.json`、`content.md`、`boxes.normalized.json` 和可选图片；轻量解析结果包含 `lite-manifest.json` 和 `lite-content.md`。Reader overlay 和全文复制已经通过 `storage.readPreferredMarkdown()` 读取“精准优先、轻量兜底”的 Markdown。

新功能需要把这些本地解析结果暴露给外部调用方。第一版入口为 Zotero 插件运行时内的本地 HTTP API，而不是独立 Node CLI。这样可以直接复用 Zotero 的 item、attachment、profile 和 storage 能力，避免外部进程猜测 Zotero profile 路径或重新实现条目解析逻辑。

## 目标

- 提供默认关闭的本地 HTTP API，用于读取某个 Zotero 条目的 Markdown 解析结果。
- 支持通过 `libraryID + key` 精确定位 Zotero 普通条目或 PDF attachment。
- 支持按标题检索条目候选，但标题检索只返回候选元数据，不直接返回 Markdown。
- 支持全文、标题列表、指定章节、关键词搜索四种 Markdown 查询粒度。
- 支持普通条目下自动选择最可能的原始文献 PDF；无法唯一判定时返回候选附件元数据，不返回 Markdown。
- 支持调用方通过 `attachmentKey` 指定某个 PDF attachment，从而绕过普通条目的自动附件选择。
- 支持用户选择是否启用 token 校验；需要 token 时由插件生成 token。

## 非目标

- 第一版不实现独立外部 CLI。后续如需 CLI，应复用本设计中的查询核心与 API 响应模型。
- 第一版不触发新的 MinerU 解析任务。API 只读取已经保存到本地的结果；缺少结果时返回明确提示。
- 第一版不对图片资源做额外 HTTP 暴露。Markdown 中现有图片路径保持原样。
- 第一版不把多个 PDF attachment 的 Markdown 自动合并为一份文档。
- 第一版不做语义搜索、向量索引或跨条目全文检索。

## 偏好设置与安全策略

新增偏好项：

- `apiEnabled`: `boolean`，默认 `false`。
- `apiRequireToken`: `boolean`，默认 `true`。
- `apiToken`: `string`，由插件生成。用户可以在偏好页重新生成。

偏好页新增“本地查询 API”区域：

- 显示 API 当前启用状态。
- 提供启用/关闭 API 的开关。
- 提供是否要求 token 的开关。
- 提供生成/重新生成 token 的按钮。
- 不在偏好页提供最小调用示例；偏好页只承担状态展示、开关和 token 管理职责。

README 文件新增最小调用示例，包含 `libraryID`、`key`、`Authorization: Bearer <token>` 的示例形态，并说明示例中的 token 来自 Zotero 偏好页。

API 默认关闭。关闭时所有 API 请求返回 `403`，响应 JSON 包含 `error: "api-disabled"`。

当 `apiRequireToken` 为 `true` 时，请求必须提供以下任一认证方式：

- HTTP header: `Authorization: Bearer <token>`
- Query: `token=<token>`

token 缺失或错误时返回 `403`，响应 JSON 包含 `error: "invalid-token"`。当 `apiRequireToken` 为 `false` 时，仅本机可访问的 Zotero HTTP server 约束仍然适用，但插件不额外校验 token。

## HTTP API

API 注册在 Zotero 插件运行时内，使用 Zotero 本地 HTTP server endpoint。路径使用插件前缀，避免与 Zotero 原生 API 冲突。

### 标题检索

`GET /mineru-for-zotero/search`

Query 参数：

- `libraryID`: Zotero library ID，必填。
- `title`: 标题关键词，必填。

行为：

- 使用 Zotero `Search` 在指定 library 中执行 `title contains` 查询。
- 只返回候选条目元数据，不读取 Markdown。
- 候选可以是普通条目，也可以是 PDF attachment。普通条目返回其 PDF attachment 摘要和每个 attachment 的解析状态。

响应示例：

```json
{
  "candidates": [
    {
      "item": {
        "itemID": 123,
        "libraryID": 1,
        "key": "ABCD1234",
        "type": "regular",
        "title": "Example Paper"
      },
      "attachments": [
        {
          "itemID": 456,
          "libraryID": 1,
          "key": "PDFKEY01",
          "fileName": "example.pdf",
          "preciseReady": true,
          "liteReady": false
        }
      ]
    }
  ]
}
```

### Markdown 查询

`GET /mineru-for-zotero/markdown`

Query 参数：

- `libraryID`: Zotero library ID，必填。
- `key`: Zotero item key，必填。可以指向普通条目或 PDF attachment。
- `attachmentKey`: PDF attachment key，可选。传入后以该 attachment 为准。
- `granularity`: `full`、`headings`、`section`、`search`，默认 `full`。
- `sectionPath`: 指定章节路径，仅 `granularity=section` 使用。支持 JSON 数组字符串，例如 `["Introduction","Background"]`，也支持 `/` 分隔字符串，例如 `Introduction/Background`。
- `q`: 搜索关键词，仅 `granularity=search` 使用。
- `contextParagraphs`: 命中上下文段落数，仅 `granularity=search` 使用，默认 `1`，最小 `0`。

全文响应示例：

```json
{
  "item": {
    "itemID": 123,
    "libraryID": 1,
    "key": "ABCD1234",
    "type": "regular",
    "title": "Example Paper"
  },
  "attachment": {
    "itemID": 456,
    "libraryID": 1,
    "key": "PDFKEY01",
    "fileName": "example.pdf"
  },
  "result": {
    "mode": "precise",
    "source": "preferred"
  },
  "granularity": "full",
  "content": "# Example Paper\n\nBody..."
}
```

标题列表响应示例：

```json
{
  "granularity": "headings",
  "headings": [
    {
      "level": 1,
      "title": "Example Paper",
      "path": ["Example Paper"]
    },
    {
      "level": 2,
      "title": "Introduction",
      "path": ["Example Paper", "Introduction"]
    }
  ]
}
```

章节响应示例：

```json
{
  "granularity": "section",
  "heading": {
    "level": 2,
    "title": "Introduction",
    "path": ["Example Paper", "Introduction"]
  },
  "content": "## Introduction\n\nSection body..."
}
```

关键词搜索响应示例：

```json
{
  "granularity": "search",
  "query": "retrieval",
  "matches": [
    {
      "paragraphIndex": 3,
      "context": "Previous paragraph.\n\nThis paragraph mentions retrieval.\n\nNext paragraph.",
      "before": ["Previous paragraph."],
      "hit": "This paragraph mentions retrieval.",
      "after": ["Next paragraph."]
    }
  ]
}
```

## 条目与附件解析

当 `key` 指向 PDF attachment：

- 校验该 item 是 PDF attachment。
- 使用 `{ libraryID, key }` 读取 storage。

当 `key` 指向普通条目：

1. 获取该条目的 PDF attachments。
2. 如果传入 `attachmentKey`，只在这些 PDF attachments 中查找匹配项。
3. 如果未传入 `attachmentKey`，运行“原始文献 PDF”自动选择规则。
4. 选出唯一 attachment 后再读取 storage。

确定目标 PDF attachment 后，统一按以下顺序读取 Markdown：

1. 如果存在精准解析结果，返回 `content.md`。
2. 如果不存在精准解析结果但存在轻量解析结果，返回 `lite-content.md`。
3. 如果都不存在，返回 `404` 和 `error: "parse-result-not-found"`。

当普通条目没有 PDF attachment 时，返回 `404` 和 `error: "pdf-attachment-not-found"`。

当传入的 `attachmentKey` 不属于该普通条目，或不是 PDF attachment，返回 `404` 和 `error: "attachment-not-found"`。

## 原始文献 PDF 自动选择规则

自动选择规则必须可解释，不能在无法判定时随机取一个。

候选集合：

- 仅包含普通条目下的 PDF attachments。
- 记录每个候选的 `itemID`、`libraryID`、`key`、`fileName`、解析状态、评分、评分原因。

评分规则：

- 降权明显派生文件名或 attachment title。派生词包括：
  - 英文：`annotated`、`annotation`、`annotations`、`highlight`、`highlights`、`note`、`notes`、`translated`、`translation`、`copy`、`edited`
  - 中文：`批注`、`注释`、`高亮`、`笔记`、`翻译`、`译文`、`副本`、`修改`
- 优先 Zotero `getBestAttachments()` 排序中更靠前的 PDF。
- 优先文件名或 attachment title 与父条目标题更接近的 PDF。
- 优先较早添加的 PDF，作为“原始下载文件通常先进入条目”的弱信号。
- 不因某个附件已有解析结果而优先选择它；选择文献身份应先于读取解析结果。

判定：

- 如果最高分候选唯一，选中该 PDF。
- 如果最高分并列，或候选信息不足以形成唯一最高分，返回 `409` 和 `error: "ambiguous-attachment"`。
- `409` 响应必须包含所有候选附件的元数据、解析状态、评分和原因。
- `409` 响应不包含任何 Markdown 内容。

歧义响应示例：

```json
{
  "error": "ambiguous-attachment",
  "message": "Multiple PDF attachments may be the original paper. Specify attachmentKey to fetch one.",
  "candidates": [
    {
      "itemID": 456,
      "libraryID": 1,
      "key": "PDFKEY01",
      "fileName": "paper.pdf",
      "preciseReady": true,
      "liteReady": false,
      "score": 120,
      "reasons": ["best-attachment-order:0", "title-similarity"]
    },
    {
      "itemID": 789,
      "libraryID": 1,
      "key": "PDFKEY02",
      "fileName": "paper-annotated.pdf",
      "preciseReady": true,
      "liteReady": false,
      "score": 120,
      "reasons": ["best-attachment-order:1", "derived-name:annotated"]
    }
  ]
}
```

## Markdown 解析语义

标题解析：

- 只识别 ATX heading，即以 `#` 到 `######` 开头的 Markdown 标题。
- 标题路径由 heading 层级形成。
- 文档开头没有 heading 时，`headings` 返回空数组。

章节解析：

- `sectionPath` 必须精确匹配 heading path。
- 章节内容从目标 heading 行开始，到下一个同级或更高级 heading 之前结束。
- 如果路径不存在，返回 `404` 和 `error: "section-not-found"`。
- 如果同一路径无法唯一定位，返回 `409` 和 `error: "ambiguous-section"`，并返回候选 heading 元数据。

关键词搜索：

- 默认大小写不敏感。
- 按空行分隔 Markdown 段落。
- 每个命中返回命中段落及前后 `contextParagraphs` 个段落。
- 同一段落多次命中同一关键词时，只返回一个 match。
- `q` 为空或只包含空白时返回 `400` 和 `error: "missing-query"`。

## 错误模型

所有错误默认返回 JSON：

```json
{
  "error": "error-code",
  "message": "Human readable message"
}
```

主要错误码：

- `api-disabled`: API 未启用。
- `invalid-token`: token 缺失或错误。
- `invalid-request`: 请求参数缺失或格式错误。
- `item-not-found`: 找不到指定 Zotero item。
- `pdf-attachment-not-found`: 普通条目没有 PDF attachment。
- `attachment-not-found`: 指定 attachment 不存在或不属于该条目。
- `ambiguous-attachment`: 自动附件选择无法唯一判定。
- `parse-result-not-found`: 目标 PDF 没有可用解析结果。
- `section-not-found`: 找不到指定章节路径。
- `ambiguous-section`: 章节路径无法唯一定位。
- `missing-query`: 搜索关键词为空。
- `internal-error`: 未预期错误。

## 模块边界

建议新增模块：

- `src/modules/markdownQuery/markdownParser.ts`: 解析 heading、章节和段落搜索。纯函数，不依赖 Zotero。
- `src/modules/markdownQuery/attachmentResolver.ts`: 把 Zotero item 解析为目标 PDF attachment 或歧义候选。
- `src/modules/markdownQuery/queryService.ts`: 组合 Zotero item、storage 和 Markdown parser，输出 API 响应对象。
- `src/modules/markdownQuery/apiEndpoint.ts`: 注册和清理 Zotero `Server.Endpoints`，处理 HTTP 参数、认证、响应码。

现有模块改动：

- `src/modules/storage.ts`: 如有必要，增加读取结果来源状态的只读方法；不得改变现有存储目录和 precise/lite 优先级语义。
- `src/modules/preferenceScript.ts`: 增加 API 偏好 UI 和 token 生成入口。
- `src/hooks.ts`: startup 注册 API endpoint，shutdown 清理 endpoint。
- `typings/prefs.d.ts` 与 locale 文件：增加偏好项和界面文案。

## 测试要求

必须新增或更新测试：

- Markdown parser:
  - 提取多级 heading 和 path。
  - 按 heading path 返回章节内容。
  - 章节不存在返回 `section-not-found`。
  - 关键词搜索返回命中段落和前后段落上下文。
  - 空关键词返回 `missing-query`。

- Attachment resolver:
  - PDF attachment key 直接解析为自身。
  - 普通条目只有一个 PDF 时选择该 PDF。
  - 普通条目有原始 PDF 和批注/翻译 PDF 时优先原始 PDF。
  - 多个候选无法唯一判定时返回 `ambiguous-attachment` 和候选元数据。
  - `attachmentKey` 可以精确选择某个子 PDF。

- Query service:
  - precise 结果优先于 lite 结果。
  - lite-only 结果可返回。
  - 缺少解析结果返回 `parse-result-not-found`。
  - `full`、`headings`、`section`、`search` 四种粒度响应稳定。

- API endpoint:
  - API 关闭时返回 `403 api-disabled`。
  - token 开启时拒绝缺失或错误 token。
  - token 可通过 header 或 query 传入。
  - 标题检索只返回候选，不返回 Markdown。

最终验证命令：

```powershell
pnpm lint:check
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
pnpm build
```
