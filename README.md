# MinerU for Zotero

[![zotero target version](https://img.shields.io/badge/Zotero-8%2F9-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

<p align="center">
    <img src="assets/cover.png" alt="cover" width=100%/>
</p>

[中文文档](README_zh.md)

MinerU for Zotero helps you parse Zotero PDF attachments with MinerU and copy layout-aware content directly from the Zotero PDF Reader.

## What You Can Do

<video src="assets/demo.mp4" controls></video>

- Parse one or more selected PDF attachments from the Zotero item list.
- Reuse an existing parse result, or reparse and replace it when needed.
- Show MinerU boxes in the Zotero PDF Reader.
- Switch between all boxes, hovered boxes, and off mode.
- Copy a single text, title, list, table, image caption, reference, formula, or other recognized box.
- Select multiple boxes with `Shift` or `Ctrl`, then copy them together in reading order.
- Copy the full parsed Markdown from the reader toolbar when no boxes are selected.
- Optionally save images from MinerU results into the local result folder.

## Requirements

- Zotero 8 or 9.
- A MinerU API Key.
- PDF attachments that are available on this computer.

## Setup

1. Install the plugin in Zotero.
2. Open `Edit` -> `Settings` -> `MinerU for Zotero`.
3. Enter your MinerU API Key.
4. Optional: enable `Save parsed result images` if you want images from MinerU results to be saved locally.

The API Key is stored only in local Zotero preferences.

## Parse a PDF

1. In the Zotero item list, select one or more PDF attachments.
2. Right-click the selection and choose `Parse PDF with MinerU`.
3. Wait until Zotero shows `MinerU parsing finished`.
4. Open the parsed PDF in the Zotero PDF Reader.

If a selected PDF already has a parse result, choose one of these options:

- `Use existing result`: keep the current result and use it in the reader.
- `Reparse and overwrite`: submit the PDF again and replace the result after parsing succeeds.

If parsing fails during replacement, the existing usable result is kept.

## Copy in the Reader

1. Open a parsed PDF.
2. Click the `MinerU boxes` button in the PDF Reader toolbar.
3. Choose a mode:
   - `Show all boxes`
   - `Show only hovered box`
   - `Disable plugin features`
4. Hover over a box and click `Copy`.
5. For formulas, choose `Copy with $` or `Copy without $`.

For multi-box copying, hold `Shift` or `Ctrl` while clicking boxes. Then use the toolbar menu to copy the selected content or clear the selection. If no boxes are selected, the same copy button copies the full parsed Markdown.

## Local Results

Open `Edit` -> `Settings` -> `MinerU for Zotero` and click `Open Data Folder` to view local parse results. The settings page also shows how many PDFs currently have usable results.

The result folder contains the parsed Markdown, box data used by the reader, and optional images. External tools may read these files, but editing them is not recommended.

## Local Markdown Query API

The local Markdown query API is disabled by default. Enable it from `Edit` -> `Settings` -> `MinerU for Zotero`, generate a token, and use the token in requests. The token comes from the Zotero preferences page.

Minimal example:

```shell
curl "http://127.0.0.1:23119/mineru-for-zotero/markdown?libraryID=1&key=ABCD1234" \
  -H "Authorization: Bearer <token>"
```

Use `attachmentKey=<PDF attachment key>` when a regular Zotero item has multiple PDF attachments and you want to select one explicitly. The API reads existing local parse results only. It returns precise Markdown first and falls back to lite Markdown when precise results are unavailable.

## Troubleshooting

### API Key Not Configured

Open the plugin settings page, enter your MinerU API Key, and try again.

### File Access Failed

Make sure the PDF is available locally. If the attachment is cloud-only or still syncing, open or download it in Zotero first.

### The Reader Says No Parse Result Is Available

Parse the PDF first. If you already parsed it, open the data folder from the settings page and confirm that the parsed result still exists.

### Boxes Are Not Visible

Confirm that the toolbar mode is not set to `Disable plugin features`. If the PDF was parsed but still has no boxes, reparse it.

### Result Download Failed

The MinerU result download may be temporarily unavailable. Try again later or reparse the PDF.

## Development

Install dependencies:

```shell
npm install
```

Start development mode:

```shell
npm start
```

Run tests, checks, and build:

```shell
npm test
npm run lint:check
npm run build
```

## License

AGPL-3.0-or-later
