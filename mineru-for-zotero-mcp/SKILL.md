---
name: mineru-for-zotero-mcp
description: Use when finding a Zotero paper, identifying opened or active Zotero tabs and parse status, reading selected MinerU boxes, or retrieving parsed Markdown or arXiv LaTeX source.
---

# MinerU for Zotero MCP

Use the connected Zotero tools as the primary source for paper content. Start from the paper title, resolve the Zotero item, and narrow each later request from information returned by an earlier request.

## IRON LAW

For any subsequent task that requires acquiring paper content (such as reading, quoting, summarizing, or extracting paper text, tables, formulas, or images), **first try to obtain the content from Zotero using this skill (the MinerU for Zotero MCP).**

- Use parsed Markdown by default. Treat LaTeX source as an accuracy check: read only the corresponding LaTeX section or passage when the Markdown has a clear parsing error or an ambiguity that cannot be resolved from the Markdown. Do not read the full LaTeX source as a routine second pass.
- If the tools are unavailable or the connection fails, report that the Zotero MCP service could not be reached instead of inventing document content.
- Do not go straight to web search or other sources when the parsed content already exists in Zotero. Check this skill first.

## Paper workflow

When the user refers to the currently displayed paper or selected boxes, use the runtime tools below before title search. Returned libraryId, itemKey, and attachmentKey can be passed directly to the existing Markdown and image tools.

1. Search by title with `zotero_search_items`.
2. Choose the regular Zotero item key from the search result. If several records match, compare their metadata and use the record that best matches the requested paper.
3. Prefer parsed Markdown for normal reading. Read headings first with `mineru_read_markdown`, then request only the needed section or search context. Use table and image tools only with references returned by the Markdown result.
4. If Markdown reports ambiguous PDF attachments, retry with one of the candidate attachment keys. Keep using that attachment for later Markdown requests.
5. Use the LaTeX path when source-level text, formulas, labels, or included source files are needed. Call `mineru_fetch_latex` before any other LaTeX operation, then inspect headings or search before reading a larger section. Pass the regular Zotero item key to LaTeX tools; do not pass a PDF attachment key.

Markdown and LaTeX are separate source paths. A cached LaTeX source must be fetched before it can be read, searched, or queried for tables and images.

## Reading context

| Request                                       | Tool arguments                                  |
| --------------------------------------------- | ----------------------------------------------- |
| All opened item tabs and parse status         | `zotero_list_tabs({"scope":"all"})`             |
| Currently displayed item tab and parse status | `zotero_list_tabs({"scope":"active"})`          |
| All selected MinerU boxes                     | `mineru_get_selected_boxes({"scope":"all"})`    |
| Selected boxes in the currently displayed tab | `mineru_get_selected_boxes({"scope":"active"})` |

These tools accept only scope; `{}` defaults to active. Active uses the selected tab in the most recently active Zotero main window, even after switching to another app. A selected library tab yields no items. All tabs includes unloaded item tabs across main windows and excludes library tabs; all boxes includes background readers and standalone PDF reader windows. Active box queries include all selected boxes in that tab, including offscreen boxes.

Tab results contain parent-paper libraryId/itemId/itemKey/title (standalone attachments identify themselves), actual attachmentId/attachmentKey, tabId, tabTitle, active, status, and parseStatus. PDF parseStatus contains preciseReady, liteReady, preciseRunning, liteRunning, and preferredMode (precise, lite, or null). Ready and running may coexist during replacement. Non-PDF parseStatus is null; item-unavailable and parse-status-unavailable are per-tab outcomes. Keep the actual attachmentKey when querying the opened PDF.

Selections are grouped under readers with source identifiers, readerInstanceId, selectedCount, rawIndex-ordered boxes (rawIndex, page, type, markdown), combined markdown, missingRawIndexes, and per-reader status. Formula Markdown retains dollar delimiters; images remain references. Readers without selected boxes are omitted. If none remain, readers is empty and the text block says `No selected boxes.`, without tab metadata or a full-Markdown fallback. Stale-selection, parse-result-unavailable, or item-unavailable set isError while retaining successful groups; inspect structuredContent before retrying. These queries do not change selection or the clipboard, download sources, or trigger parsing. Native PDF text selection and partial selections within box panels are not box selection.

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
