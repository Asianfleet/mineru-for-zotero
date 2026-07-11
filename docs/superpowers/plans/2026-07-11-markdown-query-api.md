# Markdown 查询 API 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Zotero 插件运行时内提供默认关闭的本地 Markdown 查询 HTTP API，外部调用方可以按 Zotero 条目或 PDF attachment 读取已保存的 MinerU Markdown 结果。

**Architecture:** 新增 `src/modules/markdownQuery/`，把纯 Markdown 解析、Zotero 条目/附件解析、查询服务和 Zotero HTTP endpoint 分成独立模块。API endpoint 只处理 HTTP 参数、认证与 JSON 响应，业务逻辑由 query service 组合 resolver、storage 和 parser 完成。偏好页只提供 API 开关、token 开关和 token 生成入口，最小调用示例写入 README。

**Tech Stack:** TypeScript ES modules、Zotero 8/9 runtime APIs、`Zotero.Server.Endpoints` promise-style endpoint、Fluent locale files、`zotero-plugin-scaffold` Mocha/Chai tests、Prettier/ESLint via `npm run lint:check`。

## Global Constraints

- API 默认关闭：`apiEnabled` 默认 `false`。
- token 校验默认开启：`apiRequireToken` 默认 `true`。
- token 由插件生成并保存到 `apiToken`，用户可在偏好页重新生成。
- 偏好页不展示最小调用示例，只展示状态、开关和 token 管理。
- README 文件展示最小调用示例，包含 `libraryID`、`key`、`Authorization: Bearer <token>`。
- API 只读取已有本地解析结果，不触发 MinerU 解析任务。
- 确定目标 PDF attachment 后，必须优先读取精准结果 `content.md`，没有精准结果时读取轻量结果 `lite-content.md`。
- 普通条目自动选择附件时不能因附件已有解析结果而优先选择它。
- 无法唯一确定普通条目的原始 PDF 时返回 `409 ambiguous-attachment`，响应不包含 Markdown。
- 使用 `npm` 执行项目脚本；本项目不使用 Vitest。

---

## File Structure

- Create: `src/modules/markdownQuery/types.ts`
  - 定义 API 错误、响应对象、heading、section、search match、item/attachment summary、测试可替换的 Zotero 依赖接口。
- Create: `src/modules/markdownQuery/markdownParser.ts`
  - 纯函数解析 ATX heading、章节和关键词搜索；不依赖 Zotero。
- Create: `src/modules/markdownQuery/attachmentResolver.ts`
  - 把 Zotero item key 和可选 `attachmentKey` 解析成唯一 PDF attachment，或返回可解释的候选歧义错误。
- Create: `src/modules/markdownQuery/queryService.ts`
  - 组合 Zotero item 查找、attachment resolver、storage preferred Markdown、Markdown parser，输出稳定响应对象。
- Create: `src/modules/markdownQuery/apiEndpoint.ts`
  - 注册/清理 `/mineru-for-zotero/search` 和 `/mineru-for-zotero/markdown` endpoint，处理参数、token、JSON 响应码。
- Modify: `src/utils/prefs.ts`
  - 增加 `apiEnabled`、`apiRequireToken`、`apiToken` 的默认读取、写入和 token 生成 helper。
- Modify: `src/modules/preferenceScript.ts`
  - 同步新偏好控件，生成 token，显示 token 来源与启用状态，不添加调用示例。
- Modify: `src/hooks.ts`
  - startup 注册 Markdown 查询 endpoint，shutdown 清理 endpoint。
- Modify: `addon/prefs.js`
  - 增加 API 偏好默认值。
- Modify: `addon/content/preferences.xhtml`
  - 增加“本地查询 API”偏好区域。
- Modify: `addon/locale/en-US/preferences.ftl`
  - 增加 API 查询区域英文文案。
- Modify: `addon/locale/zh-CN/preferences.ftl`
  - 增加 API 查询区域中文文案。
- Modify: `typings/prefs.d.ts`
  - 增加新偏好键类型。
- Modify: `typings/i10n.d.ts`
  - 增加新 Fluent message id。
- Modify: `README.md`
  - 在 Local Results 后增加英文最小调用示例。
- Modify: `README_zh.md`
  - 在本地结果后增加中文最小调用示例。
- Create: `test/markdownParser.test.ts`
  - 覆盖 heading、section、search 和错误语义。
- Create: `test/attachmentResolver.test.ts`
  - 用 fake Zotero items 覆盖直接 PDF、普通条目自动选择、指定 attachment、歧义和缺失。
- Create: `test/markdownQueryService.test.ts`
  - 用 fake storage 和 fake Zotero gateway 覆盖查询响应、精准优先、轻量兜底和错误码。
- Create: `test/markdownApiEndpoint.test.ts`
  - 覆盖 endpoint 注册、认证、JSON 状态码和标题检索不返回 Markdown。
- Modify: `test/preferenceScript.test.ts`
  - 覆盖偏好 UI 顺序、API 开关默认值、token 生成与控件同步。

## Task 1: Markdown Parser

**Files:**

- Create: `src/modules/markdownQuery/types.ts`
- Create: `src/modules/markdownQuery/markdownParser.ts`
- Create: `test/markdownParser.test.ts`

**Interfaces:**

- Produces:
  - `MarkdownQueryError`
  - `parseHeadings(markdown: string): MarkdownHeading[]`
  - `readSection(markdown: string, sectionPath: string[] | string): MarkdownSectionResult`
  - `searchMarkdown(markdown: string, query: string, contextParagraphs?: number): MarkdownSearchMatch[]`

- [ ] **Step 1: Write failing parser tests**

Create `test/markdownParser.test.ts`:

```ts
import { assert } from "chai";
import {
  parseHeadings,
  readSection,
  searchMarkdown,
} from "../src/modules/markdownQuery/markdownParser";
import { MarkdownQueryError } from "../src/modules/markdownQuery/types";

describe("markdownParser", function () {
  const markdown = [
    "# Example Paper",
    "",
    "Lead paragraph.",
    "",
    "## Introduction",
    "",
    "Intro body.",
    "",
    "### Background",
    "",
    "Background body mentions Retrieval.",
    "",
    "## Methods",
    "",
    "Method body mentions retrieval again.",
  ].join("\n");

  it("extracts ATX headings with paths", function () {
    assert.deepEqual(parseHeadings(markdown), [
      { level: 1, title: "Example Paper", path: ["Example Paper"], line: 0 },
      {
        level: 2,
        title: "Introduction",
        path: ["Example Paper", "Introduction"],
        line: 4,
      },
      {
        level: 3,
        title: "Background",
        path: ["Example Paper", "Introduction", "Background"],
        line: 8,
      },
      {
        level: 2,
        title: "Methods",
        path: ["Example Paper", "Methods"],
        line: 12,
      },
    ]);
  });

  it("returns a section by exact heading path", function () {
    const section = readSection(markdown, ["Example Paper", "Introduction"]);

    assert.deepEqual(section.heading.path, ["Example Paper", "Introduction"]);
    assert.equal(
      section.content,
      "## Introduction\n\nIntro body.\n\n### Background\n\nBackground body mentions Retrieval.",
    );
  });

  it("returns section-not-found for a missing section", function () {
    assert.throws(
      () => readSection(markdown, ["Example Paper", "Discussion"]),
      MarkdownQueryError,
      "section-not-found",
    );
  });

  it("searches paragraphs case-insensitively with context", function () {
    assert.deepEqual(searchMarkdown(markdown, "retrieval", 1), [
      {
        paragraphIndex: 4,
        context:
          "### Background\n\nBackground body mentions Retrieval.\n\n## Methods",
        before: ["### Background"],
        hit: "Background body mentions Retrieval.",
        after: ["## Methods"],
      },
      {
        paragraphIndex: 6,
        context: "## Methods\n\nMethod body mentions retrieval again.",
        before: ["## Methods"],
        hit: "Method body mentions retrieval again.",
        after: [],
      },
    ]);
  });

  it("rejects empty search queries", function () {
    assert.throws(
      () => searchMarkdown(markdown, "   "),
      MarkdownQueryError,
      "missing-query",
    );
  });
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep markdownParser
```

Expected: FAIL because `src/modules/markdownQuery/markdownParser.ts` does not exist.

- [ ] **Step 3: Implement parser types**

Create `src/modules/markdownQuery/types.ts` with these exported definitions:

```ts
export type MarkdownQueryErrorCode =
  | "api-disabled"
  | "invalid-token"
  | "invalid-request"
  | "item-not-found"
  | "pdf-attachment-not-found"
  | "attachment-not-found"
  | "ambiguous-attachment"
  | "parse-result-not-found"
  | "section-not-found"
  | "ambiguous-section"
  | "missing-query"
  | "internal-error";

export class MarkdownQueryError extends Error {
  constructor(
    public readonly code: MarkdownQueryErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "MarkdownQueryError";
  }
}

export interface MarkdownHeading {
  level: number;
  title: string;
  path: string[];
  line: number;
}

export interface MarkdownSectionResult {
  heading: MarkdownHeading;
  content: string;
}

export interface MarkdownSearchMatch {
  paragraphIndex: number;
  context: string;
  before: string[];
  hit: string;
  after: string[];
}
```

- [ ] **Step 4: Implement parser functions**

Create `src/modules/markdownQuery/markdownParser.ts`:

```ts
import {
  MarkdownHeading,
  MarkdownQueryError,
  MarkdownSearchMatch,
  MarkdownSectionResult,
} from "./types";

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * 解析 Markdown ATX 标题，并为每个标题生成层级路径。
 */
export function parseHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const stack: MarkdownHeading[] = [];

  markdown.split(/\r?\n/).forEach((line, index) => {
    const match = ATX_HEADING.exec(line);
    if (!match) {
      return;
    }

    const level = match[1].length;
    const title = match[2].trim();
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const heading: MarkdownHeading = {
      level,
      title,
      path: [...stack.map((item) => item.title), title],
      line: index,
    };
    headings.push(heading);
    stack.push(heading);
  });

  return headings;
}

/**
 * 根据 heading path 返回章节内容，包含章节标题行。
 */
export function readSection(
  markdown: string,
  sectionPath: string[] | string,
): MarkdownSectionResult {
  const path = normalizeSectionPath(sectionPath);
  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  const matches = headings.filter((heading) => samePath(heading.path, path));

  if (matches.length === 0) {
    throw new MarkdownQueryError(
      "section-not-found",
      404,
      "Section path was not found",
    );
  }
  if (matches.length > 1) {
    throw new MarkdownQueryError(
      "ambiguous-section",
      409,
      "Section path matched multiple headings",
      { candidates: matches },
    );
  }

  const heading = matches[0];
  const nextHeading = headings.find(
    (candidate) =>
      candidate.line > heading.line && candidate.level <= heading.level,
  );
  const endLine = nextHeading?.line ?? lines.length;

  return {
    heading,
    content: lines.slice(heading.line, endLine).join("\n").trimEnd(),
  };
}

/**
 * 按空行分隔段落，返回包含前后上下文的关键词命中。
 */
export function searchMarkdown(
  markdown: string,
  query: string,
  contextParagraphs = 1,
): MarkdownSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    throw new MarkdownQueryError("missing-query", 400, "Search query is empty");
  }

  const contextSize = Math.max(0, Math.floor(contextParagraphs));
  const paragraphs = markdown
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph, index) => {
    if (!paragraph.toLowerCase().includes(normalizedQuery)) {
      return [];
    }
    const before = paragraphs.slice(Math.max(0, index - contextSize), index);
    const after = paragraphs.slice(index + 1, index + 1 + contextSize);
    return [
      {
        paragraphIndex: index,
        context: [...before, paragraph, ...after].join("\n\n"),
        before,
        hit: paragraph,
        after,
      },
    ];
  });
}

function normalizeSectionPath(path: string[] | string): string[] {
  if (Array.isArray(path)) {
    return path.map((part) => part.trim()).filter(Boolean);
  }
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function samePath(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((part, i) => part === right[i])
  );
}
```

- [ ] **Step 5: Run parser tests and commit**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep markdownParser
```

Expected: PASS for `markdownParser`.

Commit:

```bash
git add src/modules/markdownQuery/types.ts src/modules/markdownQuery/markdownParser.ts test/markdownParser.test.ts
git commit -m "feat(markdown-query): add markdown parser"
```

## Task 2: Attachment Resolver

**Files:**

- Modify: `src/modules/markdownQuery/types.ts`
- Create: `src/modules/markdownQuery/attachmentResolver.ts`
- Create: `test/attachmentResolver.test.ts`

**Interfaces:**

- Consumes:
  - `MarkdownQueryError` from Task 1.
- Produces:
  - `ZoteroItemLike`
  - `AttachmentCandidate`
  - `ResolvedAttachment`
  - `resolveAttachment(input): Promise<ResolvedAttachment>`

- [ ] **Step 1: Extend shared types**

Add to `src/modules/markdownQuery/types.ts`:

```ts
export interface ZoteroItemLike {
  id: number;
  key: string;
  libraryID: number;
  dateAdded?: string;
  attachmentFilename?: string;
  parentItemID?: number | false;
  isRegularItem(): boolean;
  isPDFAttachment(): boolean;
  getDisplayTitle(): string;
  getField(field: string): string;
  getAttachments(includeTrashed?: boolean): number[];
  getBestAttachments(): Promise<ZoteroItemLike[]>;
}

export interface ZoteroItemsGateway {
  getAsync(ids: number[]): Promise<ZoteroItemLike[]>;
  getByLibraryAndKeyAsync(
    libraryID: number,
    key: string,
  ): Promise<ZoteroItemLike | false>;
}

export interface AttachmentCandidate {
  itemID: number;
  libraryID: number;
  key: string;
  fileName: string;
  preciseReady: boolean;
  liteReady: boolean;
  score: number;
  reasons: string[];
}

export interface ResolvedAttachment {
  item: ZoteroItemLike;
  attachment: ZoteroItemLike;
  candidates?: AttachmentCandidate[];
}

export interface ParseStatusReader {
  readParseStatus(ref: {
    libraryID: number;
    key: string;
  }): Promise<{ preciseReady: boolean; liteReady: boolean }>;
}
```

- [ ] **Step 2: Write failing resolver tests**

Create `test/attachmentResolver.test.ts`:

```ts
import { assert } from "chai";
import { resolveAttachment } from "../src/modules/markdownQuery/attachmentResolver";
import {
  MarkdownQueryError,
  ZoteroItemLike,
  ZoteroItemsGateway,
} from "../src/modules/markdownQuery/types";

describe("attachmentResolver", function () {
  it("resolves a PDF attachment key directly", async function () {
    const pdf = fakeItem({ id: 1, key: "PDF1", pdf: true });
    const result = await resolveAttachment({
      libraryID: 1,
      key: "PDF1",
      items: fakeItems([pdf]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "PDF1");
  });

  it("selects the only PDF attachment under a regular item", async function () {
    const pdf = fakeItem({ id: 2, key: "PDF2", pdf: true });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2],
      bestAttachments: [pdf],
      title: "Example Paper",
    });
    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      items: fakeItems([parent, pdf]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "PDF2");
  });

  it("prefers the original PDF over derived annotated files", async function () {
    const original = fakeItem({
      id: 2,
      key: "ORIG",
      pdf: true,
      fileName: "example-paper.pdf",
    });
    const annotated = fakeItem({
      id: 3,
      key: "ANN",
      pdf: true,
      fileName: "example-paper-annotated.pdf",
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [original, annotated],
      title: "Example Paper",
    });

    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      items: fakeItems([parent, original, annotated]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "ORIG");
  });

  it("returns ambiguous-attachment when candidates tie", async function () {
    const a = fakeItem({ id: 2, key: "PDFA", pdf: true, fileName: "a.pdf" });
    const b = fakeItem({ id: 3, key: "PDFB", pdf: true, fileName: "b.pdf" });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [a, b],
      title: "Unrelated Title",
    });

    await assertRejectsCode(
      () =>
        resolveAttachment({
          libraryID: 1,
          key: "ITEM1",
          items: fakeItems([parent, a, b]),
          storage: fakeStatus(),
        }),
      "ambiguous-attachment",
    );
  });

  it("uses attachmentKey to select a child PDF exactly", async function () {
    const a = fakeItem({ id: 2, key: "PDFA", pdf: true });
    const b = fakeItem({ id: 3, key: "PDFB", pdf: true });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [a, b],
    });

    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      attachmentKey: "PDFB",
      items: fakeItems([parent, a, b]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "PDFB");
  });
});
```

Append these helpers in the same test file:

```ts
function fakeItem(input: {
  id: number;
  key: string;
  regular?: boolean;
  pdf?: boolean;
  title?: string;
  fileName?: string;
  attachments?: number[];
  bestAttachments?: ZoteroItemLike[];
}): ZoteroItemLike {
  return {
    id: input.id,
    key: input.key,
    libraryID: 1,
    dateAdded: `2026-01-${String(input.id).padStart(2, "0")} 00:00:00`,
    attachmentFilename: input.fileName ?? `${input.key}.pdf`,
    isRegularItem: () => Boolean(input.regular),
    isPDFAttachment: () => Boolean(input.pdf),
    getDisplayTitle: () => input.title ?? input.fileName ?? input.key,
    getField: (field) => (field === "title" ? (input.title ?? "") : ""),
    getAttachments: () => input.attachments ?? [],
    getBestAttachments: async () => input.bestAttachments ?? [],
  };
}

function fakeItems(items: ZoteroItemLike[]): ZoteroItemsGateway {
  return {
    async getAsync(ids) {
      return ids.map((id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`missing fake item ${id}`);
        return item;
      });
    },
    async getByLibraryAndKeyAsync(libraryID, key) {
      return (
        items.find(
          (item) => item.libraryID === libraryID && item.key === key,
        ) ?? false
      );
    },
  };
}

function fakeStatus() {
  return {
    async readParseStatus() {
      return { preciseReady: false, liteReady: false };
    },
  };
}

async function assertRejectsCode(
  callback: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    assert.instanceOf(error, MarkdownQueryError);
    assert.equal((error as MarkdownQueryError).code, code);
    return;
  }
  assert.fail(`Expected ${code}`);
}
```

- [ ] **Step 3: Run resolver tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep attachmentResolver
```

Expected: FAIL because `attachmentResolver.ts` does not exist.

- [ ] **Step 4: Implement resolver**

Create `src/modules/markdownQuery/attachmentResolver.ts` with these exported functions:

```ts
import {
  AttachmentCandidate,
  MarkdownQueryError,
  ParseStatusReader,
  ResolvedAttachment,
  ZoteroItemsGateway,
  ZoteroItemLike,
} from "./types";

const DERIVED_NAME_PATTERN =
  /(annotated|annotation|annotations|highlight|highlights|note|notes|translated|translation|copy|edited|批注|注释|高亮|笔记|翻译|译文|副本|修改)/i;

export async function resolveAttachment(input: {
  libraryID: number;
  key: string;
  attachmentKey?: string;
  items: ZoteroItemsGateway;
  storage: ParseStatusReader;
}): Promise<ResolvedAttachment> {
  const item = await input.items.getByLibraryAndKeyAsync(
    input.libraryID,
    input.key,
  );
  if (!item) {
    throw new MarkdownQueryError("item-not-found", 404, "Item was not found");
  }

  if (item.isPDFAttachment()) {
    return { item, attachment: item };
  }
  if (!item.isRegularItem()) {
    throw new MarkdownQueryError(
      "pdf-attachment-not-found",
      404,
      "Item is not a regular item or PDF attachment",
    );
  }

  const attachments = (
    await input.items.getAsync(item.getAttachments(false))
  ).filter((candidate) => candidate.isPDFAttachment());

  if (attachments.length === 0) {
    throw new MarkdownQueryError(
      "pdf-attachment-not-found",
      404,
      "Regular item has no PDF attachments",
    );
  }

  if (input.attachmentKey) {
    const attachment = attachments.find(
      (candidate) => candidate.key === input.attachmentKey,
    );
    if (!attachment) {
      throw new MarkdownQueryError(
        "attachment-not-found",
        404,
        "Attachment key does not belong to the regular item",
      );
    }
    return { item, attachment };
  }

  const candidates = await scoreCandidates(item, attachments, input.storage);
  const topScore = Math.max(...candidates.map((candidate) => candidate.score));
  const winners = candidates.filter(
    (candidate) => candidate.score === topScore,
  );
  if (winners.length !== 1) {
    throw new MarkdownQueryError(
      "ambiguous-attachment",
      409,
      "Multiple PDF attachments may be the original paper. Specify attachmentKey to fetch one.",
      { candidates },
    );
  }

  const attachment = attachments.find(
    (candidate) => candidate.key === winners[0].key,
  );
  if (!attachment) {
    throw new MarkdownQueryError(
      "internal-error",
      500,
      "Selected attachment disappeared",
    );
  }

  return { item, attachment, candidates };
}

async function scoreCandidates(
  parent: ZoteroItemLike,
  attachments: ZoteroItemLike[],
  storage: ParseStatusReader,
): Promise<AttachmentCandidate[]> {
  const bestAttachments = await parent.getBestAttachments();
  const parentTitle = parent.getDisplayTitle() || parent.getField("title");

  return Promise.all(
    attachments.map(async (attachment) => {
      const reasons: string[] = [];
      let score = 100;
      const bestIndex = bestAttachments.findIndex(
        (candidate) => candidate.key === attachment.key,
      );
      if (bestIndex >= 0) {
        score += Math.max(0, 30 - bestIndex);
        reasons.push(`best-attachment-order:${bestIndex}`);
      }

      const fileName = getAttachmentFileName(attachment);
      if (
        DERIVED_NAME_PATTERN.test(`${fileName} ${attachment.getDisplayTitle()}`)
      ) {
        score -= 40;
        reasons.push("derived-name");
      }

      const similarity = titleSimilarity(parentTitle, fileName);
      if (similarity > 0) {
        score += similarity;
        reasons.push("title-similarity");
      }

      if (attachment.dateAdded) {
        score -= Math.min(10, Date.parse(attachment.dateAdded) / 10 ** 13);
        reasons.push(`date-added:${attachment.dateAdded}`);
      }

      const status = await storage.readParseStatus({
        libraryID: attachment.libraryID,
        key: attachment.key,
      });

      return {
        itemID: attachment.id,
        libraryID: attachment.libraryID,
        key: attachment.key,
        fileName,
        preciseReady: status.preciseReady,
        liteReady: status.liteReady,
        score: Math.round(score),
        reasons,
      };
    }),
  );
}

function getAttachmentFileName(attachment: ZoteroItemLike): string {
  return attachment.attachmentFilename || attachment.getDisplayTitle();
}

function titleSimilarity(title: string, fileName: string): number {
  const titleTokens = tokenize(title);
  const fileTokens = tokenize(fileName.replace(/\.pdf$/i, ""));
  if (titleTokens.length === 0 || fileTokens.length === 0) {
    return 0;
  }
  const overlap = titleTokens.filter((token) =>
    fileTokens.includes(token),
  ).length;
  return Math.round((overlap / titleTokens.length) * 20);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 2);
}
```

- [ ] **Step 5: Run resolver tests and commit**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep attachmentResolver
```

Expected: PASS for `attachmentResolver`.

Commit:

```bash
git add src/modules/markdownQuery/types.ts src/modules/markdownQuery/attachmentResolver.ts test/attachmentResolver.test.ts
git commit -m "feat(markdown-query): resolve zotero pdf attachments"
```

## Task 3: Query Service

**Files:**

- Modify: `src/modules/markdownQuery/types.ts`
- Create: `src/modules/markdownQuery/queryService.ts`
- Create: `test/markdownQueryService.test.ts`

**Interfaces:**

- Consumes:
  - `resolveAttachment()` from Task 2.
  - `parseHeadings()`, `readSection()`, `searchMarkdown()` from Task 1.
  - `StorageAdapter.readPreferredMarkdown()` and `StorageAdapter.readParseStatus()`.
- Produces:
  - `createMarkdownQueryService(deps)`
  - `MarkdownQueryService.searchByTitle(input)`
  - `MarkdownQueryService.queryMarkdown(input)`

- [ ] **Step 1: Extend response types**

Add to `src/modules/markdownQuery/types.ts`:

```ts
export type MarkdownGranularity = "full" | "headings" | "section" | "search";

export interface ItemSummary {
  itemID: number;
  libraryID: number;
  key: string;
  type: "regular" | "attachment";
  title: string;
}

export interface AttachmentSummary {
  itemID: number;
  libraryID: number;
  key: string;
  fileName: string;
  preciseReady?: boolean;
  liteReady?: boolean;
}
```

- [ ] **Step 2: Write failing query service tests**

Create `test/markdownQueryService.test.ts` with tests for:

```ts
import { assert } from "chai";
import { createMarkdownQueryService } from "../src/modules/markdownQuery/queryService";
import { MarkdownQueryError } from "../src/modules/markdownQuery/types";

describe("markdownQueryService", function () {
  it("returns full markdown after resolving an attachment", async function () {
    const service = createMarkdownQueryService(fakeDeps("# Precise"));

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.include(JSON.stringify(response), "# Precise");
  });

  it("uses preferred markdown so lite-only results can be returned", async function () {
    const service = createMarkdownQueryService(fakeDeps("# Lite"));

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.include(JSON.stringify(response), "# Lite");
  });

  it("returns heading granularity", async function () {
    const service = createMarkdownQueryService(fakeDeps("# A\n\n## B"));
    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "headings",
    });

    assert.deepInclude(response, { granularity: "headings" });
    assert.include(JSON.stringify(response), '"title":"B"');
  });

  it("maps missing markdown to parse-result-not-found", async function () {
    const service = createMarkdownQueryService(
      fakeDeps("# Missing", async () => {
        throw new Error("not found");
      }),
    );

    await assertRejectsCode(
      () => service.queryMarkdown({ libraryID: 1, key: "PDF1" }),
      "parse-result-not-found",
    );
  });
});
```

Add fake helpers in the same file, reusing the fake item shape from Task 2.

- [ ] **Step 3: Run service tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep markdownQueryService
```

Expected: FAIL because `queryService.ts` does not exist.

- [ ] **Step 4: Implement query service**

Create `src/modules/markdownQuery/queryService.ts`:

```ts
import { resolveAttachment } from "./attachmentResolver";
import { parseHeadings, readSection, searchMarkdown } from "./markdownParser";
import {
  AttachmentSummary,
  MarkdownGranularity,
  MarkdownQueryError,
  ParseStatusReader,
  ZoteroItemsGateway,
  ZoteroItemLike,
} from "./types";

export interface PreferredMarkdownReader extends ParseStatusReader {
  readPreferredMarkdown(ref: {
    libraryID: number;
    key: string;
  }): Promise<string>;
}

export interface MarkdownQueryService {
  searchByTitle(input: { libraryID: number; title: string }): Promise<unknown>;
  queryMarkdown(input: {
    libraryID: number;
    key: string;
    attachmentKey?: string;
    granularity?: MarkdownGranularity;
    sectionPath?: string[] | string;
    q?: string;
    contextParagraphs?: number;
  }): Promise<unknown>;
}

export function createMarkdownQueryService(deps: {
  items: ZoteroItemsGateway;
  storage: PreferredMarkdownReader;
  searchItemsByTitle(input: {
    libraryID: number;
    title: string;
  }): Promise<ZoteroItemLike[]>;
}): MarkdownQueryService {
  return {
    async searchByTitle(input) {
      if (!input.title.trim()) {
        throw new MarkdownQueryError("invalid-request", 400, "Missing title");
      }
      const items = await deps.searchItemsByTitle(input);
      return {
        candidates: await Promise.all(
          items.map(async (item) => ({
            item: summarizeItem(item),
            attachments: item.isRegularItem()
              ? await summarizeAttachments(item, deps.items, deps.storage)
              : item.isPDFAttachment()
                ? [await summarizeAttachment(item, deps.storage)]
                : [],
          })),
        ),
      };
    },

    async queryMarkdown(input) {
      const resolved = await resolveAttachment({
        libraryID: input.libraryID,
        key: input.key,
        attachmentKey: input.attachmentKey,
        items: deps.items,
        storage: deps.storage,
      });
      let markdown: string;
      try {
        markdown = await deps.storage.readPreferredMarkdown({
          libraryID: resolved.attachment.libraryID,
          key: resolved.attachment.key,
        });
      } catch {
        throw new MarkdownQueryError(
          "parse-result-not-found",
          404,
          "Target PDF has no available parse result",
        );
      }

      const base = {
        item: summarizeItem(resolved.item),
        attachment: await summarizeAttachment(
          resolved.attachment,
          deps.storage,
        ),
        result: { source: "preferred" },
      };
      const granularity = input.granularity ?? "full";

      if (granularity === "full") {
        return { ...base, granularity, content: markdown };
      }
      if (granularity === "headings") {
        return { ...base, granularity, headings: parseHeadings(markdown) };
      }
      if (granularity === "section") {
        const section = readSection(markdown, input.sectionPath ?? []);
        return { ...base, granularity, ...section };
      }
      if (granularity === "search") {
        return {
          ...base,
          granularity,
          query: input.q ?? "",
          matches: searchMarkdown(
            markdown,
            input.q ?? "",
            input.contextParagraphs,
          ),
        };
      }
      throw new MarkdownQueryError(
        "invalid-request",
        400,
        "Invalid granularity",
      );
    },
  };
}

function summarizeItem(item: ZoteroItemLike) {
  return {
    itemID: item.id,
    libraryID: item.libraryID,
    key: item.key,
    type: item.isPDFAttachment() ? "attachment" : "regular",
    title: item.getDisplayTitle() || item.getField("title"),
  };
}

async function summarizeAttachments(
  item: ZoteroItemLike,
  items: ZoteroItemsGateway,
  storage: ParseStatusReader,
): Promise<AttachmentSummary[]> {
  const attachments = (await items.getAsync(item.getAttachments(false))).filter(
    (candidate) => candidate.isPDFAttachment(),
  );
  return Promise.all(
    attachments.map((attachment) => summarizeAttachment(attachment, storage)),
  );
}

async function summarizeAttachment(
  attachment: ZoteroItemLike,
  storage: ParseStatusReader,
): Promise<AttachmentSummary> {
  const status = await storage.readParseStatus({
    libraryID: attachment.libraryID,
    key: attachment.key,
  });
  return {
    itemID: attachment.id,
    libraryID: attachment.libraryID,
    key: attachment.key,
    fileName: attachment.attachmentFilename || attachment.getDisplayTitle(),
    preciseReady: status.preciseReady,
    liteReady: status.liteReady,
  };
}
```

- [ ] **Step 5: Run service tests and commit**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep markdownQueryService
```

Expected: PASS for `markdownQueryService`.

Commit:

```bash
git add src/modules/markdownQuery/queryService.ts test/markdownQueryService.test.ts src/modules/markdownQuery/types.ts
git commit -m "feat(markdown-query): add query service"
```

## Task 4: API Preferences and Settings UI

**Files:**

- Modify: `addon/prefs.js`
- Modify: `src/utils/prefs.ts`
- Modify: `addon/content/preferences.xhtml`
- Modify: `src/modules/preferenceScript.ts`
- Modify: `addon/locale/en-US/preferences.ftl`
- Modify: `addon/locale/zh-CN/preferences.ftl`
- Modify: `typings/prefs.d.ts`
- Modify: `typings/i10n.d.ts`
- Modify: `test/preferenceScript.test.ts`

**Interfaces:**

- Produces:
  - `getMarkdownApiEnabled(): boolean`
  - `setMarkdownApiEnabled(value: boolean): void`
  - `getMarkdownApiRequireToken(): boolean`
  - `setMarkdownApiRequireToken(value: boolean): void`
  - `getMarkdownApiToken(): string`
  - `setMarkdownApiToken(value: string): void`
  - `generateMarkdownApiToken(): string`

- [ ] **Step 1: Write failing preference tests**

Extend `test/preferenceScript.test.ts`:

```ts
import {
  generateMarkdownApiToken,
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
} from "../src/utils/prefs";

it("defaults the markdown query API to disabled with token required", function () {
  assert.isFalse(getMarkdownApiEnabled());
  assert.isTrue(getMarkdownApiRequireToken());
  assert.equal(getMarkdownApiToken(), "");
});

it("generates and persists a markdown query API token", function () {
  try {
    const token = generateMarkdownApiToken();
    assert.match(token, /^[A-Za-z0-9_-]{32,}$/);
    setMarkdownApiToken(token);
    assert.equal(getMarkdownApiToken(), token);
  } finally {
    setMarkdownApiToken("");
  }
});

it("shows local query API controls without a request example", async function () {
  const preferences = await fetchPreferencePanelMarkup();

  assertIncreasingIndexes(preferences, [
    'data-l10n-id="mineruForZotero-pref-query-api-title"',
    'id="zotero-prefpane-mineruForZotero-api-enabled"',
    'id="zotero-prefpane-mineruForZotero-api-require-token"',
    'id="mineruForZotero-api-regenerate-token"',
  ]);
  assert.notInclude(preferences, "Authorization: Bearer");
});

it("persists markdown query API checkbox changes immediately", function () {
  const enabled = fakePreferenceElement("false", "", "checkbox");
  const requireToken = fakePreferenceElement("true", "", "checkbox");
  const document = fakePreferenceDocument({
    "zotero-prefpane-mineruForZotero-api-enabled": enabled,
    "zotero-prefpane-mineruForZotero-api-require-token": requireToken,
  });

  try {
    setMarkdownApiEnabled(false);
    setMarkdownApiRequireToken(true);
    registerPreferenceValueSync(document);

    enabled.checked = true;
    enabled.emit("command");
    requireToken.checked = false;
    requireToken.emit("command");

    assert.isTrue(getMarkdownApiEnabled());
    assert.isFalse(getMarkdownApiRequireToken());
  } finally {
    setMarkdownApiEnabled(false);
    setMarkdownApiRequireToken(true);
  }
});
```

- [ ] **Step 2: Run preference tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep preferenceScript
```

Expected: FAIL because new prefs helpers and UI ids do not exist.

- [ ] **Step 3: Add default prefs and types**

Add to `addon/prefs.js`:

```js
pref("__prefsPrefix__.apiEnabled", false);
pref("__prefsPrefix__.apiRequireToken", true);
pref("__prefsPrefix__.apiToken", "");
```

Add to `typings/prefs.d.ts`:

```ts
"apiEnabled": boolean;
"apiRequireToken": boolean;
"apiToken": string;
```

- [ ] **Step 4: Add prefs helpers**

Modify `src/utils/prefs.ts`:

```ts
export function getMarkdownApiEnabled(): boolean {
  return getPref("apiEnabled") === true;
}

export function setMarkdownApiEnabled(value: boolean) {
  return setPref("apiEnabled", value);
}

export function getMarkdownApiRequireToken(): boolean {
  return getPref("apiRequireToken") !== false;
}

export function setMarkdownApiRequireToken(value: boolean) {
  return setPref("apiRequireToken", value);
}

export function getMarkdownApiToken(): string {
  const value = getPref("apiToken");
  return typeof value === "string" ? value : "";
}

export function setMarkdownApiToken(value: string) {
  return setPref("apiToken", value);
}

export function generateMarkdownApiToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToUrlToken(bytes);
}

function bytesToUrlToken(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
```

- [ ] **Step 5: Add settings UI without examples**

Add a new `vbox` section in `addon/content/preferences.xhtml` after the parse mode controls and before data storage:

```xml
<vbox>
  <label>
    <html:h2 data-l10n-id="pref-query-api-title"></html:h2>
  </label>
  <checkbox
    id="zotero-prefpane-__addonRef__-api-enabled"
    data-l10n-id="pref-query-api-enabled"
    native="true"
    preference="apiEnabled"
  />
  <checkbox
    id="zotero-prefpane-__addonRef__-api-require-token"
    data-l10n-id="pref-query-api-require-token"
    native="true"
    preference="apiRequireToken"
  />
  <hbox align="center" style="gap: 6px">
    <html:button
      id="__addonRef__-api-regenerate-token"
      data-l10n-id="pref-query-api-regenerate-token"
    ></html:button>
    <html:span id="__addonRef__-api-token-status"></html:span>
  </hbox>
  <html:div data-l10n-id="pref-query-api-help"></html:div>
</vbox>
```

- [ ] **Step 6: Add UI behavior**

Modify imports and `registerPreferenceValueSync()` in `src/modules/preferenceScript.ts` to register the two checkboxes:

```ts
registerCheckboxPreferenceSync(
  document,
  `zotero-prefpane-${config.addonRef}-api-enabled`,
  getMarkdownApiEnabled,
  setMarkdownApiEnabled,
);
registerCheckboxPreferenceSync(
  document,
  `zotero-prefpane-${config.addonRef}-api-require-token`,
  getMarkdownApiRequireToken,
  setMarkdownApiRequireToken,
);
```

In `registerPrefsScripts()`, wire the regenerate button:

```ts
updateMarkdownApiTokenStatus(_window);
document
  .getElementById(`${config.addonRef}-api-regenerate-token`)
  ?.addEventListener("click", () => {
    setMarkdownApiToken(generateMarkdownApiToken());
    void updateMarkdownApiTokenStatus(_window);
  });
```

Add helper:

```ts
async function updateMarkdownApiTokenStatus(_window: Window): Promise<void> {
  const hasToken = Boolean(getMarkdownApiToken());
  setText(
    _window.document,
    `${config.addonRef}-api-token-status`,
    await formatL10n(
      _window,
      hasToken ? "pref-query-api-token-ready" : "pref-query-api-token-empty",
    ),
  );
}
```

Extend `formatL10n()` fallback with English fallback strings for the two token status ids.

- [ ] **Step 7: Add locale keys and i10n types**

Add to `addon/locale/en-US/preferences.ftl`:

```ftl
pref-query-api-title = Local Query API
pref-query-api-enabled =
    .label = Enable local Markdown query API
pref-query-api-require-token =
    .label = Require token
pref-query-api-regenerate-token = Generate token
pref-query-api-token-ready = Token generated
pref-query-api-token-empty = No token generated
pref-query-api-help = The token is generated here. Request examples are documented in the README.
```

Add to `addon/locale/zh-CN/preferences.ftl`:

```ftl
pref-query-api-title = 本地查询 API
pref-query-api-enabled =
    .label = 启用本地 Markdown 查询 API
pref-query-api-require-token =
    .label = 要求 token
pref-query-api-regenerate-token = 生成 token
pref-query-api-token-ready = token 已生成
pref-query-api-token-empty = 尚未生成 token
pref-query-api-help = token 在这里生成。调用示例见 README。
```

Add each `pref-query-api-*` id to `typings/i10n.d.ts`.

- [ ] **Step 8: Run preference tests and commit**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep preferenceScript
```

Expected: PASS for `preferenceScript`.

Commit:

```bash
git add addon/prefs.js src/utils/prefs.ts addon/content/preferences.xhtml src/modules/preferenceScript.ts addon/locale/en-US/preferences.ftl addon/locale/zh-CN/preferences.ftl typings/prefs.d.ts typings/i10n.d.ts test/preferenceScript.test.ts
git commit -m "feat(markdown-query): add api preferences"
```

## Task 5: HTTP API Endpoint and Lifecycle

**Files:**

- Create: `src/modules/markdownQuery/apiEndpoint.ts`
- Modify: `src/hooks.ts`
- Create: `test/markdownApiEndpoint.test.ts`

**Interfaces:**

- Consumes:
  - `createMarkdownQueryService()` from Task 3.
  - API prefs helpers from Task 4.
  - `Zotero.Server.Endpoints` promise-style endpoint from `zotero-types`.
- Produces:
  - `registerMarkdownQueryApiEndpoint(): void`
  - `unregisterMarkdownQueryApiEndpoint(): void`
  - `createMarkdownQueryEndpoint(deps): typeof Zotero.Server.Endpoint`

- [ ] **Step 1: Write failing endpoint tests**

Create `test/markdownApiEndpoint.test.ts`:

```ts
import { assert } from "chai";
import {
  createMarkdownQueryEndpoint,
  MARKDOWN_ENDPOINT_PATHS,
} from "../src/modules/markdownQuery/apiEndpoint";
import {
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
} from "../src/utils/prefs";

describe("markdownApiEndpoint", function () {
  afterEach(function () {
    setMarkdownApiEnabled(false);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("");
  });

  it("returns api-disabled when the API is off", async function () {
    setMarkdownApiEnabled(false);
    const endpoint = createMarkdownQueryEndpoint(fakeService());
    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown"),
    );

    assert.deepEqual(response, [
      403,
      "application/json",
      JSON.stringify({
        error: "api-disabled",
        message: "Markdown query API is disabled",
      }),
    ]);
  });

  it("rejects missing tokens when token auth is required", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("secret");
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown"),
    );

    assert.include(String(response[2]), "invalid-token");
  });

  it("accepts bearer tokens", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("secret");
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown", {
        headers: { authorization: "Bearer secret" },
        query: { libraryID: "1", key: "PDF1" },
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), "# Body");
  });

  it("registers the expected endpoint paths", function () {
    assert.deepEqual(MARKDOWN_ENDPOINT_PATHS, [
      "/mineru-for-zotero/search",
      "/mineru-for-zotero/markdown",
    ]);
  });
});
```

Add helpers in the same file:

```ts
function fakeService() {
  return {
    async searchByTitle() {
      return { candidates: [] };
    },
    async queryMarkdown() {
      return { granularity: "full", content: "# Body" };
    },
  };
}

function request(
  pathname: string,
  overrides: Partial<{
    method: "GET" | "POST";
    query: Record<string, string>;
    headers: Record<string, string>;
  }> = {},
) {
  return {
    method: overrides.method ?? "GET",
    pathname,
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    data: undefined,
  };
}
```

- [ ] **Step 2: Run endpoint tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep markdownApiEndpoint
```

Expected: FAIL because `apiEndpoint.ts` does not exist.

- [ ] **Step 3: Implement endpoint**

Create `src/modules/markdownQuery/apiEndpoint.ts`:

```ts
import {
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
} from "../../utils/prefs";
import { createStorage } from "../storage";
import { getMinerUStorageRoot } from "../preferenceScript";
import {
  createMarkdownQueryService,
  MarkdownQueryService,
} from "./queryService";
import { MarkdownQueryError, ZoteroItemLike } from "./types";

export const MARKDOWN_ENDPOINT_PATHS = [
  "/mineru-for-zotero/search",
  "/mineru-for-zotero/markdown",
] as const;

export function registerMarkdownQueryApiEndpoint(): void {
  const service = createMarkdownQueryService({
    items: Zotero.Items,
    storage: createStorage(getMinerUStorageRoot()),
    searchItemsByTitle,
  });
  const endpoint = createMarkdownQueryEndpoint(service);
  for (const path of MARKDOWN_ENDPOINT_PATHS) {
    Zotero.Server.Endpoints[path] = endpoint;
  }
}

export function unregisterMarkdownQueryApiEndpoint(): void {
  for (const path of MARKDOWN_ENDPOINT_PATHS) {
    delete Zotero.Server.Endpoints[path];
  }
}

export function createMarkdownQueryEndpoint(service: MarkdownQueryService) {
  return {
    supportedMethods: ["GET"],
    async init(options: {
      method: "GET" | "POST";
      pathname: string;
      query: Record<string, string>;
      headers: Record<string, string>;
    }) {
      try {
        authorize(options.query, options.headers);
        const payload =
          options.pathname === "/mineru-for-zotero/search"
            ? await service.searchByTitle({
                libraryID: requireInteger(options.query.libraryID, "libraryID"),
                title: requireString(options.query.title, "title"),
              })
            : await service.queryMarkdown({
                libraryID: requireInteger(options.query.libraryID, "libraryID"),
                key: requireString(options.query.key, "key"),
                attachmentKey: options.query.attachmentKey,
                granularity: options.query.granularity as never,
                sectionPath: options.query.sectionPath,
                q: options.query.q,
                contextParagraphs: parseOptionalInteger(
                  options.query.contextParagraphs,
                ),
              });
        return json(200, payload);
      } catch (error) {
        return jsonError(error);
      }
    },
  };
}

async function searchItemsByTitle(input: {
  libraryID: number;
  title: string;
}): Promise<ZoteroItemLike[]> {
  const search = new Zotero.Search();
  search.libraryID = input.libraryID;
  search.addCondition("title", "contains", input.title);
  const ids = await search.search();
  return Zotero.Items.getAsync(ids);
}

function authorize(
  query: Record<string, string>,
  headers: Record<string, string>,
): void {
  if (!getMarkdownApiEnabled()) {
    throw new MarkdownQueryError(
      "api-disabled",
      403,
      "Markdown query API is disabled",
    );
  }
  if (!getMarkdownApiRequireToken()) {
    return;
  }
  const expected = getMarkdownApiToken();
  const provided = getBearerToken(headers) || query.token || "";
  if (!expected || provided !== expected) {
    throw new MarkdownQueryError("invalid-token", 403, "Invalid API token");
  }
}

function getBearerToken(headers: Record<string, string>): string {
  const header = headers.authorization ?? headers.Authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? "";
}

function requireString(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Missing required parameter: ${name}`,
    );
  }
  return value.trim();
}

function requireInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Invalid integer parameter: ${name}`,
    );
  }
  return parsed;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function json(code: number, payload: unknown) {
  return [code, "application/json", JSON.stringify(payload)] as const;
}

function jsonError(error: unknown) {
  if (error instanceof MarkdownQueryError) {
    return json(error.status, {
      error: error.code,
      message: error.message,
      ...(typeof error.details === "object" && error.details
        ? (error.details as Record<string, unknown>)
        : {}),
    });
  }
  return json(500, {
    error: "internal-error",
    message: error instanceof Error ? error.message : "Unexpected error",
  });
}
```

- [ ] **Step 4: Register lifecycle hooks**

Modify `src/hooks.ts` imports:

```ts
import {
  registerMarkdownQueryApiEndpoint,
  unregisterMarkdownQueryApiEndpoint,
} from "./modules/markdownQuery/apiEndpoint";
```

Call after locale/preference setup in `onStartup()`:

```ts
registerMarkdownQueryApiEndpoint();
```

Call in `onShutdown()` before deleting addon object:

```ts
unregisterMarkdownQueryApiEndpoint();
```

- [ ] **Step 5: Run endpoint tests and commit**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep markdownApiEndpoint
```

Expected: PASS for `markdownApiEndpoint`.

Commit:

```bash
git add src/modules/markdownQuery/apiEndpoint.ts src/hooks.ts test/markdownApiEndpoint.test.ts
git commit -m "feat(markdown-query): expose local http endpoint"
```

## Task 6: README Examples and Full Coverage Pass

**Files:**

- Modify: `README.md`
- Modify: `README_zh.md`

**Interfaces:**

- Consumes:
  - Public API path `/mineru-for-zotero/markdown`
  - README requirement from the spec.
- Produces:
  - User-facing minimal call examples outside Zotero preferences.

- [ ] **Step 1: Add English README example**

Insert after `## Local Results` in `README.md`:

````md
## Local Markdown Query API

The local Markdown query API is disabled by default. Enable it from `Edit` -> `Settings` -> `MinerU for Zotero`, generate a token, and use the token in requests.

Minimal example:

```shell
curl "http://127.0.0.1:23119/mineru-for-zotero/markdown?libraryID=1&key=ABCD1234" \
  -H "Authorization: Bearer <token>"
```

Use `attachmentKey=<PDF attachment key>` when a regular Zotero item has multiple PDF attachments and you want to select one explicitly. The API reads existing local parse results only. It returns precise Markdown first and falls back to lite Markdown when precise results are unavailable.
````

- [ ] **Step 2: Add Chinese README example**

Insert after `## 本地结果` in `README_zh.md`:

````md
## 本地 Markdown 查询 API

本地 Markdown 查询 API 默认关闭。可以在 `编辑` -> `设置` -> `MinerU for Zotero` 中启用，并生成 token。token 来自 Zotero 偏好页。

最小调用示例：

```shell
curl "http://127.0.0.1:23119/mineru-for-zotero/markdown?libraryID=1&key=ABCD1234" \
  -H "Authorization: Bearer <token>"
```

普通 Zotero 条目有多个 PDF attachment 时，可以传入 `attachmentKey=<PDF attachment key>` 精确选择附件。API 只读取已有本地解析结果；有精准 Markdown 时优先返回精准结果，没有时返回轻量 Markdown。
````

- [ ] **Step 3: Run focused test groups**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "markdownParser|attachmentResolver|markdownQueryService|markdownApiEndpoint|preferenceScript"
```

Expected: PASS for the five focused groups.

- [ ] **Step 4: Run full scaffold tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: all scaffold tests pass.

- [ ] **Step 5: Commit docs and coverage fixes**

Commit:

```bash
git add README.md README_zh.md test src addon typings
git commit -m "docs(markdown-query): document local api usage"
```

## Task 7: Final Verification

**Files:**

- No new files.
- Verify all files touched by Tasks 1-6.

**Interfaces:**

- Consumes:
  - All implementation from Tasks 1-6.
- Produces:
  - Final verified branch state ready for review.

- [ ] **Step 1: Format generated superpowers docs if they changed**

Run:

```powershell
npx prettier --write docs/superpowers/plans/2026-07-11-markdown-query-api.md docs/superpowers/specs/2026-07-11-markdown-query-api-design.md
```

Expected: Prettier completes without errors.

- [ ] **Step 2: Run lint gate**

Run:

```powershell
npm run lint:check
```

Expected: Prettier check and ESLint both pass.

- [ ] **Step 3: Run full tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: all scaffold tests pass and Zotero exits automatically.

- [ ] **Step 4: Run production build**

Run:

```powershell
npm run build
```

Expected: `zotero-plugin build` and `tsc --noEmit` both pass.

- [ ] **Step 5: Inspect final diff**

Run:

```powershell
git status --short
git diff -- src/modules/markdownQuery src/utils/prefs.ts src/modules/preferenceScript.ts src/hooks.ts addon/prefs.js addon/content/preferences.xhtml addon/locale/en-US/preferences.ftl addon/locale/zh-CN/preferences.ftl typings/prefs.d.ts typings/i10n.d.ts README.md README_zh.md test
```

Expected: diff contains only Markdown query API implementation, preferences, docs, and tests.

## Self-Review

- Spec coverage: Tasks 1-6 cover API preferences, token auth, title search, Markdown query granularities, attachment resolution, precise-first/lite-fallback storage reads, README examples, lifecycle registration, locale and typings.
- Endpoint API basis: Task 5 uses the promise-style `Zotero.Server.Endpoint.init(options)` shape confirmed from `zotero-types/types/xpcom/server.d.ts`.
- Dependency scope: no new runtime dependency is introduced.
- Storage scope: existing `storage.readPreferredMarkdown()` and `readParseStatus()` are reused; storage directory layout is unchanged.
- README placement: examples are in `README.md` and `README_zh.md`, not in `preferences.xhtml`.
- Verification commands: final commands use `npm`, matching current repository rules.
