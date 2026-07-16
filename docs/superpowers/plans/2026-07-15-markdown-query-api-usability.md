# Markdown Query API Usability Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the local Markdown Query API and bundled CLI so agents can query grouped sections, fetch tables, and retrieve MinerU images with low friction.

**Architecture:** Extend the existing `markdownQuery` module boundaries instead of creating a new API layer. Keep pure Markdown parsing in `markdownParser.ts`, compose Zotero/storage access in `queryService.ts`, expose HTTP routes in `apiEndpoint.ts`, and keep CLI formatting in `query-markdown.mjs`.

**Tech Stack:** TypeScript ES modules, Zotero `Server.Endpoints`, Node ESM CLI, Mocha/Chai scaffold tests, Node built-in test runner for CLI tests.

## Global Constraints

- HTTP API and CLI are both stable interfaces for this upgrade.
- `granularity=section` is a breaking change and always returns `groups`.
- `sectionNumber` supports single values, comma groups, and hyphen ranges such as `5.1`, `5.1,5.2`, `5.1-5.4`, and `5.1,5.3-5.5`.
- `sectionPath` supports comma groups and fuzzy matching without a full root title path.
- Section group failures return HTTP 200 with group-level `status`, except invalid request parameters return HTTP 400.
- Tables are fetched through `/mineru-for-zotero/tables`; section queries do not format tables.
- Images are fetched through `/mineru-for-zotero/image`; single image requests return bytes, multiple image requests return JSON statuses.
- `mineru-for-zotero-cli/SKILL.md` Workflows must stay split by scenario, not rewritten as one long end-to-end flow.
- Use `npm` for package scripts in this repository.
- For generated or agent-maintained Markdown under `docs/superpowers/`, run Prettier on touched files before final lint verification.

---

## File Structure

- Modify `src/modules/markdownQuery/types.ts`: add section group, table query, image query, and image read result types.
- Modify `src/modules/markdownQuery/markdownParser.ts`: add pure section query parsing, section number extraction, fuzzy path matching, image link extraction, and table extraction helpers.
- Modify `src/modules/markdownQuery/queryService.ts`: return grouped section results, add `queryTables()` and `readImages()` service methods.
- Modify `src/modules/markdownQuery/apiEndpoint.ts`: register `/mineru-for-zotero/tables` and `/mineru-for-zotero/image`, parse new query parameters, and return bytes for single-image success.
- Modify `src/modules/storage.ts`: add a read-only image bytes method with mime metadata for the image endpoint.
- Modify `src/modules/copyFormatter.ts`: export the existing table text format conversion helper already used by reader overlay.
- Modify `mineru-for-zotero-cli/scripts/query-markdown.mjs`: add `table` and `image` commands, section flags, and grouped section text formatting.
- Modify `mineru-for-zotero-cli/SKILL.md`: update CLI reference and add separate workflows for sections, tables, and images.
- Modify `README.md` and `README_zh.md`: document the section breaking change and new endpoints briefly.
- Update tests in `test/markdownParser.test.ts`, `test/markdownQueryService.test.ts`, `test/markdownApiEndpoint.test.ts`, `test/storage.test.ts`, and `test/queryMarkdownCli.test.mjs`.

---

### Task 1: Grouped Section Parser

**Files:**

- Modify: `src/modules/markdownQuery/types.ts`
- Modify: `src/modules/markdownQuery/markdownParser.ts`
- Test: `test/markdownParser.test.ts`

**Interfaces:**

- Produces:
  - `MarkdownHeading.number?: string`
  - `MarkdownSectionQueryKind = "section-number" | "section-number-range" | "section-path"`
  - `MarkdownSectionGroupStatus = "ok" | "not-found" | "ambiguous" | "invalid-range"`
  - `readSectionGroups(markdown: string, input: { sectionNumber?: string; sectionPath?: string }): MarkdownSectionGroup[]`
  - `extractMarkdownImageLinks(markdown: string): string[]`
  - `extractMarkdownTables(markdown: string): MarkdownTableSource[]`
- Consumes: existing `parseHeadings()`, `readSection()`, and `MarkdownQueryError`.

- [ ] **Step 1: Write failing parser tests**

Add these cases to `test/markdownParser.test.ts`:

```ts
it("returns grouped sections by section number and range", function () {
  const groupedMarkdown = [
    "# Paper",
    "",
    "## 5.1 Experiment Settings",
    "",
    "Settings body.",
    "",
    "## 5.2 Results",
    "",
    "Results body.",
    "",
    "## 5.3 Analysis",
    "",
    "Analysis body.",
  ].join("\n");

  const groups = readSectionGroups(groupedMarkdown, {
    sectionNumber: "5.1,5.2-5.3",
  });

  assert.deepEqual(
    groups.map((group) => ({
      query: group.query,
      kind: group.kind,
      status: group.status,
      titles: group.matches.map((match) => match.heading.title),
    })),
    [
      {
        query: "5.1",
        kind: "section-number",
        status: "ok",
        titles: ["5.1 Experiment Settings"],
      },
      {
        query: "5.2-5.3",
        kind: "section-number-range",
        status: "ok",
        titles: ["5.2 Results", "5.3 Analysis"],
      },
    ],
  );
});

it("returns grouped fuzzy section path matches", function () {
  const groups = readSectionGroups(markdown, {
    sectionPath: "background,methods",
  });

  assert.deepEqual(
    groups.map((group) => ({
      query: group.query,
      status: group.status,
      titles: group.matches.map((match) => match.heading.title),
    })),
    [
      { query: "background", status: "ok", titles: ["Background"] },
      { query: "methods", status: "ok", titles: ["Methods"] },
    ],
  );
});

it("reports missing, ambiguous, and invalid section groups", function () {
  const duplicateMarkdown = [
    "# Paper",
    "",
    "## 5.1 Setup",
    "",
    "A",
    "",
    "## 5.1 Setup Again",
    "",
    "B",
  ].join("\n");

  const groups = readSectionGroups(duplicateMarkdown, {
    sectionNumber: "5.1,5.1-6.2,9.9",
  });

  assert.deepEqual(
    groups.map((group) => ({
      query: group.query,
      status: group.status,
      candidates: group.candidates?.length ?? 0,
    })),
    [
      { query: "5.1", status: "ambiguous", candidates: 2 },
      { query: "5.1-6.2", status: "invalid-range", candidates: 0 },
      { query: "9.9", status: "not-found", candidates: 0 },
    ],
  );
});

it("extracts markdown image links from section content", function () {
  assert.deepEqual(
    extractMarkdownImageLinks("![Figure](images/a.jpg)\n\n![](images/b.png)"),
    ["images/a.jpg", "images/b.png"],
  );
});
```

Update the import at the top:

```ts
import {
  extractMarkdownImageLinks,
  parseHeadings,
  readSection,
  readSectionGroups,
  searchMarkdown,
} from "../src/modules/markdownQuery/markdownParser";
```

- [ ] **Step 2: Run parser tests and verify failure**

Run:

```powershell
npm test -- --grep markdownParser
```

Expected: FAIL because `readSectionGroups` and `extractMarkdownImageLinks` do not exist.

- [ ] **Step 3: Add section group types**

Add to `src/modules/markdownQuery/types.ts`:

```ts
export type MarkdownSectionQueryKind =
  | "section-number"
  | "section-number-range"
  | "section-path";

export type MarkdownSectionGroupStatus =
  | "ok"
  | "not-found"
  | "ambiguous"
  | "invalid-range";

export interface MarkdownSectionMatch extends MarkdownSectionResult {
  images: string[];
}

export interface MarkdownSectionGroup {
  query: string;
  kind: MarkdownSectionQueryKind;
  status: MarkdownSectionGroupStatus;
  matches: MarkdownSectionMatch[];
  candidates?: MarkdownHeading[];
  warnings?: string[];
}

export interface MarkdownTableSource {
  rawIndex?: number;
  page?: number;
  caption?: string;
  html?: string;
  markdown?: string;
  tsv?: string;
  latex?: string;
  text: string;
}
```

Change `MarkdownHeading`:

```ts
export interface MarkdownHeading {
  level: number;
  title: string;
  path: string[];
  line: number;
  number?: string;
}
```

- [ ] **Step 4: Implement pure parser helpers**

In `src/modules/markdownQuery/markdownParser.ts`, update imports:

```ts
import {
  MarkdownHeading,
  MarkdownQueryError,
  MarkdownSearchMatch,
  MarkdownSectionGroup,
  MarkdownSectionMatch,
  MarkdownSectionResult,
  MarkdownTableSource,
} from "./types";
```

Add number extraction in `parseHeadings()`:

```ts
const heading: MarkdownHeading = {
  level,
  title,
  path: [...stack.map((item) => item.title), title],
  line: index,
  number: extractHeadingNumber(title),
};
```

Add these exported helpers below `readSection()`:

```ts
/** 根据章节号或模糊路径表达式返回分组 section。 */
export function readSectionGroups(
  markdown: string,
  input: { sectionNumber?: string; sectionPath?: string },
): MarkdownSectionGroup[] {
  if (input.sectionNumber?.trim() && input.sectionPath?.trim()) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      "sectionNumber and sectionPath cannot be used together",
    );
  }

  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  if (input.sectionNumber?.trim()) {
    return splitQueryGroups(input.sectionNumber).map((query) =>
      readSectionNumberGroup(lines, headings, query),
    );
  }
  return splitQueryGroups(input.sectionPath ?? "").map((query) =>
    readSectionPathGroup(lines, headings, query),
  );
}

/** 提取 Markdown 图片链接中的相对 path，保持原始顺序并去重。 */
export function extractMarkdownImageLinks(markdown: string): string[] {
  const paths: string[] = [];
  for (const match of markdown.matchAll(
    /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const path = match[1].trim();
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

/** 从 Markdown 中提取裸 HTML table，供 lite 结果降级查询使用。 */
export function extractMarkdownTables(markdown: string): MarkdownTableSource[] {
  return [...markdown.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(
    (match, index) => ({
      rawIndex: index,
      html: match[0],
      text: normalizeSearchText(match[0]),
    }),
  );
}
```

Add private helpers:

```ts
function splitQueryGroups(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readSectionNumberGroup(
  lines: string[],
  headings: MarkdownHeading[],
  query: string,
): MarkdownSectionGroup {
  if (query.includes("-")) {
    return readSectionNumberRangeGroup(lines, headings, query);
  }

  const matches = headings.filter((heading) => heading.number === query);
  if (matches.length === 0) {
    return emptyGroup(query, "section-number", "not-found");
  }
  if (matches.length > 1) {
    return {
      ...emptyGroup(query, "section-number", "ambiguous"),
      candidates: matches,
    };
  }
  return okGroup(query, "section-number", [
    sectionMatchForHeading(lines, headings, matches[0]),
  ]);
}

function readSectionNumberRangeGroup(
  lines: string[],
  headings: MarkdownHeading[],
  query: string,
): MarkdownSectionGroup {
  const [start, end, extra] = query.split("-").map((part) => part.trim());
  if (
    !start ||
    !end ||
    extra ||
    mainSectionNumber(start) !== mainSectionNumber(end)
  ) {
    return emptyGroup(query, "section-number-range", "invalid-range");
  }

  const startMatches = headings.filter((heading) => heading.number === start);
  const endMatches = headings.filter((heading) => heading.number === end);
  if (startMatches.length !== 1 || endMatches.length !== 1) {
    return emptyGroup(query, "section-number-range", "not-found");
  }

  const startLine = startMatches[0].line;
  const endLine = endMatches[0].line;
  if (startLine > endLine) {
    return emptyGroup(query, "section-number-range", "invalid-range");
  }

  return okGroup(
    query,
    "section-number-range",
    headings
      .filter(
        (heading) =>
          heading.number &&
          mainSectionNumber(heading.number) === mainSectionNumber(start) &&
          heading.line >= startLine &&
          heading.line <= endLine,
      )
      .map((heading) => sectionMatchForHeading(lines, headings, heading)),
  );
}

function readSectionPathGroup(
  lines: string[],
  headings: MarkdownHeading[],
  query: string,
): MarkdownSectionGroup {
  const normalizedQuery = normalizeSearchText(query);
  const matches = headings.filter((heading) =>
    normalizeSearchText(heading.path.join(" / ")).includes(normalizedQuery),
  );
  if (matches.length === 0) {
    return emptyGroup(query, "section-path", "not-found");
  }
  if (matches.length > 1) {
    return {
      ...emptyGroup(query, "section-path", "ambiguous"),
      candidates: matches,
    };
  }
  return okGroup(query, "section-path", [
    sectionMatchForHeading(lines, headings, matches[0]),
  ]);
}

function sectionMatchForHeading(
  lines: string[],
  headings: MarkdownHeading[],
  heading: MarkdownHeading,
): MarkdownSectionMatch {
  const nextHeading = headings.find(
    (candidate) =>
      candidate.line > heading.line && candidate.level <= heading.level,
  );
  const endLine = nextHeading?.line ?? lines.length;
  const content = lines.slice(heading.line, endLine).join("\n").trimEnd();
  return {
    heading,
    content,
    images: extractMarkdownImageLinks(content),
  };
}

function okGroup(
  query: string,
  kind: MarkdownSectionGroup["kind"],
  matches: MarkdownSectionMatch[],
): MarkdownSectionGroup {
  return { query, kind, status: "ok", matches, warnings: [] };
}

function emptyGroup(
  query: string,
  kind: MarkdownSectionGroup["kind"],
  status: MarkdownSectionGroup["status"],
): MarkdownSectionGroup {
  return { query, kind, status, matches: [], warnings: [] };
}

function extractHeadingNumber(title: string): string | undefined {
  return /^([A-Z]?(?:\d+|[A-Z])(?:\.\d+)*)(?:\.|\s)/i
    .exec(title.trim())?.[1]
    ?.replace(/\.$/, "");
}

function mainSectionNumber(value: string): string {
  return value.split(".")[0].toUpperCase();
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 5: Run parser tests and commit**

Run:

```powershell
npm test -- --grep markdownParser
```

Expected: PASS.

Commit:

```bash
git add src/modules/markdownQuery/types.ts src/modules/markdownQuery/markdownParser.ts test/markdownParser.test.ts
git commit -m "feat(markdown-query): add grouped section parser"
```

---

### Task 2: Grouped Section Service and Endpoint

**Files:**

- Modify: `src/modules/markdownQuery/queryService.ts`
- Modify: `src/modules/markdownQuery/apiEndpoint.ts`
- Test: `test/markdownQueryService.test.ts`
- Test: `test/markdownApiEndpoint.test.ts`

**Interfaces:**

- Consumes: `readSectionGroups()` and `MarkdownSectionGroup` from Task 1.
- Produces:
  - `MarkdownQueryService.queryMarkdown(input)` accepts `sectionNumber?: string`.
  - `/mineru-for-zotero/markdown` parses `sectionNumber`.
  - Section results return `{ granularity: "section", groups: MarkdownSectionGroup[] }`.

- [ ] **Step 1: Write failing service and endpoint tests**

Add to `test/markdownQueryService.test.ts`:

```ts
it("returns grouped section results", async function () {
  const service = createMarkdownQueryService(
    fakeDeps({
      markdown: "# Doc\n\n## 5.1 Setup\n\nAlpha\n\n## 5.2 Results\n\nBeta",
    }),
  );

  const response = await service.queryMarkdown({
    libraryID: 1,
    key: "PDF1",
    granularity: "section",
    sectionNumber: "5.1,5.2",
  });

  assert.deepInclude(response, { granularity: "section" });
  assert.nestedPropertyVal(response, "groups[0].query", "5.1");
  assert.nestedPropertyVal(
    response,
    "groups[0].matches[0].heading.title",
    "5.1 Setup",
  );
  assert.nestedPropertyVal(response, "groups[1].query", "5.2");
});
```

Add to `test/markdownApiEndpoint.test.ts`:

```ts
it("passes sectionNumber to markdown queries", async function () {
  setMarkdownApiEnabled(true);
  setMarkdownApiRequireToken(false);
  let received: unknown;
  const endpoint = createMarkdownQueryEndpoint({
    async searchByTitle() {
      return { candidates: [] };
    },
    async queryMarkdown(input) {
      received = input;
      return { granularity: "section", groups: [] };
    },
  });

  const response = await endpoint.init(
    request("/mineru-for-zotero/markdown", {
      query: {
        libraryID: "1",
        key: "PDF1",
        granularity: "section",
        sectionNumber: "5.1,5.2",
      },
    }),
  );

  assert.equal(response[0], 200);
  assert.deepInclude(received as Record<string, unknown>, {
    sectionNumber: "5.1,5.2",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- --grep "markdownQueryService|markdownApiEndpoint"
```

Expected: FAIL because `sectionNumber` is not accepted and section still returns the old shape.

- [ ] **Step 3: Update query service**

In `src/modules/markdownQuery/queryService.ts`, update imports:

```ts
import {
  parseHeadings,
  readSectionGroups,
  searchMarkdown,
} from "./markdownParser";
```

Extend `queryMarkdown(input)`:

```ts
sectionNumber?: string;
```

Replace the `section` branch:

```ts
if (granularity === "section") {
  const groups = readSectionGroups(markdown, {
    sectionNumber: input.sectionNumber,
    sectionPath: input.sectionPath,
  });
  return { ...base, granularity, groups };
}
```

- [ ] **Step 4: Update endpoint parameter parsing**

In `src/modules/markdownQuery/apiEndpoint.ts`, pass `sectionNumber`:

```ts
sectionNumber: optionalString(query.sectionNumber),
```

Keep `sectionPath: parseSectionPath(query.sectionPath)` for now so old JSON array input still reaches the service. If both `sectionNumber` and `sectionPath` are present, `readSectionGroups()` throws `invalid-request`.

- [ ] **Step 5: Run tests and commit**

Run:

```powershell
npm test -- --grep "markdownQueryService|markdownApiEndpoint"
```

Expected: PASS.

Commit:

```bash
git add src/modules/markdownQuery/queryService.ts src/modules/markdownQuery/apiEndpoint.ts test/markdownQueryService.test.ts test/markdownApiEndpoint.test.ts
git commit -m "feat(markdown-query): return grouped section results"
```

---

### Task 3: Table Query Endpoint

**Files:**

- Modify: `src/modules/markdownQuery/types.ts`
- Modify: `src/modules/markdownQuery/queryService.ts`
- Modify: `src/modules/markdownQuery/apiEndpoint.ts`
- Modify: `src/modules/copyFormatter.ts`
- Test: `test/markdownQueryService.test.ts`
- Test: `test/markdownApiEndpoint.test.ts`

**Interfaces:**

- Consumes: `storage.readBoxes()`, `extractMarkdownTables()`, and `formatTableBoxForCopy()`.
- Produces:
  - `MarkdownQueryService.queryTables(input): Promise<unknown>`
  - `GET /mineru-for-zotero/tables`
  - `MARKDOWN_ENDPOINT_PATHS` includes `/mineru-for-zotero/tables`.

- [ ] **Step 1: Write failing table service test**

Add to `test/markdownQueryService.test.ts` by extending `fakeDeps()` storage with optional `boxes`.

```ts
it("queries tables by caption or content", async function () {
  const service = createMarkdownQueryService(
    fakeDeps({
      markdown:
        "# Doc\n\nTable 2: Dataset statistics\n\n<table><tr><td>WikiTable</td></tr></table>",
      boxes: [
        {
          rawIndex: 7,
          page: 3,
          type: "table",
          bbox: { x: 0, y: 0, width: 10, height: 10 },
          markdown: "",
          formula: null,
          tableFormats: {
            html: "<table><tr><td>WikiTable</td></tr></table>",
          },
        },
      ],
    }),
  );

  const response = await service.queryTables({
    libraryID: 1,
    key: "PDF1",
    q: "WikiTable",
    match: "both",
    tableFormat: "markdown",
  });

  assert.nestedPropertyVal(response, "tables[0].rawIndex", 7);
  assert.include(
    String(
      (response as { tables: Array<{ content: string }> }).tables[0].content,
    ),
    "WikiTable",
  );
});
```

Add this storage method in `fakeDeps()`:

```ts
async readBoxes() {
  return input.boxes ?? [];
}
```

- [ ] **Step 2: Write failing endpoint registration test**

Add to `test/markdownApiEndpoint.test.ts`:

```ts
it("registers the tables endpoint path", function () {
  assert.include(MARKDOWN_ENDPOINT_PATHS, "/mineru-for-zotero/tables");
});
```

Extend `fakeService()`:

```ts
async queryTables() {
  return { tables: [] };
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npm test -- --grep "queries tables|tables endpoint"
```

Expected: FAIL because `queryTables` and the endpoint path do not exist.

- [ ] **Step 4: Export table format helper**

`formatTableBoxForCopy()` is already exported from `src/modules/copyFormatter.ts`. Do not duplicate conversion logic. If a needed helper is private, add a named export in the same file and cover it through existing `copyFormatter.test.ts`.

- [ ] **Step 5: Add table service method**

In `src/modules/markdownQuery/queryService.ts`, extend `PreferredMarkdownReader`:

```ts
readBoxes(ref: { libraryID: number; key: string }): Promise<NormalizedBox[]>;
```

Import:

```ts
import { formatTableBoxForCopy } from "../copyFormatter";
import type { NormalizedBox, TableCopyTextFormat } from "../domain";
```

Add to `MarkdownQueryService`:

```ts
queryTables(input: {
  libraryID: number;
  key: string;
  attachmentKey?: string;
  q: string;
  match?: "caption" | "content" | "both";
  tableFormat?: TableCopyTextFormat | "json";
}): Promise<unknown>;
```

Implement inside the returned service object:

```ts
async queryTables(input) {
  const resolved = await resolveAttachment({
    libraryID: input.libraryID,
    key: input.key,
    attachmentKey: input.attachmentKey,
    items: deps.items,
    storage: deps.storage,
  });
  const query = input.q.trim();
  if (!query) {
    throw new MarkdownQueryError("missing-query", 400, "missing-query");
  }

  const parseStatus = await deps.storage.readParseStatus({
    libraryID: resolved.attachment.libraryID,
    key: resolved.attachment.key,
  });
  const markdown = await deps.storage.readPreferredMarkdown({
    libraryID: resolved.attachment.libraryID,
    key: resolved.attachment.key,
  });
  const boxes = await readBoxesOrEmpty(deps.storage, resolved.attachment);
  const tableFormat = input.tableFormat ?? "html";
  const match = input.match ?? "both";
  const tables = buildTableResults({
    boxes,
    markdown,
    query,
    match,
    tableFormat,
  });

  return {
    item: summarizeItem(resolved.item),
    attachment: summarizeAttachmentPayload(resolved.attachment, parseStatus),
    result: {
      mode: parseStatus.preciseReady ? "precise" : ("lite" as const),
      source: "preferred" as const,
    },
    query,
    match,
    tableFormat,
    tables,
  };
}
```

Add helper functions in the same file:

```ts
async function readBoxesOrEmpty(
  storage: PreferredMarkdownReader,
  attachment: ZoteroItemLike,
): Promise<NormalizedBox[]> {
  try {
    return await storage.readBoxes({
      libraryID: attachment.libraryID,
      key: attachment.key,
    });
  } catch {
    return [];
  }
}

function buildTableResults(input: {
  boxes: NormalizedBox[];
  markdown: string;
  query: string;
  match: "caption" | "content" | "both";
  tableFormat: TableCopyTextFormat | "json";
}) {
  const normalizedQuery = normalizeTableSearchText(input.query);
  const boxTables = input.boxes
    .filter((box) => ["table", "table_body"].includes(box.type.toLowerCase()))
    .map((box) => tableResultFromBox(box, input.tableFormat));
  const markdownTables = extractMarkdownTables(input.markdown).map((table) => ({
    rawIndex: table.rawIndex,
    content: table.html ?? table.text,
    formats: { html: table.html },
  }));

  return [...boxTables, ...markdownTables].filter((table) =>
    tableMatches(table, normalizedQuery, input.match),
  );
}
```

Use existing local helper names for `tableResultFromBox()`, `normalizeTableSearchText()`, and `tableMatches()`. Each helper must include a docstring comment because it is a new function.

- [ ] **Step 6: Update endpoint**

In `src/modules/markdownQuery/apiEndpoint.ts`, add path:

```ts
"/mineru-for-zotero/tables",
```

Route it before the markdown fallback:

```ts
if (options.pathname === "/mineru-for-zotero/tables") {
  return json(
    200,
    await service.queryTables({
      libraryID: requireInteger(query.libraryID, "libraryID"),
      key: requireString(query.key, "key"),
      attachmentKey: optionalString(query.attachmentKey),
      q: requireString(query.q, "q"),
      match: parseTableMatch(query.match),
      tableFormat: parseTableFormat(query.tableFormat),
    }),
  );
}
```

Add parsers:

```ts
function parseTableMatch(value: string | undefined) {
  const text = optionalString(value);
  if (!text) return undefined;
  if (["caption", "content", "both"].includes(text))
    return text as "caption" | "content" | "both";
  throw new MarkdownQueryError("invalid-request", 400, "Invalid table match");
}

function parseTableFormat(value: string | undefined) {
  const text = optionalString(value);
  if (!text) return undefined;
  if (["html", "markdown", "tsv", "latex", "json"].includes(text)) {
    return text as "html" | "markdown" | "tsv" | "latex" | "json";
  }
  throw new MarkdownQueryError("invalid-request", 400, "Invalid table format");
}
```

- [ ] **Step 7: Run tests and commit**

Run:

```powershell
npm test -- --grep "markdownQueryService|markdownApiEndpoint"
```

Expected: PASS.

Commit:

```bash
git add src/modules/markdownQuery/types.ts src/modules/markdownQuery/queryService.ts src/modules/markdownQuery/apiEndpoint.ts src/modules/copyFormatter.ts test/markdownQueryService.test.ts test/markdownApiEndpoint.test.ts
git commit -m "feat(markdown-query): add table query endpoint"
```

---

### Task 4: Image Endpoint and Storage Bytes Reader

**Files:**

- Modify: `src/modules/domain.ts`
- Modify: `src/modules/storage.ts`
- Modify: `src/modules/markdownQuery/types.ts`
- Modify: `src/modules/markdownQuery/queryService.ts`
- Modify: `src/modules/markdownQuery/apiEndpoint.ts`
- Test: `test/storage.test.ts`
- Test: `test/markdownQueryService.test.ts`
- Test: `test/markdownApiEndpoint.test.ts`

**Interfaces:**

- Produces:
  - `StorageAdapter.readImage(ref, imageMarkdownPath): Promise<MinerUImageReadResult | null>`
  - `MarkdownQueryService.readImages(input): Promise<MarkdownImageQueryResult>`
  - `GET /mineru-for-zotero/image`

- [ ] **Step 1: Write failing storage test**

Add to `test/storage.test.ts`:

```ts
it("reads MinerU image bytes with mime type", async function () {
  const { storage, attachment } = await createStorageFixture();
  await storage.writeResult({
    attachment,
    mineruTaskID: "task-image-bytes",
    rawResult: {},
    markdown: "![A](images/a.jpg)",
    boxes: [],
    images: [{ path: "a.jpg", bytes: new Uint8Array([1, 2, 3]) }],
  });

  const image = await storage.readImage(attachment, "images/a.jpg");

  assert.deepEqual(Array.from(image?.bytes ?? []), [1, 2, 3]);
  assert.equal(image?.mime, "image/jpeg");
  assert.isNull(await storage.readImage(attachment, "../a.jpg"));
});
```

- [ ] **Step 2: Write failing endpoint tests**

Add to `test/markdownApiEndpoint.test.ts`:

```ts
it("returns image bytes for a single image request", async function () {
  setMarkdownApiEnabled(true);
  setMarkdownApiRequireToken(false);
  const endpoint = createMarkdownQueryEndpoint({
    async searchByTitle() {
      return { candidates: [] };
    },
    async queryMarkdown() {
      return { granularity: "full", content: "" };
    },
    async queryTables() {
      return { tables: [] };
    },
    async readImages() {
      return {
        images: [
          {
            path: "images/a.jpg",
            status: "ok",
            mime: "image/jpeg",
            bytes: new Uint8Array([1, 2, 3]),
          },
        ],
      };
    },
  });

  const response = await endpoint.init(
    request("/mineru-for-zotero/image", {
      query: { libraryID: "1", key: "PDF1", path: "images/a.jpg" },
    }),
  );

  assert.equal(response[0], 200);
  assert.equal(response[1], "image/jpeg");
  assert.deepEqual(Array.from(response[2] as Uint8Array), [1, 2, 3]);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npm test -- --grep "image bytes|single image request"
```

Expected: FAIL because `readImage()` and `/image` are not implemented.

- [ ] **Step 4: Add image read domain and storage method**

In `src/modules/domain.ts`:

```ts
export interface MinerUImageReadResult {
  path: string;
  mime: string;
  bytes: Uint8Array;
  dataURL: string;
}
```

In `src/modules/storage.ts`, add to `StorageAdapter`:

```ts
readImage(
  ref: AttachmentKeyRef,
  imageMarkdownPath: string,
): Promise<MinerUImageReadResult | null>;
```

Implement next to `readImageDataURL()`:

```ts
async readImage(ref, imageMarkdownPath) {
  return readImageFromDir(getAttachmentDir(fsRoot, ref), imageMarkdownPath);
},
```

Add helper:

```ts
async function readImageFromDir(
  dir: string,
  imageMarkdownPath: string,
): Promise<MinerUImageReadResult | null> {
  const relativePath = normalizeMinerUImageMarkdownPath(imageMarkdownPath);
  if (!relativePath) {
    return null;
  }
  const imagePath = joinPath(dir, IMAGES_DIR, relativePath);
  if (!(await exists(imagePath))) {
    return null;
  }
  const bytes = await readBytes(imagePath);
  const mime = getImageMimeType(relativePath);
  return {
    path: `${IMAGES_DIR}/${relativePath}`,
    mime,
    bytes,
    dataURL: `data:${mime};base64,${bytesToBase64(bytes)}`,
  };
}
```

- [ ] **Step 5: Add image service method**

In `src/modules/markdownQuery/types.ts`, add:

```ts
export type MarkdownImageStatus = "ok" | "not-found" | "invalid-path";

export interface MarkdownImageResult {
  path: string;
  status: MarkdownImageStatus;
  mime?: string;
  dataURL?: string;
  bytes?: Uint8Array;
}
```

In `queryService.ts`, extend storage dependency:

```ts
readImage(ref: { libraryID: number; key: string }, path: string): Promise<MinerUImageReadResult | null>;
```

Add service method:

```ts
readImages(input: {
  libraryID: number;
  key: string;
  attachmentKey?: string;
  path: string;
}): Promise<{ images: MarkdownImageResult[] }>;
```

Implementation:

```ts
async readImages(input) {
  const resolved = await resolveAttachment({
    libraryID: input.libraryID,
    key: input.key,
    attachmentKey: input.attachmentKey,
    items: deps.items,
    storage: deps.storage,
  });
  const images = await Promise.all(
    splitCsv(input.path).map(async (path) => {
      if (!isMarkdownImagePath(path)) {
        return { path, status: "invalid-path" as const };
      }
      const image = await deps.storage.readImage(
        {
          libraryID: resolved.attachment.libraryID,
          key: resolved.attachment.key,
        },
        path,
      );
      if (!image) {
        return { path, status: "not-found" as const };
      }
      return {
        path,
        status: "ok" as const,
        mime: image.mime,
        dataURL: image.dataURL,
        bytes: image.bytes,
      };
    }),
  );
  return { images };
}
```

Add helpers:

```ts
function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isMarkdownImagePath(path: string): boolean {
  return (
    /^images\/[^/][^\\]*$/i.test(path) &&
    !path.includes("..") &&
    !/^[a-z]+:\/\//i.test(path)
  );
}
```

- [ ] **Step 6: Update endpoint for image bytes and multi-image JSON**

In `apiEndpoint.ts`, add `/mineru-for-zotero/image` to `MARKDOWN_ENDPOINT_PATHS`.

Route it:

```ts
if (options.pathname === "/mineru-for-zotero/image") {
  const payload = await service.readImages({
    libraryID: requireInteger(query.libraryID, "libraryID"),
    key: requireString(query.key, "key"),
    attachmentKey: optionalString(query.attachmentKey),
    path: requireString(query.path, "path"),
  });
  return imageResponse(payload);
}
```

Add response helper:

```ts
function imageResponse(payload: { images: MarkdownImageResult[] }) {
  if (payload.images.length === 1) {
    const image = payload.images[0];
    if (image.status === "ok" && image.bytes && image.mime) {
      return [200, image.mime, image.bytes] as const;
    }
    if (image.status === "invalid-path") {
      return json(400, {
        error: "invalid-path",
        message: "Invalid image path",
      });
    }
    return json(404, { error: "image-not-found", message: "Image not found" });
  }
  return json(200, {
    images: payload.images.map(({ bytes, ...image }) => image),
  });
}
```

- [ ] **Step 7: Run tests and commit**

Run:

```powershell
npm test -- --grep "storage|markdownQueryService|markdownApiEndpoint"
```

Expected: PASS.

Commit:

```bash
git add src/modules/domain.ts src/modules/storage.ts src/modules/markdownQuery/types.ts src/modules/markdownQuery/queryService.ts src/modules/markdownQuery/apiEndpoint.ts test/storage.test.ts test/markdownQueryService.test.ts test/markdownApiEndpoint.test.ts
git commit -m "feat(markdown-query): add image retrieval endpoint"
```

---

### Task 5: CLI, Skill Docs, README, and Final Verification

**Files:**

- Modify: `mineru-for-zotero-cli/scripts/query-markdown.mjs`
- Modify: `mineru-for-zotero-cli/SKILL.md`
- Modify: `README.md`
- Modify: `README_zh.md`
- Test: `test/queryMarkdownCli.test.mjs`

**Interfaces:**

- Consumes API parameters from Tasks 2-4.
- Produces CLI commands:
  - `markdown --section-number <expr>`
  - `table --query <text> --match <kind> --table-format <format>`
  - `image --path <paths> --output <file> --output-dir <dir>`

- [ ] **Step 1: Write failing CLI tests**

Add to `test/queryMarkdownCli.test.mjs`:

```js
test("passes section-number and formats grouped section text", async () => {
  await withServer(
    {
      status: 200,
      body: {
        item: { key: "ABCD1234", title: "Paper" },
        attachment: { key: "PDFKEY01", fileName: "paper.pdf" },
        result: { mode: "precise", source: "preferred" },
        granularity: "section",
        groups: [
          {
            query: "5.1",
            kind: "section-number",
            status: "ok",
            matches: [
              {
                heading: {
                  title: "5.1 Setup",
                  path: ["Paper", "5.1 Setup"],
                  line: 10,
                },
                content: "## 5.1 Setup\n\nBody",
                images: [],
              },
            ],
          },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "markdown",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--granularity",
        "section",
        "--section-number",
        "5.1",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /\[Group 1] 5\.1/);
      assert.equal(requests[0].searchParams.sectionNumber, "5.1");
    },
  );
});

test("queries tables with table-format", async () => {
  await withServer(
    {
      status: 200,
      body: {
        query: "Table 2",
        match: "both",
        tableFormat: "markdown",
        tables: [
          { caption: "Table 2", page: 3, rawIndex: 7, content: "| A |" },
        ],
      },
    },
    async ({ port, requests }) => {
      const result = await runCli([
        "table",
        "--port",
        String(port),
        "--library-id",
        "1",
        "--key",
        "ABCD1234",
        "--query",
        "Table 2",
        "--table-format",
        "markdown",
      ]);

      assert.equal(result.code, 0);
      assert.match(result.stdout, /Table 2/);
      assert.equal(requests[0].pathname, "/mineru-for-zotero/tables");
      assert.equal(requests[0].searchParams.tableFormat, "markdown");
    },
  );
});
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```powershell
node --test test/queryMarkdownCli.test.mjs
```

Expected: FAIL because `table`, `image`, and `--section-number` are not supported.

- [ ] **Step 3: Update CLI argument parsing**

In `query-markdown.mjs`, extend constants:

```js
const TABLE_ENDPOINT = "/mineru-for-zotero/tables";
const IMAGE_ENDPOINT = "/mineru-for-zotero/image";
const VALID_COMMANDS = new Set(["search", "markdown", "table", "image"]);
const VALID_TABLE_FORMATS = new Set([
  "html",
  "markdown",
  "tsv",
  "latex",
  "json",
]);
const VALID_TABLE_MATCHES = new Set(["caption", "content", "both"]);
```

In `parseCommand(argv)`, replace command validation with:

```js
if (!VALID_COMMANDS.has(command)) {
  throw new CliArgumentError(`Unknown command: ${command}`);
}
```

Add table branch:

```js
if (command === "table") {
  const key = getRequiredFlag(flags, "--key");
  const query = getRequiredFlag(flags, "--query");
  const tableFormat = getFlag(flags, "--table-format", "html");
  const match = getFlag(flags, "--match", "both");
  if (!VALID_TABLE_FORMATS.has(tableFormat)) {
    throw new CliArgumentError("Invalid --table-format.");
  }
  if (!VALID_TABLE_MATCHES.has(match)) {
    throw new CliArgumentError("Invalid --match.");
  }
  return {
    command,
    endpoint: TABLE_ENDPOINT,
    listenPort,
    baseUrl,
    format,
    timeoutMs,
    token,
    params: { libraryID, key, q: query, match, tableFormat },
  };
}
```

Add image branch:

```js
if (command === "image") {
  const key = getRequiredFlag(flags, "--key");
  const path = getRequiredFlag(flags, "--path");
  return {
    command,
    endpoint: IMAGE_ENDPOINT,
    listenPort,
    baseUrl,
    format,
    timeoutMs,
    token,
    output: getFlag(flags, "--output"),
    outputDir: getFlag(flags, "--output-dir"),
    params: { libraryID, key, path },
  };
}
```

In markdown params:

```js
addOptionalParam(params, "sectionNumber", getFlag(flags, "--section-number"));
```

- [ ] **Step 4: Update CLI request and formatting**

For image binary responses, add:

```js
async function requestMarkdownApi(options) {
  const url = new URL(options.endpoint, options.baseUrl);
  for (const [key, value] of Object.entries(options.params)) {
    url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const headers = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(url, { headers, signal: controller.signal });
    if (
      options.command === "image" &&
      response.ok &&
      !response.headers.get("content-type")?.includes("json")
    ) {
      return {
        imageBytes: new Uint8Array(await response.arrayBuffer()),
        mime:
          response.headers.get("content-type") || "application/octet-stream",
      };
    }
    const payload = await parseJsonResponse(response);
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
```

Add formatting branches:

```js
function formatTextSuccess(options, data) {
  if (options.command === "search") return formatSearchText(options, data);
  if (options.command === "table") return formatTableText(options, data);
  if (options.command === "image") return formatImageText(options, data);
  return formatMarkdownText(options, data);
}
```

Add grouped section formatter inside `formatMarkdownText()`:

```js
if (granularity === "section" && Array.isArray(data.groups)) {
  lines.push(...formatSectionGroups(data.groups));
}
```

Define:

```js
function formatSectionGroups(groups) {
  return groups.flatMap((group, index) => {
    const lines = [
      `[Group ${index + 1}] ${valueOrUnknown(group.query)}`,
      `Kind: ${valueOrUnknown(group.kind)}`,
      `Status: ${valueOrUnknown(group.status)}`,
      `Matches: ${Array.isArray(group.matches) ? group.matches.length : 0}`,
    ];
    for (const match of group.matches ?? []) {
      lines.push(
        "",
        `Heading: ${valueOrUnknown(match.heading?.title)}`,
        `Path: ${formatPath(match.heading?.path)}`,
        `Line: ${valueOrUnknown(match.heading?.line)}`,
        "",
        match.content ?? "",
      );
    }
    return lines;
  });
}
```

- [ ] **Step 5: Update SKILL.md workflows**

In `mineru-for-zotero-cli/SKILL.md`, keep separate workflow headings. Add short sections:

````markdown
### Read sections by number

Use this when paper headings include section numbers.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-number "5.1,5.3-5.5"
```
````

### Read sections by fuzzy path

Use this when you know a heading phrase but not the full root path.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-path "Experiment Settings,Results"
```

### Find tables

Use this when the user asks for a table by caption or cell content.

```powershell
node scripts/query-markdown.mjs table --library-id 1 --key ABCD1234 --query "Table 2" --match both --table-format markdown
```

### Fetch images

Use this when section output contains `![](images/...)` and the image is needed.

```powershell
node scripts/query-markdown.mjs image --library-id 1 --key ABCD1234 --path "images/a.jpg" --output a.jpg
```

````

- [ ] **Step 6: Update README files**

Add a concise API note to `README.md` and `README_zh.md`:

```md
`granularity=section` now returns grouped results under `groups`. Use `sectionNumber` for numbered headings and fuzzy `sectionPath` for partial heading/path matching. Tables are available from `/mineru-for-zotero/tables`; images referenced as `images/...` are available from `/mineru-for-zotero/image`.
````

Use Chinese equivalent in `README_zh.md`.

- [ ] **Step 7: Run final verification**

Run:

```powershell
node --test test/queryMarkdownCli.test.mjs
npm run lint:check
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
npm run build
```

Expected: all commands PASS.

- [ ] **Step 8: Commit final CLI and docs work**

Commit:

```bash
git add mineru-for-zotero-cli/scripts/query-markdown.mjs mineru-for-zotero-cli/SKILL.md README.md README_zh.md test/queryMarkdownCli.test.mjs
git commit -m "feat(markdown-query): update cli for sections tables and images"
```

---

## Plan Self-Review

Spec coverage:

- Grouped `granularity=section`: covered by Tasks 1 and 2.
- `sectionNumber` single, comma, and range syntax: covered by Task 1 parser tests and Task 5 CLI tests.
- Fuzzy comma-separated `sectionPath`: covered by Task 1 and Task 5.
- Table endpoint by caption/content: covered by Task 3.
- Image endpoint with single bytes and multi JSON: covered by Task 4.
- CLI section/table/image commands: covered by Task 5.
- Split `SKILL.md` Workflows style: covered by Task 5 Step 5.
- README and breaking change docs: covered by Task 5 Step 6.

Placeholder scan:

- No reserved planning markers or unspecified test instructions are intentionally present.
- Every task has exact file paths, commands, expected outcomes, and commit messages.

Type consistency:

- `sectionNumber`, `sectionPath`, `tableFormat`, and `attachmentKey` use the same camelCase names across service and HTTP query parsing.
- CLI flags use kebab-case and map to API camelCase parameters.
- `MarkdownSectionGroup.status` values match the spec: `ok`, `not-found`, `ambiguous`, `invalid-range`.
