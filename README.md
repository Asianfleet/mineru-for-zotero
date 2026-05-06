# MinerU for Zotero

[中文](README_zh.md)

MinerU for Zotero is a Zotero 7 plugin that submits PDFs to the official
MinerU API for parsing and lets you quickly copy structured content from
MinerU boxes in the Zotero PDF Reader.

## Features

- Submit MinerU parsing from the context menu of a Zotero item or PDF
  attachment.
- List PDF attachments under a regular item and parse all PDFs with one
  command.
- Toggle the MinerU box overlay from the PDF Reader toolbar.
- Switch between showing all boxes, showing only the hovered box, and disabling
  the plugin overlay.
- Copy a single box or multiple selected boxes.
- Merge multi-box copies into Markdown in the original MinerU box order.
- Copy formula boxes with or without `$` delimiters.
- Store parsing results per attachment so external programs can read the raw
  JSON, Markdown, and normalized box data.

## Compatibility

- Zotero: designed for Zotero 7.
- Parsing service: official MinerU API v4.
- System support: follows the support scope of Zotero 7 and
  `zotero-plugin-scaffold`.

## Installation

1. Download the latest `.xpi` file from GitHub Releases.
2. Open Zotero.
3. Go to `Tools` -> `Add-ons`.
4. Click the gear menu and choose `Install Add-on From File...`.
5. Select the downloaded `.xpi` file and restart Zotero.

## Configuration

1. In Zotero, open `Edit` -> `Settings` -> `MinerU for Zotero`.
2. Enter your MinerU API Key.
3. The API Key is stored only in local Zotero preferences and is used to call
   the MinerU API.

The development `.env` file is only used for the Zotero launch path,
development profile, and release token. Do not put the MinerU API Key in
`.env`.

## Usage

### Parse PDFs

1. In the Zotero item list, select a PDF attachment or a regular item that has
   PDF attachments.
2. Right-click `Parse PDF with MinerU`.
3. If the selected item is a PDF attachment, the plugin parses that PDF
   directly.
4. If the selected item is a regular item, the plugin opens a submenu with the
   MinerU icon:
   - `Parse all PDFs`: parse every PDF attachment under the item.
   - A single PDF filename: parse only that PDF attachment.
5. Wait for upload, parsing, download, and local writing to finish.

If the target PDF already has parsing results, the plugin asks you to choose:

- `Use existing result`: keep the existing result and use it directly in the
  Reader.
- `Re-parse and overwrite`: submit the PDF to MinerU again and replace the old
  result after success. If parsing fails, the old result is kept.

During batch parsing, if some PDFs already have usable results, choosing
`Use existing result` skips those PDFs and continues with the remaining
unfinished PDFs. Choosing `Re-parse and overwrite` resubmits all target PDFs.

### Copy Content in the Reader

1. Open a parsed PDF.
2. Click the `MinerU box` button in the PDF Reader toolbar.
3. Choose an overlay mode:
   - `Show all boxes`
   - `Show hovered box only`
   - `Disable plugin features`
4. Hover over a box and use its copy button.
5. Use `Shift` or `Ctrl` to click multiple boxes, then copy the selected boxes
   from the toolbar menu.

## Data Files

The plugin stores parsing results in the Zotero plugin data directory. You can
open it from the settings page by clicking `Open data folder`.

Directory structure:

```text
mineru-copy/
  attachments/
    <libraryID>-<attachmentKey>/
      manifest.json
      mineru-result.json
      content.md
      boxes.normalized.json
```

File descriptions:

- `manifest.json`: attachment metadata, PDF modification time, parsing time,
  MinerU task id, and status.
- `mineru-result.json`: the raw MinerU result for diagnostics and external
  reading.
- `content.md`: the full Markdown output from MinerU.
- `boxes.normalized.json`: the stable box data structure used by the plugin.

External programs may read these files, but writing to them is not recommended.
The plugin only provides compatibility guarantees for data structures written by
the plugin itself.

## FAQ

### API Key Not Configured

Open the plugin settings page, enter your MinerU API Key, and try again.

### File Access Failed

Make sure the PDF attachment is available locally. For attachments that exist
only in the cloud or have not finished syncing, open or download the PDF in
Zotero first.

### Parsing Result Is Missing Box Information

The plugin saves the raw MinerU result but does not enable the overlay. Keep
`mineru-result.json` for diagnostics and re-parse if needed.

### Boxes Are Not Visible in the Reader

First confirm that the PDF was parsed successfully. If it was parsed but boxes
still do not appear, open the data folder from the settings page and check
whether `boxes.normalized.json` exists under the corresponding attachment
directory.

### Result Download Failed

The download URL returned by MinerU, or the network path to it, may be
temporarily unavailable. Try again later or re-parse the PDF.

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

Release:

```shell
npm run release
```

`npm run release` uses the `zotero-plugin-scaffold` release flow. The GitHub
Action builds the plugin after a tag is pushed and publishes the `.xpi`,
`update.json`, and `update-beta.json`.

## License

AGPL-3.0-or-later
