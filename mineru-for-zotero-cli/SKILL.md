---
name: mineru-for-zotero-cli
description: Query MinerU for Zotero Markdown parse results through a bundled CLI. Use this skill when the task requires searching Zotero items by title, selecting parsed PDF attachments, inspecting Markdown headings, reading specific sections, searching parsed Markdown content, or fetching full Markdown. Produces agent-readable text output or structured JSON for pipeline usage.
---

# MinerU for Zotero CLI

## Context

MinerU is a document parsing system for converting PDFs into structured content such as Markdown, layout regions, formulas, tables, and images. MinerU for Zotero is a Zotero plugin that runs MinerU parsing for PDF attachments, stores the parse results in the local Zotero profile, and exposes saved Markdown through a local query API.

Use the bundled CLI to query parsed Markdown that MinerU for Zotero has already saved. The CLI calls the plugin's local HTTP API; it does not parse PDFs, read Zotero profile files, or bypass Zotero preferences.

## Preconditions

- Zotero is running.
- Markdown query API is available.
- If the API requires a token, pass it with `--token <token>`.

## IRON LAW

For any subsequent task that requires acquiring paper content (such as reading, quoting, summarizing, or extracting paper text, tables, formulas, or images), **first try to obtain the content from Zotero using this skill (the bundled `scripts/query-markdown.mjs` CLI).**

- Use the CLI as the PRIMARY and preferred source for paper content.
- Fall back to other methods only if the CLI fails (for example the result is missing, the API is disabled, or the item/attachment cannot be resolved).
- Do not go straight to web search or other sources when the parsed content already exists in Zotero. Check this skill first.

## CLI Reference

### CLI Script

All operations use `scripts/query-markdown.mjs` (Nodejs, zero external dependencies).

```powershell
node scripts/query-markdown.mjs <command> [options]
```

### Commands

| Command    | Description                                                                                     | Example                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `search`   | Search Zotero items by title and return matching candidates.                                    | `node scripts/query-markdown.mjs search --library-id 1 --title "keyword" --format json`                         |
| `markdown` | Query saved MinerU Markdown for an item key, with selectable granularity.                       | `node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity headings --format text`   |
| `table`    | Find tables by caption, exact caption number, content, or both and return the requested format. | `node scripts/query-markdown.mjs table --library-id 1 --key ABCD1234 --query "Table 2" --table-format markdown` |
| `image`    | Fetch image files referenced as `images/...` in Markdown output.                                | `node scripts/query-markdown.mjs image --library-id 1 --key ABCD1234 --path "images/a.jpg" --output a.jpg`      |

### Common Options

- `--library-id <id>` — Zotero library ID; required for `search`, `markdown`, `table`, and `image`
- `--port <number>` — Zotero local server port; default is auto-detected from the Zotero profile, then 23119
- `--token <token>` — API token, sent as Authorization: Bearer
- `--format <text|json>` — Output format; default is text, use `--format text` for agent-readable text. use `--format json` when another script or pipeline needs structured output.
- `--timeout-ms <number>` — Request timeout; default is 30000

### Search options

- `--title <text>` — Required search text for title matching

### Markdown options

- `--attachment-key <key>` — Select a specific PDF attachment after ambiguous-attachment or explicit user choice
- `--granularity <kind>` — full, headings, section, or search
- `--section-number <expr>` — Section numbers for section queries, for example `5.1,5.3-5.5`. Range queries only support endpoints within the same top-level section; query cross-section ranges such as `1-3` as separate numbers, for example `1,2,3`.
- `--section-path <path>` — Fuzzy heading phrase or comma-separated path fragments for section queries
- `--query <text>` — Search query for search queries
- `--context-paragraphs <n>` — Context paragraphs for search queries

### Table options

- `--query <text>` — Required table caption or cell-content query
- `--match <kind>` — caption, content, both, or caption-exact; default is both
- `--table-format <format>` — html, markdown, tsv, latex, or json; default is html

### Image options

- `--path <paths>` — Required image path or comma-separated paths from Markdown output
- `--output <file>` — Save a single image response to a file; use only for one image path
- `--output-dir <dir>` — Save image responses under a directory; required for comma-separated multi-image paths

## Workflows

### Search a paper by title

Use this when you do not yet know the Zotero item key.

```powershell
node scripts/query-markdown.mjs search --library-id 1 --title "paper title"
```

### Read headings first

Let the CLI choose the parsed PDF attachment automatically before specifying an attachment.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity headings
```

If this succeeds, keep omitting `--attachment-key` for later `headings`, `section`, `search`, and `full` requests on the same item. Do not preemptively pick the first PDF just because the search result lists multiple attachments. The CLI's automatic selection prefers parsed attachments and should be allowed to resolve the item-level key first.

### Select a specific attachment

Add `--attachment-key` only after the CLI returns `ambiguous-attachment`, or when the user explicitly asks for a specific attachment.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --attachment-key PDFKEY01 --granularity headings
```

Use one of the candidate keys from the error output, then keep that same attachment key for later requests.

### Read sections by number

Use this when paper headings include section numbers.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-number "5.1,5.3-5.5"
```

### Read sections by fuzzy path

Use this when you know a heading phrase but not the full root path.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-path "Experiment Settings,Results"
```

Section output is grouped under `groups`, so inspect each group status before treating a query as found.

### Search parsed Markdown

Use this for local context inside a saved parse result.

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity search --query "retrieval" --context-paragraphs 2
```

### Fetch full Markdown

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity full
```

Use full Markdown only when section or search output is insufficient.

### Find tables

Use this when the user asks for a table by caption or cell content.

```powershell
node scripts/query-markdown.mjs table --library-id 1 --key ABCD1234 --query "Table 2" --match both --table-format markdown
```

Use `--match caption-exact` when the query is a table-number token such as `Table 2` and should not also match `Table 20`.

### Fetch images

Use this when section output contains `![](images/...)` and the image is needed.

```powershell
node scripts/query-markdown.mjs image --library-id 1 --key ABCD1234 --path "images/a.jpg" --output a.jpg
```

Image commands must provide `--output` or `--output-dir`; use `--output` for one image path and `--output-dir` for comma-separated multi-image paths.

## Error Handling

- `api-disabled`: Ask the user to enable the Markdown query API in Zotero preferences.
- `invalid-token`: Ask the user for the current API token from Zotero preferences.
- `ambiguous-attachment`: This is the signal to re-run with `--attachment-key` using one of the candidate keys. It is not a failure to prevent in advance.
- `parse-result-not-found`: Tell the user the target PDF has no available parse result yet.
- `section-not-found`: Re-run with `--granularity headings`, then use `--section-number` or a more specific `--section-path`.
- `missing-query`: Re-run the search query with a non-empty `--query` value.
- `invalid-path`: Use only image paths under `images/...`.
- `image-not-found`: Confirm the Markdown image path exists in the saved parse result.
