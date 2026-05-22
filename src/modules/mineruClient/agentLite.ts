import { requestJson, requestOk } from "./api";
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
import type { MinerUClient, MinerUClientOptions } from "./types";

type AgentSubmitResponse = {
  task_id?: string;
  taskId?: string;
  file_url?: string;
  fileUrl?: string;
};

type AgentPollResponse = {
  state?: string;
  status?: string;
  err_msg?: string;
  message?: string;
  markdown_url?: string;
  markdownUrl?: string;
};

/**
 * 创建在线 Agent lite 模式的 MinerU client。
 */
export function createOnlineAgentLiteMinerUClient(
  options: MinerUClientOptions,
): MinerUClient {
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

  return {
    /**
     * 提交在线 lite 任务并上传 PDF 字节。
     */
    async submitPdf(filePath) {
      const response = await requestJson<AgentSubmitResponse>(
        request,
        `${baseURL}/api/v1/agent/parse/file`,
        "agent-submit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: basename(filePath),
            language: "ch",
            enable_table: false,
            enable_formula: false,
            is_ocr: false,
          }),
        },
      );
      const taskID = response.task_id ?? response.taskId;
      const uploadURL = response.file_url ?? response.fileUrl;
      if (!taskID || !uploadURL) {
        throw new MinerUTaskError(
          "MinerU Agent submit response missing upload data",
        );
      }

      const bytes = normalizeBinary(await readPdfBytes(readBinary, filePath));
      await requestOk(
        () => uploadBinary(uploadURL, bytes),
        uploadURL,
        "agent-upload",
        { method: "PUT" },
      );
      return { taskID };
    },

    /**
     * 查询在线 lite 任务状态并转换为统一状态。
     */
    async pollTask(taskID) {
      const response = await requestJson<AgentPollResponse>(
        request,
        `${baseURL}/api/v1/agent/parse/${encodeURIComponent(taskID)}`,
        "agent-poll",
        { method: "GET" },
      );
      const state = String(response.state ?? response.status ?? "").toLowerCase();
      if (["done", "success", "succeeded", "finished"].includes(state)) {
        return { status: "succeeded" };
      }
      if (["failed", "fail", "error"].includes(state)) {
        return {
          status: "failed",
          error:
            response.err_msg || response.message || "MinerU Agent task failed",
        };
      }
      return { status: "running" };
    },

    /**
     * 下载在线 lite Markdown 结果。
     */
    async downloadResult(taskID) {
      const response = await requestJson<AgentPollResponse>(
        request,
        `${baseURL}/api/v1/agent/parse/${encodeURIComponent(taskID)}`,
        "agent-download",
        { method: "GET" },
      );
      const markdownURL = response.markdown_url ?? response.markdownUrl;
      if (!markdownURL) {
        return { kind: "lite", markdown: "" };
      }
      const markdownResponse = await requestOk(
        () => downloadBinary(markdownURL),
        markdownURL,
        "download",
        { method: "GET" },
      );
      return { kind: "lite", markdown: await markdownResponse.text() };
    },
  };
}
