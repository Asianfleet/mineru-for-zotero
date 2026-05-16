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
}

export type OverlayMode = "all" | "hover" | "off";
export type FormulaCopyMode = "with-dollar" | "without-dollar";
