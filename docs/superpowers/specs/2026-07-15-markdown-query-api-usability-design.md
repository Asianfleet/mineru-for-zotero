# Markdown 查询 API 易用性升级设计

## 背景

当前 Markdown Query API 和随仓库维护的 CLI 已经能检索 Zotero 条目、读取已保存的 MinerU Markdown，并支持 `full`、`headings`、`section`、`search` 四种粒度。实际使用中暴露出几个高摩擦点：

- `sectionPath` 必须完整精确匹配，论文根标题过长时调用成本很高。
- 一次只能读取一个 section，连续阅读多个实验、结果或评估章节需要多次调用。
- Markdown 中的表格常以原始 HTML 形式出现，agent 需要更直接地按表格标题或内容定位表格。
- Markdown 中的图片链接是 `images/...` 相对路径，外部 agent 无法直接查看或保存图片。

本次升级把 HTTP API 和 CLI 都视为稳定接口一起设计。目标是降低 agent 查询摩擦，同时保持 API 响应可解释、可测试、可向后文档化。

## 目标

- `granularity=section` 支持章节号查询、逗号分组、章节号范围和模糊路径查询。
- `granularity=section` 统一返回分组响应模型，让单 section、多 section、缺失和歧义都使用同一结构。
- 新增表格查询 endpoint，可通过表格标题或表格内容匹配表格，并按指定格式返回。
- 新增图片获取 endpoint，可根据 Markdown 中的 `![](images/...)` 链接读取图片。
- CLI 同步支持章节号、模糊 section path、表格查询和图片保存。
- `mineru-for-zotero-cli/SKILL.md` 保持现有按场景拆分的 Workflows 风格，补充新的短 workflow。

## 非目标

- 不做语义搜索、向量检索或跨条目检索。
- 不让 section 查询负责表格格式转换；表格由独立 endpoint 查询。
- 不在 section 响应中默认内联图片 base64。
- 不触发新的 MinerU 解析任务；所有接口仍只读取已有解析结果。
- 不把多个 PDF attachment 的 Markdown 自动合并。

## Breaking Change

`GET /mineru-for-zotero/markdown?granularity=section` 的响应模型改为统一分组结构。

旧响应：

```json
{
  "granularity": "section",
  "heading": {},
  "content": "..."
}
```

新响应：

```json
{
  "granularity": "section",
  "groups": []
}
```

所有 `section` 查询，包括单个完整 `sectionPath` 查询，都返回 `groups`。这是有意的接口调整，CLI、README 和 skill 文档都需要明确说明。

## Markdown Section API

复用现有 endpoint：

```text
GET /mineru-for-zotero/markdown
```

新增或调整参数：

- `granularity=section`：启用分组 section 查询。
- `sectionNumber`：章节号表达式，支持单个、逗号分组和范围。
- `sectionPath`：章节路径或标题片段表达式，支持逗号分组和模糊匹配。

`sectionNumber` 和 `sectionPath` 互斥。同时传入时返回 `400 invalid-request`。

### Section Number 语法

`sectionNumber` 支持：

- `5.1`
- `5.1,5.2`
- `5.1-5.4`
- `5.1,5.3-5.5`

逗号是顶层分组分隔符。范围表达式是一个分组，不拆成多个顶层组。响应按输入分组顺序返回。

### Section Path 语法

`sectionPath` 支持：

- `Experiment Settings`
- `5.1 Experiment`
- `Introduction/Background`
- `Experiment Settings,Results`

逗号是顶层分组分隔符。每个分组都执行模糊匹配，不要求完整路径，不要求包含论文根标题。

## Section 响应模型

响应保留已有 `item`、`attachment`、`result` 等顶层摘要字段，并在 `granularity=section` 下返回 `groups`。

```json
{
  "item": {},
  "attachment": {},
  "result": {
    "mode": "precise",
    "source": "preferred"
  },
  "granularity": "section",
  "groups": [
    {
      "query": "5.1",
      "kind": "section-number",
      "status": "ok",
      "matches": [
        {
          "heading": {
            "level": 2,
            "title": "5.1 Experiment Settings",
            "path": [
              "Table Meets LLM: Can Large Language Models Understand Structured Table Data? A Benchmark and Empirical Study",
              "5.1 Experiment Settings"
            ],
            "line": 120,
            "number": "5.1"
          },
          "content": "## 5.1 Experiment Settings\n\n...",
          "images": [
            {
              "path": "images/63e644fe.jpg",
              "url": "/mineru-for-zotero/image?libraryID=1&key=ABCD1234&path=images%2F63e644fe.jpg"
            }
          ]
        }
      ],
      "warnings": []
    }
  ]
}
```

分组字段：

- `query`：逗号分隔前的原始查询片段。
- `kind`：`section-number`、`section-number-range` 或 `section-path`。
- `status`：`ok`、`not-found`、`ambiguous` 或 `invalid-range`。
- `matches`：成功命中的 section，按文档顺序返回。
- `candidates`：歧义时返回候选 heading 元数据，不返回 section content。
- `warnings`：可选，记录非致命降级。

分组匹配失败不让整个 HTTP 请求失败。只要请求参数合法，API 返回 HTTP 200，并在每个 group 内表达状态。

## 章节号匹配语义

章节号从 heading 标题开头提取，支持常见论文格式：

- `5.1 Experiment Settings`
- `5.1. Experiment Settings`
- `5 Results`
- `A.1 Appendix Setting`

规则：

- 单号查询匹配编号完全等于输入的 heading。
- 范围查询要求起点和终点编号都存在。
- 范围查询按文档顺序返回位于起点和终点之间的 heading，包含端点。
- 第一版不支持跨主编号范围，例如 `5.1-6.2`。这类查询作为该分组的 `invalid-range`。
- 同一编号命中多个 heading 时，该分组为 `ambiguous`，返回候选 heading 元数据。

## 模糊路径匹配语义

`sectionPath` 对查询和 heading path 做归一化后匹配：

- 大小写不敏感。
- 折叠连续空白。
- 忽略常见 Markdown 标点差异。
- 查询可以匹配 leaf heading，也可以匹配完整 path 的任意连续片段。

示例：

- `Experiment Settings` 可匹配 `Paper Title / 5.1 Experiment Settings`。
- `5.1 Experiment` 可匹配 `Paper Title / 5.1 Experiment Settings`。
- `Introduction/Background` 匹配 path 中相邻的 `Introduction / Background`。

如果一个查询命中多个 heading，该分组为 `ambiguous`，返回候选 heading 元数据，不返回 content，避免把错误章节混入上下文。

## 表格查询 Endpoint

新增 endpoint：

```text
GET /mineru-for-zotero/tables
```

参数：

- `libraryID`：必填。
- `key`：Zotero item key 或 PDF attachment key，必填。
- `attachmentKey`：可选，和 Markdown 查询保持一致。
- `q`：表格查询关键词，必填。
- `match`：`caption`、`content` 或 `both`，默认 `both`。
- `tableFormat`：`html`、`markdown`、`tsv`、`latex` 或 `json`，默认 `html`。

`tableFormat` 使用独立名称，避免和 CLI 全局 `--format text|json` 混淆。

### 表格匹配语义

- `caption`：匹配 `table_caption`、表格父 box 附近的 caption 文本，以及 Markdown 中类似 `Table 2:` 或 `表 2` 的标题。
- `content`：匹配表格 HTML、Markdown、TSV 或 JSON 单元格文本。
- `both`：caption 或 content 命中即可。
- 匹配大小写不敏感，折叠空白。
- 返回多个命中时按文档顺序排列，不报歧义。
- `q` 为空返回 `400 missing-query`。
- 没有命中返回 HTTP 200 和 `tables: []`。

### 表格响应模型

```json
{
  "item": {},
  "attachment": {},
  "result": {
    "mode": "precise",
    "source": "preferred"
  },
  "query": "Table 2",
  "match": "both",
  "tableFormat": "markdown",
  "tables": [
    {
      "rawIndex": 42,
      "page": 5,
      "caption": "Table 2: Dataset statistics",
      "content": "| Dataset | Rows |\n| --- | --- |\n| WikiTable | 1000 |",
      "formats": {
        "html": "<table>...</table>",
        "markdown": "| Dataset | Rows |\n| --- | --- |\n| WikiTable | 1000 |",
        "tsv": "Dataset\tRows\nWikiTable\t1000",
        "latex": "\\begin{tabular}{cc}\nDataset & Rows\n\\end{tabular}"
      }
    }
  ]
}
```

精准解析 boxes 可用时，返回 `rawIndex`、`page`、caption 和格式化内容。只有 lite Markdown 可用时，可以退化为 Markdown 级表格搜索，缺少精确 box 信息不视为错误。

## 图片获取 Endpoint

新增 endpoint：

```text
GET /mineru-for-zotero/image
```

参数：

- `libraryID`：必填。
- `key`：Zotero item key 或 PDF attachment key，必填。
- `attachmentKey`：可选，和 Markdown 查询保持一致。
- `path`：必填，支持单个或逗号分隔的 Markdown 图片路径。

合法路径必须是解析结果中的 `images/` 相对路径，例如：

- `images/63e644fe.jpg`
- `images/63e644fe.jpg,images/another.png`

拒绝：

- `../a.jpg`
- `/absolute/a.jpg`
- `C:\a.jpg`
- `http://example.com/a.jpg`
- 非 `images/` 开头的路径。

### 单图响应

单个合法 path 且图片存在时，返回图片 bytes 和正确的 `Content-Type`，不包装 JSON。

单图缺失返回 `404 image-not-found` JSON 错误。单图路径非法返回 `400 invalid-path` JSON 错误。

### 多图响应

多个 path 时返回 JSON，每项独立表达状态：

```json
{
  "images": [
    {
      "path": "images/a.jpg",
      "status": "ok",
      "mime": "image/jpeg",
      "dataURL": "data:image/jpeg;base64,..."
    },
    {
      "path": "images/b.png",
      "status": "not-found"
    },
    {
      "path": "../secret.png",
      "status": "invalid-path"
    }
  ]
}
```

多图请求的非法或缺失项不影响其他项，HTTP 状态为 200。

## CLI 设计

CLI 继续使用现有脚本：

```powershell
node scripts/query-markdown.mjs <command> [options]
```

支持子命令：

- `search`
- `markdown`
- `table`
- `image`

### Markdown 子命令

新增参数：

- `--section-number <expr>`：传给 API 的 `sectionNumber`。
- `--section-path <expr>`：继续传给 API 的 `sectionPath`，但现在支持逗号和模糊匹配。

示例：

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-number "5.1,5.3-5.5"
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-path "Experiment Settings,Results"
```

text 输出按 group 展示：

```text
[Group 1] 5.1
Kind: section-number
Status: ok
Matches: 1

Heading: 5.1 Experiment Settings
Path: Paper Title / 5.1 Experiment Settings
Line: 120

## 5.1 Experiment Settings

...
```

`not-found`、`ambiguous` 和 `invalid-range` 组在 text 输出中清晰标注，但命令整体仍按 HTTP 200 成功退出。

### Table 子命令

```powershell
node scripts/query-markdown.mjs table --library-id 1 --key ABCD1234 --query "Table 2" --match both --table-format markdown
```

参数：

- `--query <text>`：必填，对应 API 的 `q`。
- `--match caption|content|both`：默认 `both`。
- `--table-format html|markdown|tsv|latex|json`：默认 `html`。
- `--format text|json`：仍表示 CLI 输出 envelope 格式。

text 输出打印每个表格的 caption、page、rawIndex 和内容。

### Image 子命令

```powershell
node scripts/query-markdown.mjs image --library-id 1 --key ABCD1234 --path "images/a.jpg" --output a.jpg
node scripts/query-markdown.mjs image --library-id 1 --key ABCD1234 --path "images/a.jpg,images/b.png" --output-dir .\figures
```

参数：

- `--path <paths>`：必填，支持逗号分隔。
- `--output <file>`：单图保存路径。
- `--output-dir <dir>`：多图或批量保存目录。

单图配合 `--output` 时保存为指定文件。多图配合 `--output-dir` 时按原文件名保存，重名时去重。多图不传 `--output-dir` 时输出 text 或 JSON 清单。

## Skill 文档更新

更新 `mineru-for-zotero-cli/SKILL.md` 时保持现有 Workflows 风格：按独立场景分别写短小 workflow，不写成一整套长流程。

新增或调整的 workflow：

- Read headings first
- Read sections by number
- Read sections by fuzzy path
- Find tables
- Fetch images
- Fetch full Markdown

每个 workflow 保持短示例和适用场景说明。

## 错误模型

新增错误码：

- `image-not-found`
- `invalid-path`

沿用现有错误：

- `invalid-request`
- `missing-query`
- `parse-result-not-found`
- `ambiguous-attachment`
- `internal-error`

`section` 查询只有请求参数非法时返回 HTTP 400。章节缺失、歧义和范围非法是分组级状态。

`tables` 查询中，`q` 为空返回 HTTP 400；无命中返回 HTTP 200。

`image` 单图请求可返回 HTTP 200 bytes、HTTP 400 JSON 或 HTTP 404 JSON。多图请求返回 HTTP 200 JSON。

## 模块边界

建议在现有边界上增量扩展：

- `markdownParser.ts`：增加 heading 编号提取、section query 分组解析、范围匹配和模糊 path 匹配。
- `queryService.ts`：增加分组 section 响应、table 查询服务和 image 读取服务入口。
- `apiEndpoint.ts`：注册 `/mineru-for-zotero/tables` 与 `/mineru-for-zotero/image`，处理新参数、认证和 bytes 响应。
- `copyFormatter.ts`：复用已有表格格式转换逻辑；如需给 API 使用，暴露必要的表格格式 helper。
- `storage.ts`：优先复用 `readBoxes()` 和 `readImageDataURL()`；如果单图 bytes 响应需要真实 bytes，可新增只读方法读取图片 bytes 和 mime。
- `mineru-for-zotero-cli/scripts/query-markdown.mjs`：新增 `table`、`image` 子命令和 section 分组输出。
- `mineru-for-zotero-cli/SKILL.md`：更新 CLI Reference 与 Workflows。

## 测试要求

新增或更新测试：

- `markdownParser.test.ts`
  - 提取 heading section number。
  - 解析逗号分组和范围。
  - 按章节号返回单个、多个和范围 sections。
  - 模糊 path 匹配 leaf title 与 path 片段。
  - 缺失、歧义和非法范围返回分组级状态。

- `markdownQueryService.test.ts`
  - `granularity=section` 统一返回 `groups`。
  - section 响应提取图片链接清单。
  - table 查询按 caption、content 和 both 匹配。
  - precise boxes 不可用时可退化为 Markdown 级表格搜索。

- `markdownApiEndpoint.test.ts`
  - 注册 `/mineru-for-zotero/tables` 与 `/mineru-for-zotero/image`。
  - 新 endpoint 沿用 API 开关和 token 校验。
  - 单图返回 bytes 和 content type。
  - 多图返回 JSON 状态数组。
  - 非法图片路径不读取文件系统。

- `queryMarkdownCli.test.mjs`
  - `--section-number` 单号、逗号和范围参数。
  - `--section-path` 逗号模糊查询参数。
  - `table` 子命令 text 与 JSON 输出。
  - `image` 子命令单图 `--output` 和多图 `--output-dir`。
  - token 不出现在 CLI 输出中。

最终验证建议：

```powershell
node --test test/queryMarkdownCli.test.mjs
npm run lint:check
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
npm run build
```
