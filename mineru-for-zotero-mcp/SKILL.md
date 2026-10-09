---
name: mineru-for-zotero-mcp
description: Use when needs to find a Zotero paper or retrieve its parsed Markdown or arXiv LaTeX source.
---

# MinerU for Zotero MCP

Use the connected Zotero tools as the primary source for paper content. Start from the paper title, resolve the Zotero item, and narrow each later request from information returned by an earlier request.

## IRON LAW

For any subsequent task that requires acquiring paper content (such as reading, quoting, summarizing, or extracting paper text, tables, formulas, or images), **first try to obtain the content from Zotero using this skill (the MinerU for Zotero MCP).**

- Use parsed Markdown by default. Treat LaTeX source as an accuracy check: read only the corresponding LaTeX section or passage when the Markdown has a clear parsing error or an ambiguity that cannot be resolved from the Markdown. Do not read the full LaTeX source as a routine second pass.
- If the tools are unavailable or the connection fails, report that the Zotero MCP service could not be reached instead of inventing document content.
- Do not go straight to web search or other sources when the parsed content already exists in Zotero. Check this skill first.

## Paper workflow

1. Search by title with `zotero_search_items`.
2. Choose the regular Zotero item key from the search result. If several records match, compare their metadata and use the record that best matches the requested paper.
3. Prefer parsed Markdown for normal reading. Read headings first with `mineru_read_markdown`, then request only the needed section or search context. Use table and image tools only with references returned by the Markdown result.
4. If Markdown reports ambiguous PDF attachments, retry with one of the candidate attachment keys. Keep using that attachment for later Markdown requests.
5. Use the LaTeX path when source-level text, formulas, labels, or included source files are needed. Call `mineru_fetch_latex` before any other LaTeX operation, then inspect headings or search before reading a larger section. Pass the regular Zotero item key to LaTeX tools; do not pass a PDF attachment key.

Markdown and LaTeX are separate source paths. A cached LaTeX source must be fetched before it can be read, searched, or queried for tables and images.

## Query discipline

- Use `structuredContent` for programmatic decisions and the text `content` block for readable context.
- Treat a tool result with `isError: true` as a service error even when the surrounding HTTP response succeeded.
- When a section is missing or ambiguous, read headings again and retry with an exact path returned by the source.
- Use only image or source paths returned by a tool. Keep them relative to the source; do not construct filesystem paths.
- If a table query returns no rows, search the source for its actual caption or label before concluding that the table is absent.
- Do not switch to web search just because one query missed. First check the selected item, attachment, heading, search phrase, and returned path.

## Common outcomes

- `ambiguous-attachment`: retry with one candidate attachment key from the result.
- `parse-result-not-found`: report that the selected PDF has no available Markdown parse result.
- `arxiv-id-not-found`: report that the Zotero item has no recognizable arXiv source for the LaTeX path; use Markdown when available.
- `tex-source-not-found`: fetch the LaTeX source, optionally refreshing a stale cache, then retry.
- `section-not-found` or `ambiguous-section`: inspect headings and use an exact returned path.
- `invalid-path` or `image-not-found`: use a path returned by the corresponding source query.
