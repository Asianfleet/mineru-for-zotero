# Markdown Query API Usability Final Follow-up Report

日期：2026-07-16
分支：`feat/markdown-query-api-usability`
提交建议：`fix(markdown-query): tighten image and cli edge cases`

## 处理范围

本次只处理最终评审包中的两个 Minor：

1. `/mineru-for-zotero/image` 在 `path=,,,` 这类空 CSV 输入下错误返回 `200 { images: [] }`。
2. CLI help/usage 仍展示错误脚本路径 `node skill/scripts/query-markdown.mjs ...`。

## RED

先补了以下回归测试并确认失败：

- `test/queryMarkdownCli.test.mjs`
  - 断言 help 文本应包含 `node mineru-for-zotero-cli/scripts/query-markdown.mjs ...`
  - 初次运行 `node --test test/queryMarkdownCli.test.mjs` 失败，实际输出仍是旧路径。
- `test/markdownApiEndpoint.test.ts`
  - 新增 `path: ",,,"` 应返回 `400 invalid-request`
  - 初次运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 失败，实际返回 `200`。
- `test/markdownQueryService.test.ts`
  - 新增 service 层空 path 列表应抛 `invalid-request`

## 实现

### 1. Image 空路径校验

- 在 `src/modules/markdownQuery/queryService.ts`
  - 对 `splitCsv(input.path)` 结果做空列表校验。
  - 当列表为空时抛出 `MarkdownQueryError("invalid-request", 400, "Missing image path")`。

- 在 `src/modules/markdownQuery/apiEndpoint.ts`
  - 新增 `requireImagePath()`。
  - endpoint 层拒绝只包含逗号或空白的 `path`，保证即使 service 被 stub，HTTP 行为仍正确。

### 2. CLI help 路径修正

- 在 `mineru-for-zotero-cli/scripts/query-markdown.mjs`
  - 将 help/usage 中四条命令示例统一改为：
    - `node mineru-for-zotero-cli/scripts/query-markdown.mjs ...`

## 变更文件

- `src/modules/markdownQuery/queryService.ts`
- `src/modules/markdownQuery/apiEndpoint.ts`
- `test/markdownQueryService.test.ts`
- `test/markdownApiEndpoint.test.ts`
- `mineru-for-zotero-cli/scripts/query-markdown.mjs`
- `test/queryMarkdownCli.test.mjs`

## 最终验证

以下命令已在最终代码状态下全部通过：

```powershell
node --test test/queryMarkdownCli.test.mjs
npm run lint:check
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
npm run build
```

结果：

- CLI tests：12/12 通过
- Scaffold tests：341 通过，0 失败
- `npm run lint:check`：通过
- `npm run build`：通过

## 备注

- 修复保持在最终评审要求的文件责任范围内。
- 未回退或覆盖他人改动。
