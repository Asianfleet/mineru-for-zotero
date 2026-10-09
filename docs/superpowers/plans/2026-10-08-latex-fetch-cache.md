# LaTeX Fetch 缓存响应修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `latex fetch` 的缓存命中与首次下载返回同形状 manifest，且缓存检查不读取 TeX 正文。

**Architecture:** 存储层提供仅检查 manifest 和文件存在性的读取方法；fetch 分支调用此方法并直接返回 manifest。CLI 保持现有顶层 manifest 格式化逻辑，以端到端测试确认不再出现 `unknown`。

**Tech Stack:** TypeScript、Zotero IOUtils、Mocha/Chai、Node test。

## Global Constraints

- 缓存检查校验 ready 状态、条目身份、路径安全性及列出的 `.tex` 文件存在性。
- 不改变首次下载和 `latex read` 的正文读取行为。
- 缓存验证失败沿现有下载流程处理；不新增依赖。

---

### Task 1: 存储层轻量缓存读取

**Files:** `src/modules/texSource/storage.ts`、`test/texStorage.test.ts`

**Interfaces:** `readReadyManifest(ref): Promise<TexManifest>`；失败时抛出错误，由 fetch 现有捕获逻辑处理。

- [x] 写失败测试：保存含 `main.tex` 的缓存后，监测 `IOUtils.readUTF8` 只读取 `manifest.json`，返回值等于保存的 manifest；删除 `.tex` 后读取失败；条目身份或不安全路径不被接受。
- [x] 运行 Zotero scaffold 测试并确认新增测试因方法缺失而失败。
- [x] 实现 `readReadyManifest`，只调用 `IOUtils.readUTF8(manifestPath)` 和 `IOUtils.exists`；验证 `libraryID`、`itemKey`、`mainFile`、`files` 后返回 manifest。
- [x] 重跑测试，确认通过。实现记录：缓存命中只读 manifest 并用 `exists` 检查所列 TeX 文件。

### Task 2: Fetch 响应与 CLI 回归

**Files:** `src/modules/sourceQuery/apiEndpoint.ts`、`test/sourceApiEndpoint.test.ts`、`test/querySourceCli.test.mjs`

**Interfaces:** `fetchLatex` 缓存分支返回 `store.readReadyManifest({ libraryID, key })` 的结果；首次下载仍返回 `manifest`。

- [x] 写失败测试：缓存分支与首次下载形状一致，缓存命中不访问下载流程；CLI text 模式展示 arXiv ID、版本、主文件和文件数，且没有 `unknown`。
- [x] 运行相应测试并确认失败原因是缓存响应形状。
- [x] 修改 fetch 缓存分支，重跑测试确认通过。实现记录：缓存分支直接返回 `readReadyManifest` 的顶层 manifest；CLI 无需改动。

### Task 3: 最终验证

**Files:** 本计划文件仅记录完成情况。

- [x] 运行 `node --test test/querySourceCli.test.mjs`、完整 Zotero scaffold 测试、`npm run build`。结果：CLI 19 通过、scaffold 363 通过、build 成功。
- [x] 格式化本计划，最后一次修改后运行 `npm run lint:check`，检查最终 diff。
- [x] 使用目标论文 `NML4HPJG` 复测缓存命中响应；当前本地 API 仍由旧版 Zotero 插件提供，返回 `unknown`，需安装本次构建并重新加载插件后验证新版本。
