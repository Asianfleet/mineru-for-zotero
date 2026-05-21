/*
 * MinerU official API documentation: https://mineru.net/apiManage/docs
 * Interface version used here: v4.
 *
 * Local PDF flow:
 * 1. POST /api/v4/file-urls/batch with { enable_formula, language, files }.
 *    Response data contains batch_id and file_urls[].url.
 * 2. PUT the PDF bytes to file_urls[0].url.
 * 3. GET /api/v4/extract-results/batch/{batch_id} to poll state.
 *    Response data.extract_result[].state maps done/failed/running states.
 * 4. Result download URLs are returned in extract_result[].full_zip_url.
 */

import {
  fetchBatchResult,
  firstExtractResult,
  getUploadURL,
  ensureBusinessSuccess,
  jsonHeaders,
  requestJson,
  requestOk,
} from "./api";
import { retryDownloadZip, zoteroDownloadFileBytes } from "./download";
import { MinerUTaskError } from "./errors";
import { readFileBytes, readPdfBytes } from "./file";
import {
  createDefaultRequest,
  fallbackDownloadBinary,
  fetchDownloadBinary,
  fetchUploadBinary,
  normalizeBinary,
  xhrDownloadBinary,
  xhrUploadBinary,
} from "./http";
import { basename, normalizeBaseURL } from "./path";
import { readImagesFromZip, readRawResultFromZip } from "./result";
import type {
  FileUrlsBatchResponse,
  MinerUClient,
  MinerUClientOptions,
} from "./types";
import { decodeText } from "./zip";

export {
  MinerUFileAccessError,
  MinerURequestError,
  MinerUTaskError,
} from "./errors";
export type { MinerUClient } from "./types";

export function createMinerUClient(options: MinerUClientOptions): MinerUClient {
  const baseURL = normalizeBaseURL(options.baseURL ?? "https://mineru.net");
  const request = options.fetch ?? createDefaultRequest();
  const readBinary = options.readBinary ?? readFileBytes;
  const uploadBinary =
    options.uploadBinary ??
    (options.fetch ? fetchUploadBinary(request) : xhrUploadBinary);
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
  const maxDownloadAttempts = options.maxDownloadAttempts ?? 4;
  const downloadRetryDelayMs = options.downloadRetryDelayMs ?? 2000;

  return {
    async submitPdf(filePath) {
      const fileName = basename(filePath);
      const response = await requestJson<FileUrlsBatchResponse>(
        request,
        `${baseURL}/api/v4/file-urls/batch`,
        "submit",
        {
          method: "POST",
          headers: jsonHeaders(options.apiKey),
          body: JSON.stringify({
            enable_formula: true,
            enable_table: true,
            language: "auto",
            model_version: "vlm",
            files: [{ name: fileName }],
          }),
        },
      );

      ensureBusinessSuccess(response, "submit");
      const taskID = response.data?.batch_id;
      const uploadURL = getUploadURL(response.data?.file_urls?.[0]);
      if (!taskID || !uploadURL) {
        throw new MinerUTaskError("MinerU submit response missing upload data");
      }

      const bytes = normalizeBinary(await readPdfBytes(readBinary, filePath));
      await requestOk(
        () => uploadBinary(uploadURL, bytes),
        uploadURL,
        "upload",
        {
          method: "PUT",
        },
      );

      return { taskID };
    },

    async pollTask(taskID) {
      const response = await fetchBatchResult(
        request,
        baseURL,
        options.apiKey,
        taskID,
      );
      const result = firstExtractResult(response);
      const state = String(result?.state ?? "").toLowerCase();

      if (["done", "success", "succeeded", "finished"].includes(state)) {
        return { status: "succeeded" };
      }
      if (["failed", "fail", "error"].includes(state)) {
        return {
          status: "failed",
          error: result?.err_msg || response.msg || "MinerU task failed",
        };
      }
      return { status: "running" };
    },

    async downloadResult(taskID) {
      let response = await fetchBatchResult(
        request,
        baseURL,
        options.apiKey,
        taskID,
      );
      const result = firstExtractResult(response);
      if (result?.full_zip_url) {
        const zip = await retryDownloadZip(
          async () => {
            response = await fetchBatchResult(
              request,
              baseURL,
              options.apiKey,
              taskID,
            );
            return { response, result: firstExtractResult(response) };
          },
          { response, result },
          downloadBinary,
          downloadFileBytes,
          maxDownloadAttempts,
          downloadRetryDelayMs,
        );
        return {
          rawResult: readRawResultFromZip(zip) ?? response,
          markdown: zip.has("full.md")
            ? decodeText(zip.get("full.md")?.bytes ?? new Uint8Array())
            : "",
          images: readImagesFromZip(zip),
        };
      }

      if (!result?.md_url) {
        return {
          rawResult: response,
          markdown: "",
        };
      }

      const markdownResponse = await requestOk(
        () => downloadBinary(result.md_url || ""),
        result.md_url,
        "download",
        { method: "GET" },
      );
      return {
        rawResult: response,
        markdown: await markdownResponse.text(),
      };
    },
  };
}
