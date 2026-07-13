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
- MinerU for Zotero plugin has been installed.
- If the API requires a token, pass it with `--token <token>`.

## Recommended Flow

1. If the Zotero key is unknown, search by title first:

```powershell
node scripts/query-markdown.mjs search --library-id 1 --title "paper title"
```

2. Inspect headings before requesting large content:

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity headings
```

3. Read a specific section when a heading path is known:

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity section --section-path "Introduction/Background"
```

4. Search parsed Markdown for local context:

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity search --query "retrieval" --context-paragraphs 2
```

5. Fetch full Markdown only when section or search output is insufficient:

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --granularity full
```

## CLI Reference

Use `--format text` for agent-readable text. Use `--format json` when another script or pipeline needs structured output.

Common options:

```text
--base-url <url>          Zotero local server URL; default is http://127.0.0.1:23119
--token <token>           API token, sent as Authorization: Bearer
--format <text|json>      Output format; default is text
--timeout-ms <number>     Request timeout; default is 30000
```

Search command:

```powershell
node scripts/query-markdown.mjs search --library-id 1 --title "keyword" --format json
```

Markdown command:

```powershell
node scripts/query-markdown.mjs markdown --library-id 1 --key ABCD1234 --attachment-key PDFKEY01 --granularity headings --format text
```

Markdown options:

```text
--attachment-key <key>       Select a specific PDF attachment under a regular item
--granularity <kind>         full, headings, section, or search
--section-path <path>        Heading path for section queries
--query <text>               Search query for search queries
--context-paragraphs <n>     Context paragraphs for search queries
```

## Error Handling

- `api-disabled`: Ask the user to enable the Markdown query API in Zotero preferences.
- `invalid-token`: Ask the user for the current API token from Zotero preferences.
- `ambiguous-attachment`: Re-run with `--attachment-key` using one of the candidate keys.
- `parse-result-not-found`: Tell the user the target PDF has no available parse result yet.
- `section-not-found`: Re-run with `--granularity headings` and use an exact heading path.
- `missing-query`: Re-run the search query with a non-empty `--query` value.
