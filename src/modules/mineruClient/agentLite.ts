import { ensureBusinessSuccess, requestJson, requestOk } from "./api";
import { downloadPlainFileBytes } from "./download";
import { MinerUTaskError } from "./errors";
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
import type { MinerUClient, MinerUClientOptions } from "./types";

type AgentSubmitResponse = {
  task_id?: string;
  taskId?: string;
  file_url?: string;
  fileUrl?: string;
};

type AgentResponseEnvelope<T extends object> = T & {
  code?: number;
  msg?: string;
  data?: T;
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
 * 兼容 MinerU Agent API 的标准 data 包裹响应和旧测试中的顶层字段响应。
 */
function unwrapAgentData<T extends object>(
  response: AgentResponseEnvelope<T>,
  stage: string,
): T {
  ensureBusinessSuccess(response, stage);
  return response.data ?? response;
}

/**
 * 创建在线 Agent lite 模式的 MinerU client。
 */
export function createOnlineAgentLiteMinerUClient(
  options: MinerUClientOptions,
): MinerUClient {
  const baseURL = normalizeBaseURL(options.baseURL ?? "https://mineru.net");
  const request = options.fetch ?? createDefaultRequest();
  const readBinary = options.readBinary ?? readFileBytes;
  const uploadBinary = options.uploadBinary ?? xhrUploadBinary;
  const downloadBinary =
    options.downloadBinary ??
    (options.fetch
      ? fetchDownloadBinary(request)
      : fallbackDownloadBinary(
          xhrDownloadBinary,
          fetchDownloadBinary(request),
        ));
  const downloadFileBytes =
    options.downloadFileBytes ?? downloadPlainFileBytes;

  return {
    /**
     * 提交在线 lite 任务并上传 PDF 字节。
     */
    async submitPdf(filePath) {
      const response = await requestJson<
        AgentResponseEnvelope<AgentSubmitResponse>
      >(
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
      const data = unwrapAgentData(response, "agent-submit");
      const taskID = data.task_id ?? data.taskId;
      const uploadURL = data.file_url ?? data.fileUrl;
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
      const response = await requestJson<
        AgentResponseEnvelope<AgentPollResponse>
      >(
        request,
        `${baseURL}/api/v1/agent/parse/${encodeURIComponent(taskID)}`,
        "agent-poll",
        { method: "GET" },
      );
      const data = unwrapAgentData(response, "agent-poll");
      const state = String(data.state ?? data.status ?? "").toLowerCase();
      if (["done", "success", "succeeded", "finished"].includes(state)) {
        return { status: "succeeded" };
      }
      if (["failed", "fail", "error"].includes(state)) {
        return {
          status: "failed",
          error:
            data.err_msg ||
            data.message ||
            response.msg ||
            "MinerU Agent task failed",
        };
      }
      return { status: "running" };
    },

    /**
     * 下载在线 lite Markdown 结果。
     */
    async downloadResult(taskID) {
      const response = await requestJson<
        AgentResponseEnvelope<AgentPollResponse>
      >(
        request,
        `${baseURL}/api/v1/agent/parse/${encodeURIComponent(taskID)}`,
        "agent-download",
        { method: "GET" },
      );
      const data = unwrapAgentData(response, "agent-download");
      const markdownURL = data.markdown_url ?? data.markdownUrl;
      if (!markdownURL) {
        return { kind: "lite", markdown: "" };
      }
      return {
        kind: "lite",
        markdown: await downloadMarkdown(
          markdownURL,
          downloadBinary,
          downloadFileBytes,
        ),
      };
    },
  };
}

/**
 * 下载在线 lite Markdown；网络响应为空或失败时回退到文件下载路径。
 */
async function downloadMarkdown(
  url: string,
  downloadBinary: (url: string) => Promise<Response>,
  downloadFileBytes: NonNullable<MinerUClientOptions["downloadFileBytes"]>,
): Promise<string> {
  try {
    const response = await requestOk(
      () => downloadBinary(url),
      url,
      "download",
      { method: "GET" },
    );
    const markdown = await response.text();
    if (markdown.trim()) {
      return markdown;
    }
  } catch {
    // CDN Markdown 在 Zotero/Firefox 中可能 EOF；继续走文件下载兜底。
  }

  try {
    const result = await downloadFileBytes(url);
    if (result instanceof Map) {
      const markdownEntry =
        result.get("full.md") ??
        Array.from(result.values()).find((entry) =>
          entry.name.toLowerCase().endsWith(".md"),
        );
      return markdownEntry ? decodeMarkdownBytes(markdownEntry.bytes) : "";
    }
    return decodeMarkdownBytes(result);
  } catch (error) {
    throw new MinerUTaskError(
      `MinerU Agent markdown download failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * 将 Markdown 字节按 UTF-8 解码。
 */
function decodeMarkdownBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
