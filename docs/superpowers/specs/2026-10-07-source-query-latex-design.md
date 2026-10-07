# Markdown 与 LaTeX 双来源查询设计

## 背景

现有 `mineru-for-zotero-cli/scripts/query-markdown.mjs` 通过 Zotero 本地 HTTP API 查询 MinerU 保存的 Markdown。`table` 和 `image` 是 Markdown 语义下的顶层命令。新需求增加 LaTeX 源码查询：源码只根据 Zotero 条目的 arXiv ID 在线下载，磁盘只保留解压后的文件，Zotero UI 不增加入口，下载由 CLI 命令触发。

本次重构不保留旧 CLI 或旧 HTTP 路由的兼容接口。

## 目标

- 用 `query-source.mjs` 统一查询入口，并按来源组织命令。
- 保留 Markdown 的全文、标题、章节、搜索、表格和图片能力。
- 增加 LaTeX 源码下载、全文、标题、章节、搜索、表格和图片能力。
- LaTeX 表格只返回原始 LaTeX 代码。
- 将解压后的 LaTeX 文件存到 `mineru-copy/tex_source/`。
- 下载失败或新结果损坏时保留上一份可用源码。

## 非目标

- 不修改 Zotero 偏好页或其它 Zotero UI。
- 不从 PDF 或 MinerU 结果推导 LaTeX 源码。
- 不保留 `query-markdown.mjs`、旧顶层 `table`/`image` 命令或旧 Markdown HTTP 路由。
- 不实现语义搜索、跨条目搜索或 LaTeX 到 Markdown/HTML 的格式转换。

## CLI 命令

入口：

```text
node mineru-for-zotero-cli/scripts/query-source.mjs <source> <operation> [options]
```

共用的条目检索命令保持为：

```text
search --library-id <id> --title <text>
```

Markdown 命令：

```text
markdown read  --library-id <id> --key <key> [--granularity full|headings|section|search]
markdown table --library-id <id> --key <key> --query <text>
markdown image --library-id <id> --key <key> --path <images/...> (--output <file>|--output-dir <dir>)
```

LaTeX 命令：

```text
latex fetch --library-id <id> --key <key> [--refresh] [--main-file <relative-path>]
latex read  --library-id <id> --key <key> [--granularity full|headings|section|search]
latex table --library-id <id> --key <key> --query <text>
latex image --library-id <id> --key <key> --path <relative-path> (--output <file>|--output-dir <dir>)
```

`--format text|json` 只表示 CLI 输出封装格式。`latex table` 不提供 `--table-format`，始终返回表格原始 LaTeX。所有命令继续支持 `--port`、`--token` 和 `--timeout-ms`。

`latex fetch` 是唯一会写入源码存储的命令。没有 `--refresh` 时，如果已有与清单匹配的 ready 源码则直接返回；有 `--refresh` 时重新下载。条目记录 `vN` 版本时下载该版本；没有版本时下载当前最新版，并在清单中记录实际版本。

`--main-file` 仅用于首次下载时主文件无法唯一确定，或配合 `--refresh` 重选主文件；路径必须指向下载归档内的 `.tex` 文件。Markdown 的 `--attachment-key`、`--table-format` 等现有参数继续在 Markdown 子命令下使用。

## HTTP API

API 使用来源前缀，避免把不同内容模型混在同一个 endpoint：

```text
GET  /mineru-for-zotero/search
GET  /mineru-for-zotero/markdown/read
GET  /mineru-for-zotero/markdown/table
GET  /mineru-for-zotero/markdown/image
GET  /mineru-for-zotero/latex/read
GET  /mineru-for-zotero/latex/table
GET  /mineru-for-zotero/latex/image
POST /mineru-for-zotero/latex/fetch
```

所有路由沿用现有 API 开关和 Bearer token 校验。Markdown 路由的请求参数和响应字段保持现有查询语义，但从旧 `/markdown`、`/tables`、`/image` 路径迁移到来源前缀下。LaTeX `read` 的响应保留 `item`、`source`、`granularity` 等摘要字段，并增加 `source: "latex"`、`files` 或 `mainFile` 信息；`table` 返回匹配表格的 `content`、`caption`、`file`、`lineStart` 和 `lineEnd`；`image` 返回文件 bytes 或多文件状态清单。

`fetch` 接受 `libraryID`、`key`、可选 `refresh` 和 `mainFile`，返回 arXiv ID、实际版本、文件数、主文件和存储状态。查询接口只读本地源码，不因缺少源码而隐式下载。

## arXiv ID 与下载

条目解析优先读取明确的 arXiv 元数据；同时支持从条目 URL 识别 arXiv 标识。ID 统一为旧式 `形如 hep-th/9901001` 或新式 `2301.01234`，可带 `vN`。多个来源冲突时返回 `ambiguous-arxiv-id`，不猜测。

源码使用 arXiv `/src/<id>` 或等价 e-print 下载地址。响应可能是 gzip 压缩的单文件，也可能是 gzip 后的 tar 包；下载器必须根据响应和内容识别 gzip、tar 与单个 TeX 文件。只写解压后的文件，不保存压缩包。

解压在临时目录完成，校验通过后原子替换 ready 目录。必须拒绝绝对路径、`..` 越界路径、符号链接逃逸和超过单次下载/解压大小限制的归档。失败时删除临时目录并保留旧 ready 目录。

## 存储布局

```text
mineru-copy/
  attachments/...
  tex_source/
    <libraryID>-<itemKey>/
      manifest.json
      main.tex
      sections/intro.tex
      figures/figure1.pdf
```

`manifest.json` 至少包含 `libraryID`、`itemKey`、`arxivID`、`resolvedVersion`、`downloadedAt`、`mainFile`、`fileCount`、`status` 和 `resultVersion`。目录按普通 Zotero 条目键组织，不按 PDF attachment 键组织。临时和备份目录使用可识别前缀，查询和统计时忽略它们。

## LaTeX 文档模型

下载完成后扫描 `.tex` 文件并确定主文件。优先选择包含 `\\documentclass` 和 `\\begin{document}` 的唯一文件；如果存在多个候选且无法由入口引用关系唯一确定，返回 `ambiguous-main-file`，允许 `fetch` 使用显式 `--main-file` 重新指定。解析主文件中的 `\\input` 和 `\\include`，按出现顺序建立展开文档，同时保留每段的源文件和行号。禁止跟随源码目录外的引用。

标题识别覆盖 `\\part`、`\\chapter`、`\\section`、`\\subsection`、`\\subsubsection` 和带星号变体。能静态推断的编号写入 heading；宏生成或自定义计数器无法推断时保留标题路径并省略编号。`section` 支持现有的章节号、路径和范围语义，`search` 在展开后的逻辑文本中匹配并返回源文件位置。

表格识别覆盖 `table`、`table*`、`tabular`、`tabular*`、`longtable` 等常见环境。查询匹配 `\\caption`、`\\label` 或环境内文本，结果返回完整环境代码，不做格式转换。嵌套环境使用平衡计数扫描而非单一正则。无匹配时返回 HTTP 200 和 `tables: []`。

图片识别覆盖 `\\includegraphics`，路径解析相对于引用文件目录，最终路径必须位于源码目录内。图片查询只允许 manifest 中已存在的文件。

## 错误模型

沿用现有错误封装，并增加：

- `arxiv-id-not-found`: 条目没有可识别的 arXiv ID。
- `ambiguous-arxiv-id`: 条目中的 arXiv ID 来源冲突。
- `arxiv-source-not-found`: arXiv 没有可用源码。
- `arxiv-download-failed`: 下载失败或响应格式不受支持。
- `unsafe-archive`: 归档包含越界路径、链接或其它不安全内容。
- `tex-source-not-found`: 尚未执行 fetch 或 ready 源码不存在。
- `ambiguous-main-file`: 无法唯一确定主 TeX 文件。
- `tex-file-not-found`: 显式指定的 TeX 文件不存在。
- `tex-image-not-found`: 图片不在已保存源码树中。

## 模块边界

- `src/modules/texSource/`: arXiv ID 提取、下载、归档安全检查、主文件发现、源码存储。
- `src/modules/latexQuery/`: 展开文档、标题/章节/搜索、表格和图片查询。
- `src/modules/sourceQuery/`: 共用 item 搜索、认证、响应模型和 endpoint 注册。
- `mineru-for-zotero-cli/scripts/query-source.mjs`: 新 CLI 解析、请求、文本输出和错误提示。
- `src/modules/storage.ts`: 新增独立的 tex source storage 接口；不改变现有 `attachments/` 语义。

## 测试要求

- CLI：新命令树、参数校验、text/json 输出、token 不泄露，旧命令应被拒绝。
- arXiv：新旧 ID、版本规则、URL/字段提取、无 ID、冲突 ID、单文件和 tar.gz 源码。
- 存储：原子替换、失败保留旧结果、manifest、越界路径、符号链接和大小限制。
- LaTeX：主文件唯一性、`input/include` 顺序、标题路径、章节/搜索来源位置、平衡环境表格提取、图片路径安全。
- API：来源路由、fetch 写入、缺少源码错误、认证和 API 开关。
- 回归：现有 Markdown parser、table、image、attachment resolver 和 query service 测试全部保持通过。

最终验证命令：

```powershell
node --test test/querySourceCli.test.mjs
npm run lint:check
.\\node_modules\\.bin\\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
npm run build
```
