# Repository Guidelines

## Project Structure & Module Organization

This repository is a Zotero 7 plugin built with TypeScript and
`zotero-plugin-scaffold`. Runtime source lives in `src/`: `index.ts` is the
entry point, `hooks.ts` handles lifecycle behavior, `modules/` contains feature
modules, and `utils/` contains shared helpers. Static plugin assets and Zotero
metadata live in `addon/`, including `manifest.json`, `prefs.js`, XUL/XHTML/CSS
under `addon/content/`, icons, and Fluent locale files under
`addon/locale/<locale>/`. Type declarations live in `typings/`. Tests live in
`test/` and use `*.test.ts` naming. Generated build output is under
`.scaffold/build/` and should not be edited manually.

## Build, Test, and Development Commands

- `npm start`: runs `zotero-plugin serve`, builds in development mode, launches
  Zotero, and watches `src/**` and `addon/**` for hot reload.
- `npm run build`: creates a production plugin build with
  `zotero-plugin build`, then runs `tsc --noEmit` for type checking.
- `npm test`: runs the scaffold test suite.
- `npm run lint:check`: checks Prettier formatting and ESLint rules.
- `npm run lint:fix`: formats files and applies safe ESLint fixes.
- `npm run release`: starts the configured release flow for versioning,
  packaging, tags, and GitHub release assets.

## Coding Style & Naming Conventions

Use TypeScript ES modules and follow the existing two-space indentation. Prettier
is configured with `printWidth: 80`, `tabWidth: 2`, and LF line endings. Keep
module filenames descriptive and lower camel case where the project already does
so, for example `preferenceScript.ts` or `mineruClient.ts`. Prefer small modules
with explicit exported functions or classes over broad utility files. Locale keys
belong in Fluent files, not inline UI strings.

## Testing Guidelines

Tests use Mocha and Chai through `zotero-plugin test`. Place unit tests in
`test/` with names like `featureName.test.ts`, and keep shared fixtures in
clearly named helper files such as `domainFixtures.ts`. Add or update tests for
parsing, formatting, storage, client boundaries, and lifecycle behavior when
those areas change. Run `npm test` plus `npm run lint:check` before opening a
pull request.

After code changes, run the full scaffold test suite with
`zotero-plugin test --exit-on-finish` so the scaffold test Zotero process exits
automatically after the suite completes.

For small edits to existing XHTML files such as `addon/content/preferences.xhtml`,
avoid running `prettier --write` unless formatting is part of the task. It can
reflow unrelated long tags and expand the diff; if it happens during validation,
restore unrelated formatting before final verification.

## Project Notes

- When debugging the MinerU parsing pipeline, do not infer API behavior from UI
  messages alone. Use tests or diagnostics to verify each boundary: upload,
  task submission, polling, download, decompression, raw result schema, and box
  normalization.
- MinerU box data is not always stored in `pages[].blocks`. Real results may use
  `pdf_info[].para_blocks` or `pdf_info[].layout_dets`; page size may be
  `page_size`; regions may be `bbox` or `poly`; text may be under
  `lines[].spans[].content`. For "missing box information" errors, inspect the
  saved `mineru-result.json` and the schemas supported by the normalizer first.
- Diagnose MinerU result ZIP download issues with network evidence. In the
  Zotero/Firefox runtime, `fetch`, `Zotero.HTTP.request`, and
  `Zotero.File.download` may behave differently for CDN URLs. If the built-in
  network path returns an empty response, record the URL, byte count, response
  headers, and verify any fallback with a reproducible download path.
- Keep MinerU presigned URL requests as close to the signed request as possible.
  Prefer a bare XHR PUT for uploads to presigned URLs so extra headers do not
  change the signature calculation and trigger `SignatureDoesNotMatch`. After
  downloading a ZIP locally, prefer ZIP readers available in the Zotero runtime,
  such as `nsIZipReader`; do not assume `DecompressionStream("deflate-raw")` is
  available in the target runtime.
- `ztoolkit.log` may not appear in the console being inspected, depending on the
  runtime environment and console settings. For reader-toolbar or iframe click
  diagnostics, also emit to `Zotero.debug` and the relevant window
  `console.info`, and keep a visible UI state when possible.
- For Zotero/Firefox prompt dialogs using `confirmEx`, treat dialog close,
  Escape, and cancel-like positions as the non-destructive choice. Do not bind
  button position 1 to destructive actions such as reparsing or overwriting,
  because close/cancel behavior can return that position.
- When reader overlay data is missing, do not rely on logs alone. Surface a
  user-facing notice, reset the overlay mode to `off`, and keep `boxes.normalized.json`
  in sync with `mineru-result.json` even when the box count does not change,
  otherwise newly supported MinerU types like captions, headers, and footnotes
  can stay hidden in already-parsed PDFs.
- For Zotero/PDF.js reader overlays, mount the overlay root on the reader
  document `body` or `documentElement`, not on `#viewerContainer`, `.pdfViewer`,
  or other PDF.js internal scroll containers. The internal containers may report
  connected overlay nodes and normal page counts while still preventing
  pointer/mouse events from reaching the overlay logic reliably. Use the PDF.js
  containers for scroll observation and wheel forwarding only.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits, such as
`feat(mineru): add official api client boundary` and
`test(mineru): add domain formatter normalizer coverage`. Use a short
imperative subject with a meaningful scope. Pull requests should describe the
behavioral change, list test results, link related issues, and include
screenshots or recordings for visible Zotero UI changes. Do not commit local
secrets from `.env`; use `.env.example` for documented configuration.
