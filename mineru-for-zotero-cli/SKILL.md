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

## CLI Reference

### CLI Script

All operations use `scripts/query-markdown.mjs` (Nodejs, zero external dependencies).

```powershell
node scripts/query-markdown.mjs <command> [options]
```

### Commands

| Command    | Description                                                               | Example                                                                                                       |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `search`   | Search Zotero items by title and return matching candidates.              | `node scripts/query-markdown.mjs search --library-id 1 --title "keyword" --format json`                       |
| `markdown` | Query saved MinerU Markdown for an item key, with selectable granularity. | `node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity headings --format text` |

### Common Options

- `--library-id <id>` — Zotero library ID; required for both `search` and `markdown`
- `--port <number>` — Zotero local server port; default is auto-detected from the Zotero profile, then 23119
- `--token <token>` — API token, sent as Authorization: Bearer
- `--format <text|json>` — Output format; default is text, use `--format text` for agent-readable text. use `--format json` when another script or pipeline needs structured output.
- `--timeout-ms <number>` — Request timeout; default is 30000

### Search options

- `--title <text>` — Required search text for title matching

### Markdown options

- `--attachment-key <key>` — Select a specific PDF attachment after ambiguous-attachment or explicit user choice
- `--granularity <kind>` — full, headings, section, or search
- `--section-path <path>` — Exact full heading path from headings output, including root title
- `--query <text>` — Search query for search queries
- `--context-paragraphs <n>` — Context paragraphs for search queries

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

### Read a section

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-path "Paper Title/Introduction/Background"
```

`--section-path` must be the exact full path shown by `headings`, including the root title. A leaf heading such as `"Background"` is not enough when the headings output shows `"Paper Title/Introduction/Background"`.

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

## Error Handling

- `api-disabled`: Ask the user to enable the Markdown query API in Zotero preferences.
- `invalid-token`: Ask the user for the current API token from Zotero preferences.
- `ambiguous-attachment`: This is the signal to re-run with `--attachment-key` using one of the candidate keys. It is not a failure to prevent in advance.
- `parse-result-not-found`: Tell the user the target PDF has no available parse result yet.
- `section-not-found`: Re-run with `--granularity headings` and use an exact full heading path, including the root title.
- `missing-query`: Re-run the search query with a non-empty `--query` value.
