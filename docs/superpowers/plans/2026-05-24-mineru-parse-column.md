# MinerU 解析列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Zotero 条目列表中新增 `MinerU 解析` 列，用 badge 显示 PDF attachment 的精准、轻量和解析中状态。

**Architecture:** 使用 `Zotero.ItemTreeManager.registerColumn()` 注册同步自定义列，列渲染只读取 `addon.data.itemTreeColumn.statuses` 运行时缓存。`storage.ts` 负责读取磁盘 ready 状态，`itemTreeColumn.ts` 负责缓存、列注册和 badge 渲染，`parseManager.ts` 只在解析边界标记 running/ready/clear。

**Tech Stack:** TypeScript ES modules, Zotero ItemTreeManager plugin API, Fluent locale, Mocha/Chai scaffold tests, Prettier/ESLint, `zotero-plugin-scaffold`。

---

## File Structure

- Create: `src/modules/itemTreeColumn.ts`
  - 注册和注销 `MinerU 解析` 自定义列。
  - 管理 `addon.data.itemTreeColumn.statuses` 运行时缓存。
  - 把 cache 状态转换为列 token。
  - 渲染 badge DOM。
- Modify: `src/addon.ts`
  - 为 `addon.data.itemTreeColumn` 增加类型。
- Modify: `src/modules/storage.ts`
  - 在 `StorageAdapter` 增加 `readParseStatus()` 和 `listParseStatuses()`。
  - 复用 precise/lite ready 判定，避免 column 模块直接读 manifest。
- Modify: `src/modules/parseManager.ts`
  - 在解析开始、成功、失败路径调用 item tree column 状态函数。
- Modify: `src/hooks.ts`
  - main window load 后注册列。
  - shutdown 时注销列。
- Modify: `addon/content/zoteroPane.css`
  - 增加 badge 和单元格容器样式。
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
  - 增加列标题和 badge 文案。
- Modify: `addon/locale/en-US/mainWindow.ftl`
  - 增加对应英文文案。
- Modify: `typings/i10n.d.ts`
  - 增加新 Fluent key 类型。
- Modify: `test/storage.test.ts`
  - 覆盖 status 读取和目录扫描。
- Create: `test/itemTreeColumn.test.ts`
  - 覆盖 token、cache、renderCell、register/unregister。
- Modify: `test/parseManager.test.ts`
  - 覆盖解析过程中的 running/ready/clear 调用。
- Modify: `test/startup.test.ts`
  - 覆盖启动注册和 shutdown 注销列。

## Task 1: Storage Status API

**Files:**

- Modify: `src/modules/storage.ts`
- Modify: `test/storage.test.ts`

- [ ] **Step 1: Write failing tests for single attachment status**

Add tests near existing lite storage tests in `test/storage.test.ts`:

```ts
it("reads combined precise and lite parse status", async function () {
  const root = await makeTempRoot();
  const storage = createStorage(root);
  const attachment = attachmentRef({ libraryID: 12, key: "ABC123" });

  await storage.writeResult({
    attachment,
    mineruTaskID: "precise-task",
    rawResult: rawResultWithBoxes,
    markdown: "# Precise",
    boxes: normalizedBoxes,
  });
  await storage.writeLiteResult({
    attachment,
    mineruTaskID: "lite-task",
    source: "online",
    markdown: "# Lite",
  });

  assert.deepEqual(await storage.readParseStatus(attachment), {
    preciseReady: true,
    liteReady: true,
  });
});

it("does not expose failed precise results as parse column ready status", async function () {
  const root = await makeTempRoot();
  const storage = createStorage(root);
  const attachment = attachmentRef({ libraryID: 12, key: "ABC123" });

  await storage.writeFailedResult({
    attachment,
    mineruTaskID: "failed-task",
    rawResult: { content_list: [{ type: "text" }] },
    markdown: "# Failed",
    error: "解析结果缺少 box 信息",
  });

  assert.deepEqual(await storage.readParseStatus(attachment), {
    preciseReady: false,
    liteReady: false,
  });
});

it("does not expose incomplete lite files as parse column ready status", async function () {
  const root = await makeTempRoot();
  const storage = createStorage(root);
  const attachment = attachmentRef({ libraryID: 12, key: "ABC123" });
  const dir = storage.getAttachmentDir(attachment);

  await writeTestText(
    joinTestPath(dir, "lite-manifest.json"),
    JSON.stringify({
      attachmentID: attachment.id,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      fileName: attachment.fileName,
      pdfMtime: attachment.mtime,
      parsedAt: new Date().toISOString(),
      mineruTaskID: "lite-task",
      resultVersion: 1,
      source: "online",
      mode: "lite",
      status: "ready",
    }),
  );

  assert.deepEqual(await storage.readParseStatus(attachment), {
    preciseReady: false,
    liteReady: false,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL during TypeScript build because `StorageAdapter.readParseStatus` does not exist.

- [ ] **Step 3: Add storage interface and implementation**

In `src/modules/storage.ts`, extend `StorageAdapter`:

```ts
readParseStatus(ref: AttachmentKeyRef): Promise<{
  preciseReady: boolean;
  liteReady: boolean;
}>;
listParseStatuses(): Promise<
  Map<string, { preciseReady: boolean; liteReady: boolean }>
>;
```

Add methods inside the object returned by `createStorage()`:

```ts
async readParseStatus(ref) {
  return readParseStatusFromDir(fsRoot, ref);
},

async listParseStatuses() {
  const attachmentsDir = joinPath(fsRoot, ATTACHMENTS_DIR);
  const statuses = new Map<
    string,
    { preciseReady: boolean; liteReady: boolean }
  >();
  if (!(await exists(attachmentsDir))) {
    return statuses;
  }

  const children = await readDir(attachmentsDir);
  for (const child of children) {
    if (isTransientResultDir(child)) {
      continue;
    }
    const key = parseAttachmentResultDirName(child);
    if (!key) {
      continue;
    }
    const status = await readParseStatusFromAttachmentDir(
      joinPath(attachmentsDir, child),
    );
    if (status.preciseReady || status.liteReady) {
      statuses.set(child, status);
    }
  }
  return statuses;
},
```

Add helpers below `readReadyLiteMarkdown()`:

```ts
async function readParseStatusFromDir(
  root: string,
  ref: AttachmentKeyRef,
): Promise<{ preciseReady: boolean; liteReady: boolean }> {
  return readParseStatusFromAttachmentDir(getAttachmentDir(root, ref));
}

async function readParseStatusFromAttachmentDir(
  dir: string,
): Promise<{ preciseReady: boolean; liteReady: boolean }> {
  return {
    preciseReady: await hasReadyPreciseResultInDir(dir),
    liteReady: await hasReadyLiteResultInDir(dir),
  };
}

async function hasReadyPreciseResultInDir(dir: string): Promise<boolean> {
  try {
    const manifest = await readManifestFile(dir);
    return manifest.status === "ready";
  } catch {
    return false;
  }
}

async function hasReadyLiteResultInDir(dir: string): Promise<boolean> {
  try {
    const manifest = (await readJson(
      joinPath(dir, LITE_MANIFEST_FILE),
    )) as Partial<LiteParseManifest>;
    if (manifest.status !== "ready" || manifest.mode !== "lite") {
      return false;
    }
    const markdown = await readText(joinPath(dir, LITE_CONTENT_FILE));
    return Boolean(markdown.trim());
  } catch {
    return false;
  }
}

function parseAttachmentResultDirName(name: string): string | null {
  return /^\d+-[A-Z0-9]+$/.test(name) ? name : null;
}
```

Then simplify existing helpers to reuse the new directory helpers:

```ts
async function hasReadyPreciseResult(
  root: string,
  ref: AttachmentKeyRef,
): Promise<boolean> {
  return hasReadyPreciseResultInDir(getAttachmentDir(root, ref));
}
```

- [ ] **Step 4: Run storage tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS for storage tests, or continue to next failing test if the full suite has unrelated pre-existing failures.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/storage.ts test/storage.test.ts
git commit -m "feat(storage): expose MinerU parse status"
```

## Task 2: Runtime State Types

**Files:**

- Modify: `src/addon.ts`
- Create: `src/modules/itemTreeColumn.ts`
- Create: `test/itemTreeColumn.test.ts`

- [ ] **Step 1: Write failing type-focused tests for cache keys and tokens**

Create `test/itemTreeColumn.test.ts`:

```ts
import { assert } from "chai";
import {
  createEmptyParseColumnStatus,
  getAttachmentStatusKey,
  getMinerUParseColumnToken,
  type ParseColumnStatus,
} from "../src/modules/itemTreeColumn";

describe("itemTreeColumn", function () {
  it("uses libraryID and attachment key as the parse column status key", function () {
    assert.equal(
      getAttachmentStatusKey({ libraryID: 12, key: "ABC123" }),
      "12-ABC123",
    );
  });

  it("returns an empty token for regular items and non-PDF attachments", function () {
    const statuses = new Map<string, ParseColumnStatus>();

    assert.equal(getMinerUParseColumnToken(regularItem(), statuses), "");
    assert.equal(getMinerUParseColumnToken(nonPdfAttachment(), statuses), "");
  });

  it("returns precise and lite tokens in a stable order", function () {
    const statuses = new Map<string, ParseColumnStatus>([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "ready",
        },
      ],
    ]);

    assert.equal(
      getMinerUParseColumnToken(pdfAttachment(), statuses),
      "precise|lite",
    );
  });

  it("returns running tokens for the mode currently being parsed", function () {
    const statuses = new Map<string, ParseColumnStatus>([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "running",
        },
      ],
    ]);

    assert.equal(
      getMinerUParseColumnToken(pdfAttachment(), statuses),
      "precise|lite-running",
    );
  });

  it("creates an empty parse column status", function () {
    assert.deepEqual(createEmptyParseColumnStatus(), {
      precise: "none",
      lite: "none",
    });
  });
});

function pdfAttachment(): Zotero.Item {
  return {
    id: 1,
    key: "ABC123",
    libraryID: 12,
    isAttachment: () => true,
    isPDFAttachment: () => true,
  } as unknown as Zotero.Item;
}

function nonPdfAttachment(): Zotero.Item {
  return {
    key: "ABC123",
    libraryID: 12,
    isAttachment: () => true,
    isPDFAttachment: () => false,
  } as unknown as Zotero.Item;
}

function regularItem(): Zotero.Item {
  return {
    key: "ITEM123",
    libraryID: 12,
    isAttachment: () => false,
    isPDFAttachment: () => false,
  } as unknown as Zotero.Item;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because `src/modules/itemTreeColumn.ts` does not exist.

- [ ] **Step 3: Add item tree column module types and pure helpers**

Create `src/modules/itemTreeColumn.ts`:

```ts
import type { AttachmentRef } from "./domain";

export type ParseColumnModeState = "none" | "ready" | "running";

export type ParseColumnStatus = {
  precise: ParseColumnModeState;
  lite: ParseColumnModeState;
};

type AttachmentStatusKeyRef = Pick<AttachmentRef, "libraryID" | "key">;

export function createEmptyParseColumnStatus(): ParseColumnStatus {
  return {
    precise: "none",
    lite: "none",
  };
}

export function getAttachmentStatusKey(ref: AttachmentStatusKeyRef): string {
  return `${ref.libraryID}-${ref.key}`;
}

export function getMinerUParseColumnToken(
  item: Zotero.Item,
  statuses: Map<string, ParseColumnStatus>,
): string {
  if (!isPdfAttachment(item)) {
    return "";
  }
  const status = statuses.get(
    getAttachmentStatusKey({ libraryID: item.libraryID, key: item.key }),
  );
  if (!status) {
    return "";
  }
  return createTokenParts(status).join("|");
}

function createTokenParts(status: ParseColumnStatus): string[] {
  const parts: string[] = [];
  if (status.precise === "ready") {
    parts.push("precise");
  } else if (status.precise === "running") {
    parts.push("precise-running");
  }
  if (status.lite === "ready") {
    parts.push("lite");
  } else if (status.lite === "running") {
    parts.push("lite-running");
  }
  return parts;
}

function isPdfAttachment(item: Zotero.Item): boolean {
  return (
    typeof item.isAttachment === "function" &&
    typeof item.isPDFAttachment === "function" &&
    item.isAttachment() &&
    item.isPDFAttachment()
  );
}
```

Modify `src/addon.ts` and import the state type:

```ts
import type { ItemTreeColumnState } from "./modules/itemTreeColumn";
```

Add to `addon.data`:

```ts
itemTreeColumn?: ItemTreeColumnState;
```

Export the state type from `src/modules/itemTreeColumn.ts`:

```ts
export type ItemTreeColumnState = {
  registeredDataKey?: string;
  statuses: Map<string, ParseColumnStatus>;
};
```

- [ ] **Step 4: Run itemTreeColumn tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS for the new pure helper tests.

- [ ] **Step 5: Commit**

```powershell
git add src/addon.ts src/modules/itemTreeColumn.ts test/itemTreeColumn.test.ts
git commit -m "feat(column): add parse column runtime state"
```

## Task 3: Column Registration, Cache, and Badge Rendering

**Files:**

- Modify: `src/modules/itemTreeColumn.ts`
- Modify: `test/itemTreeColumn.test.ts`
- Modify: `typings/i10n.d.ts`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `addon/content/zoteroPane.css`

- [ ] **Step 1: Add failing tests for registration and rendering**

Append to `test/itemTreeColumn.test.ts`:

```ts
import {
  createMinerUParseColumnRegistration,
  renderMinerUParseCell,
} from "../src/modules/itemTreeColumn";
```

Add tests inside `describe("itemTreeColumn", ...)`:

```ts
it("creates a Zotero item tree column registration", function () {
  const statuses = new Map<string, ParseColumnStatus>();
  const registration = createMinerUParseColumnRegistration({
    statuses,
    getString: (id) => id,
  });

  assert.equal(registration.dataKey, "mineruParseStatus");
  assert.equal(registration.label, "item-tree-column-mineru-parse");
  assert.equal(registration.pluginID, "mineru-for-zotero@asianfleet.github.io");
  assert.deepEqual(registration.enabledTreeIDs, ["main"]);
  assert.equal(registration.width, "140");
  assert.deepEqual(registration.zoteroPersist, ["width", "hidden"]);
});

it("renders ready and running badges from a token", function () {
  const cell = renderMinerUParseCell(
    0,
    "precise|lite-running",
    { className: "custom-column" } as Parameters<
      typeof renderMinerUParseCell
    >[2],
    false,
    document,
    (id) => {
      const values: Record<string, string> = {
        "item-tree-column-mineru-parse-precise": "精准",
        "item-tree-column-mineru-parse-lite": "轻量",
        "item-tree-column-mineru-parse-running": "解析中",
      };
      return values[id] ?? id;
    },
  );

  assert.equal(cell.className, "custom-column mineru-parse-column-cell");
  assert.deepEqual(
    Array.from(cell.querySelectorAll(".mineru-parse-column-badge")).map(
      (badge) => badge.textContent,
    ),
    ["精准", "轻量(解析中)"],
  );
});

it("renders an empty cell for an empty token", function () {
  const cell = renderMinerUParseCell(
    0,
    "",
    { className: "custom-column" } as Parameters<
      typeof renderMinerUParseCell
    >[2],
    false,
    document,
    () => "",
  );

  assert.equal(cell.textContent, "");
  assert.equal(cell.childElementCount, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because `createMinerUParseColumnRegistration()` and `renderMinerUParseCell()` do not exist.

- [ ] **Step 3: Implement registration factory and renderer**

Update `src/modules/itemTreeColumn.ts`:

```ts
import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import { getString } from "../utils/locale";
import { createStorage, type StorageAdapter } from "./storage";
import { getMinerUStorageRoot } from "./preferenceScript";
```

Add dependency and manager types:

```ts
type ItemTreeColumnRegistration =
  _ZoteroTypes.ItemTreeManager.ItemTreeCustomColumnOptions;

type ItemTreeColumnManager = Pick<
  _ZoteroTypes.ItemTreeManager,
  "registerColumn" | "unregisterColumn" | "refreshColumns"
>;

type ItemTreeColumnDependencies = {
  storage?: StorageAdapter;
  createStorage?: () => StorageAdapter;
  itemTreeManager?: ItemTreeColumnManager;
  getString?: (id: FluentMessageId) => string;
  log?: (...args: unknown[]) => void;
};
```

Add registration factory:

```ts
export function createMinerUParseColumnRegistration(input: {
  statuses: Map<string, ParseColumnStatus>;
  getString: (id: FluentMessageId) => string;
}): ItemTreeColumnRegistration {
  return {
    dataKey: "mineruParseStatus",
    label: input.getString("item-tree-column-mineru-parse"),
    pluginID: config.addonID,
    enabledTreeIDs: ["main"],
    width: "140",
    minWidth: 110,
    fixedWidth: false,
    staticWidth: false,
    showInColumnPicker: true,
    zoteroPersist: ["width", "hidden"],
    dataProvider: (item) => getMinerUParseColumnToken(item, input.statuses),
    renderCell: (index, data, column, isFirstColumn, doc) =>
      renderMinerUParseCell(
        index,
        data,
        column,
        isFirstColumn,
        doc,
        input.getString,
      ),
  };
}
```

Add renderer:

```ts
export function renderMinerUParseCell(
  _index: number,
  data: string,
  column: { className: string },
  _isFirstColumn: boolean,
  doc: Document,
  resolveString: (id: FluentMessageId) => string,
): HTMLElement {
  const cell = doc.createElement("span");
  cell.className = `${column.className} mineru-parse-column-cell`.trim();
  for (const token of data.split("|").filter(Boolean)) {
    cell.append(createBadge(doc, token, resolveString));
  }
  return cell;
}

function createBadge(
  doc: Document,
  token: string,
  resolveString: (id: FluentMessageId) => string,
): HTMLElement {
  const badge = doc.createElement("span");
  badge.className = "mineru-parse-column-badge";
  if (token.endsWith("-running")) {
    const mode = token.replace("-running", "");
    badge.classList.add("mineru-parse-column-badge-running");
    badge.textContent = `${resolveModeLabel(mode, resolveString)}(${resolveString(
      "item-tree-column-mineru-parse-running",
    )})`;
    return badge;
  }
  badge.textContent = resolveModeLabel(token, resolveString);
  return badge;
}

function resolveModeLabel(
  mode: string,
  resolveString: (id: FluentMessageId) => string,
): string {
  return mode === "lite"
    ? resolveString("item-tree-column-mineru-parse-lite")
    : resolveString("item-tree-column-mineru-parse-precise");
}
```

Add register/unregister/cache functions:

```ts
export async function registerItemTreeColumn(
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  if (state.registeredDataKey) {
    return;
  }

  const manager = dependencies.itemTreeManager ?? Zotero.ItemTreeManager;
  const resolveString = dependencies.getString ?? getString;
  try {
    const registeredDataKey = manager.registerColumn(
      createMinerUParseColumnRegistration({
        statuses: state.statuses,
        getString: resolveString,
      }),
    );
    if (!registeredDataKey) {
      return;
    }
    state.registeredDataKey = registeredDataKey;
    await refreshAllMinerUParseStatuses(dependencies);
  } catch (error) {
    (dependencies.log ?? ztoolkit.log)(
      "failed to register MinerU parse column",
      error,
    );
  }
}

export function unregisterItemTreeColumn(
  dependencies: ItemTreeColumnDependencies = {},
): void {
  const state = addon.data.itemTreeColumn;
  if (!state?.registeredDataKey) {
    addon.data.itemTreeColumn = undefined;
    return;
  }
  const manager = dependencies.itemTreeManager ?? Zotero.ItemTreeManager;
  try {
    manager.unregisterColumn(state.registeredDataKey);
  } catch (error) {
    (dependencies.log ?? ztoolkit.log)(
      "failed to unregister MinerU parse column",
      error,
    );
  }
  addon.data.itemTreeColumn = undefined;
}

export async function refreshAllMinerUParseStatuses(
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const storage = getColumnStorage(dependencies);
  const statuses = await storage.listParseStatuses();
  state.statuses.clear();
  for (const [key, status] of statuses) {
    state.statuses.set(key, {
      precise: status.preciseReady ? "ready" : "none",
      lite: status.liteReady ? "ready" : "none",
    });
  }
  refreshColumns(dependencies);
}

function getOrCreateItemTreeColumnState(): ItemTreeColumnState {
  addon.data.itemTreeColumn ??= { statuses: new Map() };
  return addon.data.itemTreeColumn;
}

function getColumnStorage(
  dependencies: ItemTreeColumnDependencies,
): StorageAdapter {
  if (dependencies.storage) {
    return dependencies.storage;
  }
  return (
    dependencies.createStorage?.() ?? createStorage(getMinerUStorageRoot())
  );
}

function refreshColumns(dependencies: ItemTreeColumnDependencies): void {
  (dependencies.itemTreeManager ?? Zotero.ItemTreeManager).refreshColumns();
}
```

- [ ] **Step 4: Add locale types and strings**

Add to `typings/i10n.d.ts` union:

```ts
| "item-tree-column-mineru-parse"
| "item-tree-column-mineru-parse-precise"
| "item-tree-column-mineru-parse-lite"
| "item-tree-column-mineru-parse-running"
```

Add to `addon/locale/zh-CN/mainWindow.ftl`:

```ftl
item-tree-column-mineru-parse = MinerU 解析
item-tree-column-mineru-parse-precise = 精准
item-tree-column-mineru-parse-lite = 轻量
item-tree-column-mineru-parse-running = 解析中
```

Add to `addon/locale/en-US/mainWindow.ftl`:

```ftl
item-tree-column-mineru-parse = MinerU Parse
item-tree-column-mineru-parse-precise = Precise
item-tree-column-mineru-parse-lite = Lite
item-tree-column-mineru-parse-running = Parsing
```

- [ ] **Step 5: Add CSS**

Append to `addon/content/zoteroPane.css`:

```css
.mineru-parse-column-cell {
  align-items: center;
  display: inline-flex;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.mineru-parse-column-badge {
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: 4px;
  box-sizing: border-box;
  display: inline-flex;
  font-size: 0.86em;
  line-height: 1.45;
  max-width: 100%;
  padding: 0 5px;
}

.mineru-parse-column-badge-running {
  border-style: dashed;
  font-weight: 600;
}
```

- [ ] **Step 6: Run tests and lint**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
pnpm lint:check
```

Expected: tests PASS and lint PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/itemTreeColumn.ts test/itemTreeColumn.test.ts typings/i10n.d.ts addon/locale/zh-CN/mainWindow.ftl addon/locale/en-US/mainWindow.ftl addon/content/zoteroPane.css
git commit -m "feat(column): render MinerU parse badges"
```

## Task 4: Running and Ready Status Updates

**Files:**

- Modify: `src/modules/itemTreeColumn.ts`
- Modify: `test/itemTreeColumn.test.ts`

- [ ] **Step 1: Add failing tests for running/ready/clear transitions**

Append to `test/itemTreeColumn.test.ts` imports:

```ts
import {
  clearAttachmentParseRunning,
  markAttachmentParseReady,
  markAttachmentParseRunning,
} from "../src/modules/itemTreeColumn";
```

Add tests:

```ts
it("marks a mode as running while preserving the other ready mode", async function () {
  addon.data.itemTreeColumn = {
    statuses: new Map([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "none",
        },
      ],
    ]),
  };
  let refreshCount = 0;

  await markAttachmentParseRunning({ libraryID: 12, key: "ABC123" }, "lite", {
    itemTreeManager: fakeItemTreeManager(() => refreshCount++),
  });

  assert.deepEqual(addon.data.itemTreeColumn.statuses.get("12-ABC123"), {
    precise: "ready",
    lite: "running",
  });
  assert.equal(refreshCount, 1);
});

it("marks a mode as ready after a successful parse", async function () {
  addon.data.itemTreeColumn = {
    statuses: new Map([
      [
        "12-ABC123",
        {
          precise: "none",
          lite: "running",
        },
      ],
    ]),
  };

  await markAttachmentParseReady({ libraryID: 12, key: "ABC123" }, "lite", {
    itemTreeManager: fakeItemTreeManager(),
  });

  assert.deepEqual(addon.data.itemTreeColumn.statuses.get("12-ABC123"), {
    precise: "none",
    lite: "ready",
  });
});

it("clears running status by re-reading disk ready status", async function () {
  addon.data.itemTreeColumn = {
    statuses: new Map([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "running",
        },
      ],
    ]),
  };

  await clearAttachmentParseRunning({ libraryID: 12, key: "ABC123" }, "lite", {
    itemTreeManager: fakeItemTreeManager(),
    storage: {
      ...fakeStorage(),
      readParseStatus: async () => ({
        preciseReady: true,
        liteReady: false,
      }),
    },
  });

  assert.deepEqual(addon.data.itemTreeColumn.statuses.get("12-ABC123"), {
    precise: "ready",
    lite: "none",
  });
});
```

Add helpers:

```ts
function fakeItemTreeManager(onRefresh: () => void = () => {}) {
  return {
    registerColumn: () => "registered-key",
    unregisterColumn: () => true,
    refreshColumns: onRefresh,
  };
}

function fakeStorage() {
  return {
    getAttachmentDir: () => "",
    hasReadyResult: async () => false,
    hasLiteResult: async () => false,
    readManifest: async () => {
      throw new Error("not needed");
    },
    readMarkdown: async () => "",
    readPreferredMarkdown: async () => "",
    readBoxes: async () => [],
    readParseStatus: async () => ({ preciseReady: false, liteReady: false }),
    listParseStatuses: async () => new Map(),
    writeResult: async () => {},
    writeFailedResult: async () => {},
    writeLiteResult: async () => {},
    countReadyResults: async () => 0,
    openDataFolder: async () => {},
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because transition functions do not exist.

- [ ] **Step 3: Implement transition functions**

Add to `src/modules/itemTreeColumn.ts`:

```ts
type ParseColumnMode = "precise" | "lite";

export async function markAttachmentParseRunning(
  ref: AttachmentStatusKeyRef,
  mode: ParseColumnMode,
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const key = getAttachmentStatusKey(ref);
  const status = {
    ...(state.statuses.get(key) ?? createEmptyParseColumnStatus()),
  };
  status[mode] = "running";
  state.statuses.set(key, status);
  refreshColumns(dependencies);
}

export async function markAttachmentParseReady(
  ref: AttachmentStatusKeyRef,
  mode: ParseColumnMode,
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const key = getAttachmentStatusKey(ref);
  const status = {
    ...(state.statuses.get(key) ?? createEmptyParseColumnStatus()),
  };
  status[mode] = "ready";
  state.statuses.set(key, status);
  refreshColumns(dependencies);
}

export async function clearAttachmentParseRunning(
  ref: AttachmentStatusKeyRef,
  mode: ParseColumnMode,
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const key = getAttachmentStatusKey(ref);
  const current = {
    ...(state.statuses.get(key) ?? createEmptyParseColumnStatus()),
  };
  try {
    const diskStatus =
      await getColumnStorage(dependencies).readParseStatus(ref);
    current.precise = diskStatus.preciseReady ? "ready" : "none";
    current.lite = diskStatus.liteReady ? "ready" : "none";
  } catch {
    current[mode] = "none";
  }
  if (current.precise === "none" && current.lite === "none") {
    state.statuses.delete(key);
  } else {
    state.statuses.set(key, current);
  }
  refreshColumns(dependencies);
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS for itemTreeColumn tests.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/itemTreeColumn.ts test/itemTreeColumn.test.ts
git commit -m "feat(column): track MinerU parsing state"
```

## Task 5: Lifecycle Registration

**Files:**

- Modify: `src/hooks.ts`
- Modify: `test/startup.test.ts`
- Modify: `test/itemTreeColumn.test.ts`

- [ ] **Step 1: Add failing startup tests**

Append to `test/startup.test.ts`:

```ts
it("registers the MinerU parse item tree column on main window load", async function () {
  assert.isTrue(
    Zotero.ItemTreeManager.isCustomColumn(
      `${config.addonID}-mineruParseStatus`,
    ),
  );
});
```

Append to `test/itemTreeColumn.test.ts`:

```ts
import { unregisterItemTreeColumn } from "../src/modules/itemTreeColumn";
```

Add this test inside `describe("itemTreeColumn", ...)`:

```ts
it("unregisters the registered MinerU parse column and clears runtime state", function () {
  addon.data.itemTreeColumn = {
    registeredDataKey: "registered-key",
    statuses: new Map([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "none",
        },
      ],
    ]),
  };
  const unregisteredKeys: string[] = [];

  unregisterItemTreeColumn({
    itemTreeManager: {
      registerColumn: () => "registered-key",
      unregisterColumn: (dataKey) => {
        unregisteredKeys.push(dataKey);
        return true;
      },
      refreshColumns: () => {},
    },
  });

  assert.deepEqual(unregisteredKeys, ["registered-key"]);
  assert.isUndefined(addon.data.itemTreeColumn);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because hooks do not register the column yet and `unregisterItemTreeColumn()` is not wired for this unit test.

- [ ] **Step 3: Wire lifecycle hooks**

Modify imports in `src/hooks.ts`:

```ts
import {
  registerItemTreeColumn,
  unregisterItemTreeColumn,
} from "./modules/itemTreeColumn";
```

In `onMainWindowLoad()`, after `registerItemMenu()`:

```ts
await registerItemTreeColumn();
```

In `onShutdown()`, before `ztoolkit.unregisterAll()`:

```ts
unregisterItemTreeColumn();
```

- [ ] **Step 4: Run startup tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS. The shutdown behavior is covered through the deterministic `unregisterItemTreeColumn()` unit test instead of calling `onShutdown()` inside the shared startup test process.

- [ ] **Step 5: Commit**

```powershell
git add src/hooks.ts test/startup.test.ts test/itemTreeColumn.test.ts
git commit -m "feat(column): register MinerU parse column"
```

## Task 6: Parse Manager Integration

**Files:**

- Modify: `src/modules/parseManager.ts`
- Modify: `test/parseManager.test.ts`

- [ ] **Step 1: Add failing tests for running and ready calls**

Extend `ParseManagerDependencies` tests by adding optional callbacks after `baseDependencies()` is available:

```ts
it("marks precise parsing as running and ready", async function () {
  const events: string[] = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    onParseColumnRunning: async (_attachment, mode) => {
      events.push(`${mode}:running`);
    },
    onParseColumnReady: async (_attachment, mode) => {
      events.push(`${mode}:ready`);
    },
    client: successfulPreciseClient(),
  });

  await manager.parseAttachment(pdfAttachment());

  assert.deepEqual(events, ["precise:running", "precise:ready"]);
});

it("marks lite parsing as running and ready", async function () {
  const events: string[] = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    getParseMode: () => "lite",
    onParseColumnRunning: async (_attachment, mode) => {
      events.push(`${mode}:running`);
    },
    onParseColumnReady: async (_attachment, mode) => {
      events.push(`${mode}:ready`);
    },
    client: {
      submitPdf: async () => ({ taskID: "lite-task" }),
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
    },
  });

  await manager.parseAttachment(pdfAttachment());

  assert.deepEqual(events, ["lite:running", "lite:ready"]);
});

it("clears running parse column status after parse failure", async function () {
  const events: string[] = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    onParseColumnRunning: async (_attachment, mode) => {
      events.push(`${mode}:running`);
    },
    onParseColumnClearRunning: async (_attachment, mode) => {
      events.push(`${mode}:clear`);
    },
    client: {
      submitPdf: async () => {
        throw new MinerURequestError("upload", 403, "bad signature");
      },
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => preciseResultFixture(),
    },
  });

  await manager.parseAttachment(pdfAttachment());

  assert.deepEqual(events, ["precise:running", "precise:clear"]);
});

it("clears running parse column status for empty lite markdown", async function () {
  const events: string[] = [];
  const manager = createParseManager({
    ...baseDependencies([]),
    getParseMode: () => "lite",
    onParseColumnRunning: async (_attachment, mode) => {
      events.push(`${mode}:running`);
    },
    onParseColumnClearRunning: async (_attachment, mode) => {
      events.push(`${mode}:clear`);
    },
    client: {
      submitPdf: async () => ({ taskID: "lite-task" }),
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => ({ kind: "lite", markdown: " " }),
    },
  });

  await manager.parseAttachment(pdfAttachment());

  assert.deepEqual(events, ["lite:running", "lite:clear"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because `ParseManagerDependencies` does not include parse column callbacks.

- [ ] **Step 3: Add parse column dependencies**

Modify imports in `src/modules/parseManager.ts`:

```ts
import {
  clearAttachmentParseRunning,
  markAttachmentParseReady,
  markAttachmentParseRunning,
} from "./itemTreeColumn";
```

Extend `ParseManagerDependencies`:

```ts
onParseColumnRunning?: (
  attachment: AttachmentRef,
  mode: ParseMode,
) => Promise<void>;
onParseColumnReady?: (
  attachment: AttachmentRef,
  mode: ParseMode,
) => Promise<void>;
onParseColumnClearRunning?: (
  attachment: AttachmentRef,
  mode: ParseMode,
) => Promise<void>;
```

Add defaults in `createDefaultDependencies()`:

```ts
onParseColumnRunning: markAttachmentParseRunning,
onParseColumnReady: markAttachmentParseReady,
onParseColumnClearRunning: clearAttachmentParseRunning,
```

- [ ] **Step 4: Mark running before submit and clear on all non-success exits**

In `parseAttachmentWithDependencies()`, after `attachmentRef` is created and before `client.submitPdf()`:

```ts
let parseColumnRunning = false;
await dependencies.onParseColumnRunning?.(attachmentRef, mode);
parseColumnRunning = true;
```

In lite empty markdown branch, before `return`:

```ts
if (parseColumnRunning) {
  await dependencies.onParseColumnClearRunning?.(attachmentRef, mode);
  parseColumnRunning = false;
}
```

After successful lite write, before finished notice:

```ts
await dependencies.onParseColumnReady?.(attachmentRef, "lite");
parseColumnRunning = false;
```

In empty boxes branch, before `return`:

```ts
if (parseColumnRunning) {
  await dependencies.onParseColumnClearRunning?.(attachmentRef, mode);
  parseColumnRunning = false;
}
```

After successful precise write, before finished notice:

```ts
await dependencies.onParseColumnReady?.(attachmentRef, "precise");
parseColumnRunning = false;
```

In `catch`, before mapping user-visible message:

```ts
if (parseColumnRunning) {
  await dependencies.onParseColumnClearRunning?.(attachmentRef, mode);
}
```

- [ ] **Step 5: Run parse manager tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS for parseManager tests.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/parseManager.ts test/parseManager.test.ts
git commit -m "feat(parse): update MinerU parse column state"
```

## Task 7: Final Verification and Cleanup

**Files:**

- Review all touched files.

- [ ] **Step 1: Inspect diff for unrelated changes**

Run:

```powershell
git status --short
git diff --stat
git diff --check
```

Expected: only task-related files are modified and `git diff --check` exits 0.

- [ ] **Step 2: Run final lint**

Run:

```powershell
pnpm lint:check
```

Expected: PASS with Prettier and ESLint both clean.

- [ ] **Step 3: Run final scaffold test suite**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: all scaffold tests pass.

- [ ] **Step 4: Manual Zotero smoke test**

Run:

```powershell
pnpm start
```

Expected:

- Zotero opens with a `MinerU 解析` column available in the item tree column picker.
- A PDF attachment with no MinerU result shows an empty cell.
- A PDF attachment with precise result shows `精准`.
- A PDF attachment with lite result shows `轻量`.
- A PDF attachment with both results shows `精准` and `轻量`.
- Starting precise parsing changes the corresponding badge to `精准(解析中)`.
- Starting lite parsing changes the corresponding badge to `轻量(解析中)`.
- Failed parsing clears the running badge and leaves previous ready badges intact.

Stop the dev server after the smoke test.

- [ ] **Step 5: Commit final cleanup if needed**

If Task 7 changed files, commit the task-related files:

```powershell
git add src/modules/storage.ts src/modules/itemTreeColumn.ts src/modules/parseManager.ts src/hooks.ts src/addon.ts typings/i10n.d.ts addon/content/zoteroPane.css addon/locale/zh-CN/mainWindow.ftl addon/locale/en-US/mainWindow.ftl test/storage.test.ts test/itemTreeColumn.test.ts test/parseManager.test.ts test/startup.test.ts
git commit -m "test(column): verify MinerU parse column"
```

If Task 7 did not change files, do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers the custom item tree column, PDF-only display, precise/lite badges, running mode badges, failed result omission, runtime cache in `addon.data`, storage status APIs, lifecycle registration, parseManager status transitions, locale strings, CSS, and final verification.
- Placeholder scan: No placeholder markers or open-ended implementation instructions remain.
- Type consistency: `ParseColumnStatus`, `ParseColumnModeState`, `readParseStatus()`, `listParseStatuses()`, `markAttachmentParseRunning()`, `markAttachmentParseReady()`, and `clearAttachmentParseRunning()` use consistent names across tasks.
