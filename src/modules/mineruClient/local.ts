import { requestJson, requestOk } from "./api";
import { MinerUTaskError } from "./errors";
import { readFileBytes, readPdfBytes } from "./file";
import { buildLocalTaskFormData } from "./formData";
import { createFormDataRequest, normalizeBinary } from "./http";
import { normalizeBaseURL } from "./path";
import { readImagesFromZip } from "./result";
import type {
  MinerUClient,
  MinerUClientOptions,
  MinerUParseMode,
  ZipEntries,
} from "./types";
import { decodeText, readZipWithFileFallback } from "./zip";

type LocalTaskResponse = {
  task_id?: string;
  taskId?: string;
  status?: string;
  message?: string;
};

type LocalResultResponse = {
  results?: Record<
    string,
    {
      md_content?: string;
      middle_json?: unknown;
      content_list?: unknown;
      images?: Record<string, string>;
    }
  >;
};

/**
 * 创建本地 MinerU API client，负责提交异步任务和轮询任务状态。
 */
export function createLocalMinerUClient(
  options: MinerUClientOptions & {
    mode: MinerUParseMode;
    localApiBaseURL: string;
    saveImages?: boolean;
  },
): MinerUClient {
  const baseURL = normalizeBaseURL(options.localApiBaseURL);
  const request = options.fetch ?? createFormDataRequest();
  const readBinary = options.readBinary ?? readFileBytes;

  return {
    /**
     * 检查本地服务健康状态后提交 PDF 解析任务。
     */
    async submitPdf(filePath) {
      await requestOk(request, `${baseURL}/health`, "local-health", {
        method: "GET",
      });
      const bytes = normalizeBinary(await readPdfBytes(readBinary, filePath));
      const response = await requestJson<LocalTaskResponse>(
        request,
        `${baseURL}/tasks`,
        "local-submit",
        {
          method: "POST",
          body: buildLocalTaskFormData({
            filePath,
            bytes,
            mode: options.mode,
            saveImages: options.saveImages !== false,
          }),
        },
      );
      const taskID = response.task_id ?? response.taskId;
      if (!taskID) {
        throw new MinerUTaskError(
          "Local MinerU submit response missing task_id",
        );
      }
      return { taskID };
    },

    /**
     * 轮询本地异步任务状态，并转换为统一任务状态。
     */
    async pollTask(taskID) {
      const response = await requestJson<LocalTaskResponse>(
        request,
        `${baseURL}/tasks/${encodeURIComponent(taskID)}`,
        "local-poll",
        { method: "GET" },
      );
      const status = String(response.status ?? "").toLowerCase();
      if (
        ["done", "success", "succeeded", "finished", "completed"].includes(
          status,
        )
      ) {
        return { status: "succeeded" };
      }
      if (["failed", "fail", "error"].includes(status)) {
        return {
          status: "failed",
          error: response.message || "Local MinerU task failed",
        };
      }
      return { status: "running" };
    },

    /**
     * 下载本地任务结果，并按 precise/lite 模式转换为统一结果。
     */
    async downloadResult(taskID) {
      const response = await requestOk(
        request,
        `${baseURL}/tasks/${encodeURIComponent(taskID)}/result`,
        "local-download",
        { method: "GET" },
      );
      const contentType = response.headers.get("Content-Type") ?? "";
      if (isZipResponse(contentType)) {
        const zip = await readZipWithFileFallback(
          await response.arrayBuffer(),
          "mineru-local-result.zip",
        );
        return {
          kind: "precise",
          markdown: readLocalZipMarkdown(zip),
          rawResult: readLocalZipRawResult(zip),
          images: readImagesFromZip(zip),
        };
      }

      const json = (await response.json()) as LocalResultResponse;
      const result = firstLocalResult(json);
      const markdown = result.md_content ?? "";
      if (options.mode === "lite") {
        return { kind: "lite", markdown };
      }
      return {
        kind: "precise",
        markdown,
        rawResult: parseMaybeJson(
          result.middle_json ?? result.content_list ?? json,
        ),
        images: decodeDataURLImages(result.images),
      };
    },
  };
}

function firstLocalResult(response: LocalResultResponse) {
  return Object.values(response.results ?? {})[0] ?? {};
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function decodeDataURLImages(
  images: Record<string, string> | undefined,
): { path: string; bytes: Uint8Array }[] | undefined {
  if (!images) {
    return undefined;
  }
  const decoded = Object.entries(images).flatMap(([path, value]) => {
    const comma = value.indexOf(",");
    if (comma === -1) {
      return [];
    }
    const binary = decodeBase64(value.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return [{ path, bytes }];
  });
  return decoded.length > 0 ? decoded : undefined;
}

function decodeBase64(value: string): string {
  const runtime = globalThis as typeof globalThis & {
    atob?: (data: string) => string;
    Buffer?: { from: (data: string, encoding: "base64") => Uint8Array };
  };
  if (runtime.atob) {
    return runtime.atob(value);
  }
  const bytes = runtime.Buffer?.from(value, "base64");
  if (!bytes) {
    throw new MinerUTaskError("Cannot decode local MinerU image data");
  }
  return Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function isZipResponse(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes("application/zip") ||
    normalized.includes("application/x-zip-compressed") ||
    normalized.includes("application/octet-stream")
  );
}

function readLocalZipMarkdown(zip: ZipEntries): string {
  const entry = Array.from(zip.values()).find((item) =>
    item.name.endsWith(".md"),
  );
  return entry ? decodeText(entry.bytes) : "";
}

function readLocalZipRawResult(zip: ZipEntries): unknown {
  const entries = Array.from(zip.values());
  const middle = entries.find((item) => item.name.endsWith("_middle.json"));
  const content = entries.find((item) =>
    item.name.endsWith("_content_list.json"),
  );
  const entry = middle ?? content;
  return entry ? JSON.parse(decodeText(entry.bytes)) : {};
}
