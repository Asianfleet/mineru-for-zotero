# API Source And Parse Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global API source and parse mode preferences so the plugin supports online/local and precise/lite parsing while preserving existing precise-result behavior.

**Architecture:** Keep the existing `MinerUClient` submit/poll/download contract, but make `downloadResult()` return a discriminated union for precise vs lite results. Add focused online-lite and local-API client modules, keep storage responsible for precise-vs-lite file semantics, and let `parseManager` branch only on result kind.

**Tech Stack:** TypeScript ES modules, Zotero plugin scaffold, Mocha/Chai tests, Fluent locale files, Zotero/Firefox `fetch`/XHR/IOUtils APIs.

---

## File Structure

- Modify `typings/prefs.d.ts`: add `parseSource`, `parseMode`, and `localApiBaseURL` preference types.
- Modify `addon/prefs.js`: add default preference values.
- Modify `src/utils/prefs.ts`: add typed getters/setters for the new preferences and safe defaults.
- Modify `addon/content/preferences.xhtml`: add source/mode/local URL controls without reflowing unrelated XHTML.
- Modify `addon/locale/zh-CN/preferences.ftl` and `addon/locale/en-US/preferences.ftl`: add preference labels/help text.
- Modify `typings/i10n.d.ts`: add new locale IDs used by preferences and parse messages.
- Modify `addon/locale/zh-CN/mainWindow.ftl` and `addon/locale/en-US/mainWindow.ftl`: add parse status/error strings.
- Modify `src/modules/mineruClient/types.ts`: add parse option/result unions and local/agent response types.
- Create `src/modules/mineruClient/factory.ts`: map preferences to the right client implementation.
- Rename current online precise implementation conceptually by editing `src/modules/mineruClient/index.ts`: preserve `createMinerUClient()` export and re-export factory/client helpers.
- Create `src/modules/mineruClient/onlinePrecise.ts`: place the existing v4 batch implementation from `src/modules/mineruClient/index.ts` behind `createOnlinePreciseMinerUClient(options)`.
- Create `src/modules/mineruClient/agentLite.ts`: implement online Agent lite async flow.
- Create `src/modules/mineruClient/local.ts`: implement local `/health`, `/tasks`, polling, and result download parsing.
- Create `src/modules/mineruClient/formData.ts`: build multipart form data in one place for local API clients.
- Modify `src/modules/mineruClient/result.ts`: add local ZIP extraction helpers if the existing ZIP helper needs source-specific filename support.
- Modify `src/modules/storage.ts`: add lite result write/read/preferred Markdown methods.
- Modify `src/modules/domain.ts`: add `LiteParseManifest`.
- Modify `src/modules/parseManager.ts`: read preferences, create clients, handle precise vs lite results, and mode-specific existing-result checks.
- Modify `src/modules/readerOverlay/copy.ts`: use preferred Markdown for full-copy fallback.
- Modify tests in `test/prefs`, `test/mineruClient.test.ts`, `test/storage.test.ts`, `test/parseManager.test.ts`, and `test/readerOverlay.test.ts`.

## Task 1: Preferences And Locale Surface

**Files:**

- Modify: `typings/prefs.d.ts`
- Modify: `addon/prefs.js`
- Modify: `src/utils/prefs.ts`
- Modify: `addon/content/preferences.xhtml`
- Modify: `addon/locale/zh-CN/preferences.ftl`
- Modify: `addon/locale/en-US/preferences.ftl`
- Modify: `typings/i10n.d.ts`
- Test: `test/preferenceScript.test.ts`

- [x] **Step 1: Add failing preference tests**

Add tests to `test/preferenceScript.test.ts` near the existing `getSaveImages` tests:

```ts
import {
  getLocalApiBaseURL,
  getParseMode,
  getParseSource,
  setLocalApiBaseURL,
  setParseMode,
  setParseSource,
} from "../src/utils/prefs";

it("defaults parse source, parse mode, and local API URL", function () {
  assert.equal(getParseSource(), "online");
  assert.equal(getParseMode(), "precise");
  assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:8000");
});

it("round-trips parse source, parse mode, and local API URL", function () {
  setParseSource("local");
  setParseMode("lite");
  setLocalApiBaseURL("http://127.0.0.1:9000/");

  assert.equal(getParseSource(), "local");
  assert.equal(getParseMode(), "lite");
  assert.equal(getLocalApiBaseURL(), "http://127.0.0.1:9000/");
});
```

- [x] **Step 2: Run the focused preference test and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "parse source" --exit-on-finish --abort-on-fail
```

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

Expected: FAIL because `getParseSource`, `getParseMode`, and `getLocalApiBaseURL` are not exported.

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令先因 `unknown option '--grep'` 失败，未能进入预期的测试用例失败阶段；该环境偏差已记录，后续以全量 `zotero-plugin test --exit-on-finish --abort-on-fail` 验证新增测试。

- [x] **Step 3: Add preference types and defaults**

In `typings/prefs.d.ts`, extend `PluginPrefsMap`:

```ts
"parseSource": "online" | "local";
"parseMode": "precise" | "lite";
"localApiBaseURL": string;
```

In `addon/prefs.js`, set defaults:

```js
pref("parseSource", "online");
pref("parseMode", "precise");
pref("localApiBaseURL", "http://127.0.0.1:8000");
```

- [x] **Step 4: Add typed preference helpers**

In `src/utils/prefs.ts`, add exported types and helpers:

```ts
export type ParseSource = "online" | "local";
export type ParseMode = "precise" | "lite";

export function getParseSource(): ParseSource {
  const value = getPref("parseSource");
  return value === "local" ? "local" : "online";
}

export function setParseSource(value: ParseSource) {
  return setPref("parseSource", value);
}

export function getParseMode(): ParseMode {
  const value = getPref("parseMode");
  return value === "lite" ? "lite" : "precise";
}

export function setParseMode(value: ParseMode) {
  return setPref("parseMode", value);
}

export function getLocalApiBaseURL(): string {
  const value = getPref("localApiBaseURL");
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "http://127.0.0.1:8000";
}

export function setLocalApiBaseURL(value: string) {
  return setPref("localApiBaseURL", value);
}
```

- [x] **Step 5: Add preference UI controls**

In `addon/content/preferences.xhtml`, insert a new `vbox` after the API Key block and before `saveImages`:

```xml
  <vbox>
    <html:h3 data-l10n-id="pref-api-source-title"></html:h3>
    <html:select
      id="zotero-prefpane-__addonRef__-parse-source"
      preference="parseSource"
    >
      <html:option value="online" data-l10n-id="pref-api-source-online"></html:option>
      <html:option value="local" data-l10n-id="pref-api-source-local"></html:option>
    </html:select>
    <html:div data-l10n-id="pref-api-source-help"></html:div>
  </vbox>
  <vbox>
    <html:h3 data-l10n-id="pref-parse-mode-title"></html:h3>
    <html:select
      id="zotero-prefpane-__addonRef__-parse-mode"
      preference="parseMode"
    >
      <html:option value="precise" data-l10n-id="pref-parse-mode-precise"></html:option>
      <html:option value="lite" data-l10n-id="pref-parse-mode-lite"></html:option>
    </html:select>
    <html:div data-l10n-id="pref-parse-mode-help"></html:div>
  </vbox>
  <vbox>
    <html:h3
      for="zotero-prefpane-__addonRef__-local-api-base-url"
      data-l10n-id="pref-local-api-base-url"
    ></html:h3>
    <html:input
      type="text"
      id="zotero-prefpane-__addonRef__-local-api-base-url"
      preference="localApiBaseURL"
    ></html:input>
    <html:div data-l10n-id="pref-local-api-base-url-help"></html:div>
  </vbox>
```

- [x] **Step 6: Add preference locale strings**

Append to `addon/locale/zh-CN/preferences.ftl`:

```ftl
pref-api-source-title = API 来源
pref-api-source-online = 在线 API
pref-api-source-local = 本地部署 API
pref-api-source-help = 解析命令始终使用这里选择的 API 来源。
pref-parse-mode-title = 解析模式
pref-parse-mode-precise = 精准解析
pref-parse-mode-lite = 轻量解析
pref-parse-mode-help = 精准解析生成框选数据；轻量解析只保存 Markdown。
pref-local-api-base-url = 本地 API 地址
pref-local-api-base-url-help = 本地 mineru-api 或 mineru-router 地址，例如 http://127.0.0.1:8000。
```

Append to `addon/locale/en-US/preferences.ftl`:

```ftl
pref-api-source-title = API Source
pref-api-source-online = Online API
pref-api-source-local = Local API
pref-api-source-help = Parse commands always use the API source selected here.
pref-parse-mode-title = Parse Mode
pref-parse-mode-precise = Precise Parse
pref-parse-mode-lite = Lite Parse
pref-parse-mode-help = Precise parse creates box data; lite parse saves Markdown only.
pref-local-api-base-url = Local API URL
pref-local-api-base-url-help = Local mineru-api or mineru-router URL, for example http://127.0.0.1:8000.
```

Update `typings/i10n.d.ts` to include each new `pref-*` ID.

- [x] **Step 7: Run focused preference tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "parse source" --exit-on-finish --abort-on-fail
```

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

Expected: PASS for the new preference tests.

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令无法作为 focused test 使用；已改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `123 passed`，其中新增 preference 测试通过。

- [x] **Step 8: Commit preference surface**

```powershell
git add typings\prefs.d.ts addon\prefs.js src\utils\prefs.ts addon\content\preferences.xhtml addon\locale\zh-CN\preferences.ftl addon\locale\en-US\preferences.ftl typings\i10n.d.ts test\preferenceScript.test.ts
git commit -m "feat(prefs): 增加 API 来源与解析模式设置"
```

实现说明：
本轮已补充 parse source、parse mode、local API URL 的默认值与 round-trip 测试，扩展了 `PluginPrefsMap`、`src/utils/prefs.ts` 的类型化 helper，以及 preferences.xhtml 中对应的来源、模式和本地地址控件；同时补齐了中英文 locale 文案与 `typings/i10n.d.ts` 中新增的 `pref-*` ID。
测试方面，按计划执行的 `.\node_modules\.bin\zotero-plugin.CMD test --grep "parse source" --exit-on-finish --abort-on-fail` 在当前脚手架版本下直接失败，错误为 `unknown option '--grep'`；因此改用 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 进行验证，结果为 `123 passed`，其中 `preferenceScript` 下新增的两条 parse source 相关测试通过。审查后已把 round-trip 测试改为 `finally` 中恢复默认偏好，避免持久 Zotero preferences 污染后续测试。

## Task 2: Client Result Types And Factory

**Files:**

- Modify: `src/modules/mineruClient/types.ts`
- Create: `src/modules/mineruClient/onlinePrecise.ts`
- Create: `src/modules/mineruClient/factory.ts`
- Modify: `src/modules/mineruClient/index.ts`
- Test: `test/mineruClient.test.ts`

- [x] **Step 1: Add failing factory tests**

Add to `test/mineruClient.test.ts`:

```ts
import { createMinerUClientForSettings } from "../src/modules/mineruClient";

it("creates the online precise client by default", async function () {
  const calls: string[] = [];
  const client = createMinerUClientForSettings({
    source: "online",
    mode: "precise",
    apiKey: "secret-token",
    readBinary: async () => new Uint8Array([1]),
    fetch: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/api/v4/file-urls/batch")) {
        return jsonResponse({
          code: 0,
          data: {
            batch_id: "batch-1",
            file_urls: ["https://upload.example/a"],
          },
        });
      }
      return new Response("", { status: 200 });
    },
  });

  await client.submitPdf("C:/tmp/a.pdf");

  assert.equal(calls[0], "POST https://mineru.net/api/v4/file-urls/batch");
});
```

- [x] **Step 2: Run the focused factory test and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "creates the online precise client" --exit-on-finish --abort-on-fail
```

Expected: FAIL because `createMinerUClientForSettings` does not exist.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令先因 `unknown option '--grep'` 失败，未能进入预期的测试用例失败阶段；随后改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，构建阶段按预期失败，错误为 `No matching export in "src/modules/mineruClient/index.ts" for import "createMinerUClientForSettings"`，确认新增测试已覆盖缺失 factory 导出的 red 阶段。

- [x] **Step 3: Extend result and settings types**

In `src/modules/mineruClient/types.ts`, replace the current `downloadResult` shape with:

```ts
export type MinerUParseSource = "online" | "local";
export type MinerUParseMode = "precise" | "lite";

export type MinerUPreciseResult = {
  kind: "precise";
  rawResult: unknown;
  markdown: string;
  images?: MinerUImageFile[];
};

export type MinerULiteResult = {
  kind: "lite";
  markdown: string;
};

export type MinerUParseResult = MinerUPreciseResult | MinerULiteResult;

export interface MinerUClient {
  submitPdf(filePath: string): Promise<{ taskID: string }>;
  pollTask(
    taskID: string,
  ): Promise<{ status: "running" | "succeeded" | "failed"; error?: string }>;
  downloadResult(taskID: string): Promise<MinerUParseResult>;
}

export interface MinerUClientFactoryOptions extends MinerUClientOptions {
  source: MinerUParseSource;
  mode: MinerUParseMode;
  localApiBaseURL?: string;
  saveImages?: boolean;
}
```

- [x] **Step 4: Move current implementation into online precise module**

Create `src/modules/mineruClient/onlinePrecise.ts` by copying the full current `createMinerUClient(options: MinerUClientOptions)` implementation from `index.ts`. In the copied file, change the function declaration line from:

```ts
export function createMinerUClient(options: MinerUClientOptions): MinerUClient {
```

to:

```ts
export function createOnlinePreciseMinerUClient(options: MinerUClientOptions): MinerUClient {
```

Ensure every returned download result has `kind: "precise"`:

```ts
return {
  kind: "precise",
  rawResult: readRawResultFromZip(zip) ?? response,
  markdown: zip.has("full.md")
    ? decodeText(zip.get("full.md")?.bytes ?? new Uint8Array())
    : "",
  images: readImagesFromZip(zip),
};
```

For the `md_url` fallback:

```ts
return {
  kind: "precise",
  rawResult: response,
  markdown: await markdownResponse.text(),
};
```

- [x] **Step 5: Add factory module**

Create `src/modules/mineruClient/factory.ts`:

```ts
import { createOnlinePreciseMinerUClient } from "./onlinePrecise";
import type { MinerUClient, MinerUClientFactoryOptions } from "./types";

export function createMinerUClientForSettings(
  options: MinerUClientFactoryOptions,
): MinerUClient {
  if (options.source === "online" && options.mode === "precise") {
    return createOnlinePreciseMinerUClient(options);
  }
  throw new Error(
    `Unsupported MinerU client mode: ${options.source}/${options.mode}`,
  );
}
```

- [x] **Step 6: Keep public exports compatible**

Replace `src/modules/mineruClient/index.ts` with exports that keep current imports working:

```ts
export {
  MinerUFileAccessError,
  MinerURequestError,
  MinerUTaskError,
} from "./errors";
export { createMinerUClientForSettings } from "./factory";
export { createOnlinePreciseMinerUClient as createMinerUClient } from "./onlinePrecise";
export type {
  MinerUClient,
  MinerUClientFactoryOptions,
  MinerULiteResult,
  MinerUParseMode,
  MinerUParseResult,
  MinerUParseSource,
  MinerUPreciseResult,
} from "./types";
```

- [x] **Step 7: Update existing tests for result kind**

In `test/mineruClient.test.ts`, where tests assert result object equality, add `kind: "precise"` or assert specific fields. Example:

```ts
assert.equal(result.kind, "precise");
assert.equal(result.markdown, "# Title");
if (result.kind !== "precise") {
  assert.fail("Expected precise result");
}
assert.deepEqual(result.rawResult, { pages: [{ pageNo: 1 }] });
```

- [x] **Step 8: Run mineru client tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "mineruClient" --exit-on-finish --abort-on-fail
```

Expected: PASS.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令无法作为 focused test 使用；已改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `124 passed`，其中 `mineruClient` 分组共 17 条测试全部通过，新增 factory 测试与 `result.kind` 相关断言通过。

- [x] **Step 9: Commit client factory**

```powershell
git add src\modules\mineruClient\types.ts src\modules\mineruClient\onlinePrecise.ts src\modules\mineruClient\factory.ts src\modules\mineruClient\index.ts test\mineruClient.test.ts
git commit -m "refactor(mineru): 拆分在线精准 client"
```

实现说明：
本轮把 `MinerUClient` 的下载结果扩展为 `precise | lite` 判别联合，并新增 `MinerUClientFactoryOptions`、`MinerUParseSource`、`MinerUParseMode` 等类型；随后将原先 `index.ts` 中的在线 precise v4 实现整体迁移到 `onlinePrecise.ts`，统一在 ZIP 和 `md_url` 回退路径上返回 `kind: "precise"`。
同时新增 `factory.ts`，提供 `createMinerUClientForSettings()`，当前先支持 `online/precise` 映射，并在 `index.ts` 中保留 `createMinerUClient` 旧入口导出到 `createOnlinePreciseMinerUClient`，避免现有 `parseManager` 与测试调用面破坏。由于 `downloadResult()` 已变为 union，而 Task 4 才会接入 lite 写入分支，本轮在 `parseManager` 下载后加了一个临时 `result.kind === "lite"` guard，使当前中间态保持类型正确且不改变 online precise 行为；审查后该 guard 改为记录日志并显示 generic 错误，避免把未接线的 lite 分支误报为下载失败。测试方面，按计划补充了 factory 创建测试，并把现有 `downloadResult()` 断言更新为校验 `result.kind === "precise"` 后再断言 `rawResult` 与 `images`；由于当前脚手架 CLI 不支持 `--grep`，最终使用 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 全量验证，结果为 `124 passed`；另运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。

## Task 3: Storage Lite Results And Preferred Markdown

**Files:**

- Modify: `src/modules/domain.ts`
- Modify: `src/modules/storage.ts`
- Test: `test/storage.test.ts`

- [x] **Step 1: Add failing storage tests**

Add to `test/storage.test.ts`:

```ts
it("writes and detects lite markdown without ready precise result", async function () {
  const storage = createStorage("TmpD/mineru-copy-test");
  const attachment = attachmentRef();

  await storage.writeLiteResult({
    attachment,
    mineruTaskID: "lite-task",
    source: "online",
    markdown: "# Lite",
  });

  assert.isTrue(await storage.hasLiteResult(attachment));
  assert.isFalse(await storage.hasReadyResult(attachment));
  assert.equal(await storage.readPreferredMarkdown(attachment), "# Lite");
});

it("prefers precise markdown over lite markdown", async function () {
  const storage = createStorage("TmpD/mineru-copy-test");
  const attachment = attachmentRef({ key: "PREFER" });

  await storage.writeLiteResult({
    attachment,
    mineruTaskID: "lite-task",
    source: "local",
    markdown: "# Lite",
  });
  await storage.writeResult({
    attachment,
    mineruTaskID: "precise-task",
    rawResult: { pages: [{ pageNo: 1 }] },
    markdown: "# Precise",
    boxes: normalizedBoxes,
  });

  assert.equal(await storage.readPreferredMarkdown(attachment), "# Precise");
});
```

- [x] **Step 2: Run focused storage tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "lite markdown" --exit-on-finish --abort-on-fail
```

Expected: FAIL because `writeLiteResult`, `hasLiteResult`, and `readPreferredMarkdown` do not exist.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令先因 `unknown option '--grep'` 失败；随后改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，构建与测试阶段按预期失败，首个失败用例为 `writes and detects lite markdown without ready precise result`，原因是 `writeLiteResult`/`hasLiteResult`/`readPreferredMarkdown` 尚不存在，确认 red 阶段成立。

- [x] **Step 3: Add lite manifest domain type**

In `src/modules/domain.ts`, add:

```ts
export interface LiteParseManifest {
  attachmentID: number;
  attachmentKey: string;
  libraryID: number;
  fileName: string;
  pdfMtime: number;
  parsedAt: string;
  mineruTaskID: string;
  resultVersion: 1;
  source: "online" | "local";
  mode: "lite";
  status: "ready";
}
```

- [x] **Step 4: Extend storage adapter**

In `src/modules/storage.ts`, import `LiteParseManifest` and extend `StorageAdapter`:

```ts
hasLiteResult(ref: AttachmentKeyRef): Promise<boolean>;
readPreferredMarkdown(ref: AttachmentKeyRef): Promise<string>;
writeLiteResult(input: {
  attachment: AttachmentRef;
  mineruTaskID: string;
  source: "online" | "local";
  markdown: string;
}): Promise<void>;
```

Add constants:

```ts
const LITE_CONTENT_FILE = "lite-content.md";
const LITE_MANIFEST_FILE = "lite-manifest.json";
```

- [x] **Step 5: Implement lite storage methods**

Inside `createStorage()` return object:

```ts
async hasLiteResult(ref) {
  try {
    const markdown = await readText(joinPath(getAttachmentDir(fsRoot, ref), LITE_CONTENT_FILE));
    return markdown.trim().length > 0;
  } catch {
    return false;
  }
},

async readPreferredMarkdown(ref) {
  try {
    return await this.readMarkdown(ref);
  } catch {
    const markdown = await readText(joinPath(getAttachmentDir(fsRoot, ref), LITE_CONTENT_FILE));
    if (!markdown.trim()) {
      throw new Error("MinerU lite result is empty");
    }
    return markdown;
  }
},

async writeLiteResult(input) {
  if (!input.markdown.trim()) {
    throw new Error("MinerU lite markdown is empty");
  }
  const dir = getAttachmentDir(fsRoot, input.attachment);
  const manifest: LiteParseManifest = {
    attachmentID: input.attachment.id,
    attachmentKey: input.attachment.key,
    libraryID: input.attachment.libraryID,
    fileName: input.attachment.fileName,
    pdfMtime: input.attachment.mtime,
    parsedAt: new Date().toISOString(),
    mineruTaskID: input.mineruTaskID,
    resultVersion: 1,
    source: input.source,
    mode: "lite",
    status: "ready",
  };
  await writeText(joinPath(dir, LITE_CONTENT_FILE), input.markdown);
  await writeJson(joinPath(dir, LITE_MANIFEST_FILE), manifest);
},
```

If TypeScript rejects `this.readMarkdown(ref)` inside the object, use a local helper:

```ts
async function readReadyMarkdown(
  root: string,
  ref: AttachmentKeyRef,
): Promise<string> {
  const dir = getAttachmentDir(root, ref);
  const manifest = await readManifestFile(dir);
  if (manifest.status !== "ready") {
    throw new Error(`MinerU result is not ready: ${manifest.status}`);
  }
  return readText(joinPath(dir, CONTENT_FILE));
}
```

Then call `readReadyMarkdown(fsRoot, ref)` from both `readMarkdown` and `readPreferredMarkdown`.

- [x] **Step 6: Preserve lite files across precise writes**

Before moving a new precise temp dir over an existing target dir in `writeAttachmentResultDir`, copy existing lite files into the temp dir:

```ts
await preserveLiteFiles(targetDir, tempDir);
```

Add helper:

```ts
async function preserveLiteFiles(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  for (const fileName of [LITE_CONTENT_FILE, LITE_MANIFEST_FILE]) {
    const source = joinPath(sourceDir, fileName);
    if (!(await exists(source))) {
      continue;
    }
    await writeText(joinPath(targetDir, fileName), await readText(source));
  }
}
```

Call it after validating temp dir and before moving `targetDir` to backup. This ensures a new precise parse does not delete existing lite Markdown.

- [x] **Step 7: Run storage tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "storage" --exit-on-finish --abort-on-fail
```

Expected: PASS.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令无法作为 focused test 使用；已改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，初始结果为 `127 passed`。审查后补充 precise 损坏不回退 lite、以及不保留不完整 lite 文件两个边界用例，并重新验证为 `129 passed`；另行运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。

- [x] **Step 8: Commit lite storage**

```powershell
git add src\modules\domain.ts src\modules\storage.ts test\storage.test.ts
git commit -m "feat(storage): 保存轻量解析 markdown"
```

执行说明：按当前子代理约束，本轮不执行 commit，由主代理统一审查和提交。

实现说明：
本轮在 `domain.ts` 新增 `LiteParseManifest`，并在 `storage.ts` 中补充 `hasLiteResult()`、`writeLiteResult()`、`readPreferredMarkdown()` 以及 `lite-content.md` / `lite-manifest.json` 常量。`readMarkdown()` 与 `readPreferredMarkdown()` 共用 ready Markdown helper，避免重复判定逻辑；`writeLiteResult()` 对空 Markdown 显式报错。
为了不破坏现有 precise 结果目录的原子替换与 backup 语义，`writeAttachmentResultDir()` 仍然先写临时目录并校验，再在替换前把已有完整 lite 文件复制进新的 precise temp dir，保证 precise 重写不会删除之前的 lite Markdown。审查后进一步收紧了两个边界：`readPreferredMarkdown()` 只在不存在 ready precise manifest 或 precise manifest 非 ready 时才回退 lite，避免 ready precise 内容损坏时被静默降级；`preserveLiteFiles()` 只有在 `lite-content.md` 与 `lite-manifest.json` 同时存在且 manifest 可解析时才迁移，避免保留半成品 lite 状态。测试方面，先补了 lite-only、preferred markdown、以及 precise 写入保留 lite 文件的用例，审查后又补了 ready precise 内容损坏不回退、以及不保留不完整 lite 文件的边界用例；由于当前 scaffold CLI 不支持 `--grep`，最终使用 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 全量验证，结果为 `129 passed`，并且 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。

## Task 4: Parse Manager Mode Branching

**Files:**

- Modify: `src/modules/parseManager.ts`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `typings/i10n.d.ts`
- Test: `test/parseManager.test.ts`

- [x] **Step 1: Add failing parse manager tests**

Add to `test/parseManager.test.ts`:

```ts
it("does not require an API key for lite results", async function () {
  const messages: string[] = [];
  let wroteLite = false;
  const manager = createParseManager({
    ...baseDependencies(messages),
    getApiKey: () => "",
    getParseSource: () => "online",
    getParseMode: () => "lite",
    storage: {
      ...baseStorage(),
      hasLiteResult: async () => false,
      writeLiteResult: async () => {
        wroteLite = true;
      },
    },
    client: {
      submitPdf: async () => ({ taskID: "lite-task" }),
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
    },
  });

  await manager.parseAttachment(pdfAttachment());

  assert.isTrue(wroteLite);
  assert.notInclude(messages, "parse-error-missing-api-key");
});

it("writes precise results only for precise client results", async function () {
  const messages: string[] = [];
  let wrotePrecise = false;
  const manager = createParseManager({
    ...baseDependencies(messages),
    getParseSource: () => "online",
    getParseMode: () => "precise",
    storage: {
      ...baseStorage(),
      writeResult: async () => {
        wrotePrecise = true;
      },
    },
    client: {
      submitPdf: async () => ({ taskID: "precise-task" }),
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => ({
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
      }),
    },
  });

  await manager.parseAttachment(pdfAttachment());

  assert.isTrue(wrotePrecise);
});
```

After production types are changed, update the test helper exactly as described in Step 8: add `getParseSource`, `getParseMode`, and `getLocalApiBaseURL` to `baseDependencies()`, and add `hasLiteResult`, `readPreferredMarkdown`, and `writeLiteResult` to `baseStorage()`.

- [x] **Step 2: Run focused parse manager tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "lite results" --exit-on-finish --abort-on-fail
```

Expected: FAIL because parse manager does not understand mode/source or lite results.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令先因 `unknown option '--grep'` 失败，未能进入预期的测试用例失败阶段；随后改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果按预期在新增测试 `does not require an API key for lite results` 上失败，报错为 `expected false to be true`，确认 red 阶段成立。

- [x] **Step 3: Extend parse manager dependencies**

In `src/modules/parseManager.ts`, import new preference getters:

```ts
import {
  getApiKey,
  getLocalApiBaseURL,
  getParseMode,
  getParseSource,
  getSaveImages,
  type ParseMode,
  type ParseSource,
} from "../utils/prefs";
```

Extend `ParseManagerDependencies`:

```ts
getParseSource?: () => ParseSource;
getParseMode?: () => ParseMode;
getLocalApiBaseURL?: () => string;
createClient?: (settings: {
  apiKey: string;
  source: ParseSource;
  mode: ParseMode;
  localApiBaseURL: string;
  saveImages: boolean;
}) => MinerUClient;
```

- [x] **Step 4: Add helper functions for settings**

Add helpers near `getClient`:

```ts
function getCurrentParseSource(
  dependencies: ParseManagerDependencies,
): ParseSource {
  return dependencies.getParseSource?.() ?? "online";
}

function getCurrentParseMode(
  dependencies: ParseManagerDependencies,
): ParseMode {
  return dependencies.getParseMode?.() ?? "precise";
}

function requiresApiKey(source: ParseSource, mode: ParseMode): boolean {
  return source === "online" && mode === "precise";
}
```

Update `createDefaultDependencies()`:

```ts
getParseSource,
getParseMode,
getLocalApiBaseURL,
createClient: (settings) => createMinerUClientForSettings(settings),
```

- [x] **Step 5: Make existing-result checks mode-specific**

In both single and bulk parse paths, replace unconditional API-key and ready checks with:

```ts
const source = getCurrentParseSource(dependencies);
const mode = getCurrentParseMode(dependencies);
const apiKey = dependencies.getApiKey().trim();
if (requiresApiKey(source, mode) && !apiKey) {
  dependencies.showMessage("parse-error-missing-api-key");
  return;
}
```

Add helper:

```ts
async function hasExistingResultForMode(
  attachment: AttachmentRef,
  mode: ParseMode,
  storage: StorageAdapter,
): Promise<boolean> {
  return mode === "lite"
    ? await storage.hasLiteResult(attachment)
    : await storage.hasReadyResult(attachment);
}
```

Use this helper where `hasReadyResult()` is currently used.

- [x] **Step 6: Branch writes by result kind**

After `const result = await client.downloadResult(taskID);`, add:

```ts
if (result.kind === "lite") {
  phase = "write";
  if (!result.markdown.trim()) {
    dependencies.showMessage("parse-error-empty-lite-markdown");
    return;
  }
  await storage.writeLiteResult({
    attachment: attachmentRef,
    mineruTaskID: taskID,
    source,
    markdown: result.markdown,
  });
  dependencies.showMessage("parse-lite-finished");
  return;
}
```

Keep the existing normalize/writeResult flow under the precise branch:

```ts
const boxes = normalizeMinerUBoxes(result.rawResult);
```

- [x] **Step 7: Add locale keys for lite/local errors**

Append to `addon/locale/zh-CN/mainWindow.ftl`:

```ftl
parse-lite-finished = 轻量解析完成
parse-error-empty-lite-markdown = 轻量解析没有返回 Markdown
parse-error-local-api-url = 请先配置有效的本地 API 地址
parse-error-local-api-unavailable = 本地 API 服务不可用：{ $message }
```

Append to `addon/locale/en-US/mainWindow.ftl`:

```ftl
parse-lite-finished = Lite parse finished
parse-error-empty-lite-markdown = Lite parse returned no Markdown
parse-error-local-api-url = Configure a valid local API URL first
parse-error-local-api-unavailable = Local API service is unavailable: { $message }
```

Update `typings/i10n.d.ts` with those IDs.

- [x] **Step 8: Update test doubles**

In `test/parseManager.test.ts`, update `baseDependencies()` with:

```ts
getParseSource: () => "online",
getParseMode: () => "precise",
getLocalApiBaseURL: () => "http://127.0.0.1:8000",
```

Update `baseStorage()` with no-op methods:

```ts
hasLiteResult: async () => false,
readPreferredMarkdown: async () => "Body",
writeLiteResult: async () => {},
```

Update existing fake `downloadResult` return values to include `kind: "precise"` when they include `rawResult`.

- [x] **Step 9: Run parse manager tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "parseManager" --exit-on-finish --abort-on-fail
```

Expected: PASS.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令无法作为 focused test 使用；已改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，初始结果为 `132 passed`。审查后补充 bulk lite existing-result、空 lite Markdown、lite 写入失败错误分类，以及 createClient settings 透传用例，并重新验证为 `136 passed`；其中 `parseManager` 分组全部通过，新增 lite 模式分支测试通过。另运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。

- [x] **Step 10: Commit parse manager branching**

```powershell
git add src\modules\parseManager.ts addon\locale\zh-CN\mainWindow.ftl addon\locale\en-US\mainWindow.ftl typings\i10n.d.ts test\parseManager.test.ts
git commit -m "feat(parse): 按来源与模式处理解析结果"
```

实现说明：
本轮在 `parseManager` 中补齐了 source/mode 感知：默认依赖改为通过 `createMinerUClientForSettings()` 按当前设置创建 client，并读取 `parseSource`、`parseMode`、`localApiBaseURL` 与 `saveImages`。API key 现在仅在 `online/precise` 时为必需；单个与批量解析的“已有结果”判定也按 mode 区分为 `hasReadyResult()` 或 `hasLiteResult()`。
同时移除了 Task 2 的临时 lite unsupported guard，改为在 `downloadResult()` 返回 `kind: "lite"` 时直接写入 `storage.writeLiteResult()`，并对空 Markdown 给出 `parse-error-empty-lite-markdown`。审查后将 write 阶段的 overwrite 错误分类收窄到 precise 既有结果，避免 lite 写失败时错误声称旧结果已保留；也新增了 createClient settings 透传测试，确认 `apiKey/source/mode/localApiBaseURL/saveImages` 会完整传给 factory。当前 Task 4 只负责 parseManager 分支接线，`online/lite` 与 `local/*` 的默认 factory 支持由后续 Task 5-7 接上。本轮还补充了 `parse-lite-finished` 等中英文 locale key 与 `typings/i10n.d.ts` ID，同步更新了 `parseManager` 测试桩，新增 lite 不需要 API key、lite 已有结果复用、bulk lite 已有结果复用、空 lite Markdown 不写入、lite 写入失败不报 overwrite、precise 结果写入等覆盖。测试方面，按计划记录了 `--grep` 在当前 scaffold CLI 下不可用，最终使用 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 全量验证通过，结果为 `136 passed`；另运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。

## Task 5: Local API Client

**Files:**

- Create: `src/modules/mineruClient/formData.ts`
- Create: `src/modules/mineruClient/local.ts`
- Modify: `src/modules/mineruClient/factory.ts`
- Test: `test/mineruClient.test.ts`

- [x] **Step 1: Add failing local client tests**

Add to `test/mineruClient.test.ts`:

```ts
it("checks local health before submitting a local task", async function () {
  const calls: string[] = [];
  const client = createMinerUClientForSettings({
    source: "local",
    mode: "lite",
    apiKey: "",
    localApiBaseURL: "http://127.0.0.1:8000",
    readBinary: async () => new Uint8Array([1, 2, 3]),
    fetch: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/health")) {
        return jsonResponse({ status: "healthy" });
      }
      return jsonResponse({ task_id: "local-task" }, 202);
    },
  });

  const result = await client.submitPdf("C:/tmp/a.pdf");

  assert.deepEqual(result, { taskID: "local-task" });
  assert.equal(calls[0], "GET http://127.0.0.1:8000/health");
  assert.equal(calls[1], "POST http://127.0.0.1:8000/tasks");
});

it("submits local lite tasks with markdown-only result flags", async function () {
  let submittedBody: FormData | undefined;
  const client = createMinerUClientForSettings({
    source: "local",
    mode: "lite",
    apiKey: "",
    localApiBaseURL: "http://127.0.0.1:8000",
    readBinary: async () => new Uint8Array([1, 2, 3]),
    fetch: async (url, init) => {
      if (String(url).endsWith("/health")) {
        return jsonResponse({ status: "healthy" });
      }
      submittedBody = init?.body as FormData;
      return jsonResponse({ task_id: "local-task" }, 202);
    },
  });

  await client.submitPdf("C:/tmp/a.pdf");

  assert.equal(submittedBody?.get("return_md"), "true");
  assert.equal(submittedBody?.get("return_middle_json"), "false");
  assert.equal(submittedBody?.get("return_images"), "false");
  assert.equal(submittedBody?.get("response_format_zip"), "false");
});
```

- [x] **Step 2: Run focused local tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "local" --exit-on-finish --abort-on-fail
```

Expected: FAIL because local clients are unsupported.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令先因 `unknown option '--grep'` 失败；随后新增 local client 测试在中断前已写入，生产代码尚未支持 local client，符合 red 阶段预期。

- [x] **Step 3: Add multipart builder**

Create `src/modules/mineruClient/formData.ts`:

```ts
import { basename } from "./path";

export type LocalParseMode = "precise" | "lite";

export function buildLocalTaskFormData(input: {
  filePath: string;
  bytes: Uint8Array;
  mode: LocalParseMode;
  saveImages: boolean;
}): FormData {
  const form = new FormData();
  form.append(
    "files",
    new Blob([input.bytes], { type: "application/pdf" }),
    basename(input.filePath),
  );
  form.append("lang_list", "ch");
  form.append("backend", "hybrid-auto-engine");
  form.append("parse_method", "auto");
  form.append("formula_enable", "true");
  form.append("table_enable", "true");
  form.append("image_analysis", "true");
  form.append("return_md", "true");
  form.append(
    "return_middle_json",
    input.mode === "precise" ? "true" : "false",
  );
  form.append("return_model_output", "false");
  form.append(
    "return_content_list",
    input.mode === "precise" ? "true" : "false",
  );
  form.append(
    "return_images",
    input.mode === "precise" && input.saveImages ? "true" : "false",
  );
  form.append(
    "response_format_zip",
    input.mode === "precise" ? "true" : "false",
  );
  form.append("return_original_file", "false");
  form.append("start_page_id", "0");
  form.append("end_page_id", "99999");
  return form;
}
```

- [x] **Step 4: Implement local client skeleton**

Create `src/modules/mineruClient/local.ts`:

```ts
import { requestJson, requestOk } from "./api";
import { buildLocalTaskFormData } from "./formData";
import { readFileBytes, readPdfBytes } from "./file";
import { createDefaultRequest, normalizeBinary } from "./http";
import { normalizeBaseURL } from "./path";
import type {
  MinerUClient,
  MinerUClientOptions,
  MinerUParseMode,
} from "./types";

type LocalTaskResponse = {
  task_id?: string;
  taskId?: string;
  status?: string;
  message?: string;
};

export function createLocalMinerUClient(
  options: MinerUClientOptions & {
    mode: MinerUParseMode;
    localApiBaseURL: string;
    saveImages?: boolean;
  },
): MinerUClient {
  const baseURL = normalizeBaseURL(options.localApiBaseURL);
  const request = options.fetch ?? createDefaultRequest();
  const readBinary = options.readBinary ?? readFileBytes;

  return {
    async submitPdf(filePath) {
      await requestOk(request, `${baseURL}/health`, "local-health", {
        method: "GET",
      });
      const bytes = normalizeBinary(await readPdfBytes(readBinary, filePath));
      const response = await requestJson<LocalTaskResponse>(
        request,
        `${baseURL}/tasks`,
        "local-submit",
        {
          method: "POST",
          body: buildLocalTaskFormData({
            filePath,
            bytes,
            mode: options.mode,
            saveImages: options.saveImages !== false,
          }),
        },
      );
      const taskID = response.task_id ?? response.taskId;
      if (!taskID) {
        throw new Error("Local MinerU submit response missing task_id");
      }
      return { taskID };
    },
    async pollTask(taskID) {
      const response = await requestJson<LocalTaskResponse>(
        request,
        `${baseURL}/tasks/${encodeURIComponent(taskID)}`,
        "local-poll",
        { method: "GET" },
      );
      const status = String(response.status ?? "").toLowerCase();
      if (
        ["done", "success", "succeeded", "finished", "completed"].includes(
          status,
        )
      ) {
        return { status: "succeeded" };
      }
      if (["failed", "fail", "error"].includes(status)) {
        return {
          status: "failed",
          error: response.message || "Local MinerU task failed",
        };
      }
      return { status: "running" };
    },
    async downloadResult() {
      return options.mode === "lite"
        ? { kind: "lite", markdown: "" }
        : { kind: "precise", rawResult: {}, markdown: "" };
    },
  };
}
```

- [x] **Step 5: Wire local client in factory**

In `src/modules/mineruClient/factory.ts`:

```ts
import { createLocalMinerUClient } from "./local";
```

Add branch:

```ts
if (options.source === "local") {
  return createLocalMinerUClient({
    ...options,
    mode: options.mode,
    localApiBaseURL: options.localApiBaseURL ?? "http://127.0.0.1:8000",
    saveImages: options.saveImages,
  });
}
```

- [x] **Step 6: Run focused local submit tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "local.*task|markdown-only" --exit-on-finish --abort-on-fail
```

Expected: PASS for submit/form tests. Other local result tests are not added until Task 6.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：当前 `zotero-plugin test` CLI 不支持 `--grep`，该命令无法作为 focused test 使用；已改跑 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `139 passed`，其中 local health、local lite form flags 与 local poll 状态测试通过。另运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。

- [x] **Step 7: Commit local submit and polling**

```powershell
git add src\modules\mineruClient\formData.ts src\modules\mineruClient\local.ts src\modules\mineruClient\factory.ts test\mineruClient.test.ts
git commit -m "feat(mineru): 提交本地异步解析任务"
```

实现说明：
本轮新增 `formData.ts`，集中构造本地 MinerU `/tasks` multipart form data，并按 `precise/lite` 设置 `return_md`、`return_middle_json`、`return_content_list`、`return_images` 与 `response_format_zip` 等字段。新增 `local.ts`，实现本地 API 的 `/health` 检查、`/tasks` 提交、任务状态轮询，以及 Task 6 前的 placeholder `downloadResult()`。
`factory.ts` 已接入 `source === "local"` 分支，并在缺省时使用 `http://127.0.0.1:8000` 作为本地 API 地址。测试方面，先由中断的子代理补入 local client red 测试，随后本地完成实现；由于当前 scaffold CLI 不支持 `--grep`，最终使用 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 全量验证通过，结果为 `139 passed`；另运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过。审查时发现 `factory.ts` 暴露 local client 后，placeholder `downloadResult()` 会让用户可选但不可用，因此 Task 5 未单独提交；本步骤随 Task 6 的真实结果下载实现合并提交。复审前又补充了默认请求路径覆盖：本地 client 不再把 multipart `FormData` 交给 `Zotero.HTTP.request`，而是使用可提交 FormData 的 fetch/XHR 请求器。

## Task 6: Local API Result Download

**Files:**

- Modify: `src/modules/mineruClient/local.ts`
- Modify: `src/modules/mineruClient/result.ts`
- Test: `test/mineruClient.test.ts`

- [x] **Step 1: Add failing local result tests**

Add to `test/mineruClient.test.ts`:

```ts
it("downloads local lite markdown from JSON results", async function () {
  const client = createMinerUClientForSettings({
    source: "local",
    mode: "lite",
    apiKey: "",
    localApiBaseURL: "http://127.0.0.1:8000",
    fetch: async () =>
      jsonResponse({
        results: {
          "a.pdf": { md_content: "# Lite" },
        },
      }),
  });

  const result = await client.downloadResult("local-task");

  assert.deepEqual(result, { kind: "lite", markdown: "# Lite" });
});

it("downloads local precise markdown and raw result from JSON results", async function () {
  const raw = {
    pdf_info: [{ page_idx: 0, page_size: [100, 200], para_blocks: [] }],
  };
  const client = createMinerUClientForSettings({
    source: "local",
    mode: "precise",
    apiKey: "",
    localApiBaseURL: "http://127.0.0.1:8000",
    fetch: async () =>
      jsonResponse({
        results: {
          "a.pdf": {
            md_content: "# Precise",
            middle_json: JSON.stringify(raw),
            content_list: JSON.stringify([{ type: "text" }]),
          },
        },
      }),
  });

  const result = await client.downloadResult("local-task");

  assert.equal(result.kind, "precise");
  if (result.kind !== "precise") assert.fail("Expected precise result");
  assert.equal(result.markdown, "# Precise");
  assert.deepEqual(result.rawResult, raw);
});
```

- [x] **Step 2: Run focused local result tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "downloads local" --exit-on-finish --abort-on-fail
```

Expected: FAIL because `downloadResult()` throws.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：Task 5 审查后决定不保留 placeholder `downloadResult()`，因此本轮直接补入 local JSON/ZIP 结果测试并推进实现；测试覆盖 lite JSON、precise JSON、precise ZIP，以及 local submit 缺失 `task_id` 时抛出 `MinerUTaskError`。

- [x] **Step 3: Implement JSON result parsing**

In `src/modules/mineruClient/local.ts`, add:

```ts
type LocalResultResponse = {
  results?: Record<
    string,
    {
      md_content?: string;
      middle_json?: unknown;
      content_list?: unknown;
      images?: Record<string, string>;
    }
  >;
};

function firstLocalResult(response: LocalResultResponse) {
  return Object.values(response.results ?? {})[0] ?? {};
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function decodeDataURLImages(images: Record<string, string> | undefined) {
  if (!images) {
    return undefined;
  }
  return Object.entries(images).flatMap(([path, value]) => {
    const comma = value.indexOf(",");
    if (comma === -1) {
      return [];
    }
    const binary = atob(value.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return [{ path, bytes }];
  });
}
```

Implement `downloadResult(taskID)` JSON path:

```ts
const response = await requestJson<LocalResultResponse>(
  request,
  `${baseURL}/tasks/${encodeURIComponent(taskID)}/result`,
  "local-download",
  { method: "GET" },
);
const result = firstLocalResult(response);
const markdown = result.md_content ?? "";
if (options.mode === "lite") {
  return { kind: "lite", markdown };
}
return {
  kind: "precise",
  markdown,
  rawResult: parseMaybeJson(
    result.middle_json ?? result.content_list ?? response,
  ),
  images: decodeDataURLImages(result.images),
};
```

- [x] **Step 4: Add ZIP result support for precise local results**

If local precise uses `response_format_zip=true`, `requestJson()` will fail on ZIP. Replace the precise result download branch with `requestOk()`, inspect content type, and parse ZIP when needed:

```ts
const response = await requestOk(
  request,
  `${baseURL}/tasks/${encodeURIComponent(taskID)}/result`,
  "local-download",
  { method: "GET" },
);
const contentType = response.headers.get("Content-Type") ?? "";
if (contentType.includes("application/zip")) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const zip = readZipEntries(bytes);
  return {
    kind: "precise",
    markdown: readLocalZipMarkdown(zip),
    rawResult: readLocalZipRawResult(zip),
    images: readImagesFromZip(zip),
  };
}
const json = (await response.json()) as LocalResultResponse;
```

Add helper functions in `local.ts` or `result.ts`:

```ts
function readLocalZipMarkdown(zip: ZipEntries): string {
  const entry = Array.from(zip.values()).find((item) =>
    item.name.endsWith(".md"),
  );
  return entry ? decodeText(entry.bytes) : "";
}

function readLocalZipRawResult(zip: ZipEntries): unknown {
  const middle = Array.from(zip.values()).find((item) =>
    item.name.endsWith("_middle.json"),
  );
  const content = Array.from(zip.values()).find((item) =>
    item.name.endsWith("_content_list.json"),
  );
  const entry = middle ?? content;
  return entry ? JSON.parse(decodeText(entry.bytes)) : {};
}
```

Import existing `readZipEntries`, `decodeText`, and `readImagesFromZip` helpers.

- [x] **Step 5: Run local result tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "downloads local" --exit-on-finish --abort-on-fail
```

Expected: PASS.

- [x] **Step 6: Commit local result download**

```powershell
git add src\modules\mineruClient\local.ts src\modules\mineruClient\result.ts test\mineruClient.test.ts
git commit -m "feat(mineru): 读取本地解析结果"
```

实现说明：
本轮把本地 `downloadResult(taskID)` 从 placeholder 改为真实下载逻辑：统一请求 `/tasks/{taskID}/result`，根据 `Content-Type` 处理 JSON 或 ZIP 结果；lite JSON 返回 `{ kind: "lite", markdown }`，precise JSON 解析 `middle_json`、`content_list` 与 data URL 图片，precise ZIP 读取任意 `.md`、`*_middle.json`、`*_content_list.json` 和 `images/` 图片。为支持本地 ZIP 中非 `full.md` 的 Markdown 文件名，ZIP reader 与结果条目保留规则扩展为读取任意 `.md`。
同时把 local submit 缺失 `task_id` 的错误改为 `MinerUTaskError`，并在 `parseManager` 中把 `local-*` 请求阶段统一映射到 `parse-error-local-api-unavailable`，避免本地服务不可用时落入泛化错误。审查后修复了三个边界：默认本地提交路径优先使用可提交 `FormData` 的 fetch/XHR 请求器，避免 `Zotero.HTTP.request` 不支持 multipart body；ZIP 判定扩展到 `application/octet-stream` 与 `application/x-zip-compressed`；本地 ZIP 内存解析失败时会写入临时文件并通过 Zotero `nsIZipReader` 回退，避免缺少 `DecompressionStream("deflate-raw")` 时压缩 ZIP 无法读取。由于 Task 5 的 factory 暴露 local client 依赖 Task 6 的真实结果下载，Task 5 和 Task 6 合并为一个提交更安全。验证方面已运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过，并运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `146 passed`。

## Task 7: Online Agent Lite Client

**Files:**

- Create: `src/modules/mineruClient/agentLite.ts`
- Modify: `src/modules/mineruClient/factory.ts`
- Test: `test/mineruClient.test.ts`

- [x] **Step 1: Add failing online lite tests**

Add to `test/mineruClient.test.ts`:

```ts
it("submits online lite tasks without authorization", async function () {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const client = createMinerUClientForSettings({
    source: "online",
    mode: "lite",
    apiKey: "",
    readBinary: async () => new Uint8Array([1, 2, 3]),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/v1/agent/parse/file")) {
        return jsonResponse({
          task_id: "agent-task",
          file_url: "https://upload.example/lite",
        });
      }
      return new Response("", { status: 200 });
    },
  });

  await client.submitPdf("C:/tmp/a.pdf");

  assert.equal(calls[0].url, "https://mineru.net/api/v1/agent/parse/file");
  assert.isUndefined(
    (calls[0].init?.headers as Record<string, string> | undefined)
      ?.Authorization,
  );
  assert.equal(calls[1].url, "https://upload.example/lite");
});

it("downloads online lite markdown from markdown_url", async function () {
  const client = createMinerUClientForSettings({
    source: "online",
    mode: "lite",
    apiKey: "",
    fetch: async (url) => {
      if (String(url).includes("/api/v1/agent/parse/")) {
        return jsonResponse({
          state: "done",
          markdown_url: "https://download.example/lite.md",
        });
      }
      return new Response("# Lite");
    },
  });

  const result = await client.downloadResult("agent-task");

  assert.deepEqual(result, { kind: "lite", markdown: "# Lite" });
});
```

- [x] **Step 2: Run focused online lite tests and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "online lite" --exit-on-finish --abort-on-fail
```

Expected: FAIL because online lite client is unsupported.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：已新增 online lite submit/download 测试；`.\node_modules\.bin\tsc.CMD --noEmit` 通过，`.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 在实现前按预期失败于 `submits online lite tasks without authorization`，因为 `online/lite` 仍走 unsupported factory 分支。

- [x] **Step 3: Implement Agent lite client**

Create `src/modules/mineruClient/agentLite.ts`:

```ts
import { requestJson, requestOk } from "./api";
import { readFileBytes, readPdfBytes } from "./file";
import {
  createDefaultRequest,
  fallbackDownloadBinary,
  fetchDownloadBinary,
  fetchUploadBinary,
  normalizeBinary,
  xhrDownloadBinary,
  xhrUploadBinary,
} from "./http";
import { basename, normalizeBaseURL } from "./path";
import type { MinerUClient, MinerUClientOptions } from "./types";

type AgentSubmitResponse = {
  task_id?: string;
  taskId?: string;
  file_url?: string;
  fileUrl?: string;
};

type AgentPollResponse = {
  state?: string;
  status?: string;
  err_msg?: string;
  message?: string;
  markdown_url?: string;
  markdownUrl?: string;
};

export function createOnlineAgentLiteMinerUClient(
  options: MinerUClientOptions,
): MinerUClient {
  const baseURL = normalizeBaseURL(options.baseURL ?? "https://mineru.net");
  const request = options.fetch ?? createDefaultRequest();
  const readBinary = options.readBinary ?? readFileBytes;
  const uploadBinary =
    options.uploadBinary ??
    (options.fetch ? fetchUploadBinary(request) : xhrUploadBinary);
  const downloadBinary =
    options.downloadBinary ??
    (options.fetch
      ? fetchDownloadBinary(request)
      : fallbackDownloadBinary(
          xhrDownloadBinary,
          fetchDownloadBinary(request),
        ));

  return {
    async submitPdf(filePath) {
      const response = await requestJson<AgentSubmitResponse>(
        request,
        `${baseURL}/api/v1/agent/parse/file`,
        "agent-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: basename(filePath),
            language: "ch",
            enable_table: false,
            enable_formula: false,
            is_ocr: false,
          }),
        },
      );
      const taskID = response.task_id ?? response.taskId;
      const uploadURL = response.file_url ?? response.fileUrl;
      if (!taskID || !uploadURL) {
        throw new MinerUTaskError(
          "MinerU Agent submit response missing upload data",
        );
      }
      const bytes = normalizeBinary(await readPdfBytes(readBinary, filePath));
      await requestOk(
        () => uploadBinary(uploadURL, bytes),
        uploadURL,
        "agent-upload",
        {
          method: "PUT",
        },
      );
      return { taskID };
    },
    async pollTask(taskID) {
      const response = await requestJson<AgentPollResponse>(
        request,
        `${baseURL}/api/v1/agent/parse/${encodeURIComponent(taskID)}`,
        "agent-poll",
        { method: "GET" },
      );
      const state = String(
        response.state ?? response.status ?? "",
      ).toLowerCase();
      if (["done", "success", "succeeded", "finished"].includes(state)) {
        return { status: "succeeded" };
      }
      if (["failed", "fail", "error"].includes(state)) {
        return {
          status: "failed",
          error:
            response.err_msg || response.message || "MinerU Agent task failed",
        };
      }
      return { status: "running" };
    },
    async downloadResult(taskID) {
      const response = await requestJson<AgentPollResponse>(
        request,
        `${baseURL}/api/v1/agent/parse/${encodeURIComponent(taskID)}`,
        "agent-download",
        { method: "GET" },
      );
      const markdownURL = response.markdown_url ?? response.markdownUrl;
      if (!markdownURL) {
        return { kind: "lite", markdown: "" };
      }
      const markdownResponse = await requestOk(
        () => downloadBinary(markdownURL),
        markdownURL,
        "download",
        { method: "GET" },
      );
      return { kind: "lite", markdown: await markdownResponse.text() };
    },
  };
}
```

- [x] **Step 4: Wire online lite factory branch**

In `src/modules/mineruClient/factory.ts`:

```ts
import { createOnlineAgentLiteMinerUClient } from "./agentLite";
```

Add branch before unsupported error:

```ts
if (options.source === "online" && options.mode === "lite") {
  return createOnlineAgentLiteMinerUClient(options);
}
```

- [x] **Step 5: Run online lite tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "online lite" --exit-on-finish --abort-on-fail
```

Expected: PASS.

- [x] **Step 6: Commit online lite client**

```powershell
git add src\modules\mineruClient\agentLite.ts src\modules\mineruClient\factory.ts test\mineruClient.test.ts
git commit -m "feat(mineru): 支持在线轻量解析"
```

实现说明：
本轮新增 `agentLite.ts`，实现在线 Agent lite 的提交、上传、轮询和 Markdown 下载流程。提交接口使用 `/api/v1/agent/parse/file`，只发送 JSON 参数和文件名，不添加 `Authorization`，随后将 PDF 字节上传到返回的 `file_url`；轮询和下载均读取 `/api/v1/agent/parse/{taskID}`，成功状态映射为统一任务状态，下载阶段从 `markdown_url`/`markdownUrl` 拉取 Markdown 并返回 `{ kind: "lite", markdown }`。`factory.ts` 已新增 `online/lite` 分支，保留 `online/precise` 优先匹配。审查后补齐两个边界：Markdown URL 下载改用 `downloadBinary`，默认路径与 online precise 一样支持 XHR/fetch fallback；`parseManager` 也把 `agent-submit`/`agent-upload` 映射为上传阶段错误，避免 lite 上传失败落到 generic。验证方面已运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过，并运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `148 passed`。

## Task 8: Copy Full Markdown Fallback

**Files:**

- Modify: `src/modules/readerOverlay/copy.ts`
- Test: `test/readerOverlay.test.ts`

- [x] **Step 1: Add failing reader overlay copy test**

Add to `test/readerOverlay.test.ts` near the full markdown copy tests:

```ts
it("copies lite markdown when precise markdown is missing", async function () {
  const copied: string[] = [];
  const globals = globalThis as typeof globalThis & {
    ztoolkit?: unknown;
  };
  const originalZtoolkit = globals.ztoolkit;
  globals.ztoolkit = {
    Clipboard: class {
      private text = "";

      addText(text: string) {
        this.text = text;
        return this;
      }

      copy() {
        copied.push(this.text);
      }
    },
  };
  const storage = createStorage("TmpD/mineru-copy-reader-test");
  const attachment = {
    id: 1,
    key: "LITECOPY",
    libraryID: 1,
    fileName: "a.pdf",
    filePath: "a.pdf",
    mtime: 1,
  };
  const reader = createReader({
    instanceID: "reader-copy-lite-markdown",
    attachmentKey: "LITECOPY",
    views: [createView("primary")],
  });
  setReaderOverlayModeForReader(reader, "hover");

  try {
    await storage.writeLiteResult({
      attachment,
      mineruTaskID: "lite-task",
      source: "online",
      markdown: "# Lite Full",
    });
    const text = await readerOverlay.copySelectedBoxesForReader(reader);

    assert.equal(text, "# Lite Full");
    assert.deepEqual(copied, ["# Lite Full"]);
  } finally {
    globals.ztoolkit = originalZtoolkit;
  }
});
```

- [x] **Step 2: Run focused reader copy test and verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "lite markdown when precise markdown is missing" --exit-on-finish --abort-on-fail
```

Expected: FAIL because copy fallback reads only `content.md`.

注意：当前 `zotero-plugin-scaffold@0.8.2` 的 `zotero-plugin test` 不支持 `--grep`；此命令是原计划记录，实际验证需使用全量测试命令。

执行记录：新增 `copies lite markdown when precise markdown is missing` 测试后，`.\node_modules\.bin\tsc.CMD --noEmit` 通过，`.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 按预期失败于该测试，因为 no-selection 复制仍只调用 `readMarkdown()`。

- [x] **Step 3: Use preferred Markdown for no-selection copy**

In `src/modules/readerOverlay/copy.ts`, replace:

```ts
? await storage.readMarkdown(attachment)
```

with:

```ts
? await storage.readPreferredMarkdown(attachment)
```

Do not change the selected-box branch; only the no-selection Markdown branch should call `readPreferredMarkdown()`.

- [x] **Step 4: Run reader overlay tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --grep "copies full markdown|lite markdown" --exit-on-finish --abort-on-fail
```

Expected: PASS.

- [x] **Step 5: Commit copy fallback**

```powershell
git add src\modules\readerOverlay\copy.ts test\readerOverlay.test.ts
git commit -m "feat(reader): 复制全文 markdown 支持轻量结果兜底"
```

实现说明：
本轮在 `readerOverlay` 复制全文路径新增 lite markdown 覆盖：当 reader 没有选中 box 时，`copySelectedBoxesForReader()` 改用 `storage.readPreferredMarkdown()`，因此 precise `content.md` 可用时仍优先复制 precise Markdown；只有 precise Markdown 缺失时才兜底读取 lite 结果。选中 box 的复制分支没有改变，仍读取 boxes 并按 `rawIndex` 格式化。验证方面已运行 `.\node_modules\.bin\tsc.CMD --noEmit` 通过，并运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `149 passed`。

## Task 9: Final Integration And Verification

**Files:**

- Modify: only task-related files from Tasks 1-8 if verification exposes a defect
- Test: full test suite and type/build checks

- [x] **Step 1: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: PASS with no TypeScript errors.

执行记录：已运行 `.\node_modules\.bin\tsc.CMD --noEmit`，退出码为 0，无 TypeScript 错误。

- [x] **Step 2: Run focused full test suite**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS. This project does not use Vitest.

执行记录：已运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `149 passed`。本项目未运行 Vitest。

- [x] **Step 3: Check diff for unrelated changes**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only task-related source, test, locale, and docs changes are present. No generated `.scaffold/build` files or unrelated formatting-only XHTML churn should remain.

执行记录：已运行 `git status --short --branch` 和 `git diff --stat`。提交 Task 8 后工作区为 `## feat/api-source-parse-mode`，`git diff --stat` 为空；没有 `.scaffold/build` 或无关 XHTML 格式化 diff。

- [x] **Step 4: Run lint check if time allows**

Run:

```powershell
pnpm run lint:check
```

Expected: PASS. If lint finds formatting in unrelated XHTML or Markdown, revert unrelated formatting and rerun focused checks.

执行记录：已运行 `pnpm run lint:check`，失败于 Prettier 格式检查，列出 17 个文件，包括本计划外文件 `docs/superpowers/plans/2026-05-22-modules-directory-split.md`、多个既有 `src/modules/readerOverlay/*`、`src/modules/storage.ts`、`test/readerToolbar.test.ts` 等。为避免全仓库 `prettier --write` 产生无关格式化 diff，本轮未执行自动格式化；最终以类型检查、全量 scaffold 测试和干净工作区作为验收依据。

- [x] **Step 5: Commit final fixes if any**

If Step 1-4 required fixes, commit them:

```powershell
git add typings\prefs.d.ts typings\i10n.d.ts addon\prefs.js addon\content\preferences.xhtml addon\locale\zh-CN\preferences.ftl addon\locale\en-US\preferences.ftl addon\locale\zh-CN\mainWindow.ftl addon\locale\en-US\mainWindow.ftl src\utils\prefs.ts src\modules\domain.ts src\modules\storage.ts src\modules\parseManager.ts src\modules\readerOverlay\copy.ts src\modules\mineruClient\types.ts src\modules\mineruClient\index.ts src\modules\mineruClient\factory.ts src\modules\mineruClient\onlinePrecise.ts src\modules\mineruClient\agentLite.ts src\modules\mineruClient\local.ts src\modules\mineruClient\formData.ts src\modules\mineruClient\result.ts test\preferenceScript.test.ts test\mineruClient.test.ts test\storage.test.ts test\parseManager.test.ts test\readerOverlay.test.ts
git commit -m "test(mineru): 覆盖 API 来源与解析模式"
```

Use an explicit file list instead of `git add .`.

实现说明：
实现说明：
本轮先补充了 Task 9 的验证记录。最终 review 随后指出两个边界缺陷：lite result 只看 `lite-content.md` 会把缺少或失败的 `lite-manifest.json` 当作 ready；local lite 如果收到 ZIP 响应会被误转为 precise result。已追加修复：`hasLiteResult()` 与 `readPreferredMarkdown()` 现在要求 lite manifest `status === "ready"` 且 `mode === "lite"`，并要求 lite Markdown 非空；local ZIP 下载会先读取 Markdown，并在 `options.mode === "lite"` 时返回 `{ kind: "lite", markdown }`。已补充 storage partial-lite 测试和 local lite ZIP 测试。
最终验证命令中，`.\node_modules\.bin\tsc.CMD --noEmit` 通过，`.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` 最终为 `152 passed`。此前 `pnpm run lint:check` 未通过，原因是全仓库 Prettier 检查命中多处既有或计划外格式警告；为保持本任务 diff 聚焦，没有进行全仓库格式化。

## Task 10: Runtime Preference Sync

**Files:**

- Modify: `src/modules/preferenceScript.ts`
- Test: `test/preferenceScript.test.ts`

- [x] **Step 1: Reproduce stale parse mode from the preferences UI**

新增 `persists parse mode changes from the preferences UI immediately` 测试，模拟 preferences 页面中 `zotero-prefpane-mineruForZotero-parse-mode` 从 `lite` 切换到 `precise` 并触发 `change`。在实现前运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，构建按预期失败于缺少 `registerPreferenceValueSync` 导出，确认测试覆盖当前缺失的运行时同步入口。

- [x] **Step 2: Explicitly sync preference controls into Zotero.Prefs**

在 `registerPrefsScripts()` 加载 preferences 页面时调用 `registerPreferenceValueSync(document)`，为 API key、parse source、parse mode、local API base URL、save images 控件注册 `change` 监听器，并通过 `src/utils/prefs.ts` 的 typed setter 显式写入 `Zotero.Prefs`。其中 select 控件会校验允许值，避免未知 UI 值污染偏好。

- [x] **Step 3: Verify runtime parse mode switching**

已运行 `.\node_modules\.bin\tsc.CMD --noEmit`，退出码为 0；已运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `157 passed`。

实现说明：
本轮真实根因是 preferences.xhtml 的隐式 `preference="parseMode"` 绑定没有保证在当前 Zotero 运行期内立刻写入 `Zotero.Prefs`，导致用户从轻量解析切到精准解析后，不重启时 `parseManager` 仍读取到旧的 `parseMode = "lite"`，从而继续走 online lite Agent client；重启后 preferences 才被提交，所以同一 PDF 再走精准解析就成功。修复后，设置页控件变化会即时同步到 `Zotero.Prefs`，`parseManager` 下一次解析会读取到最新的 `precise` 模式。

## Task 11: Runtime-Safe Local Multipart Submit

**Files:**

- Modify: `src/modules/mineruClient/formData.ts`
- Modify: `src/modules/mineruClient/local.ts`
- Test: `test/mineruClient.test.ts`

- [x] **Step 1: Reproduce local submit without FormData/Blob**

新增 `submits local lite tasks without global FormData or Blob` 测试，临时移除 `globalThis.FormData` 和 `globalThis.Blob` 后提交 local/lite 任务。实现前运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，按预期失败在新增用例，复现 Zotero 运行时报出的 `FormData is not defined`。

- [x] **Step 2: Build multipart/form-data as bytes**

将 `buildLocalTaskFormData()` 从直接返回 `FormData` 改为返回 `{ body: Uint8Array, contentType: string }`，手工生成 `multipart/form-data` boundary、PDF 文件 part，以及 `return_md`、`return_middle_json`、`return_content_list`、`return_images`、`response_format_zip` 等本地 MinerU 表单字段。`local.ts` 提交 `/tasks` 时显式设置 `Content-Type: multipart/form-data; boundary=...` 并发送字节体，不再依赖运行时存在 `FormData` 或 `Blob`。

- [x] **Step 3: Verify local multipart submit**

已运行 `.\node_modules\.bin\tsc.CMD --noEmit`，退出码为 0；已运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `158 passed`。本轮还把既有 local/lite 与 local/precise submit 测试从 `FormData.get()` 断言改为解析 multipart 文本字段，继续覆盖轻量和精准模式的表单参数差异。

实现说明：
本轮真实根因是 local client 复用了浏览器/Node 测试环境里的 `FormData`/`Blob` 能力，但 Zotero 插件脚本运行时没有保证提供这些全局对象。官方本地 `mineru-api` 的 `/tasks` 和 `/file_parse` 仍然要求 `multipart/form-data`，因此修复没有改 API 协议，而是改为手工构造 multipart 字节体，并通过已有 fetch/XHR/Zotero HTTP 适配器提交。这样 local/lite 与 local/precise 都不会再在提交阶段因 `FormData is not defined` 崩溃。

## Task 12: Normalize File URLs Before File Access

**Files:**

- Modify: `src/modules/mineruClient/path.ts`
- Modify: `src/modules/parseManager.ts`
- Test: `test/mineruClient.test.ts`
- Test: `test/parseManager.test.ts`

- [x] **Step 1: Reproduce encoded file URL access failure**

新增 `reads PDF bytes from file URLs with encoded Windows paths` 测试，模拟 `IOUtils.read()` 接收 `file:///D:/Workspace/zotero%20plugin/a.pdf`。实现前运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，按预期失败，显示旧实现把 `file:///...` 原样传给 `IOUtils.read()`，没有解码为空格，也没有转成 Windows 原生路径。

- [x] **Step 2: Reproduce parseManager preflight path mismatch**

新增 `normalizes file URLs before checking readability` 测试，模拟 attachment `getFilePathAsync()` 返回 `file:///D:/Workspace/zotero%20plugin/a.pdf`。实现前全量测试按预期失败，显示 `isFileReadable()` 收到的仍是原始 file URL，因此会导致 `IOUtils.exists()`/`OS.File.exists()` 预检失败并提示“文件访问失败”。

- [x] **Step 3: Normalize file URLs at both preflight and read boundaries**

扩展 `src/modules/mineruClient/path.ts` 的 `toNativePath()`，支持 `file://` URL，先解析并 `decodeURIComponent()`，再把 Windows 盘符路径从 `D:/...` 转为 `D:\...`。`parseManager` 改为复用该共享函数，并在预检、attachment ref、client submit 前使用规范化后的路径，避免预检和实际读取使用不同路径语义。

- [x] **Step 4: Verify file URL path handling**

已运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `160 passed`；已运行 `.\node_modules\.bin\tsc.CMD --noEmit`，退出码为 0。

实现说明：
本轮真实根因是 Zotero/Firefox 运行时可能把附件路径表示为 `file:///...` URL，且路径中包含 `%20` 等 URI 编码；旧的 `toNativePath()` 只处理 `C:/...` 这类盘符斜杠路径，导致 `IOUtils.exists()`、`IOUtils.read()` 或 `OS.File.*` 拿到 `file:///...` 字符串后访问失败。修复后，本地和在线 client 读取 PDF 字节前都会把 file URL 转为原生 Windows 路径；`parseManager` 的预检也使用同一套转换逻辑，避免“预检失败但真实文件存在”的误报。

## Task 13: Short Local Upload Filename

**Files:**

- Modify: `src/modules/mineruClient/formData.ts`
- Test: `test/mineruClient.test.ts`

- [x] **Step 1: Diagnose local task failure from MinerU service log**

读取用户提供的 `error.txt`，确认本地 MinerU 服务已经收到文件并进入解析流程，但在 `_process_output()` 写 Markdown 时抛出 `FileNotFoundError`。失败路径为 `D:\Workspace\output\<task_id>\<long-paper-title>\hybrid_auto\<long-paper-title>.md`，同一个长论文标题同时出现在目录名和文件名中，路径长度约 283，超过 Windows 常见路径限制风险。插件端显示的 `Local MinerU task failed` 来自轮询到本地任务 `status = failed`，不是插件提交或下载阶段误判。

- [x] **Step 2: Reproduce long filename in multipart submit**

新增 `uses a short upload filename for local tasks` 测试，使用长论文标题路径提交 local/lite 任务，断言 multipart `files` part 不应包含原始长文件名，而应使用短上传名。实现前全量测试按预期失败，显示旧实现把长标题作为 `filename="..."` 发送给本地 MinerU。

- [x] **Step 3: Use a stable short local upload filename**

将本地 multipart 文件 part 的 `filename` 固定为 `mineru-local.pdf`。插件自己的 `AttachmentRef.fileName`、存储目录和 manifest 仍由 Zotero attachment 元数据决定，不受这个上传文件名影响；该短名只用于避免本地 MinerU 服务把超长标题扩展成服务端输出路径。

- [x] **Step 4: Verify local short filename submit**

已运行 `.\node_modules\.bin\tsc.CMD --noEmit`，退出码为 0；已运行 `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail`，结果为 `161 passed`。

实现说明：
本轮真实根因是本地 MinerU 服务会使用 multipart `filename` 的 stem 作为输出目录名和结果文件名。对于长论文标题，服务端输出路径在 Windows 下变得过长，导致解析完成后写 `.md` 文件失败，任务状态变为 `failed`。修复后，插件对 local API 始终上传短文件名 `mineru-local.pdf`，避免触发本地服务的长路径失败；插件结果存储仍保留 Zotero attachment 的原始文件名。

## Self-Review

- Spec coverage: preferences, four API combinations, async local API, `/health`, lite storage, precise-vs-lite overwrite rules, preferred Markdown copy, API-key rules, and tests all map to tasks above.
- Placeholder scan: no `TBD`, `TODO`, or "implement later" placeholders are intentionally present.
- Type consistency: source/mode names are `online | local` and `precise | lite` throughout; result kinds are `precise | lite`; storage methods are `hasLiteResult`, `writeLiteResult`, and `readPreferredMarkdown`.
