# LaTeX 查询完整修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `2026-10-08-latex-query-repair-design.md` 中缓存、查询、表格、图片、CLI 和文档的全部修复。

**Architecture:** `parser.ts` 建立展开源码的位置索引及容错命令扫描；`service.ts` 实现章节与搜索契约；API 负责多图逐项结果；CLI 负责参数校验、展示和文件落盘。缓存修复已在前一实施计划中完成，保留现有改动。

**Tech Stack:** TypeScript、Zotero IOUtils、Node.js、Mocha/Chai、Node test。

## Global Constraints

- 不新增第三方解析依赖；保留原始 LaTeX 源码。
- `latex read --granularity section` 只接受精确完整路径或唯一末级标题。
- Markdown 查询及文本、JSON 输出行为保持不变。
- 每个新增函数写目的注释；中文文档按 UTF-8 编辑。

---

### Task 1: 索引、扫描器和查询服务

**Files:** `src/modules/latexQuery/parser.ts`、`src/modules/latexQuery/service.ts`、`test/latexParser.test.ts`、`test/latexQueryService.test.ts`

**Interfaces:** 展开段保持 `file`/`lineStart`；标题增加 `level`、`offset`；索引提供展开位置到原文件行号映射；搜索结果含 `file`、`line`、`hit`、`before`、`after`。

- [x] 写失败用例：同文件和跨 `input` 章节边界、标题路径歧义、空搜索、注释与嵌套参数、表格原文及上下文。
- [x] 运行 scaffold 测试，确认用例因当前行为失败。
- [x] 实现索引、容错扫描与服务查询，逐项重跑测试。实现记录：新增位置索引和独立命令扫描器；章节按展开偏移截取，搜索返回原文件行号和段落上下文。

### Task 2: API 参数与多图

**Files:** `src/modules/sourceQuery/apiEndpoint.ts`、`src/modules/texSource/storage.ts`、`test/sourceApiEndpoint.test.ts`、`test/texStorage.test.ts`

**Interfaces:** `sectionNumber` 返回 `invalid-request`；多图 `images` 按请求顺序返回 `ok`、`invalid-path`、`tex-image-not-found`、`duplicate-path`；单图错误沿用 HTTP 错误。

- [x] 写失败用例：禁止编号、搜索上下文传递、两图混合状态、重复项与目录越界。
- [x] 运行 scaffold 测试确认失败，再实现参数与多图分发。
- [x] 重跑 scaffold 测试确认通过。实现记录：多图按顺序返回逐项状态；存储层按 manifest 成员关系读取单图，并明确标记已丢失文件。

### Task 3: CLI 输出与文件导出

**Files:** `mineru-for-zotero-cli/scripts/query-source.mjs`、`test/querySourceCli.test.mjs`

**Interfaces:** LaTeX 图片 JSON 结果只含路径、状态、MIME、字节数与输出路径；部分失败保留结果且退出码为 1；Markdown 输出不变。

- [x] 写失败用例：LaTeX 非法选项、标题/搜索/表格文本、多图目录层级、部分失败和无 base64。
- [x] 运行 Node CLI 测试确认失败，再实现按来源的验证与格式化。
- [x] 重跑 Node CLI 测试确认通过。实现记录：LaTeX 文本格式独立；图片写出后只保留元数据，部分失败退出码为 1。

### Task 4: 文档与验收

**Files:** `README.md`、`README_zh.md`、`mineru-for-zotero-cli/SKILL.md`、本计划。

- [x] 更新两份 README、CLI skill、help，写明章节路径、搜索上下文、多图与错误语义。
- [x] 格式化触及的 `docs/superpowers/` 文件，运行完整 scaffold、Node CLI、`npm run build`、`npm run lint:check`。结果：scaffold 373 通过；CLI、build 与 lint 结果见本次最终验证。
- [x] 用 `NML4HPJG` 复测章节、caption 与两张图片；若运行中插件仍是旧版，记录环境限制。实现记录：真实缓存源码的只读解析复测确认 `Main Results` 起于 `acl_latex.tex:300` 且不含导言，caption 完整；两张目标 `imgs/*.pdf` 存在，大小分别为 296976 和 15472 字节。隔离测试进程无法访问用户 profile，运行中 API 仍是旧插件，图片 API 以仓库夹具验证。
- [x] 复核最终 diff 只包含规范相关文件并记录实现结果。
