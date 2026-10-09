import { authHeaders, jsonHeaders, requestJson, requestOk } from "./api";
import { zoteroDownloadFileBytes } from "./download";
import {
  describeMinerUFailure,
  MinerUTaskError,
  MinerUTaskFailedError,
} from "./errors";
import { readFileBytes, readPdfBytes } from "./file";
import {
  createDefaultRequest,
  errorMessage,
  fallbackDownloadBinary,
  fetchDownloadBinary,
  fetchUploadBinary,
  normalizeBinary,
  xhrDownloadBinary,
  xhrUploadBinary,
} from "./http";
import { basename, normalizeBaseURL } from "./path";
import {
  readImagesFromZip,
  readMarkdownFromZip,
  readRawResultFromZip,
} from "./result";
import type { MinerUClient, MinerUClientOptions, ZipEntries } from "./types";
import { readZipWithFileFallback } from "./zip";

const DEFAULT_BASE_URL = "https://mineru.net/api";

/** Official MinerU v4 model versions. */
export type MinerUModelVersion = "pipeline" | "vlm";

export interface V4MinerUClientOptions extends MinerUClientOptions {
  modelVersion?: MinerUModelVersion;
}

interface V4Envelope<T> {
  code?: number | string;
  msg?: string;
  trace_id?: string;
  // Gateway failures such as an invalid token answer with these names instead
  // of `code` and `trace_id`.
  msgCode?: string;
  traceId?: string;
  data?: T;
}

interface V4FileUrlsData {
  batch_id?: string;
  file_urls?: string[];
}

interface V4ExtractResultItem {
  file_name?: string;
  state?: string;
  full_zip_url?: string;
  err_msg?: string;
  // The precise API documents `err_msg` only; `err_code` is read when the
  // service sends it and may be null.
  err_code?: number | string | null;
}

interface V4ExtractResultsData {
  batch_id?: string;
  extract_result?: V4ExtractResultItem[];
}

/**
 * Create official MinerU v4 precise parsing API client.
 *
 * Official docs: https://mineru.net/apiManage/docs
 *
 * Local file workflow (differing from v1's uploads/parse jobs):
 *   POST /v4/file-urls/batch -> obtain batch_id + presigned upload URL
 *   PUT bytes (without Content-Type)
 *   poll GET /v4/extract-results/batch/{batch_id}
 *   download full_zip_url (zip containing full.md/layout.json/images)
 *
 * Why online uses v4: official v1 output-format conversions for `middle_json`/`zip`
 * may fail with `file_conversion_failed`, whereas documented v4 reliably outputs a standard zip.
 */
export function createV4MinerUClient(
  options: V4MinerUClientOptions,
): MinerUClient {
  const baseURL = normalizeBaseURL(options.baseURL ?? DEFAULT_BASE_URL);
  const modelVersion = options.modelVersion ?? "vlm";
  const request = options.fetch ?? createDefaultRequest();
  const readBinary = options.readBinary ?? readFileBytes;
  const fetchLikeUpload = fetchUploadBinary(request);
  const globalFetch = (
    globalThis as typeof globalThis & { fetch?: typeof fetch }
  ).fetch;
  // Pre-signed PUT to external object storage. Bare sandbox XHR can fail at the
  // cross-origin layer, so try the privileged global fetch (no Content-Type)
  // first, then Zotero.HTTP, then sandbox XHR.
  const uploadCandidates: Array<
    (url: string, body: Uint8Array) => Promise<Response>
  > = [];
  if (options.uploadBinary) {
    const upload = options.uploadBinary;
    uploadCandidates.push((url, body) => upload(url, body));
  } else if (options.fetch) {
    uploadCandidates.push((url, body) => fetchLikeUpload(url, body));
  } else {
    if (globalFetch) {
      uploadCandidates.push((url, body) =>
        globalFetch(url, { method: "PUT", body }),
      );
    }
    uploadCandidates.push((url, body) => fetchLikeUpload(url, body));
    uploadCandidates.push((url, body) => xhrUploadBinary(url, body));
  }
  const uploadBinary = createFallbackUpload(uploadCandidates);
  const downloadBinary =
    options.downloadBinary ??
    (options.fetch
      ? fetchDownloadBinary(request)
      : fallbackDownloadBinary(
          xhrDownloadBinary,
          fetchDownloadBinary(request),
        ));
  const downloadFileBytes =
    options.downloadFileBytes ?? zoteroDownloadFileBytes;

  const requestV4 = async <T>(
    path: string,
    stage: string,
    init: RequestInit,
  ): Promise<T> => {
    const envelope = await requestJson<V4Envelope<T>>(
      request,
      `${baseURL}${path}`,
      stage,
      init,
    );
    if (envelope.code !== 0) {
      const traceID = envelope.trace_id ?? envelope.traceId;
      throw new MinerUTaskError(
        describeMinerUFailure(
          envelope.msg || "MinerU v4 request failed",
          envelope.code ?? envelope.msgCode,
          traceID ? `trace_id ${traceID}` : undefined,
        ),
      );
    }
    return (envelope.data ?? {}) as T;
  };

  const describeFailedItem = (
    item: V4ExtractResultItem | undefined,
    batchID: string,
  ): string =>
    describeMinerUFailure(
      item?.err_msg || "MinerU v4 task failed",
      item?.err_code,
      `batch ${batchID}`,
    );

  const fetchResults = (taskID: string, stage: string) =>
    requestV4<V4ExtractResultsData>(
      `/v4/extract-results/batch/${encodeURIComponent(taskID)}`,
      stage,
      { method: "GET", headers: authHeaders(options.apiKey) },
    );

  const downloadZip = async (url: string): Promise<ZipEntries> => {
    try {
      const response = await requestOk(
        () => downloadBinary(url),
        url,
        "download",
        { method: "GET" },
      );
      return await readZipWithFileFallback(
        await response.arrayBuffer(),
        "mineru-v4-result.zip",
      );
    } catch (primaryError) {
      try {
        const fallback = await downloadFileBytes(url);
        return fallback instanceof Map
          ? fallback
          : await readZipWithFileFallback(
              toArrayBuffer(fallback),
              "mineru-v4-result.zip",
            );
      } catch (fallbackError) {
        throw new MinerUTaskError(
          `${errorMessage(primaryError)}; fallback failed: ${errorMessage(
            fallbackError,
          )}`,
          { cause: primaryError },
        );
      }
    }
  };

  return {
    async submitPdf(filePath, submitOptions) {
      const fileEntry: Record<string, unknown> = { name: basename(filePath) };
      if (submitOptions?.pageRange) {
        fileEntry.page_ranges = submitOptions.pageRange;
      }
      const data = await requestV4<V4FileUrlsData>(
        "/v4/file-urls/batch",
        "upload",
        {
          method: "POST",
          headers: jsonHeaders(options.apiKey),
          body: JSON.stringify({
            files: [fileEntry],
            model_version: modelVersion,
          }),
        },
      );
      const batchID = data.batch_id;
      const uploadURL = data.file_urls?.[0];
      if (!batchID || !uploadURL) {
        throw new MinerUTaskError(
          "MinerU v4 upload response missing batch_id or file_urls",
        );
      }
      const bytes = normalizeBinary(await readPdfBytes(readBinary, filePath));
      // The upload URL is pre-signed object storage: never send the MinerU
      // API key, and do not set a Content-Type header (per the official docs).
      await requestOk(
        () => uploadBinary(uploadURL, bytes),
        uploadURL,
        "upload",
        { method: "PUT" },
      );
      return { taskID: batchID };
    },

    async pollTask(taskID) {
      const results = await fetchResults(taskID, "poll");
      const item = results.extract_result?.[0];
      const state = String(item?.state ?? "").toLowerCase();
      if (state === "done") {
        return { status: "succeeded" };
      }
      if (state === "failed") {
        return { status: "failed", error: describeFailedItem(item, taskID) };
      }
      return { status: "running" };
    },

    async downloadResult(taskID) {
      const results = await fetchResults(taskID, "download");
      const item = results.extract_result?.[0];
      if (String(item?.state ?? "").toLowerCase() === "failed") {
        throw new MinerUTaskFailedError(describeFailedItem(item, taskID));
      }
      const zipURL = item?.full_zip_url;
      if (!zipURL) {
        throw new MinerUTaskError("MinerU v4 result missing full_zip_url");
      }
      const zip = await downloadZip(zipURL);
      const markdown = readMarkdownFromZip(zip);
      const rawResult = readRawResultFromZip(zip);
      const images = readImagesFromZip(zip);
      if (rawResult == null || typeof rawResult !== "object") {
        return { kind: "lite", markdown };
      }
      return { kind: "precise", rawResult, markdown, images };
    },
  };
}

type UploadTransport = (url: string, body: Uint8Array) => Promise<Response>;

/**
 * Upload through the first transport that gets an answer from the server.
 *
 * The next transport is tried only when one throws (a sandbox cross-origin or
 * network failure) or answers 5xx (Zotero.HTTP reports a dropped connection
 * as a synthetic 500). A 4xx answer such as an expired signature or a file
 * that is too large is final: sending the whole PDF again through another
 * transport would only repeat the rejection. The final response is returned
 * so the caller can report its real status.
 */
export function createFallbackUpload(
  transports: UploadTransport[],
): UploadTransport {
  return async (url, body) => {
    let lastResponse: Response | undefined;
    let lastError: unknown;
    for (const transport of transports) {
      try {
        const response = await transport(url, body);
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return response;
        }
        lastResponse = response;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastResponse) {
      return lastResponse;
    }
    throw lastError instanceof Error
      ? lastError
      : new MinerUTaskError("MinerU v4 upload failed");
  };
}

/**
 * Create an independent ArrayBuffer for ZIP fallback decoding.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
