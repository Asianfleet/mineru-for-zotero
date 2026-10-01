export type MinerUBoxType = string;

export interface AttachmentRef {
  id: number;
  key: string;
  libraryID: number;
  fileName: string;
  filePath: string;
  mtime: number;
}

export interface NormalizedBox {
  rawIndex: number;
  /**
   * Original MinerU block index; official layout.pdf uses it as a 1-based layout index.
   * Legacy cached results may lack this field, falling back to rawIndex.
   */
  sourceIndex?: number;
  page: number;
  type: MinerUBoxType;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  markdown: string;
  formula: string | null;
  imagePath?: string | null;
  tableFormats?: Partial<Record<TableCopyTextFormat, string>>;
}

export interface MinerUImageFile {
  path: string;
  bytes: Uint8Array;
}

export interface ParseManifest {
  attachmentID: number;
  attachmentKey: string;
  libraryID: number;
  fileName: string;
  pdfMtime: number;
  parsedAt: string;
  mineruTaskID: string;
  resultVersion: 1;
  status: "ready" | "failed";
  error?: string;
  /**
   * BOX_NORMALIZER_VERSION the stored boxes were produced with; absent in
   * results written before the stamp existed.
   */
  boxesVersion?: number;
}

export interface LiteParseManifest {
  attachmentID: number;
  attachmentKey: string;
  libraryID: number;
  fileName: string;
  pdfMtime: number;
  parsedAt: string;
  mineruTaskID: string;
  resultVersion: 1;
  source: "online" | "local";
  mode: "lite";
  status: "ready";
}

export type OverlayMode = "all" | "hover" | "off";
export type FormulaCopyMode = "with-dollar" | "without-dollar";
export type TableCopyTextFormat = "latex" | "markdown" | "html" | "tsv";
export type TableCopyFormat = TableCopyTextFormat | "image";
