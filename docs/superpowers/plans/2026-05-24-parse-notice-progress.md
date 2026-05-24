# 解析任务提示进度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化解析任务通知，让提交与完成提示按 API 来源、解析模式和批量进度显示准确上下文。

**Architecture:** 新增 `src/modules/parseNotice.ts` 作为小型提示上下文模块，集中生成 Fluent message id 与参数。`parseManager.ts` 只负责读取当前解析设置、创建批量计数器，并在提交或成功完成时调用提示 helper。Locale 继续通过 `mainWindow.ftl` 提供用户可见文案。

**Tech Stack:** TypeScript ES modules, Fluent locale files, Mocha + Chai, zotero-plugin-scaffold.

---

## File Structure

- Create: `src/modules/parseNotice.ts`
  - 负责解析提示上下文、API/mode 标签参数、提交与完成提示参数生成、批量完成计数。
- Modify: `src/modules/parseManager.ts`
  - 在单个与批量解析流程中接入 `parseNotice`。
  - 保持错误处理与已有结果判断逻辑不变。
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
  - 更新解析提交和完成提示为两行格式。
  - 使用 Fluent selector 根据 `source` 和 `mode` 参数渲染标签。
- Modify: `addon/locale/en-US/mainWindow.ftl`
  - 添加对应英文文案。
- Modify: `typings/i10n.d.ts`
  - 添加新增 Fluent message id。此仓库当前没有单独的 i10n 生成脚本，按本次新增 key 做最小同步。
- Modify: `test/parseManager.test.ts`
  - 新增提示上下文和批量进度测试。
  - 保留现有多数 `messages: string[]` 测试。
- Test command:
  - `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`

---

### Task 1: Parse Notice Helper

**Files:**

- Create: `src/modules/parseNotice.ts`
- Test: `test/parseManager.test.ts`

- [x] **Step 1: Write failing tests for single-task notice context**

Add this block near the top of `test/parseManager.test.ts`, after the selected regular item test and before bulk parsing tests. These tests override `showMessage` locally so existing string-only assertions do not need to change.

```ts
it("reports online precise parse notices with source and mode context", async function () {
  const notices: Array<{
    id: string;
    args?: Record<string, string>;
  }> = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    showMessage: (id, args) => {
      notices.push({ id, args });
    },
    storage: {
      ...baseStorage(),
      writeResult: async () => {},
    },
    client: successfulPreciseClient(),
  });

  await manager.parseAttachment(pdfAttachment());

  assert.deepEqual(notices, [
    {
      id: "parse-task-submitted",
      args: {
        source: "online",
        mode: "precise",
      },
    },
    {
      id: "parse-task-finished",
      args: {
        source: "online",
        mode: "precise",
      },
    },
  ]);
});

it("reports all source and mode combinations in parse notices", async function () {
  const cases: Array<{
    source: "online" | "local";
    mode: "precise" | "lite";
    result:
      | {
          kind: "precise";
          rawResult: unknown;
          markdown: string;
        }
      | { kind: "lite"; markdown: string };
  }> = [
    {
      source: "online",
      mode: "precise",
      result: preciseResultFixture(),
    },
    {
      source: "online",
      mode: "lite",
      result: { kind: "lite", markdown: "# Lite" },
    },
    {
      source: "local",
      mode: "precise",
      result: preciseResultFixture(),
    },
    {
      source: "local",
      mode: "lite",
      result: { kind: "lite", markdown: "# Lite" },
    },
  ];

  for (const entry of cases) {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      getParseSource: () => entry.source,
      getParseMode: () => entry.mode,
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      client: {
        submitPdf: async () => ({ taskID: "task-1" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => entry.result,
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(
      notices.map((notice) => notice.args),
      [
        {
          source: entry.source,
          mode: entry.mode,
        },
        {
          source: entry.source,
          mode: entry.mode,
        },
      ],
    );
  }
});
```

Add helper functions near the bottom of `test/parseManager.test.ts`, before `baseDependencies()`:

```ts
function successfulPreciseClient(): NonNullable<
  ParseManagerDependencies["client"]
> {
  return {
    submitPdf: async () => ({ taskID: "task-1" }),
    pollTask: async () => ({ status: "succeeded" }),
    downloadResult: async () => preciseResultFixture(),
  };
}

function preciseResultFixture(): {
  kind: "precise";
  rawResult: unknown;
  markdown: string;
} {
  return {
    kind: "precise",
    rawResult: {
      pages: [
        {
          pageNo: 1,
          width: 1000,
          height: 1000,
          blocks: [{ type: "text", bbox: [0, 0, 100, 100], markdown: "A" }],
        },
      ],
    },
    markdown: "A",
  };
}
```

- [x] **Step 2: Run the targeted tests and verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "parse notices|source and mode combinations"
```

Expected: FAIL because `parse-task-submitted`, `parse-task-finished`, and their `source`/`mode` args are not implemented.

- [x] **Step 3: Implement `parseNotice.ts`**

Create `src/modules/parseNotice.ts`:

```ts
import type { FluentMessageId } from "../../typings/i10n";
import type { ParseMode, ParseSource } from "../utils/prefs";

export interface ParseNoticeBatchProgress {
  readonly total: number;
  completed: number;
}

export interface ParseNoticeContext {
  source: ParseSource;
  mode: ParseMode;
  batch?: ParseNoticeBatchProgress;
}

export interface ParseNotice {
  id: FluentMessageId;
  args: Record<string, string>;
}

/**
 * 创建解析提示上下文，供提交和完成提示复用。
 */
export function createParseNoticeContext(input: {
  source: ParseSource;
  mode: ParseMode;
  total?: number;
}): ParseNoticeContext {
  return {
    source: input.source,
    mode: input.mode,
    batch:
      typeof input.total === "number"
        ? { total: input.total, completed: 0 }
        : undefined,
  };
}

/**
 * 返回解析任务提交提示。
 */
export function createParseSubmittedNotice(
  context: ParseNoticeContext,
): ParseNotice {
  if (context.batch && context.batch.total > 1) {
    return {
      id: "parse-task-submitted-total",
      args: {
        ...createNoticeArgs(context),
        total: String(context.batch.total),
      },
    };
  }
  return {
    id: "parse-task-submitted",
    args: createNoticeArgs(context),
  };
}

/**
 * 返回解析任务成功完成提示，并按完成顺序更新批量计数。
 */
export function createParseFinishedNotice(
  context: ParseNoticeContext,
): ParseNotice {
  if (context.batch && context.batch.total > 1) {
    const completed = incrementCompletedCount(context.batch);
    return {
      id: "parse-task-finished-progress",
      args: {
        ...createNoticeArgs(context),
        total: String(context.batch.total),
        completed: String(completed),
      },
    };
  }
  return {
    id: "parse-task-finished",
    args: createNoticeArgs(context),
  };
}

function createNoticeArgs(context: ParseNoticeContext): Record<string, string> {
  return {
    source: context.source,
    mode: context.mode,
  };
}

function incrementCompletedCount(batch: ParseNoticeBatchProgress): number {
  batch.completed += 1;
  return batch.completed;
}
```

- [x] **Step 4: Wire single-task notices in `parseManager.ts`**

Modify imports in `src/modules/parseManager.ts`:

```ts
import {
  createParseFinishedNotice,
  createParseNoticeContext,
  createParseSubmittedNotice,
  type ParseNoticeContext,
} from "./parseNotice";
```

Change the `ParseManager` methods and the private function signature so a notice context can be passed in later by batch parsing:

```ts
async function parseAttachmentWithDependencies(
  attachment: Zotero.Item,
  options: { force?: boolean } | undefined,
  dependencies: ParseManagerDependencies,
  noticeContext?: ParseNoticeContext,
): Promise<void> {
```

After `source`, `mode`, and `apiKey` are computed, add:

```ts
const currentNoticeContext =
  noticeContext ?? createParseNoticeContext({ source, mode });
```

Replace:

```ts
dependencies.showMessage("parse-started");
```

with:

```ts
showParseNotice(dependencies, createParseSubmittedNotice(currentNoticeContext));
```

Replace the lite success notice:

```ts
dependencies.showMessage("parse-lite-finished");
```

with:

```ts
showParseNotice(dependencies, createParseFinishedNotice(currentNoticeContext));
```

Replace the precise success notice:

```ts
dependencies.showMessage("parse-finished");
```

with:

```ts
showParseNotice(dependencies, createParseFinishedNotice(currentNoticeContext));
```

Add this helper near `getClient()`:

```ts
function showParseNotice(
  dependencies: ParseManagerDependencies,
  notice: { id: FluentMessageId; args: Record<string, string> },
): void {
  dependencies.showMessage(notice.id, notice.args);
}
```

- [x] **Step 5: Run targeted tests and verify single-task notices pass**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "parse notices|source and mode combinations"
```

Expected: PASS for the new single-task notice tests. TypeScript may still fail later until locale typings are updated in Task 3.

- [x] **Step 6: Commit Task 1**

Run:

```powershell
git add src/modules/parseNotice.ts src/modules/parseManager.ts test/parseManager.test.ts
git commit -m "feat(parse): 添加解析提示上下文"
```

Expected: commit succeeds.

---

### Task 2: Batch Progress Notices

**Files:**

- Modify: `src/modules/parseManager.ts`
- Modify: `test/parseManager.test.ts`

- [x] **Step 1: Write failing tests for batch total and completion order**

Add these tests after the existing `"parses multiple attachments in parallel and confirms existing results once"` test:

```ts
it("reports batch parse notices with total and completion progress", async function () {
  const notices: Array<{ id: string; args?: Record<string, string> }> = [];
  const releaseByPath = new Map<string, () => void>();
  const waitByPath = new Map<string, Promise<void>>();
  for (const path of ["C:\\tmp\\a.pdf", "C:\\tmp\\b.pdf"]) {
    waitByPath.set(
      path,
      new Promise<void>((resolve) => {
        releaseByPath.set(path, resolve);
      }),
    );
  }
  const manager = createParseManager({
    ...baseDependencies([]),
    showMessage: (id, args) => {
      notices.push({ id, args });
    },
    client: {
      submitPdf: async (filePath) => ({ taskID: filePath }),
      pollTask: async (taskID) => {
        await waitByPath.get(taskID);
        return { status: "succeeded" };
      },
      downloadResult: async () => preciseResultFixture(),
    },
  });

  const parsing = manager.parseAttachments([
    pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
    pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
  ]);

  await Promise.resolve();
  releaseByPath.get("C:\\tmp\\b.pdf")?.();
  await Promise.resolve();
  releaseByPath.get("C:\\tmp\\a.pdf")?.();
  await parsing;

  assert.deepEqual(
    notices.filter((notice) => notice.id === "parse-task-submitted-total"),
    [
      {
        id: "parse-task-submitted-total",
        args: {
          source: "online",
          mode: "precise",
          total: "2",
        },
      },
      {
        id: "parse-task-submitted-total",
        args: {
          source: "online",
          mode: "precise",
          total: "2",
        },
      },
    ],
  );
  assert.deepEqual(
    notices.filter((notice) => notice.id === "parse-task-finished-progress"),
    [
      {
        id: "parse-task-finished-progress",
        args: {
          source: "online",
          mode: "precise",
          total: "2",
          completed: "1",
        },
      },
      {
        id: "parse-task-finished-progress",
        args: {
          source: "online",
          mode: "precise",
          total: "2",
          completed: "2",
        },
      },
    ],
  );
});

it("excludes skipped existing results from batch notice totals", async function () {
  const notices: Array<{ id: string; args?: Record<string, string> }> = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    showMessage: (id, args) => {
      notices.push({ id, args });
    },
    storage: {
      ...baseStorage(),
      hasReadyResult: async (attachment) => attachment.id === 1,
    },
    confirmReparse: async () => "use-existing",
    client: successfulPreciseClient(),
  });

  await manager.parseAttachments([
    pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
    pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
  ]);

  assert.deepEqual(notices, [
    { id: "parse-use-existing-result", args: undefined },
    {
      id: "parse-task-submitted",
      args: {
        source: "online",
        mode: "precise",
      },
    },
    {
      id: "parse-task-finished",
      args: {
        source: "online",
        mode: "precise",
      },
    },
  ]);
});
```

Add this test after the MinerU failure mapping tests:

```ts
it("counts only successful completions in batch progress notices", async function () {
  const notices: Array<{ id: string; args?: Record<string, string> }> = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    showMessage: (id, args) => {
      notices.push({ id, args });
    },
    client: {
      submitPdf: async (filePath) => ({ taskID: filePath }),
      pollTask: async (taskID) => {
        if (taskID.includes("b.pdf")) {
          return { status: "failed", error: "parse failed" };
        }
        return { status: "succeeded" };
      },
      downloadResult: async () => preciseResultFixture(),
    },
  });

  await manager.parseAttachments([
    pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
    pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
  ]);

  assert.deepEqual(
    notices.filter((notice) => notice.id === "parse-task-finished-progress"),
    [
      {
        id: "parse-task-finished-progress",
        args: {
          source: "online",
          mode: "precise",
          total: "2",
          completed: "1",
        },
      },
    ],
  );
});
```

- [x] **Step 2: Run the targeted batch tests and verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "batch parse notices|excludes skipped|successful completions"
```

Expected: FAIL because bulk parsing does not pass a shared notice context yet.

- [x] **Step 3: Pass shared batch context from `parseAttachmentsWithDependencies()`**

In `src/modules/parseManager.ts`, replace the final `Promise.all()` in `parseAttachmentsWithDependencies()`:

```ts
await Promise.all(
  attachmentsToParse.map((attachment) =>
    parseAttachmentWithDependencies(
      attachment,
      { ...options, force: true },
      dependencies,
    ),
  ),
);
```

with:

```ts
if (attachmentsToParse.length === 0) {
  return;
}

const noticeContext =
  attachmentsToParse.length > 1
    ? createParseNoticeContext({
        source,
        mode,
        total: attachmentsToParse.length,
      })
    : undefined;

await Promise.all(
  attachmentsToParse.map((attachment) =>
    parseAttachmentWithDependencies(
      attachment,
      { ...options, force: true },
      dependencies,
      noticeContext,
    ),
  ),
);
```

In the `options?.force === true` branch, keep current behavior for direct forced parsing unless the input has multiple PDFs. Replace:

```ts
await Promise.all(
  pdfAttachments.map((attachment) =>
    parseAttachmentWithDependencies(attachment, options, dependencies),
  ),
);
```

with:

```ts
const noticeContext =
  pdfAttachments.length > 1
    ? createParseNoticeContext({
        source,
        mode,
        total: pdfAttachments.length,
      })
    : undefined;
await Promise.all(
  pdfAttachments.map((attachment) =>
    parseAttachmentWithDependencies(
      attachment,
      options,
      dependencies,
      noticeContext,
    ),
  ),
);
```

This preserves concurrent execution and the existing bulk control flow. `parseAttachmentWithDependencies()` catches parse failures and reports the existing error messages, so already-started concurrent tasks can still finish.

- [x] **Step 4: Run targeted batch tests and verify they pass**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "batch parse notices|excludes skipped|successful completions"
```

Expected: PASS.

- [x] **Step 5: Run the full parse manager tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "parseManager"
```

Expected: PASS.

- [x] **Step 6: Commit Task 2**

Run:

```powershell
git add src/modules/parseManager.ts test/parseManager.test.ts
git commit -m "feat(parse): 添加批量解析提示进度"
```

Expected: commit succeeds.

---

### Task 3: Locale Messages and Typings

**Files:**

- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `typings/i10n.d.ts`

- [x] **Step 1: Update Chinese Fluent messages**

In `addon/locale/zh-CN/mainWindow.ftl`, replace:

```ftl
parse-started = 已提交 MinerU 解析任务
parse-finished = MinerU 解析完成
parse-lite-finished = 轻量解析完成
```

with:

```ftl
parse-task-submitted =
    已提交 MinerU 文档解析任务
    [{ $source ->
        [local] 本地 API
       *[online] 在线 API
    } · { $mode ->
        [lite] 轻量
       *[precise] 精准
    }]
parse-task-submitted-total =
    已提交 MinerU 文档解析任务
    [{ $source ->
        [local] 本地 API
       *[online] 在线 API
    } · { $mode ->
        [lite] 轻量
       *[precise] 精准
    } · 共 { $total } 个]
parse-task-finished =
    MinerU 文档解析任务完成
    [{ $source ->
        [local] 本地 API
       *[online] 在线 API
    } · { $mode ->
        [lite] 轻量
       *[precise] 精准
    }]
parse-task-finished-progress =
    MinerU 文档解析任务完成
    [{ $source ->
        [local] 本地 API
       *[online] 在线 API
    } · { $mode ->
        [lite] 轻量
       *[precise] 精准
    } · { $completed }/{ $total }]
```

Keep old `parse-started`, `parse-finished`, and `parse-lite-finished` only if other code still references them after Task 2. If `rg "parse-started|parse-finished|parse-lite-finished" src test addon` finds no references except generated typings, remove the old keys.

- [x] **Step 2: Update English Fluent messages**

In `addon/locale/en-US/mainWindow.ftl`, replace:

```ftl
parse-started = MinerU parse task submitted
parse-finished = MinerU parsing finished
parse-lite-finished = Lite parse finished
```

with:

```ftl
parse-task-submitted =
    MinerU document parse task submitted
    [{ $source ->
        [local] Local API
       *[online] Online API
    } · { $mode ->
        [lite] Lite
       *[precise] Precise
    }]
parse-task-submitted-total =
    MinerU document parse task submitted
    [{ $source ->
        [local] Local API
       *[online] Online API
    } · { $mode ->
        [lite] Lite
       *[precise] Precise
    } · { $total } total]
parse-task-finished =
    MinerU document parse task finished
    [{ $source ->
        [local] Local API
       *[online] Online API
    } · { $mode ->
        [lite] Lite
       *[precise] Precise
    }]
parse-task-finished-progress =
    MinerU document parse task finished
    [{ $source ->
        [local] Local API
       *[online] Online API
    } · { $mode ->
        [lite] Lite
       *[precise] Precise
    } · { $completed }/{ $total }]
```

Use `rg "parse-started|parse-finished|parse-lite-finished" src test addon` again. Remove old keys only when they are no longer referenced.

- [x] **Step 3: Update i10n typings**

In `typings/i10n.d.ts`, add these ids to the `FluentMessageId` union near the other `parse-*` keys:

```ts
  | 'parse-task-finished'
  | 'parse-task-finished-progress'
  | 'parse-task-submitted'
  | 'parse-task-submitted-total'
```

Remove these ids from the union if no code or locale uses them after the locale update:

```ts
  | 'parse-finished'
  | 'parse-lite-finished'
  | 'parse-started'
```

- [x] **Step 4: Run reference search**

Run:

```powershell
rg -n "parse-started|parse-finished|parse-lite-finished|parse-task-submitted|parse-task-finished" src addon test typings
```

Expected: only the new `parse-task-*` ids should appear in source, locale, tests, and typings. Old ids should not appear unless deliberately retained for compatibility.

- [x] **Step 5: Run parse manager tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail --grep "parseManager"
```

Expected: PASS.

- [x] **Step 6: Commit Task 3**

Run:

```powershell
git add addon/locale/zh-CN/mainWindow.ftl addon/locale/en-US/mainWindow.ftl typings/i10n.d.ts
git commit -m "feat(locale): 更新解析任务提示文案"
```

Expected: commit succeeds.

---

### Task 4: Full Verification and Cleanup

**Files:**

- Verify all changed files from Tasks 1-3.

- [x] **Step 1: Inspect working tree**

Run:

```powershell
git status --short
```

Expected: clean if each task was committed. If there are uncommitted task-related changes, inspect them before continuing:

```powershell
git diff
```

- [x] **Step 2: Run full scaffold test suite**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS. If the command fails because Zotero cannot launch or the scaffold runtime is unavailable, capture the exact failure text in the final handoff and run the narrower TypeScript or unit checks that are available.

- [x] **Step 3: Run type-aware build**

Run:

```powershell
pnpm run build
```

Expected: PASS. This confirms `typings/i10n.d.ts` and TypeScript imports are consistent.

- [x] **Step 4: Check final diff against spec**

Run:

```powershell
git log --oneline -4
git status --short
```

Expected:

- Recent commits include:
  - `feat(parse): 添加解析提示上下文`
  - `feat(parse): 添加批量解析提示进度`
  - `feat(locale): 更新解析任务提示文案`
- Working tree is clean.

- [x] **Step 5: Prepare final summary**

Final response should include:

- Changed behavior:
  - 单个任务提示显示固定主文案和 `[API · 模式]`。
  - 批量提交显示 `[API · 模式 · 共 N 个]`。
  - 批量完成按完成顺序显示 `[API · 模式 · K/N]`。
- Verification:
  - Full test command result.
  - Build command result.
- Suggested commit message if final commits are squashed later:

```text
feat(parse): 优化解析任务提示进度
```

---

## 实施与修复说明

### 已实现行为

- 单个 PDF 解析提交和完成提示改为固定主文案，并在详情行显示 `[API 来源 · 解析模式]`。
- 多个 PDF 解析提交提示合并为一条批量提交提示，详情行显示 `[API 来源 · 解析模式 · 共 N 个]`。
- 多个 PDF 解析完成提示按实际成功完成顺序显示 `[API 来源 · 解析模式 · K/N]`；失败任务不递增完成计数。
- 已选择“使用已有结果”的 attachment 不计入本轮批量总数；过滤后只剩一个待解析 PDF 时回退为单任务提示。
- item context menu 的多选入口改为一次性调用批量解析入口，避免对多个 PDF 逐个触发单任务提交提示。

### 关键实现

- 新增 `src/modules/parseNotice.ts`，集中生成解析提示上下文、提交提示、完成提示和批量计数参数。
- `src/modules/parseManager.ts` 在提交成功后显示提交提示，在结果写入成功后显示完成提示；错误提示仍沿用既有错误分类。
- Fluent 文案拆分为主文案和详情文案 key，避免 scaffold 构建后多行 Fluent value 被折叠或丢失。
- ProgressWindow 只创建一个主 `ItemProgress` 行，详情行通过 Zotero `addDescription()` 添加，借用 Zotero 内部 `_move()/sizeToContent()` 重新计算通知窗口高度。
- ProgressWindow 图标使用显式插件 icon URI，并在窗口 DOM 异步生成后进行短时间重试应用，避免回退为 Zotero 默认文件图标。

### 调试修复记录

- 修复批量提交提示重复：根因是同一个批量上下文被传给多个 attachment 后，每个 attachment 都调用提交提示；通过 `submitted` 标记保证批量提交只弹一次。
- 修复详情行两侧都有 icon：根因是把主文案和详情文案渲染为两个 ProgressWindow item；改为一个主 item 加一个详情 description。
- 修复详情行被底部裁剪：根因是替换 `ItemProgress` 内部 label 后没有触发 Zotero `sizeToContent()`；改为 `addDescription()`。
- 修复 `Node is not defined`：根因是插件脚本环境不保证全局 `Node` 构造器存在；改为使用本地 `ELEMENT_NODE_TYPE = 1`。
- 修复完成提示第二条 icon 和详情左对齐偶发失效：根因是 Zotero ProgressWindow 行 DOM 通过 `_deferUntilWindowLoad` 异步生成，单次 timeout 可能早于真实 DOM；改为根据 icon 和详情行是否实际应用成功进行短时间重试。

### 最终验证

- `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`：188 passed。
- `pnpm run build`：通过。
- `npm run lint:check`：通过。

---

## Self-Review

- Spec coverage:
  - API 来源与解析模式区分：Task 1 helper 和 Task 3 locale 覆盖。
  - 单个两行提示：Task 1 和 Task 3 覆盖。
  - 批量总数与完成进度：Task 2 覆盖。
  - 完成顺序计数：Task 2 的受控释放测试覆盖。
  - 已跳过结果不计入总数：Task 2 覆盖。
  - 错误提示不扩散：Task 2 只统计成功完成，错误仍走现有分类。
- Placeholder scan:
  - 本计划没有占位符、未定项或未展开的“补充实现”步骤。
- Type consistency:
  - `ParseNoticeContext`、`ParseNoticeBatchProgress`、`createParseNoticeContext()`、`createParseSubmittedNotice()`、`createParseFinishedNotice()` 在任务间命名一致。
  - 新 Fluent ids 在测试、locale 与 typings 中保持一致。
