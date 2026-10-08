# LaTeX 源码查询修复设计

## 背景与目标

以 Zotero 条目 `NML4HPJG`（arXiv `2505.06708`）测试 `latex` 模式时，源码下载、全文、标题、搜索、表格和单图读取可用，但章节内容截取、多图导出、部分元数据与 CLI 文本输出存在错误。现有测试通过，却未覆盖这些真实源码形态。本设计修复这些问题，并使 LaTeX 的 CLI、HTTP API、实现和文档采用同一契约。

本次只调整 LaTeX 查询与共用 CLI 对 LaTeX 响应的呈现，不改变 Markdown 查询行为、Zotero UI、源码下载或存储布局。不新增第三方 LaTeX 解析依赖。LaTeX 查询保留原始源码，不尝试宏展开、排版或语义转换。

## 文档索引与扫描边界

`src/modules/latexQuery/` 为每次读取的 ready 源码建立一次内存文档索引。索引按主文件中的 `\\input`、`\\include` 顺序展开 `.tex` 文件，记录每段的原文件路径、起始行号及展开文档中的起止偏移。已有防循环引用和目录越界约束继续生效。索引不写入 manifest，也不更改源码文件。

在索引上使用一个独立、容错的语法扫描层识别章节命令、表格环境与命令参数。扫描器跳过未转义 `%` 后的注释，处理转义字符与嵌套花括号，保留原始源码偏移；识别失败的局部内容作为普通源码保留，不使整篇文档不可查询。表格内容始终以原始偏移切片返回。扫描器与查询服务之间传递带位置的结构化记录，以便今后替换底层解析器而不改变 API。

不引入 `latex-utensils`、`unified-latex` 或 LaTeX.js：前两者需要额外依赖和 Zotero 运行时验证，后者主要用于 HTML 渲染。本次所需的是有限命令、环境和源码位置识别，增强现有扫描器足以覆盖目标，同时限制打包和回归范围。

## 章节读取契约

`latex read --granularity headings` 返回标题的命令类型、标题文本、完整标题路径、原文件和原行号，并给出由标准 `part`、`chapter`、`section`、`subsection`、`subsubsection` 推得的显示层级。带星号命令可以形成标题与路径，但不承诺排版后的章节编号。

`latex read --granularity section` 只接受 `--section-path`。路径使用 `/` 分隔，去掉各部分首尾空白后，按完整标题路径进行大小写不敏感的精确匹配；单个末级标题也可匹配，但必须在展开文档中唯一。逗号模糊片段、`--section-number`、编号列表与范围不属于 LaTeX 契约。CLI 对 LaTeX 的 `--section-number` 和 `--context-paragraphs` 在不适用的命令上明确报参数错误；HTTP API 对 `sectionNumber` 明确返回 `invalid-request`，避免忽略参数并返回误导性结果。

章节正文从命中标题的命令起始位置开始，截止于下一个同级或更高层级标题；子章节包含在父章节正文中。边界按展开顺序计算，可跨 `\\input` 文件，并保持原始 LaTeX 文本。无匹配返回 `section-not-found`；单个末级标题匹配多处返回 `ambiguous-section`，并列出候选完整路径、文件和行号供调用方重试。缺少 `--section-path` 返回 `missing-query`。全文仍按展开顺序返回，不改变原始内容。

## 搜索与表格

`latex read --granularity search` 需要非空 `--query`；空查询返回 `missing-query`。搜索按展开后的原始源码逐行匹配，返回命中行、原文件、原行号。`--context-paragraphs` 在 LaTeX 模式下按空行分隔的源码段落提供前后文，默认值与 Markdown 查询保持一致；JSON 响应明确使用 `file`、`line`、`hit`、`before`、`after`，CLI 文本输出展示文件与行号，不打印不存在的 `paragraphIndex`。

表格识别保留 `table`、`table*`、`tabular`、`tabular*` 和 `longtable` 支持。用平衡扫描提取 `\\caption` 参数，允许其中出现 `\\textbf{...}` 等嵌套命令；注释中的伪表格和伪 caption 不计入结果。返回的 `content` 仍是完整、未经改写的表格环境源码，并保留 `file`、`lineStart`、`lineEnd`。查询可命中 caption、label 或原始内容；无匹配返回 HTTP 200 与空数组。

## 图片与 CLI 输出

`latex image --path` 接受单个安全相对路径或逗号分隔的多个路径。服务端逐项验证路径及 manifest 成员关系，单图成功返回一个 `images` 记录；单图路径无效或文件不存在继续返回对应 HTTP 错误。多图请求为每个请求项按原顺序返回状态：有效文件附 MIME 与 data URL，无效路径标记 `invalid-path`，缺失文件标记 `tex-image-not-found`；一个失败项不阻止其他文件导出。空输入或仅含分隔符的输入返回 `invalid-request`。重复项标记 `duplicate-path`，不再次读取或导出，也不计为失败。

CLI 使用 `--output` 写单图，使用 `--output-dir` 写单图或多图。输出目录中的相对路径来自经过验证的归档路径；保留 `imgs/`、`logo/` 等目录层级，防止同名文件覆盖。写入完成后，text 和 JSON 输出只包含请求路径、逐项状态、MIME、字节数与实际输出路径，不回传 base64。CLI 仅在用户已提供输出目标时请求文件数据。多图中有失败项时，成功项仍写出，CLI 返回非零退出码并在 JSON 中保留逐项结果，调用方不会误以为全部成功。

LaTeX 的标题、表格和图片文本输出使用 LaTeX 专用标题与字段：标题缩进反映命令层级；搜索显示 `file:line`；表格显示原文件和起止行号，不显示 Markdown 独有的页码、rawIndex 或匹配模式。Markdown 的现有 text/JSON 输出保持不变。CLI 帮助、`mineru-for-zotero-cli/SKILL.md`、`README.md` 和 `README_zh.md` 同步写明 LaTeX 路径规则、搜索上下文、多图语义及错误行为；技能文档中的示例使用仓库内实际脚本路径。

## 组件与数据流

- `latexQuery/parser.ts`：构建带来源位置的展开索引，并提供容错命令/环境扫描；不处理 Zotero、HTTP 或磁盘读写。
- `latexQuery/service.ts`：从存储读取源码，使用索引完成标题、章节、搜索和表格查询，并执行查询参数规则。
- `sourceQuery/apiEndpoint.ts`：校验请求参数、鉴权及 LaTeX 图片列表，映射稳定 HTTP 错误；不实现语法解析。
- `texSource/storage.ts`：继续执行单路径的归档成员校验与字节读取；多图协调留在 API 层。
- `mineru-for-zotero-cli/scripts/query-source.mjs`：按来源验证选项、保存图片、生成不含二进制载荷的 text/JSON 结果。

## 验收与验证

回归测试应覆盖：同一文件中多个章节及跨 `\\input` 的截取边界；完整路径、唯一末级标题、歧义标题、未命中路径及禁止编号查询；含注释、转义和嵌套花括号的标题与 caption；搜索空查询、源码位置与上下文；单图和多图的成功、部分失败、重复路径、路径越界与输出目录层级；CLI text/JSON 中无 `undefined` 或 base64，Markdown 输出不变。

以条目 `NML4HPJG` 复测 `Main Results` 应返回该章节而非导言区；查询 `Gating variant performance` 应返回完整 caption；两张 `imgs/*.pdf` 应可一次导出。运行 `node --test test/querySourceCli.test.mjs`、完整 Zotero scaffold 测试、`npm run lint:check` 和 `npm run build`，并确认最终 diff 只包含本任务文件。
