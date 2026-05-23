# src/modules Directory Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the three oversized `src/modules` TypeScript files into directory-based modules while preserving public imports and runtime behavior.

**Architecture:** Convert `mineruClient.ts`, `readerToolbar.ts`, and `readerOverlay.ts` into same-name directories with `index.ts` entrypoints. Keep public API exports stable, split internals by responsibility, and enforce `index.ts` under 300 lines and every TypeScript file under 500 lines.

**Tech Stack:** TypeScript ES modules, Zotero 8/9 plugin runtime, `zotero-plugin-scaffold`, Mocha/Chai scaffold tests, Windows PowerShell commands.

---

## Execution Rules (must be followed)

- Work in the current workspace unless the user explicitly approves a git worktree. The project AGENTS.md requires asking before using `git worktree`.
- Do not continue past a checkpoint until the user manually accepts that checkpoint.
- Do not use `corepack pnpm` for final verification in this project. Prefer local binaries such as `.\node_modules\.bin\tsc.CMD` and `.\node_modules\.bin\zotero-plugin.CMD`.
- Do not run Vitest. This project uses `zotero-plugin test`.
- Do not edit generated `.scaffold/build/` output.
- Do not preserve line-count limits by compressing formatting. If a file approaches 500 lines, split it by responsibility.
- During refactoring, add a docstring to every function explaining its purpose.
- Keep existing external imports working, including `from "./modules/readerOverlay"` and `from "../src/modules/mineruClient"`.

## Target File Structure

### `src/modules/mineruClient/`

- Create `index.ts`: public client factory and public re-exports.
- Create `types.ts`: `MinerUClient`, `MinerUClientOptions`, `FetchLike`, batch response types, `ZipEntry`, `ZipEntries`.
- Create `errors.ts`: `MinerURequestError`, `MinerUFileAccessError`, `MinerUTaskError`.
- Create `api.ts`: MinerU v4 submit/poll result helpers and JSON request helpers.
- Create `http.ts`: fetch/XHR/Zotero HTTP adapters, request body/header normalization, HTTP error detail helpers.
- Create `download.ts`: ZIP/Markdown download retry, fallback, diagnostics, Zotero file download and curl/nsIProcess fallback.
- Create `zip.ts`: ZIP file reader, local ZIP parser, inflation, central directory helpers.
- Create `result.ts`: raw result, Markdown, image entry extraction, ZIP entry filtering.
- Create `path.ts`: basename, base URL normalization, native paths, safe URL/path helpers, byte summaries.
- Delete `src/modules/mineruClient.ts` after moving its implementation into the directory.

### `src/modules/readerToolbar/`

- Create `index.ts`: public toolbar API and shared singleton wiring.
- Create `types.ts`: toolbar state, store, anchor, registration, binding, mode and message-id types.
- Create `store.ts`: per-reader menu open state.
- Create `assets.ts`: SVG loading, icon setter functions, data URI creation.
- Create `panel.ts`: menu panel, action row, selection label, action buttons, mode group, command button DOM.
- Create `registration.ts`: main window registration, unregister, MutationObserver, interval lifecycle.
- Create `binding.ts`: toolbar anchor lookup, button binding creation/update/destroy, reader sync.
- Create `commands.ts`: all/hover/off/copy/clear command dispatch.
- Create `diagnostics.ts`: toolbar diagnostic output and `errorMessage`.
- Delete `src/modules/readerToolbar.ts` after moving its implementation into the directory.

### `src/modules/readerOverlay/`

- Create `index.ts`: public overlay API and high-level orchestration.
- Create `types.ts`: `ReaderOverlayKey`, `ReaderOverlayState`, box style, `PageRect`, positioning and selection options.
- Create `state.ts`: overlay state map, state creation, cleanup, root setters, selected count.
- Create `windows.ts`: reader attachment lookup, reader views, reader windows and iframe traversal.
- Create `styles.ts`: overlay CSS, theme variable bridge, style injection.
- Create `render.ts`: overlay root, box elements, labels, actions, type labels, renderable box filtering.
- Create `selection.ts`: selection state, hover state, modifier-active class, range selection and class sync.
- Create `positioning.ts`: page rects, page layer positioning, scroll containers, wheel forwarding.
- Create `copy.ts`: selected box copy, full Markdown fallback, formula copy, clipboard writes.
- Create `notice.ts`: missing-result notice text and user-facing notices.
- Create `diagnostics.ts`: overlay diagnostics and safe cleanup helpers.
- Delete `src/modules/readerOverlay.ts` after moving its implementation into the directory.

---

## Task 0: Baseline Checks

**Files:**

- Read: `docs/superpowers/specs/2026-05-22-modules-directory-split-design.md`
- Read: `src/modules/mineruClient.ts`
- Read: `src/modules/readerToolbar.ts`
- Read: `src/modules/readerOverlay.ts`

- [x] **Step 0.1: Confirm clean workspace**

Run:

```powershell
git status --short
```

Expected: no output.

- [x] **Step 0.2: Record current oversized files**

Run:

```powershell
Get-ChildItem -LiteralPath 'src\modules' -File -Recurse | Where-Object { $_.Extension -in '.ts','.tsx' } | ForEach-Object { $count = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines; [PSCustomObject]@{ Lines = $count; Path = $_.FullName.Substring((Get-Location).Path.Length + 1) } } | Sort-Object Lines -Descending | Format-Table -AutoSize
```

Expected: `readerOverlay.ts`, `mineruClient.ts`, and `readerToolbar.ts` are above 1000 lines before implementation.

- [x] **Step 0.3: Run baseline type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0. If it fails before edits, stop and report the baseline failure.

---

## Checkpoint 1: Split `mineruClient`

Stop after Task 4 and wait for user acceptance before starting Checkpoint 2.

**Implementation status:** Completed and manually accepted. The split was committed as `d50dcbe refactor(mineru): split client module`, then followed by `b774950 docs(mineru): add client function docstrings`. Manual plugin testing passed with no observed functional impact. Current `mineruClient` line counts remain within limits after docstrings: `download.ts` 356, `http.ts` 279, `zip.ts` 218, `index.ts` 186, `api.ts` 103, `result.ts` 99, `path.ts` 61, `errors.ts` 54, `types.ts` 51, `file.ts` 25.

### Task 1: Move `mineruClient` To A Directory Entrypoint

**Files:**

- Create: `src/modules/mineruClient/index.ts`
- Delete: `src/modules/mineruClient.ts`
- Modify: imports inside the moved file

- [x] **Step 1.1: Create the target directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'src\modules\mineruClient'
```

Expected: directory exists.

- [x] **Step 1.2: Move the current implementation**

Run:

```powershell
git mv src\modules\mineruClient.ts src\modules\mineruClient\index.ts
```

Expected: `git status --short` shows a rename from `src/modules/mineruClient.ts` to `src/modules/mineruClient/index.ts`.

- [x] **Step 1.3: Fix the domain import in `index.ts`**

Change this import:

```ts
import type { MinerUImageFile } from "./domain";
```

to:

```ts
import type { MinerUImageFile } from "../domain";
```

- [x] **Step 1.4: Verify directory import resolution**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0. This proves `from "./mineruClient"` and `from "../src/modules/mineruClient"` resolve to `mineruClient/index.ts`.

### Task 2: Extract `mineruClient` Types, Errors, API Helpers, And Path Helpers

**Files:**

- Create: `src/modules/mineruClient/types.ts`
- Create: `src/modules/mineruClient/errors.ts`
- Create: `src/modules/mineruClient/api.ts`
- Create: `src/modules/mineruClient/path.ts`
- Modify: `src/modules/mineruClient/index.ts`

- [x] **Step 2.1: Move public and internal types to `types.ts`**

Move these declarations from `index.ts` to `types.ts`, preserving their names:

```ts
import type { MinerUImageFile } from "../domain";

export interface MinerUClient {
  submitPdf(filePath: string): Promise<{ taskID: string }>;
  pollTask(
    taskID: string,
  ): Promise<{ status: "running" | "succeeded" | "failed"; error?: string }>;
  downloadResult(taskID: string): Promise<{
    rawResult: unknown;
    markdown: string;
    images?: MinerUImageFile[];
  }>;
}

export interface MinerUClientOptions {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof fetch;
  readBinary?: (filePath: string) => Promise<Uint8Array>;
  uploadBinary?: (url: string, body: Uint8Array) => Promise<Response>;
  downloadBinary?: (url: string) => Promise<Response>;
  downloadFileBytes?: (url: string) => Promise<Uint8Array | ZipEntries>;
  downloadRetryDelayMs?: number;
  maxDownloadAttempts?: number;
}

export type FetchLike = typeof fetch;
```

Also move `FileUrlsBatchResponse`, `ExtractResultsBatchResponse`, `ZipEntry`, and `ZipEntries` into `types.ts` and export them.

- [x] **Step 2.2: Move error classes to `errors.ts`**

Move `MinerURequestError`, `MinerUFileAccessError`, and `MinerUTaskError` unchanged into `errors.ts`, and export all three classes.

- [x] **Step 2.3: Move MinerU API helpers to `api.ts`**

Move these functions to `api.ts` and export them:

```text
getUploadURL
fetchBatchResult
requestJson
requestOk
ensureBusinessSuccess
firstExtractResult
authHeaders
jsonHeaders
```

Required imports in `api.ts`:

```ts
import { MinerURequestError, MinerUTaskError } from "./errors";
import type { ExtractResultsBatchResponse, FetchLike } from "./types";
import { errorMessage, responseErrorDetail } from "./http";
```

- [x] **Step 2.4: Move path and summary helpers to `path.ts`**

Move these functions to `path.ts` and export them:

```text
basename
normalizeBaseURL
toNativePath
safeURL
summarizeBytes
isSafeRelativePath
```

- [x] **Step 2.5: Update `index.ts` imports and public re-exports**

Add these imports and exports in `index.ts`:

```ts
import {
  fetchBatchResult,
  firstExtractResult,
  getUploadURL,
  jsonHeaders,
  requestJson,
  requestOk,
} from "./api";
import { MinerUFileAccessError, MinerUTaskError } from "./errors";
import type { MinerUClient, MinerUClientOptions } from "./types";
import { basename, normalizeBaseURL } from "./path";

export {
  MinerUFileAccessError,
  MinerURequestError,
  MinerUTaskError,
} from "./errors";
export type { MinerUClient } from "./types";
```

- [x] **Step 2.6: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 3: Extract `mineruClient` HTTP, Download, ZIP, And Result Modules

**Files:**

- Create: `src/modules/mineruClient/http.ts`
- Create: `src/modules/mineruClient/download.ts`
- Create: `src/modules/mineruClient/zip.ts`
- Create: `src/modules/mineruClient/result.ts`
- Modify: `src/modules/mineruClient/index.ts`
- Modify: `src/modules/mineruClient/api.ts`
- Modify: `src/modules/mineruClient/path.ts`

- [x] **Step 3.1: Move HTTP adapters to `http.ts`**

Move these functions to `http.ts` and export the functions consumed by other modules:

```text
createDefaultRequest
fetchUploadBinary
fetchDownloadBinary
fallbackDownloadBinary
xhrUploadBinary
xhrDownloadBinary
zoteroHttpFetch
xhrToResponse
normalizeResponseStatus
getRequestMethod
getRequestURL
normalizeRequestBody
normalizeBinary
toStandaloneArrayBuffer
normalizeHeaders
parseResponseHeaders
isRequest
isArrayBuffer
errorMessage
responseErrorDetail
summarizeErrorBody
extractXmlTag
sanitizeErrorDetail
```

Keep `responseErrorDetail` exported because `api.ts` uses it.

- [x] **Step 3.2: Move download fallback logic to `download.ts`**

Move these functions to `download.ts` and export `retryDownloadZip`, `zoteroDownloadFileBytes`, and `readZipOrFallback`:

```text
readZipOrFallback
withDownloadDiagnostics
retryDownloadZip
isRetryableDownloadError
delay
zoteroDownloadFileBytes
downloadWithCurl
getRuntimePlatform
downloadWithNsIProcess
findCurlPath
fileExists
fileSize
createTemporaryPath
removeFileIfExists
```

Import ZIP parsing from `./zip`, error types from `./errors`, HTTP helpers from `./http`, and URL/path helpers from `./path`.

- [x] **Step 3.3: Move ZIP parsing to `zip.ts`**

Move these functions to `zip.ts` and export the functions used outside the file:

```text
readZipFile
readZipEntryBytes
readZip
readZipEntry
inflateRaw
textMapToZipEntries
decodeText
findCentralDirectoryOffset
readUint16
readUint32
```

Keep `readZip`, `readZipFile`, `textMapToZipEntries`, and `decodeText` exported.

- [x] **Step 3.4: Move result extraction to `result.ts`**

Move these functions to `result.ts` and export them:

```text
readRawResultFromZip
readImagesFromZip
shouldKeepZipEntry
isZipImageEntry
getZipImagePath
hasPageBoxData
hasBlockGeometry
```

Import `MinerUImageFile` from `../domain`, `ZipEntries` from `./types`, and `decodeText` from `./zip`.

- [x] **Step 3.5: Keep `index.ts` focused on `createMinerUClient`**

After extraction, `index.ts` should contain:

```text
createMinerUClient
readPdfBytes
readFileBytes
public re-exports
```

If `index.ts` remains above 300 lines, move `readPdfBytes` and `readFileBytes` to `file.ts` and import them from `index.ts`.

- [x] **Step 3.6: Verify type check after extraction**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 4: Checkpoint 1 Verification And Manual Acceptance

**Files:**

- Verify: `src/modules/mineruClient/*.ts`
- Verify: `test/mineruClient.test.ts`
- Verify: `test/parseManager.test.ts`

- [x] **Step 4.1: Verify file line counts**

Run:

```powershell
Get-ChildItem -LiteralPath 'src\modules\mineruClient' -File -Filter '*.ts' | ForEach-Object { $count = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines; [PSCustomObject]@{ Lines = $count; Path = $_.FullName.Substring((Get-Location).Path.Length + 1) } } | Sort-Object Lines -Descending | Format-Table -AutoSize
```

Expected: every file is below 500 lines, and `src\modules\mineruClient\index.ts` is below 300 lines.

- [x] **Step 4.2: Run full TypeScript check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

- [x] **Step 4.3: Review diff scope**

Run:

```powershell
git diff --stat
git diff --name-status
```

Expected: changes are limited to deleting `src/modules/mineruClient.ts`, creating `src/modules/mineruClient/*.ts`, and any import fixes required by TypeScript.

- [x] **Step 4.4: Commit Checkpoint 1**

Run:

```powershell
git add src\modules\mineruClient src\modules\mineruClient.ts
git commit -m "refactor(mineru): split client module"
```

Expected: commit succeeds.

- [x] **Step 4.5: Stop for manual acceptance**

Report the commit hash, line-count table, `tsc` result, and diff scope to the user. Do not start Checkpoint 2 until the user explicitly approves.

---

## Checkpoint 2: Split `readerToolbar`

Start only after the user accepts Checkpoint 1. Stop after Task 8 and wait for user acceptance before starting Checkpoint 3.

**Implementation status:** Completed and manually accepted. The split was committed as `3e2a010 refactor(reader): split toolbar module`, then followed by `6b63f9c docs(reader): 将 toolbar 注释改为中文` to align new reader-toolbar comments with the project language convention. TypeScript and reader-toolbar formatting checks passed. Current `readerToolbar` line counts remain within limits after Chinese comments: `panel.ts` 412, `binding.ts` 301, `assets.ts` 174, `registration.ts` 133, `commands.ts` 75, `store.ts` 58, `types.ts` 51, `diagnostics.ts` 41, `index.ts` 29.

### Task 5: Move `readerToolbar` To A Directory Entrypoint

**Files:**

- Create: `src/modules/readerToolbar/index.ts`
- Delete: `src/modules/readerToolbar.ts`
- Modify: imports inside the moved file

- [x] **Step 5.1: Create the target directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'src\modules\readerToolbar'
```

- [x] **Step 5.2: Move the current implementation**

Run:

```powershell
git mv src\modules\readerToolbar.ts src\modules\readerToolbar\index.ts
```

- [x] **Step 5.3: Fix imports in `index.ts`**

Change:

```ts
import type { FluentMessageId } from "../../typings/i10n";
```

to:

```ts
import type { FluentMessageId } from "../../../typings/i10n";
```

Change:

```ts
} from "./readerOverlay";
import { getString } from "../utils/locale";
```

to:

```ts
} from "../readerOverlay";
import { getString } from "../../utils/locale";
```

- [x] **Step 5.4: Verify directory import resolution**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 6: Extract Toolbar Types, Store, Assets, And Panel DOM

**Files:**

- Create: `src/modules/readerToolbar/types.ts`
- Create: `src/modules/readerToolbar/store.ts`
- Create: `src/modules/readerToolbar/assets.ts`
- Create: `src/modules/readerToolbar/panel.ts`
- Modify: `src/modules/readerToolbar/index.ts`

- [x] **Step 6.1: Move toolbar types to `types.ts`**

Move these declarations into `types.ts` and export them:

```text
ReaderOverlayMode
ReaderMessageId
ReaderToolbarMenuState
ReaderToolbarPanelStore
ReaderToolbarAnchor
WindowToolbarRegistration
ReaderToolbarButtonBinding
ReaderToolbarRegistration
```

- [x] **Step 6.2: Move panel store to `store.ts`**

Move and export:

```text
createReaderToolbarMenuState
createReaderToolbarPanelStore
```

Import their types from `./types`.

- [x] **Step 6.3: Move icon and SVG state to `assets.ts`**

Move these constants, state variables, and functions to `assets.ts`:

```text
READER_TOOLBAR_ICON_PATH
READER_TOOLBAR_MODE_ICON_PATHS
READER_TOOLBAR_CLEAR_SELECTION_ICON_PATH
READER_TOOLBAR_COPY_SELECTION_ICON_PATH
readerToolbarIconURI
readerToolbarModeSVGs
readerToolbarClearSelectionSVG
readerToolbarCopySelectionSVG
readerToolbarIconLoadPromise
readerToolbarModeIconLoadPromise
readerToolbarActionIconLoadPromise
setReaderToolbarModeIconSVG
setReaderToolbarClearSelectionSVG
setReaderToolbarCopySelectionSVG
setReaderToolbarIconURI
createReaderToolbarIconDataURI
ensureReaderToolbarIconLoaded
ensureReaderToolbarModeIconLoaded
ensureReaderToolbarActionIconLoaded
ensureReaderToolbarAssetsLoaded
loadReaderToolbarIconURI
loadReaderToolbarModeSVGs
loadReaderToolbarActionIconSVGs
loadReaderToolbarActionIconSVG
normalizeReaderToolbarModeSVG
```

Export the SVG getter functions or state accessors required by `panel.ts` and `binding.ts`:

```ts
export function getReaderToolbarIconURI(): string;
export function getReaderToolbarModeSVG(mode: ReaderOverlayMode): string;
export function getReaderToolbarClearSelectionSVG(): string;
export function getReaderToolbarCopySelectionSVG(): string;
```

- [x] **Step 6.4: Move panel DOM creation to `panel.ts`**

Move these functions to `panel.ts` and export the public test-facing functions:

```text
createReaderToolbarPanel
updateMenu
createReaderToolbarActionRow
createReaderToolbarSelectionLabel
createReaderToolbarActionButtons
getReaderToolbarCopyLabel
createReaderToolbarIconCommandButton
createReaderToolbarModeGroup
createReaderToolbarModeButton
createReaderToolbarCommandButton
setReaderToolbarIconButtonContent
setReaderToolbarInlineSVGButtonContent
```

Keep `createReaderToolbarSelectionLabel` and `createReaderToolbarActionButtons` exported only if tests or another module imports them after extraction.

- [x] **Step 6.5: Update `index.ts` public exports**

`index.ts` must re-export these current public helpers:

```ts
export {
  createReaderToolbarMenuState,
  createReaderToolbarPanelStore,
} from "./store";
export {
  createReaderToolbarIconDataURI,
  setReaderToolbarClearSelectionSVG,
  setReaderToolbarCopySelectionSVG,
  setReaderToolbarIconURI,
  setReaderToolbarModeIconSVG,
} from "./assets";
export {
  createReaderToolbarActionRow,
  createReaderToolbarCommandButton,
  createReaderToolbarModeButton,
  createReaderToolbarModeGroup,
  createReaderToolbarPanel,
} from "./panel";
export type {
  ReaderToolbarAnchor,
  ReaderToolbarMenuState,
  ReaderToolbarPanelStore,
  ReaderToolbarRegistration,
} from "./types";
```

- [x] **Step 6.6: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 7: Extract Toolbar Registration, Binding, Commands, And Diagnostics

**Files:**

- Create: `src/modules/readerToolbar/registration.ts`
- Create: `src/modules/readerToolbar/binding.ts`
- Create: `src/modules/readerToolbar/commands.ts`
- Create: `src/modules/readerToolbar/diagnostics.ts`
- Modify: `src/modules/readerToolbar/index.ts`

- [x] **Step 7.1: Move diagnostics to `diagnostics.ts`**

Move and export:

```text
emitReaderToolbarDiagnostic
errorMessage
```

- [x] **Step 7.2: Move command dispatch to `commands.ts`**

Move and export:

```text
runReaderToolbarCommand
readerString
```

Import overlay functions from `../readerOverlay` and locale `getString` from `../../utils/locale`.

- [x] **Step 7.3: Move reader lookup helpers to `binding.ts`**

Move and export the functions needed by registration:

```text
findReaderToolbarAnchor
ensureButtonBinding
updateButtonBinding
setReaderToolbarButtonContent
destroyButtonBinding
cleanupWindowBindings
isOutsideToolbarMenu
positionMenu
getWindowReaders
getReaderToolbarDocument
getReaderAttachment
getToolbarButtonID
```

Keep `buttonBindings` in `binding.ts` so binding state is colocated with binding lifecycle.

- [x] **Step 7.4: Move window registration to `registration.ts`**

Move and export:

```text
registerReaderToolbar
unregisterReaderToolbar
registerReaderToolbarWindow
syncWindowToolbar
```

Keep `panelStore` in `index.ts` or `registration.ts`, but expose it to `binding.ts` through a typed parameter rather than importing mutable state from multiple directions.

- [x] **Step 7.5: Keep `index.ts` below 300 lines**

`index.ts` should contain public exports plus shared singleton wiring only. If orchestration grows, move the wiring into `registration.ts` and have `index.ts` re-export it.

- [x] **Step 7.6: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 8: Checkpoint 2 Verification And Manual Acceptance

**Files:**

- Verify: `src/modules/readerToolbar/*.ts`
- Verify: `test/readerToolbar.test.ts`
- Verify: `src/hooks.ts`
- Verify: `src/addon.ts`

- [x] **Step 8.1: Verify file line counts**

Run:

```powershell
Get-ChildItem -LiteralPath 'src\modules\readerToolbar' -File -Filter '*.ts' | ForEach-Object { $count = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines; [PSCustomObject]@{ Lines = $count; Path = $_.FullName.Substring((Get-Location).Path.Length + 1) } } | Sort-Object Lines -Descending | Format-Table -AutoSize
```

Expected: every file is below 500 lines, and `src\modules\readerToolbar\index.ts` is below 300 lines.

- [x] **Step 8.2: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

- [x] **Step 8.3: Review diff scope**

Run:

```powershell
git diff --stat
git diff --name-status
```

Expected: changes are limited to deleting `src/modules/readerToolbar.ts`, creating `src/modules/readerToolbar/*.ts`, and import/export fixes required by TypeScript.

- [x] **Step 8.4: Commit Checkpoint 2**

Run:

```powershell
git add src\modules\readerToolbar src\modules\readerToolbar.ts
git commit -m "refactor(reader): split toolbar module"
```

Expected: commit succeeds.

- [x] **Step 8.5: Stop for manual acceptance**

Report the commit hash, line-count table, `tsc` result, and diff scope to the user. Do not start Checkpoint 3 until the user explicitly approves.

---

## Checkpoint 3: Split `readerOverlay`

Start only after the user accepts Checkpoint 2. Stop after Task 12 and wait for final user acceptance.

**Implementation status:** Completed and manually accepted. The directory move landed first as `f3ca83e refactor(reader): split overlay module`, then the extracted submodules and orchestrator rewrite landed as `7d0338c refactor(reader): extract overlay submodules`. Final verification passed with `.\node_modules\.bin\tsc.CMD --noEmit` and `.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail` (`120 passed`). The old `src/modules/readerOverlay.ts` file was removed, and current `readerOverlay` line counts remain within limits: `positioning.ts` 452, `render.ts` 298, `selection.ts` 240, `styles.ts` 200, `state.ts` 178, `index.ts` 174, `windows.ts` 147, `notice.ts` 52, `types.ts` 50, `copy.ts` 42, `diagnostics.ts` 35.

### Task 9: Move `readerOverlay` To A Directory Entrypoint

**Files:**

- Create: `src/modules/readerOverlay/index.ts`
- Delete: `src/modules/readerOverlay.ts`
- Modify: imports inside the moved file

- [x] **Step 9.1: Create the target directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'src\modules\readerOverlay'
```

- [x] **Step 9.2: Move the current implementation**

Run:

```powershell
git mv src\modules\readerOverlay.ts src\modules\readerOverlay\index.ts
```

- [x] **Step 9.3: Fix imports in `index.ts`**

Change:

```ts
import type { NormalizedBox, OverlayMode } from "./domain";
import type { FluentMessageId } from "../../typings/i10n";
import { formatBoxesForCopy, formatFormulaForCopy } from "./copyFormatter";
import { getMinerUStorageRoot } from "./preferenceScript";
import { createStorage } from "./storage";
import { getString } from "../utils/locale";
```

to:

```ts
import type { NormalizedBox, OverlayMode } from "../domain";
import type { FluentMessageId } from "../../../typings/i10n";
import { formatBoxesForCopy, formatFormulaForCopy } from "../copyFormatter";
import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
import { getString } from "../../utils/locale";
```

- [x] **Step 9.4: Verify directory import resolution**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 10: Extract Overlay Types, State, Windows, Styles, And Diagnostics

**Files:**

- Create: `src/modules/readerOverlay/types.ts`
- Create: `src/modules/readerOverlay/state.ts`
- Create: `src/modules/readerOverlay/windows.ts`
- Create: `src/modules/readerOverlay/styles.ts`
- Create: `src/modules/readerOverlay/diagnostics.ts`
- Modify: `src/modules/readerOverlay/index.ts`

- [x] **Step 10.1: Move overlay types to `types.ts`**

Move and export:

```text
ReaderOverlayKey
ReaderOverlayState
ReaderOverlayBoxStyle
ReaderOverlayPositioningControllerOptions
ReaderOverlayPositioningController
ReaderOverlaySelectionOptions
PageRect
```

Import `NormalizedBox` and `OverlayMode` from `../domain`.

- [x] **Step 10.2: Move state management to `state.ts`**

Move and export:

```text
fallbackStates
getReaderOverlayKey
getReaderOverlayState
getReaderOverlayStateForReader
setReaderOverlayModeForReader
setReaderOverlayRootForReader
getReaderSelectedBoxCount
destroyReaderOverlay
destroyReaderOverlaysForReader
destroyReaderOverlaysByReaderID
destroyAllReaderOverlays
cleanupReaderOverlayRoot
ensureReaderOverlayStateMaps
getOverlayStates
isCurrentRenderState
safeReaderOverlayCleanup
isDeadObjectError
```

Keep `addon.data.readerOverlays` access in this file.

- [x] **Step 10.3: Move reader window helpers to `windows.ts`**

Move and export:

```text
readerOverlayNeedsWindowSync
getReaderOverlayWindow
getReaderOverlayWindows
addReaderOverlayWindowWithDescendants
getFrameContentWindow
getReaderViews
getReaderOverlayEventWindows
getWindowDocument
getParentWindow
getReaderAttachmentKey
getReaderAttachmentRef
getReaderOverlayMountContainer
```

- [x] **Step 10.4: Move CSS and theme bridge to `styles.ts`**

Move and export:

```text
READER_OVERLAY_STYLE_ID
READER_OVERLAY_THEME_VARIABLES
READER_OVERLAY_CSS
ensureReaderOverlayStyles
createReaderOverlayThemeCss
resolveCssVariableFromWindowTree
readCssVariable
isSafeCssCustomPropertyValue
```

- [x] **Step 10.5: Move diagnostics to `diagnostics.ts`**

Move and export:

```text
logReaderOverlayDiagnostic
```

- [x] **Step 10.6: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 11: Extract Overlay Render, Selection, Positioning, Copy, And Notice Modules

**Files:**

- Create: `src/modules/readerOverlay/render.ts`
- Create: `src/modules/readerOverlay/selection.ts`
- Create: `src/modules/readerOverlay/positioning.ts`
- Create: `src/modules/readerOverlay/copy.ts`
- Create: `src/modules/readerOverlay/notice.ts`
- Modify: `src/modules/readerOverlay/index.ts`

- [x] **Step 11.1: Move render helpers to `render.ts`**

Move and export:

```text
computeBoxStyle
buildReaderOverlayRoot
removeReaderOverlayRoot
createBoxElement
createBoxLabel
createBoxActions
createCopyButton
isFormulaBox
getRenderablePageBoxes
isStructuralReferenceContainerBox
containsBox
formatBoxTypeLabel
isReferenceBoxType
normalizeBoxType
groupBoxesByPage
formatPercent
clamp01
```

- [x] **Step 11.2: Move selection helpers to `selection.ts`**

Move and export:

```text
clearReaderOverlaySelectionForReader
syncSelectedBoxClasses
setBoxSelectedClass
setOverlayModifierActive
setHoveredBox
findBoxAtPoint
isPointInBoxActionsHoverArea
isPointInRect
getBoxActionsElement
getBoxElements
applyReaderOverlayBoxSelectionFromElement
isEventTarget
setElementClass
selectBoxRange
getRawIndexRange
```

- [x] **Step 11.3: Move positioning helpers to `positioning.ts`**

Move and export:

```text
createFallbackPageRect
createReaderOverlayPositioningController
getReaderScrollContainers
getPrimaryScrollContainer
positionPageLayers
findPageElement
forwardWheelToUnderlyingElement
getWheelEventConstructor
scrollElementBy
createPageRect
```

- [x] **Step 11.4: Move copy helpers to `copy.ts`**

Move and export:

```text
copySelectedBoxesForReader
formatSelectedBoxesForCopy
copyText
```

Keep usage of `formatBoxesForCopy` and `formatFormulaForCopy` imported from `../copyFormatter`.

- [x] **Step 11.5: Move notice and localized strings to `notice.ts`**

Move and export:

```text
readerOverlayString
showReaderOverlayNotice
getReaderOverlayNoticeText
```

Import `getString` from `../../utils/locale`.

- [x] **Step 11.6: Keep `index.ts` as the overlay orchestrator**

`index.ts` should keep high-level functions:

```text
applyReaderOverlayMode
renderReaderOverlayForReader
public re-exports
```

It should import behavior from the new modules and remain below 300 lines.

- [x] **Step 11.7: Run type check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

### Task 12: Checkpoint 3 Verification And Final Acceptance

**Files:**

- Verify: `src/modules/readerOverlay/*.ts`
- Verify: `test/readerOverlay.test.ts`
- Verify: `test/readerToolbar.test.ts`
- Verify: `src/hooks.ts`
- Verify: `src/addon.ts`

- [x] **Step 12.1: Verify file line counts for all split directories**

Run:

```powershell
Get-ChildItem -LiteralPath 'src\modules\mineruClient','src\modules\readerToolbar','src\modules\readerOverlay' -File -Filter '*.ts' | ForEach-Object { $count = (Get-Content -LiteralPath $_.FullName | Measure-Object -Line).Lines; [PSCustomObject]@{ Lines = $count; Path = $_.FullName.Substring((Get-Location).Path.Length + 1) } } | Sort-Object Lines -Descending | Format-Table -AutoSize
```

Expected: every file is below 500 lines; each `index.ts` is below 300 lines.

- [x] **Step 12.2: Verify no old oversized module files remain**

Run:

```powershell
Test-Path 'src\modules\mineruClient.ts'
Test-Path 'src\modules\readerToolbar.ts'
Test-Path 'src\modules\readerOverlay.ts'
```

Expected output:

```text
False
False
False
```

- [x] **Step 12.3: Run TypeScript check**

Run:

```powershell
.\node_modules\.bin\tsc.CMD --noEmit
```

Expected: exits with code 0.

- [x] **Step 12.4: Run full scaffold test suite**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: exits with code 0. If Zotero runtime setup blocks the test, capture the exact command output, keep `tsc` as the minimum verified result, and report the blocker.

- [x] **Step 12.5: Review final diff scope**

Run:

```powershell
git diff --stat
git diff --name-status
```

Expected: changes are limited to deleting the three old oversized module files, creating their directory modules, and import/export fixes required by TypeScript.

- [x] **Step 12.6: Commit Checkpoint 3**

Run:

```powershell
git add src\modules\readerOverlay src\modules\readerOverlay.ts
git commit -m "refactor(reader): split overlay module"
```

Expected: commit succeeds.

- [x] **Step 12.7: Stop for final manual acceptance**

Report the Checkpoint 3 commit hash, final line-count table, `tsc` result, scaffold test result, and final commit list to the user. Do not merge, squash, or start follow-up cleanup without explicit user instruction.

---

## Self-Review Checklist

- Spec coverage: the plan covers all three directories, stable import semantics, unchanged behavior, line-count limits, verification, and three manual checkpoints.
- Placeholder scan: the plan contains no unfinished markers and no unspecified implementation slots.
- Type consistency: public type names and function names match the current source inventory and spec.
- Scope control: the plan avoids new features, generated output edits, Vitest, and unrelated formatting.
