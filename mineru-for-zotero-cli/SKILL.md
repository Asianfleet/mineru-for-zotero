---
name: mineru-for-zotero-cli
description: Query Markdown parse results and arXiv LaTeX sources for Zotero items through a bundled CLI. Use this skill when the task requires searching Zotero items, reading MinerU Markdown, or fetching and querying an item's arXiv LaTeX source. Produces agent-readable text output or structured JSON for pipeline usage.
---

# MinerU for Zotero CLI

## Context

MinerU is a document parsing system for converting PDFs into structured content such as Markdown, layout regions, formulas, tables, and images. MinerU for Zotero is a Zotero plugin that runs MinerU parsing for PDF attachments, stores the parse results in the local Zotero profile, and exposes saved Markdown through a local query API.

Use the bundled CLI to query parsed Markdown or an arXiv LaTeX source. The CLI calls the plugin's local HTTP API; it does not parse PDFs or bypass Zotero preferences. It reads the default Zotero profile only to discover the local API port. LaTeX commands identify the arXiv ID from the Zotero item's `extra` or `url` field and download the source on demand.

## Preconditions

- Zotero is running.
- Markdown query API is available.
- If the API requires a token, pass it with `--token <token>`.

## IRON LAW

For any subsequent task that requires acquiring paper content (such as reading, quoting, summarizing, or extracting paper text, tables, formulas, or images), **first try to obtain the content from Zotero using this skill (the bundled `mineru-for-zotero-cli/scripts/query-source.mjs` CLI).**

- Use the CLI as the PRIMARY and preferred source for paper content.
- Use parsed Markdown by default. Treat LaTeX source as an accuracy check: read only the corresponding LaTeX section or passage when the Markdown has a clear parsing error or an ambiguity that cannot be resolved from the Markdown. Do not read the full LaTeX source as a routine second pass.
- Fall back to other methods only if the CLI fails (for example the result is missing, the API is disabled, or the item/attachment cannot be resolved).
- Do not go straight to web search or other sources when the parsed content already exists in Zotero. Check this skill first.

## CLI Reference

### CLI Script

All operations use `mineru-for-zotero-cli/scripts/query-source.mjs` from the repository root (Node.js, zero external dependencies).

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs <command> [options]
```

### Command Index

| Command          | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| `search`         | Search Zotero items by title.                                 |
| `markdown read`  | Read saved MinerU Markdown.                                   |
| `markdown table` | Find a table in MinerU Markdown and choose its output format. |
| `markdown image` | Fetch an image referenced by MinerU Markdown.                 |
| `latex fetch`    | Download and store the decompressed arXiv source.             |
| `latex read`     | Read the stored LaTeX source.                                 |
| `latex table`    | Find a table and return its original LaTeX code.              |
| `latex image`    | Fetch a file referenced by the stored LaTeX source.           |

### Common Options

The following options are shared by the source commands. `search` uses `--library-id` but does not use `--key`.

- `--library-id <id>` — Zotero library ID; required for every command
- `--key <key>` — Zotero item key; required for every `markdown` and `latex` command
- `--port <number>` — Zotero local server port; default is auto-detected from the Zotero profile, then 23119
- `--token <token>` — API token, sent as Authorization: Bearer
- `--format <text|json>` — Output format; default is `text`
- `--timeout-ms <number>` — Request timeout; default is 30000

### Commands

#### `search`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs search --library-id <id> --title <text> [common options]
```

- `--title <text>` — Required title search text

#### `markdown read`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id <id> --key <key> [options]
```

- `--attachment-key <key>` — Select a specific PDF attachment after an ambiguous-attachment response
- `--granularity <full|headings|section|search>` — Read scope; default is `full`
- `--section-number <expr>` — Section numbers for `section`, such as `5.1,5.3-5.5`
- `--section-path <path>` — Fuzzy heading phrase or comma-separated path fragments for `section`
- `--query <text>` — Search text for `search`
- `--context-paragraphs <n>` — Context paragraphs around each `search` match

#### `markdown table`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown table --library-id <id> --key <key> --query <text> [options]
```

- `--query <text>` — Required caption or cell-content query
- `--match <caption|content|both|caption-exact>` — Match scope; default is `both`
- `--table-format <html|markdown|tsv|latex|json>` — Output format; default is `html`

#### `markdown image`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown image --library-id <id> --key <key> --path <paths> (--output <file>|--output-dir <dir>)
```

- `--path <paths>` — Required image path or comma-separated paths from Markdown output
- `--output <file>` — Save one image; use only with a single path
- `--output-dir <dir>` — Save one or more images under a directory

#### `latex fetch`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex fetch --library-id <id> --key <key> [--refresh] [--main-file <relative-path>]
```

The arXiv ID is read from the Zotero item's `extra` or `url`. An ID with a version, such as `arXiv:2401.12345v2`, downloads that version; an unversioned ID downloads the latest source. Without `--refresh`, an existing ready source is reused. Use `--main-file <relative-path>` when the archive contains multiple possible entry files. This is the only command that downloads or replaces stored source files.

#### `latex read`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex read --library-id <id> --key <key> [options]
```

- `--granularity <full|headings|section|search>` — Read scope; default is `full`
- `--section-path <path>` — Exact full path separated by `/`, or a unique final heading title; case-insensitive
- `--query <text>` — Required non-empty search text for `search`
- `--context-paragraphs <n>` — Source paragraphs before and after each `search` match; default `1`

`latex read --granularity section` requires `--section-path`; it does not accept section numbers, number ranges, or fuzzy fragments. An ambiguous final title returns `ambiguous-section` with candidate paths and file locations. Missing paths return `section-not-found`. Section content ends at the next heading of the same or higher level, including across `\\input` files. Search output uses source file and line numbers.

#### `latex table`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex table --library-id <id> --key <key> --query <text>
```

- `--query <text>` — Required table caption or content query

The result is always the original LaTeX table code. `--table-format` is not available for this command and must not be passed.

#### `latex image`

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex image --library-id <id> --key <key> --path <paths> (--output <file>|--output-dir <dir>)
```

- `--path <paths>` — Required path or comma-separated paths in the stored source
- `--output <file>` — Save one file; use only with a single path
- `--output-dir <dir>` — Save one or more files under a directory, preserving source paths such as `imgs/` and `logo/`

Multi-file requests return an ordered result for every path. Invalid or missing paths are reported per item while valid files are still written; repeated paths are marked `duplicate-path` and written once. Any invalid or missing item makes the CLI exit nonzero. Text and JSON output contain file metadata and output paths, never base64 data.

## Workflows

### Search a paper by title

Use this when you do not yet know the Zotero item key.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs search --library-id 1 --title "paper title"
```

### Read headings first

Let the CLI choose the parsed PDF attachment automatically before specifying an attachment.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id 1 --key ABCD1234 --granularity headings
```

If this succeeds, keep omitting `--attachment-key` for later `headings`, `section`, `search`, and `full` requests on the same item. Do not preemptively pick the first PDF just because the search result lists multiple attachments. The CLI's automatic selection prefers parsed attachments and should be allowed to resolve the item-level key first.

### Select a specific attachment

Add `--attachment-key` only after the CLI returns `ambiguous-attachment`, or when the user explicitly asks for a specific attachment.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id 1 --key ABCD1234 --attachment-key PDFKEY01 --granularity headings
```

Use one of the candidate keys from the error output, then keep that same attachment key for later requests.

### Read sections by number

Use this when paper headings include section numbers.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id 1 --key ABCD1234 --granularity section --section-number "5.1,5.3-5.5"
```

### Read sections by fuzzy path

Use this when you know a heading phrase but not the full root path.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id 1 --key ABCD1234 --granularity section --section-path "Experiment Settings,Results"
```

Section output is grouped under `groups`, so inspect each group status before treating a query as found.

### Search parsed Markdown

Use this for local context inside a saved parse result.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id 1 --key ABCD1234 --granularity search --query "retrieval" --context-paragraphs 2
```

### Fetch full Markdown

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown read --library-id 1 --key ABCD1234 --granularity full
```

Use full Markdown only when section or search output is insufficient.

### Find tables

Use this when the user asks for a table by caption or cell content.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown table --library-id 1 --key ABCD1234 --query "Table 2" --match both --table-format markdown
```

Use `--match caption-exact` when the query is a table-number token such as `Table 2` and should not also match `Table 20`.

### Fetch images

Use this when section output contains `![](images/...)` and the image is needed.

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs markdown image --library-id 1 --key ABCD1234 --path "images/a.jpg" --output a.jpg
```

Image commands must provide `--output` or `--output-dir`; use `--output` for one image path and `--output-dir` for comma-separated multi-image paths.

### Query an arXiv LaTeX source

Fetch the source first. The command stores only the decompressed files under the plugin data folder and reuses them on later queries:

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex fetch --library-id 1 --key ABCD1234
```

Then inspect headings, read the full expanded source, or search source lines:

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex read --library-id 1 --key ABCD1234 --granularity headings
node mineru-for-zotero-cli/scripts/query-source.mjs latex read --library-id 1 --key ABCD1234 --granularity full
node mineru-for-zotero-cli/scripts/query-source.mjs latex read --library-id 1 --key ABCD1234 --granularity section --section-path "Main Results"
node mineru-for-zotero-cli/scripts/query-source.mjs latex read --library-id 1 --key ABCD1234 --granularity search --query "attention" --context-paragraphs 1
```

Find a table. The result is always the original LaTeX table code:

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex table --library-id 1 --key ABCD1234 --query "Table 2"
```

Fetch a source image or PDF referenced by `\\includegraphics`:

```powershell
node mineru-for-zotero-cli/scripts/query-source.mjs latex image --library-id 1 --key ABCD1234 --path imgs/one.pdf,imgs/two.pdf --output-dir extracted
```

## Error Handling

- `api-disabled`: Ask the user to enable the Markdown query API in Zotero preferences.
- `invalid-token`: Ask the user for the current API token from Zotero preferences.
- `ambiguous-attachment`: This is the signal to re-run with `--attachment-key` using one of the candidate keys. It is not a failure to prevent in advance.
- `parse-result-not-found`: Tell the user the target PDF has no available parse result yet.
- `arxiv-id-not-found`: The Zotero item has no recognizable arXiv ID in `extra` or `url`; LaTeX mode only supports arXiv sources.
- `arxiv-download-failed`: The arXiv source could not be downloaded. Retry later or check the item's arXiv ID and network access.
- `invalid-main-file`: The requested `--main-file` path is not present in the downloaded archive.
- `tex-source-not-found`: Run `latex fetch` before querying the LaTeX source, or use `--refresh` to replace a stale local copy.
- `section-not-found`: Re-run with `--granularity headings`, then use an exact LaTeX `--section-path` or a unique final title.
- `ambiguous-section`: Use one of the returned full heading paths.
- `missing-query`: Pass `--section-path` for a LaTeX section or a non-empty `--query` for search.
- `invalid-path`: Use a safe relative image path present in the stored source.
- `image-not-found`: Confirm the Markdown image path exists in the saved parse result.
