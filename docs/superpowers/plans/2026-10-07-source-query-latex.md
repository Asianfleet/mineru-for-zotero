# Markdown 与 LaTeX 双来源查询实施计划

> **执行方式：** 当前会话内逐阶段实施；每阶段完成后记录结果。

**目标：** 用来源分层的 CLI 与 HTTP API 查询 Markdown 和 arXiv LaTeX 源码，移除旧查询入口。

**架构：** Zotero 插件负责条目解析、arXiv 下载、解压存储与本地查询；Node CLI 只调用本地 API。Markdown 复用现有查询逻辑，LaTeX 使用独立的源码存储与解析模块。

**技术栈：** TypeScript、Zotero 本地 HTTP server、Node.js CLI、Mocha/Chai 与 Node test。

## 阶段

- [x] **源码获取与存储：** 新增 arXiv ID 识别、gzip/tar 解包、`tex_source/<libraryID>-<itemKey>` 原子写入、manifest 与安全校验；新增归档和 ID 测试。
- [x] **LaTeX 查询：** 建立主文件与 `input/include` 展开、标题/章节/搜索、表格源码提取和图片读取；新增 parser 测试。
- [x] **HTTP API：** 迁移 Markdown 路由，新增 LaTeX fetch/read/table/image，沿用鉴权；新增来源 API 测试。
- [x] **CLI 与文档：** 用 `query-source.mjs` 替换旧脚本，更新 CLI skill 与 README，删除旧入口和旧路由；CLI、TypeScript、lint 已验证。

## 验收

`node --test test/querySourceCli.test.mjs`、`npm run lint:check`、`npx tsc --noEmit` 已通过。Zotero scaffold 测试和生产 build 需要本机 Zotero 运行环境，本次未能执行。
