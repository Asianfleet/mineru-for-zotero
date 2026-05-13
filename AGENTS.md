# Repository Guidelines

## Project Structure & Module Organization

This repository is a Zotero 8/9 plugin built with TypeScript and `zotero-plugin-scaffold`. Runtime source lives in `src/`: `index.ts` is the entry point, `hooks.ts` handles Zotero lifecycle and menu registration, `modules/` contains feature modules, and `utils/` contains shared helpers. Static plugin assets and Zotero metadata live in `addon/`, including `manifest.json`, `prefs.js`, XUL/XHTML/CSS under `addon/content/`, SVG toolbar/menu assets, icons, and Fluent locale files under `addon/locale/<locale>/`. Type declarations live in `typings/`. Tests live in `test/` and use `*.test.ts` naming. Generated build output is under `.scaffold/build/` and should not be edited manually.

Core feature modules currently include `mineruClient.ts` for the official MinerU v4 API boundary, `parseManager.ts` for item/attachment parsing orchestration, `storage.ts` for per-attachment result persistence, `boxNormalizer.ts` for converting MinerU schemas into stable boxes, `copyFormatter.ts` for copy output, `readerToolbar.ts` for the PDF Reader toolbar menu, `readerOverlay.ts` for box rendering and selection behavior, and `preferenceScript.ts` for settings-page data-folder UI.

## Build, Test, and Development Commands

- `npm start`: runs `zotero-plugin serve`, builds in development mode, launches Zotero, and watches `src/**` and `addon/**` for hot reload.
- `npm run build`: creates a production plugin build with `zotero-plugin build`, then runs `tsc --noEmit` for type checking.
- `npm test`: runs the scaffold test suite.
- `npm run lint:check`: checks Prettier formatting and ESLint rules.
- `npm run lint:fix`: formats files and applies safe ESLint fixes.
- `npm run release`: starts the configured release flow for versioning, packaging, tags, and GitHub release assets.

## Coding Style & Naming Conventions

Use TypeScript ES modules and follow the existing two-space indentation. Prettier is configured with `printWidth: 80`, `tabWidth: 2`, and LF line endings. Keep module filenames descriptive and lower camel case where the project already does so, for example `preferenceScript.ts` or `mineruClient.ts`. Prefer small modules with explicit exported functions or classes over broad utility files. Locale keys belong in Fluent files, not inline UI strings.

## Testing Guidelines

Tests use Mocha and Chai through `zotero-plugin test`. Place unit tests in `test/` with names like `featureName.test.ts`, and keep shared fixtures in clearly named helper files such as `domainFixtures.ts`. Add or update tests for parsing, formatting, storage, client boundaries, normalizer coverage, reader toolbar behavior, reader overlay interactions, and lifecycle behavior when those areas change.

After code changes, run the full scaffold test suite with `zotero-plugin test --exit-on-finish` so the scaffold test Zotero process exits automatically after the suite completes. On Windows, prefer the local scaffold binary for final verification:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

This project does not use Vitest. Do not look for or run `.\node_modules\.bin\vitest.cmd`.

For small edits to existing XHTML files such as `addon/content/preferences.xhtml`, avoid running `prettier --write` unless formatting is part of the task. It can reflow unrelated long tags and expand the diff; if it happens during validation, restore unrelated formatting before final verification.

## Project Notes

- The official MinerU API flow is v4 batch extraction: request `/api/v4/file-urls/batch`, upload the PDF to the returned presigned URL, poll `/api/v4/extract-results/batch/{batch_id}`, then download `full_zip_url` or fall back to `md_url` where necessary.
- When debugging the MinerU parsing pipeline, do not infer API behavior from UI messages alone. Use tests or diagnostics to verify each boundary: API key checks, file readability, upload URL creation, bare upload, polling, result download, ZIP reading, raw result schema selection, box normalization, and storage writes.
- Keep MinerU presigned URL requests as close to the signed request as possible. Prefer a bare XHR PUT for uploads to presigned URLs so extra headers do not change the signature calculation and trigger `SignatureDoesNotMatch`.
- Diagnose MinerU result ZIP download issues with network evidence. In the Zotero/Firefox runtime, `fetch`, `XMLHttpRequest`, `Zotero.HTTP.request`, and `Zotero.File.download` may behave differently for CDN URLs. If the built-in network path returns an empty response or an unreadable ZIP, record the URL, byte count, response headers, ZIP-reader diagnostics, and any fallback path.
- After downloading a ZIP locally, prefer ZIP readers available in the Zotero runtime, such as `nsIZipReader`; do not assume `DecompressionStream("deflate-raw")` is available in the target runtime.
- MinerU box data is not always stored in `pages[].blocks`. Real results may use `pdf_info[].para_blocks`, `pdf_info[].layout_dets`, or `pdf_info[].discarded_blocks`; page size may be `page_size`; regions may be `bbox` or `poly`; text may be under `markdown`, `text`, `content`, `html`, `latex`, or `lines[].spans[].content`.
- The normalizer preserves detailed box types where useful for labels, including captions, headers, footers, footnotes, page numbers, references, formulas, image/table bodies, and table HTML. For "missing box information" errors, inspect the saved `mineru-result.json` and the schemas supported by `boxNormalizer.ts` first.
- Parsing results are stored under `ProfD/mineru-copy/attachments/<libraryID>-<attachmentKey>/` with `manifest.json`, `mineru-result.json`, `content.md`, and `boxes.normalized.json`. Treat these files as plugin-owned output; external tools may read them but should not write them.
- Storage writes use temporary and backup directories to keep previous ready results readable when replacement fails. Ignore transient `.tmp-*` and `.bak-*` result directories when counting or diagnosing ready results.
- `storage.readBoxes()` may refresh stale `boxes.normalized.json` from `mineru-result.json` when the raw MinerU result contains more detailed supported boxes. Do not assume an unchanged box count means the normalized file is current.
- Reparse prompts must be non-destructive by default. For Zotero/Firefox prompt dialogs using `confirmEx`, treat dialog close, Escape, and cancel-like positions as `use-existing`; do not bind button position 1 to reparsing or overwriting.
- Regular Zotero items can have multiple PDF attachments. The item context menu should expose a submenu with `Parse all PDFs` plus one entry per PDF; batch parsing should confirm existing ready results once, skip ready PDFs when the user chooses to use existing results, and otherwise parse target PDFs in parallel.
- Reader toolbar UI is icon-driven and registered per reader window. Keep panel state per reader instance, place mode commands and selection actions consistently, and use Fluent strings rather than hard-coded reader overlay or preferences text.
- Reader overlay modes are `all`, `hover`, and `off`. Multi-selection uses `Shift` or `Ctrl`; selected boxes copy in original MinerU `rawIndex` order; formula boxes support copying with or without `$` delimiters.
- Default overlay behavior must allow native PDF text selection by keeping overlay boxes and page layers at `pointer-events: none`. Only modifier-key selection mode should enable overlay pointer events and intercept box clicks.
- For Zotero/PDF.js reader overlays, mount the overlay root on the reader document `body` or `documentElement`, not on `#viewerContainer`, `.pdfViewer`, or other PDF.js internal scroll containers. Use PDF.js containers only for scroll observation, positioning, and wheel forwarding.
- Reader overlays can span same-origin nested reader iframes. Keep `rootsByWindow` and cleanup handlers in sync across windows, and clean up overlays when a reader disappears or switches mode to `off`.
- When reader overlay data is missing, do not rely on logs alone. Surface a user-facing notice, reset the overlay mode to `off`, and avoid leaving stale UI state enabled.
- `ztoolkit.log` may not appear in the console being inspected, depending on the runtime environment and console settings. For reader-toolbar or iframe click diagnostics, also emit to `Zotero.debug` and the relevant window `console.info`, and keep a visible UI state when possible.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, such as `feat(mineru): add official api client boundary` and `test(mineru): add domain formatter normalizer coverage`. Use a short imperative subject with a meaningful scope. Pull requests should describe the behavioral change, list test results, link related issues, and include screenshots or recordings for visible Zotero UI changes. Do not commit local secrets from `.env`; use `.env.example` for documented configuration.
