import type { MinerUImageFile } from "../domain";

export interface MinerUClient {
  submitPdf(filePath: string): Promise<{ taskID: string }>;
  pollTask(
    taskID: string,
  ): Promise<{ status: "running" | "succeeded" | "failed"; error?: string }>;
  downloadResult(taskID: string): Promise<{
    rawResult: unknown;
    markdown: string;
    images?: MinerUImageFile[];
  }>;
}

export interface MinerUClientOptions {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof fetch;
  readBinary?: (filePath: string) => Promise<Uint8Array>;
  uploadBinary?: (url: string, body: Uint8Array) => Promise<Response>;
  downloadBinary?: (url: string) => Promise<Response>;
  downloadFileBytes?: (
    url: string,
  ) => Promise<Uint8Array | ZipEntries>;
  downloadRetryDelayMs?: number;
  maxDownloadAttempts?: number;
}

export type FetchLike = typeof fetch;

export interface FileUrlsBatchResponse {
  code?: number;
  msg?: string;
  data?: {
    batch_id?: string;
    file_urls?: Array<string | { name?: string; url?: string }>;
  };
}

export interface ExtractResultsBatchResponse {
  code?: number;
  msg?: string;
  data?: {
    extract_result?: Array<{
      state?: string;
      err_msg?: string;
      full_zip_url?: string;
      md_url?: string;
    }>;
  };
}

export type ZipEntry = {
  name: string;
  bytes: Uint8Array;
};

export type ZipEntries = Map<string, ZipEntry>;
