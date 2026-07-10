# Repository Guidelines

## Project Structure & Module Organization

This repository is a Zotero 8/9 plugin built with TypeScript and `zotero-plugin-scaffold`. Runtime source lives in `src/`: `index.ts` is the entry point, `hooks.ts` handles Zotero lifecycle and menu registration, `modules/` contains feature modules, and `utils/` contains shared helpers. Static plugin assets and Zotero metadata live in `addon/`, including `manifest.json`, `prefs.js`, XUL/XHTML/CSS under `addon/content/`, SVG toolbar/menu assets, icons, and Fluent locale files under `addon/locale/<locale>/`. Type declarations live in `typings/`. Tests live in `test/` and use `*.test.ts` naming. Generated build output is under `.scaffold/build/` and should not be edited manually.

Core feature modules currently include `mineruClient/` for selecting and running online precise, online lite, and local MinerU clients; `parseManager.ts` for item/attachment parsing orchestration; `parseNotice.ts` for source/mode-aware parsing notices and batch progress; `itemMenu.ts` for the attachment-only library context menu; `storage.ts` for per-attachment precise and lite result persistence; `domain.ts` for shared parse, storage, and overlay domain types; `boxNormalizer.ts` for converting MinerU schemas into stable boxes; `copyFormatter.ts` for copy output; `readerToolbar/` for the PDF Reader toolbar menu; `readerOverlay/` for box rendering and selection behavior; and `preferenceScript.ts` for settings-page API source, parse mode, local endpoint, image-saving, and data-folder UI.

## Build, Test, and Development Commands

- Use `npm` for package scripts and dependency operations in this repository. The tracked lockfile is `package-lock.json`.
- `npm start`: runs `zotero-plugin serve`, builds in development mode, launches Zotero, and watches `src/**` and `addon/**` for hot reload.
- `npm run build`: creates a production plugin build with `zotero-plugin build`, then runs `tsc --noEmit` for type checking.
- `npm test`: runs the scaffold test suite.
- `npm run lint:check`: checks Prettier formatting and ESLint rules.
- `npm run lint:fix`: formats files and applies safe ESLint fixes.
- `npm run release`: starts the configured release flow for versioning, packaging, tags, and GitHub release assets.

Treat `npm run lint:check` as the local equivalent of the CI lint gate. Before any commit, run it after all file edits are complete and fix every reported Prettier or ESLint issue. Do not tell the user a change is ready to commit, push, or merge while `npm run lint:check` is failing or has not been run after the latest edit.

## Coding Style & Naming Conventions

Use TypeScript ES modules and follow the existing two-space indentation. Prettier is configured with `printWidth: 80`, `tabWidth: 2`, and LF line endings. Keep module filenames descriptive and lower camel case where the project already does so, for example `preferenceScript.ts` or `mineruClient.ts`. Prefer small modules with explicit exported functions or classes over broad utility files. Locale keys belong in Fluent files, not inline UI strings.

## Testing Guidelines

Tests use Mocha and Chai through `zotero-plugin test`. Place unit tests in `test/` with names like `featureName.test.ts`, and keep shared fixtures in clearly named helper files such as `domainFixtures.ts`. Add or update tests for parsing, formatting, storage, client boundaries, normalizer coverage, reader toolbar behavior, reader overlay interactions, and lifecycle behavior when those areas change.

After code changes, run the full scaffold test suite with `zotero-plugin test --exit-on-finish` so the scaffold test Zotero process exits automatically after the suite completes. On Windows, prefer the local scaffold binary for final verification:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

This project does not use Vitest. Do not look for or run `.\node_modules\.bin\vitest.cmd`.

Standalone Node tests under `scripts/` are not part of the scaffold suite. Run them separately with `node --test scripts/*.test.mjs` when those scripts change.

For small edits to existing XHTML files such as `addon/content/preferences.xhtml`, avoid running `prettier --write` unless formatting is part of the task. It can reflow unrelated long tags and expand the diff; if it happens during validation, restore unrelated formatting before final verification.

For user-facing Markdown documents such as `README.md` and `README_zh.md`, do not manually hard-wrap paragraphs or list items to 80 columns unless the surrounding document already uses that style. Preserve natural single-line sentences so later content edits stay readable and diffs stay focused.

For generated or agent-maintained Markdown under `docs/superpowers/`, especially `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md`, always run Prettier on the touched files before final lint verification:

```powershell
npx prettier --write docs/superpowers/plans/<file>.md docs/superpowers/specs/<file>.md
```

If multiple Markdown files were created or edited, include all of them in that command. This rule exists because unformatted plan/spec Markdown has repeatedly caused GitHub Actions `npm run lint:check` failures.

## Test Profile Port Isolation

`zotero-plugin-scaffold` generates the test profile with `extensions.zotero.httpServer.port` set to **23124** (instead of the default 23119) to avoid conflicts with a running production Zotero instance. However, the scaffold writes this setting directly into `prefs.js`, which Zotero persists on shutdown. If the test profile ever cross-contaminates the real profile (e.g. manual file copy, plugin behavior), port 23124 leaks into the production profile and breaks the Zotero Connector browser extension (which expects port 23119).

The mitigation is `scripts/fix-test-profile.mjs`, which runs via `preserve`/`pretest` hooks before every `npm start` / `npm test`. It creates a `user.js` in each test profile that sets the port override. Unlike `prefs.js`, `user.js` overrides preferences at every Zotero startup but is never written back, cutting off the leak path.

If the connector stops detecting Zotero after development work, first fully exit Zotero, then run `node scripts/fix-zotero-connector-port.mjs`. The script repairs only the leaked test port `23124` in Windows Zotero profiles and restores the Connector default port `23119`. If needed, manually check the real profile's `prefs.js` for the same stray setting.

## Project Notes

- MinerU parsing is selected by `createMinerUClientForSettings()` from `parseSource` (`online` or `local`) and `parseMode` (`precise` or `lite`). Keep the source/mode contract explicit when changing preferences, parsing orchestration, storage, and tests.
- Online precise parsing uses the official MinerU v4 batch extraction flow: request `/api/v4/file-urls/batch`, upload the PDF to the returned presigned URL, poll `/api/v4/extract-results/batch/{batch_id}`, then download `full_zip_url` or fall back to `md_url` where necessary.
- Online lite parsing uses the MinerU Agent API flow in `mineruClient/agentLite.ts`: create the task, upload to the returned file URL, poll the Agent task endpoint, then download Markdown from `markdown_url` or `markdownUrl`. Agent responses may wrap fields under `data`, so preserve both wrapped and top-level response handling.
- Local parsing uses the async local API in `mineruClient/local.ts`, defaulting to `http://127.0.0.1:8000`: check `/health`, submit multipart data to `/tasks`, poll `/tasks/{taskID}`, and download `/tasks/{taskID}/result`. Local results may be ZIP or JSON, and precise/lite mode changes both request fields and result conversion.
- When debugging the MinerU parsing pipeline, do not infer API behavior from UI messages alone. Use tests or diagnostics to verify each boundary: API key checks, file readability, upload URL creation, bare upload, polling, result download, ZIP reading, raw result schema selection, box normalization, and storage writes.
- Keep MinerU presigned URL requests as close to the signed request as possible. Prefer a bare XHR PUT for uploads to presigned URLs so extra headers do not change the signature calculation and trigger `SignatureDoesNotMatch`.
- Diagnose MinerU result ZIP download issues with network evidence. In the Zotero/Firefox runtime, `fetch`, `XMLHttpRequest`, `Zotero.HTTP.request`, and `Zotero.File.download` may behave differently for CDN URLs. If the built-in network path returns an empty response or an unreadable ZIP, record the URL, byte count, response headers, ZIP-reader diagnostics, and any fallback path.
- After downloading a ZIP locally, prefer ZIP readers available in the Zotero runtime, such as `nsIZipReader`; do not assume `DecompressionStream("deflate-raw")` is available in the target runtime.
- MinerU box data is not always stored in `pages[].blocks`. Real results may use `pdf_info[].para_blocks`, `pdf_info[].layout_dets`, or `pdf_info[].discarded_blocks`; page size may be `page_size`; regions may be `bbox` or `poly`; text may be under `markdown`, `text`, `content`, `html`, `latex`, or `lines[].spans[].content`.
- The normalizer preserves detailed box types where useful for labels, including captions, headers, footers, footnotes, page numbers, references, formulas, image/table bodies, and table HTML. For "missing box information" errors, inspect the saved `mineru-result.json` and the schemas supported by `boxNormalizer.ts` first.
- Precise parsing results are stored under `ProfD/mineru-copy/attachments/<libraryID>-<attachmentKey>/` with `manifest.json`, `mineru-result.json`, `content.md`, `boxes.normalized.json`, and optional extracted files under `images/`. Lite parsing results are stored beside them as `lite-manifest.json` and `lite-content.md`. Treat these files as plugin-owned output; external tools may read them but should not write them.
- Prefer `storage.readPreferredMarkdown()` when user-facing copy should work with either precise or lite results. It reads ready precise Markdown first and falls back to ready lite Markdown.
- Storage writes use temporary and backup directories to keep previous ready results readable when replacement fails. Ignore transient `.tmp-*` and `.bak-*` result directories when counting or diagnosing ready results.
- `storage.readBoxes()` may refresh stale `boxes.normalized.json` from `mineru-result.json` when the raw MinerU result contains more detailed supported boxes. Do not assume an unchanged box count means the normalized file is current.
- Reparse prompts must be non-destructive by default. For Zotero/Firefox prompt dialogs using `confirmEx`, treat dialog close, Escape, and cancel-like positions as `use-existing`; do not bind button position 1 to reparsing or overwriting.
- The item context menu intentionally targets PDF attachment selections only. Do not reintroduce the old regular-item submenu path unless the requirement changes explicitly.
- Multi-PDF parsing starts from one attachment-only menu command and shares one `ParseNoticeContext`. Keep batch notice counts in `parseNotice.ts`; avoid spreading completion-count mutation across `parseManager.ts` call sites.
- Batch parse notices should submit once for the whole batch, then report completion progress as each attachment finishes. Keep source/mode notice arguments in Fluent strings and update `typings/i10n.d.ts` with locale keys.
- When registering item context menu commands through `Zotero.MenuManager`, keep the lifecycle aligned with Zotero's localization resources. If a menu item uses keys from `*-mainWindow.ftl`, remove the inserted main-window Fluent link during window unload and shutdown before the plugin chrome is destructed; otherwise Zotero can keep trying to resolve an unloaded `mainWindow.ftl` and break later right-click menu refreshes.
- Reader toolbar UI is icon-driven and registered per reader window. Keep panel state per reader instance, place mode commands and selection actions consistently, and use Fluent strings rather than hard-coded reader overlay or preferences text.
- Reader overlay modes are `all`, `hover`, and `off`. Multi-selection uses `Shift` or `Ctrl`; selected boxes copy in original MinerU `rawIndex` order; formula boxes support copying with or without `$` delimiters.
- Default overlay behavior must allow native PDF text selection by keeping overlay boxes and page layers at `pointer-events: none`. Only modifier-key selection mode should enable overlay pointer events and intercept box clicks.
- For Zotero/PDF.js reader overlays, mount the overlay root on the reader document `body` or `documentElement`, not on `#viewerContainer`, `.pdfViewer`, or other PDF.js internal scroll containers. Use PDF.js containers only for scroll observation, positioning, and wheel forwarding.
- Reader overlays can span same-origin nested reader iframes. Keep `rootsByWindow` and cleanup handlers in sync across windows, and clean up overlays when a reader disappears or switches mode to `off`.
- When reader overlay data is missing, do not rely on logs alone. Surface a user-facing notice, reset the overlay mode to `off`, and avoid leaving stale UI state enabled.
- In Zotero PDF reader documents such as `resource://zotero/...viewer.html`, do not load plugin `chrome://` icon resources directly from reader overlay CSS. Prefer inline SVG or data URI icons for reader overlay controls.
- Reader overlay hover retention must include absolutely positioned child menus that extend outside the actions parent, not only the actions parent rectangle. Otherwise hover hit-testing can switch to a lower box while the pointer is over a floating menu.
- Reader overlay floating menus and panels must keep the owning box in a sustained elevated state, not only keep the actions element displayed. Later boxes can otherwise cover the open menu because of DOM order and hover z-index.
- Do not reuse the icon-only toolbar button base class for text menu items. Pseudo-element icons, fixed button dimensions, and icon-button hover boxes will pollute text menu layout.
- When adding reader overlay hit-testing helpers across modules, keep helper scope explicit. Do not assume a helper local to `render.ts` is available from `selection.ts`; missing helpers can break hover protection before the visual fix runs.
- `ztoolkit.log` may not appear in the console being inspected, depending on the runtime environment and console settings. For reader-toolbar or iframe click diagnostics, also emit to `Zotero.debug` and the relevant window `console.info`, and keep a visible UI state when possible.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, such as `feat(mineru): add official api client boundary` and `test(mineru): add domain formatter normalizer coverage`. Use a short imperative subject with a meaningful scope. Pull requests should describe the behavioral change, list test results, link related issues, and include screenshots or recordings for visible Zotero UI changes. Do not commit local secrets from `.env`; use `.env.example` for documented configuration.

Before suggesting or making a commit, explicitly confirm the latest `npm run lint:check` result in the final response. If the command was not run, state that clearly and do not provide a commit-ready summary.
