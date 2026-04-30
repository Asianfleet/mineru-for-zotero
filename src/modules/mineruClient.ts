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

export interface MinerUClient {
  submitPdf(filePath: string): Promise<{ taskID: string }>;
  pollTask(
    taskID: string,
  ): Promise<{ status: "running" | "succeeded" | "failed"; error?: string }>;
  downloadResult(taskID: string): Promise<{
    rawResult: unknown;
    markdown: string;
  }>;
}

interface MinerUClientOptions {
  apiKey: string;
  baseURL?: string;
  fetch?: typeof fetch;
  readBinary?: (filePath: string) => Promise<Uint8Array>;
}

interface FileUrlsBatchResponse {
  code?: number;
  msg?: string;
  data?: {
    batch_id?: string;
    file_urls?: Array<string | { name?: string; url?: string }>;
  };
}

interface ExtractResultsBatchResponse {
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

export class MinerURequestError extends Error {
  constructor(
    public readonly stage: string,
    public readonly status: number,
  ) {
    super(`MinerU ${stage} request failed with status ${status}`);
    this.name = "MinerURequestError";
  }
}

export class MinerUTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MinerUTaskError";
  }
}

export function createMinerUClient(options: MinerUClientOptions): MinerUClient {
  const baseURL = normalizeBaseURL(options.baseURL ?? "https://mineru.net");
  const request = options.fetch ?? fetch.bind(globalThis);
  const readBinary = options.readBinary ?? readFileBytes;

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
            language: "auto",
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

      const bytes = await readBinary(filePath);
      await requestOk(request, uploadURL, "upload", {
        method: "PUT",
        body: bytes,
      });

      return { taskID };
    },

    async pollTask(taskID) {
      const response = await fetchBatchResult(request, baseURL, options.apiKey, taskID);
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
      const response = await fetchBatchResult(request, baseURL, options.apiKey, taskID);
      const result = firstExtractResult(response);
      if (result?.full_zip_url) {
        const zipResponse = await requestOk(
          request,
          result.full_zip_url,
          "download",
          { method: "GET" },
        );
        const zip = await readZip(await zipResponse.arrayBuffer());
        return {
          rawResult: readRawResultFromZip(zip) ?? response,
          markdown: zip.get("full.md") ?? "",
        };
      }

      if (!result?.md_url) {
        return {
          rawResult: response,
          markdown: "",
        };
      }

      const markdownResponse = await requestOk(request, result.md_url, "download", {
        method: "GET",
      });
      return {
        rawResult: response,
        markdown: await markdownResponse.text(),
      };
    },
  };
}

function getUploadURL(value: string | { url?: string } | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return value?.url ?? "";
}

async function fetchBatchResult(
  request: typeof fetch,
  baseURL: string,
  apiKey: string,
  taskID: string,
): Promise<ExtractResultsBatchResponse> {
  const response = await requestJson<ExtractResultsBatchResponse>(
    request,
    `${baseURL}/api/v4/extract-results/batch/${encodeURIComponent(taskID)}`,
    "poll",
    {
      method: "GET",
      headers: authHeaders(apiKey),
    },
  );
  ensureBusinessSuccess(response, "poll");
  return response;
}

async function requestJson<T>(
  request: typeof fetch,
  url: string,
  stage: string,
  init: RequestInit,
): Promise<T> {
  const response = await requestOk(request, url, stage, init);
  return (await response.json()) as T;
}

async function requestOk(
  request: typeof fetch,
  url: string,
  stage: string,
  init: RequestInit,
): Promise<Response> {
  const response = await request(url, init);
  if (!response.ok) {
    throw new MinerURequestError(stage, response.status);
  }
  return response;
}

function ensureBusinessSuccess(
  response: { code?: number; msg?: string },
  stage: string,
): void {
  if (response.code != null && response.code !== 0) {
    throw new MinerUTaskError(response.msg || `MinerU ${stage} failed`);
  }
}

function firstExtractResult(response: ExtractResultsBatchResponse) {
  return response.data?.extract_result?.[0];
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

function jsonHeaders(apiKey: string): Record<string, string> {
  return {
    ...authHeaders(apiKey),
    "Content-Type": "application/json",
  };
}

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  if (typeof IOUtils !== "undefined") {
    return IOUtils.read(toNativePath(filePath));
  }
  return OS.File.read(toNativePath(filePath)) as Promise<Uint8Array>;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "file.pdf";
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/+$/, "");
}

function toNativePath(path: string): string {
  if (/^[a-z]:\//i.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

async function readZip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const bytes = new Uint8Array(buffer);
  const entries = new Map<string, string>();
  const centralOffset = findCentralDirectoryOffset(bytes);
  const decoder = new TextDecoder();
  let offset = centralOffset;

  while (readUint32(bytes, offset) === 0x02014b50) {
    const method = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localOffset = readUint32(bytes, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const content = await readZipEntry(
      bytes,
      localOffset,
      method,
      compressedSize,
      uncompressedSize,
    );
    entries.set(name, decoder.decode(content));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function readZipEntry(
  bytes: Uint8Array,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
): Promise<Uint8Array> {
  if (readUint32(bytes, localOffset) !== 0x04034b50) {
    throw new MinerUTaskError("MinerU result zip has an invalid local header");
  }

  const nameLength = readUint16(bytes, localOffset + 26);
  const extraLength = readUint16(bytes, localOffset + 28);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

  if (method === 0) {
    return compressed;
  }
  if (method === 8) {
    return inflateRaw(compressed, uncompressedSize);
  }
  throw new MinerUTaskError(`Unsupported MinerU result zip method ${method}`);
}

async function inflateRaw(
  compressed: Uint8Array,
  expectedSize: number,
): Promise<Uint8Array> {
  const streamCtor = (globalThis as typeof globalThis & {
    DecompressionStream?: new (format: string) => DecompressionStream;
  }).DecompressionStream;
  if (!streamCtor) {
    throw new MinerUTaskError("Cannot decompress MinerU result zip in this runtime");
  }

  const stream = new Blob([compressed]).stream().pipeThrough(
    new streamCtor("deflate-raw"),
  );
  const buffer = await new Response(stream).arrayBuffer();
  const result = new Uint8Array(buffer);
  if (expectedSize > 0 && result.length !== expectedSize) {
    throw new MinerUTaskError("MinerU result zip entry size mismatch");
  }
  return result;
}

function readRawResultFromZip(zip: Map<string, string>): unknown | null {
  for (const [name, value] of zip) {
    if (name === "full.md") {
      continue;
    }
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      return JSON.parse(value);
    } catch {
      continue;
    }
  }
  return null;
}

function findCentralDirectoryOffset(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      return readUint32(bytes, offset + 16);
    }
  }
  throw new MinerUTaskError("MinerU result zip is missing central directory");
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(
    0,
    true,
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
    0,
    true,
  );
}
