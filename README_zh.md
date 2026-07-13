# MinerU for Zotero

[![zotero target version](https://img.shields.io/badge/Zotero-8%2F9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

<p align="center">
    <img src="assets/cover.png" alt="cover" width=100%/>
</p>

[English Document](README.md)

MinerU for Zotero 可以帮你在 Zotero 中调用 MinerU 解析 PDF attachment，并在 Zotero PDF Reader 里按版面区域复制内容。

## 可以做什么

<video src="assets/demo.mp4" controls></video>

- 从 Zotero 条目列表中解析一个或多个已选 PDF attachment。
- PDF 已有解析结果时，可以直接使用已有结果，也可以重新解析并覆盖。
- 在 Zotero PDF Reader 中显示 MinerU box。
- 支持显示全部 box、仅显示鼠标所在 box、关闭插件功能三种模式。
- 支持复制单个文本、标题、列表、表格、图片标题、引用、公式等区域。
- 按住 `Shift` 或 `Ctrl` 选择多个 box 后，可按阅读顺序合并复制。
- 未选择 box 时，可从 Reader 工具栏复制全文 Markdown。
- 可选保存 MinerU 解析结果中的图片到本地结果目录。

## 使用前准备

- Zotero 8 或 9。
- MinerU API Key。
- PDF attachment 已经在当前电脑本地可用。

## 设置

1. 在 Zotero 中安装插件。
2. 打开 `编辑` -> `设置` -> `MinerU for Zotero`。
3. 填入 MinerU API Key。
4. 可选：开启 `保存解析结果图片`，将 MinerU 结果中的图片保存到本地。

API Key 只保存在本机 Zotero 首选项中。

## 解析 PDF

1. 在 Zotero 条目列表中选择一个或多个 PDF attachment。
2. 右键点击选中项，选择 `使用 MinerU 解析 PDF`。
3. 等待 Zotero 提示 `MinerU 解析完成`。
4. 在 Zotero PDF Reader 中打开已解析的 PDF。

如果选中的 PDF 已有解析结果，插件会让你选择：

- `使用已有结果`：保留当前结果，直接在 Reader 中使用。
- `重新解析并覆盖`：重新提交 PDF，解析成功后替换旧结果。

如果覆盖过程中失败，已有的可用结果会被保留。

## 在 Reader 中复制

1. 打开已解析 PDF。
2. 点击 PDF Reader 工具栏中的 `MinerU box` 按钮。
3. 选择模式：
   - `显示全部 box`
   - `仅显示鼠标所在 box`
   - `关闭插件能力`
4. 鼠标悬停到 box 上，点击 `复制`。
5. 公式区域可选择 `带 $ 复制` 或 `不带 $ 复制`。

需要复制多个区域时，按住 `Shift` 或 `Ctrl` 点击多个 box。随后可在工具栏菜单中复制已选内容或清空选择。没有选中任何 box 时，同一个复制按钮会复制全文 Markdown。

## 本地结果

打开 `编辑` -> `设置` -> `MinerU for Zotero`，点击 `打开数据文件夹` 可以查看本地解析结果。设置页也会显示当前已有可用结果的 PDF 数量。

结果目录中包含解析出的 Markdown、Reader 使用的 box 数据，以及可选保存的图片。外部工具可以读取这些文件，但不建议手动修改。

## 本地 Markdown 查询 API

本地 Markdown 查询 API 让外部本地工具通过 Zotero 自带的本地 HTTP server 读取 MinerU for Zotero 已经保存的 Markdown 解析结果。它只查询本机已有结果，不会提交新的 MinerU 解析任务，也不会直接暴露插件数据目录。

主要能力：

- 按 Zotero 标题关键词检索候选条目和 PDF attachment。
- 通过 `libraryID + key` 读取普通条目或 PDF attachment 的 Markdown。
- 支持 `full`、`headings`、`section`、`search` 四种查询粒度，便于外部 agent 先看目录、再读取章节或关键词上下文。
- 普通条目下有多个 PDF attachment 时，可用 `attachmentKey` 精确选择目标附件。
- 优先返回精准解析 Markdown；没有精准结果但有轻量解析结果时，返回轻量 Markdown，并在响应里标记 `result.mode`。

### 配置

1. 启动 Zotero，并确保 MinerU for Zotero 插件已启用。
2. 打开 `编辑` -> `设置` -> `MinerU for Zotero`。
3. 在 `本地查询 API` 中勾选 `启用本地 Markdown 查询 API`。
4. `要求 token` 控制调用方是否必须提供 token。开启后，可以点击 `生成 token`。
5. 开启 token 校验时，调用方可以把 token 放入 `Authorization: Bearer <token>` header；API 也支持 `token=<token>` 查询参数。

Zotero 默认本地端口通常是 `23119`。如果你改过 Zotero 本地 server 端口，需要把下面示例中的端口同步替换为实际端口。

### HTTP 调用示例

按标题检索候选条目：

```shell
curl --get "http://127.0.0.1:23119/mineru-for-zotero/search" \
  --data-urlencode "libraryID=1" \
  --data-urlencode "title=retrieval augmented generation" \
  -H "Authorization: Bearer <token>"
```

读取全文 Markdown：

```shell
curl "http://127.0.0.1:23119/mineru-for-zotero/markdown?libraryID=1&key=ABCD1234" \
  -H "Authorization: Bearer <token>"
```

只读取标题层级，适合先了解文档结构：

```shell
curl "http://127.0.0.1:23119/mineru-for-zotero/markdown?libraryID=1&key=ABCD1234&granularity=headings" \
  -H "Authorization: Bearer <token>"
```

读取指定章节：

```shell
curl --get "http://127.0.0.1:23119/mineru-for-zotero/markdown" \
  --data-urlencode "libraryID=1" \
  --data-urlencode "key=ABCD1234" \
  --data-urlencode "granularity=section" \
  --data-urlencode "sectionPath=Introduction/Background" \
  -H "Authorization: Bearer <token>"
```

在 Markdown 中搜索关键词并返回前后文段落：

```shell
curl --get "http://127.0.0.1:23119/mineru-for-zotero/markdown" \
  --data-urlencode "libraryID=1" \
  --data-urlencode "key=ABCD1234" \
  --data-urlencode "granularity=search" \
  --data-urlencode "q=retrieval" \
  --data-urlencode "contextParagraphs=2" \
  -H "Authorization: Bearer <token>"
```

常用参数：

| 参数                | 端点                 | 说明                                                           |
| ------------------- | -------------------- | -------------------------------------------------------------- |
| `libraryID`         | `search`、`markdown` | Zotero library ID，个人库通常是 `1`。                          |
| `title`             | `search`             | 标题关键词，用于查找候选 Zotero 条目。                         |
| `key`               | `markdown`           | Zotero 普通条目 key 或 PDF attachment key。                    |
| `attachmentKey`     | `markdown`           | 普通条目包含多个 PDF 时指定目标 PDF attachment。               |
| `granularity`       | `markdown`           | `full`、`headings`、`section` 或 `search`，默认 `full`。       |
| `sectionPath`       | `markdown`           | `section` 查询使用的标题路径，例如 `Introduction/Background`。 |
| `q`                 | `markdown`           | `search` 查询使用的关键词。                                    |
| `contextParagraphs` | `markdown`           | `search` 命中前后的上下文段落数。                              |

常见错误码：

- `api-disabled`：设置页尚未启用本地 Markdown 查询 API。
- `invalid-token`：token 缺失或不匹配。
- `ambiguous-attachment`：普通条目下有多个 PDF，请传入 `attachmentKey`。
- `parse-result-not-found`：目标 PDF 还没有可用解析结果，请先在 Zotero 中解析。
- `section-not-found`：章节路径不匹配，先用 `granularity=headings` 查看准确路径。
- `missing-query`：`granularity=search` 时缺少 `q`。

### 配套 Skill 与 CLI

仓库内提供了配套 Skill：`mineru-for-zotero-cli/`。它面向 Codex 或其他本地 agent，封装了 HTTP 参数、token header、端口读取、错误提示和文本排版。前置条件与 HTTP API 相同：Zotero 正在运行，插件已启用本地 Markdown 查询 API；如果设置页要求 token，调用时传入 `--token <token>`。

在仓库根目录可以直接运行 CLI：

```shell
node mineru-for-zotero-cli/scripts/query-markdown.mjs search --library-id 1 --title "paper title" --token "<token>"
node mineru-for-zotero-cli/scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity headings --token "<token>"
node mineru-for-zotero-cli/scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-path "Introduction/Background" --token "<token>"
node mineru-for-zotero-cli/scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity search --query "retrieval" --context-paragraphs 2 --token "<token>"
node mineru-for-zotero-cli/scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity full --format json --token "<token>"
```

CLI 默认会尝试从 Zotero 默认 profile 读取本地 HTTP server 端口，读不到时使用 `23119`。如果需要手动指定端口，添加 `--port <number>`。默认输出 `--format text`，适合 agent 直接阅读；需要脚本处理时使用 `--format json`。

## 常见问题

### 提示未配置 API Key

进入插件设置页填写 MinerU API Key 后重试。

### 提示文件访问失败

确认 PDF 已在本地可用。对于只保存在云端或还在同步中的附件，请先在 Zotero 中打开或下载该 PDF。

### Reader 提示当前 PDF 没有可用解析结果

请先解析该 PDF。如果已经解析过，可以从设置页打开数据文件夹，确认本地结果仍然存在。

### Reader 中看不到 box

先确认工具栏模式不是 `关闭插件能力`。如果 PDF 已解析但仍看不到 box，可以重新解析。

### 结果下载失败

MinerU 结果下载可能暂时不可用。可以稍后重试，或重新解析该 PDF。

## 开发

安装依赖：

```shell
npm install
```

启动开发模式：

```shell
npm start
```

测试、检查和构建：

```shell
npm test
npm run lint:check
npm run build
```

## License

AGPL-3.0-or-later
