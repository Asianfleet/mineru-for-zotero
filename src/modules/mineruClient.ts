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
  uploadBinary?: (url: string, body: Uint8Array) => Promise<Response>;
  downloadBinary?: (url: string) => Promise<Response>;
  downloadFileBytes?: (url: string) => Promise<Uint8Array | Map<string, string>>;
  downloadRetryDelayMs?: number;
  maxDownloadAttempts?: number;
}

type FetchLike = typeof fetch;

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
    detail?: string,
  ) {
    super(
      detail
        ? `MinerU ${stage} request failed: ${detail}`
        : `MinerU ${stage} request failed with status ${status}`,
    );
    this.name = "MinerURequestError";
  }
}

export class MinerUTaskError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MinerUTaskError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function createMinerUClient(options: MinerUClientOptions): MinerUClient {
  const baseURL = normalizeBaseURL(options.baseURL ?? "https://mineru.net");
  const request = options.fetch ?? createDefaultRequest();
  const readBinary = options.readBinary ?? readFileBytes;
  const uploadBinary =
    options.uploadBinary ?? (options.fetch ? fetchUploadBinary(request) : xhrUploadBinary);
  const downloadBinary =
    options.downloadBinary ??
    (options.fetch
      ? fetchDownloadBinary(request)
      : fallbackDownloadBinary(xhrDownloadBinary, fetchDownloadBinary(request)));
  const downloadFileBytes = options.downloadFileBytes ?? zoteroDownloadFileBytes;
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

      const bytes = normalizeBinary(await readBinary(filePath));
      await requestOk(() => uploadBinary(uploadURL, bytes), uploadURL, "upload", {
        method: "PUT",
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
      let response = await fetchBatchResult(request, baseURL, options.apiKey, taskID);
      const result = firstExtractResult(response);
      if (result?.full_zip_url) {
        const zip = await retryDownloadZip(
          async () => {
            response = await fetchBatchResult(request, baseURL, options.apiKey, taskID);
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
          markdown: zip.get("full.md") ?? "",
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

async function readZipOrFallback(
  zipBuffer: ArrayBuffer,
  rawResult: ExtractResultsBatchResponse,
  zipURL: string | undefined,
  markdownURL: string | undefined,
  downloadBinary: (url: string) => Promise<Response>,
  downloadFileBytes: (url: string) => Promise<Uint8Array | Map<string, string>>,
): Promise<Map<string, string>> {
  const diagnostics: string[] = [];
  try {
    return await readZip(zipBuffer);
  } catch (zipError) {
    diagnostics.push(
      `network ${safeURL(zipURL)} ${zipBuffer.byteLength} bytes: ${errorMessage(zipError)}`,
    );
    if (zipURL) {
      try {
        const fileResult = await downloadFileBytes(zipURL);
        if (fileResult instanceof Map) {
          diagnostics.push(`file ${safeURL(zipURL)} zip reader`);
          return fileResult;
        }
        diagnostics.push(`file ${safeURL(zipURL)} ${fileResult.byteLength} bytes`);
        return await readZip(toStandaloneArrayBuffer(fileResult));
      } catch (fileError) {
        diagnostics.push(`file ${safeURL(zipURL)} failed: ${errorMessage(fileError)}`);
      }
    }
    if (!markdownURL) {
      throw withDownloadDiagnostics(zipError, diagnostics);
    }
    const markdownResponse = await requestOk(
      () => downloadBinary(markdownURL),
      markdownURL,
      "download",
      { method: "GET" },
    );
    return new Map([
      ["full.md", await markdownResponse.text()],
      ["mineru-result.json", JSON.stringify(rawResult)],
    ]);
  }
}

function withDownloadDiagnostics(error: unknown, diagnostics: string[]): MinerUTaskError {
  const message = error instanceof Error ? error.message : String(error);
  return new MinerUTaskError(`${message}; attempts: ${diagnostics.join("; ")}`, {
    cause: error,
  });
}

async function retryDownloadZip(
  refetch: () => Promise<{
    response: ExtractResultsBatchResponse;
    result: ReturnType<typeof firstExtractResult>;
  }>,
  initial: {
    response: ExtractResultsBatchResponse;
    result: ReturnType<typeof firstExtractResult>;
  },
  downloadBinary: (url: string) => Promise<Response>,
  downloadFileBytes: (url: string) => Promise<Uint8Array | Map<string, string>>,
  maxAttempts: number,
  retryDelayMs: number,
): Promise<Map<string, string>> {
  let current = initial;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const zipURL = current.result?.full_zip_url;
    if (!zipURL) {
      break;
    }
    try {
      const zipResponse = await requestOk(
        () => downloadBinary(zipURL),
        zipURL,
        "download",
        { method: "GET" },
      );
      return await readZipOrFallback(
        await zipResponse.arrayBuffer(),
        current.response,
        zipURL,
        current.result?.md_url,
        downloadBinary,
        downloadFileBytes,
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableDownloadError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await delay(retryDelayMs);
      current = await refetch();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new MinerUTaskError("MinerU result download failed");
}

function isRetryableDownloadError(error: unknown): boolean {
  return (
    error instanceof MinerUTaskError &&
    error.message.includes("empty response")
  );
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (typeof Zotero !== "undefined" && Zotero.Promise?.delay) {
    await Zotero.Promise.delay(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getUploadURL(value: string | { url?: string } | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return value?.url ?? "";
}

async function fetchBatchResult(
  request: FetchLike,
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
  request: FetchLike,
  url: string,
  stage: string,
  init: RequestInit,
): Promise<T> {
  const response = await requestOk(request, url, stage, init);
  return (await response.json()) as T;
}

async function requestOk(
  request: FetchLike,
  url: string,
  stage: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await request(url, init);
  } catch (error) {
    throw new MinerURequestError(stage, 0, errorMessage(error));
  }
  if (!response.ok) {
    throw new MinerURequestError(
      stage,
      response.status,
      await responseErrorDetail(response),
    );
  }
  return response;
}

function createDefaultRequest(): FetchLike {
  const zotero = (globalThis as typeof globalThis & {
    Zotero?: typeof Zotero;
  }).Zotero;
  if (typeof zotero?.HTTP?.request === "function") {
    return zoteroHttpFetch;
  }

  const fallbackFetch = (globalThis as typeof globalThis & {
    fetch?: typeof fetch;
  }).fetch;
  if (fallbackFetch) {
    return fallbackFetch.bind(globalThis);
  }

  return async () => {
    throw new MinerUTaskError("No HTTP client is available for MinerU requests");
  };
}

function fetchUploadBinary(request: FetchLike) {
  return async (url: string, body: Uint8Array): Promise<Response> =>
    request(url, { method: "PUT", body });
}

function fetchDownloadBinary(request: FetchLike) {
  return async (url: string): Promise<Response> => request(url, { method: "GET" });
}

function fallbackDownloadBinary(
  primary: (url: string) => Promise<Response>,
  fallback: (url: string) => Promise<Response>,
) {
  return async (url: string): Promise<Response> => {
    try {
      return await primary(url);
    } catch {
      return fallback(url);
    }
  };
}

function xhrUploadBinary(url: string, body: Uint8Array): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest upload failed"));
    xhr.send(toStandaloneArrayBuffer(body));
  });
}

function xhrDownloadBinary(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest download failed"));
    xhr.send();
  });
}

async function zoteroDownloadFileBytes(url: string): Promise<Uint8Array | Map<string, string>> {
  const path = await createTemporaryPath("mineru-result.zip");
  try {
    const curlResult = await downloadWithCurl(url, path);
    if (!curlResult.used) {
      await Zotero.File.download(url, path);
    }
    return readZipFile(path) ?? normalizeBinary(await readFileBytes(path));
  } catch (error) {
    throw new MinerUTaskError(`file download failed: ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    await removeFileIfExists(path);
  }
}

async function downloadWithCurl(
  url: string,
  path: string,
): Promise<{ used: boolean; reason?: string }> {
  const platform = getRuntimePlatform();
  if (platform !== "win") {
    return { used: false, reason: `platform=${platform}` };
  }
  const processResult = await downloadWithNsIProcess(url, path);
  if (processResult.used) {
    return processResult;
  }
  const process = (globalThis as typeof globalThis & {
    ChromeUtils?: {
      importESModule?: (uri: string) => {
        Subprocess?: {
          call: (options: {
            command: string;
            arguments: string[];
            stdout?: string;
            stderr?: string;
          }) => Promise<{ exitCode: number; stderr?: string }>;
        };
      };
    };
  }).ChromeUtils?.importESModule?.("chrome://zotero/content/Subprocess.sys.mjs")
    ?.Subprocess;
  if (!process) {
    return { used: false, reason: `no subprocess; ${processResult.reason}` };
  }
  const result = await process.call({
    command: "curl.exe",
    arguments: ["-L", "--fail", "--silent", "--show-error", "-o", path, url],
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`curl.exe download failed: ${result.stderr || result.exitCode}`);
  }
  return { used: true };
}

function getRuntimePlatform(): "win" | "mac" | "linux" | "unknown" {
  const runtime = globalThis as typeof globalThis & {
    AppConstants?: { platform?: string };
    Services?: { appinfo?: { OS?: string } };
    navigator?: { platform?: string };
  };
  const value = [
    runtime.AppConstants?.platform,
    runtime.Services?.appinfo?.OS,
    runtime.navigator?.platform,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (value.includes("win")) {
    return "win";
  }
  if (value.includes("mac") || value.includes("darwin")) {
    return "mac";
  }
  if (value.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

async function downloadWithNsIProcess(
  url: string,
  path: string,
): Promise<{ used: boolean; reason?: string }> {
  const xpcom = globalThis as typeof globalThis & {
    Components?: typeof Components;
  };
  const classes = xpcom.Components?.classes;
  const interfaces = xpcom.Components?.interfaces;
  if (!classes || !interfaces) {
    return { used: false, reason: "no Components classes/interfaces" };
  }

  const curlPath = await findCurlPath();
  if (!curlPath) {
    return { used: false, reason: "curl.exe not found" };
  }

  const classMap = classes as typeof classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const file = classMap["@mozilla.org/file/local;1"].createInstance(
    interfaces.nsIFile,
  ) as nsIFile;
  file.initWithPath(curlPath);
  const process = classMap["@mozilla.org/process/util;1"].createInstance(
    interfaces.nsIProcess,
  ) as nsIProcess;
  process.init(file);
  process.startHidden = true;
  process.noShell = true;
  const args = ["-L", "--fail", "--silent", "--show-error", "-o", path, url];
  process.run(true, args, args.length);
  if (process.exitValue !== 0) {
    throw new Error(`curl.exe process exited with ${process.exitValue}`);
  }
  const size = await fileSize(path);
  if (size <= 0) {
    throw new Error("curl.exe produced an empty file");
  }
  return { used: true };
}

async function findCurlPath(): Promise<string | null> {
  const candidates = [
    "C:\\Windows\\System32\\curl.exe",
    "C:\\Windows\\Sysnative\\curl.exe",
  ];
  for (const path of candidates) {
    if (await fileExists(path)) {
      return path;
    }
  }
  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    if (typeof IOUtils !== "undefined") {
      return IOUtils.exists(path);
    }
    return OS.File.exists(path);
  } catch {
    return false;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    if (typeof IOUtils !== "undefined") {
      const stat = await IOUtils.stat(path);
      return stat.size ?? 0;
    }
    const stat = await OS.File.stat(path);
    return stat.size ?? 0;
  } catch {
    return 0;
  }
}

async function zoteroHttpFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = normalizeHeaders(init?.headers);
  const xhr = await Zotero.HTTP.request(
    getRequestMethod(input, init),
    getRequestURL(input),
    {
      body: normalizeRequestBody(init?.body),
      ...(headers ? { headers } : {}),
      responseType: "arraybuffer",
      successCodes: false,
    },
  );
  return xhrToResponse(xhr);
}

function xhrToResponse(xhr: XMLHttpRequest): Response {
  const status = normalizeResponseStatus(xhr.status, xhr.response);
  const body = [204, 205, 304].includes(status) ? null : xhr.response;
  return new Response(body, {
    status,
    statusText: xhr.statusText,
    headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
  });
}

function normalizeResponseStatus(status: number, response: unknown): number {
  if (status !== 0) {
    return status;
  }
  return response == null ? 500 : 200;
}

function getRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method;
  }
  if (isRequest(input)) {
    return input.method;
  }
  return "GET";
}

function getRequestURL(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function normalizeRequestBody(
  body: BodyInit | ArrayBufferView | null | undefined,
): string | Uint8Array | undefined {
  if (body == null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (isArrayBuffer(body)) {
    return new Uint8Array(body);
  }
  throw new MinerUTaskError("Unsupported MinerU request body type");
}

function normalizeBinary(body: ArrayBufferView): Uint8Array {
  if (!ArrayBuffer.isView(body)) {
    throw new MinerUTaskError("Unsupported MinerU binary body type");
  }
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

function toStandaloneArrayBuffer(body: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

function normalizeHeaders(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  let normalized: Record<string, string>;
  if (headers instanceof Headers) {
    normalized = Object.fromEntries(headers.entries());
  } else if (Array.isArray(headers)) {
    normalized = Object.fromEntries(headers);
  } else {
    normalized = headers;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function parseResponseHeaders(rawHeaders: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of rawHeaders.trim().split(/[\r\n]+/)) {
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function responseErrorDetail(response: Response): Promise<string> {
  const text = (await response.clone().text()).trim();
  const summary = summarizeErrorBody(text);
  return summary
    ? `status ${response.status}; ${summary}`
    : `status ${response.status}`;
}

function summarizeErrorBody(text: string): string {
  if (!text) {
    return "";
  }
  const code = extractXmlTag(text, "Code");
  const message = extractXmlTag(text, "Message");
  const summary = [code, message].filter(Boolean).join(": ");
  return sanitizeErrorDetail(summary || text);
}

function extractXmlTag(text: string, tagName: string): string {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i").exec(
    text,
  );
  return match?.[1]?.trim() ?? "";
}

function sanitizeErrorDetail(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}

function safeURL(url: string | undefined): string {
  if (!url) {
    return "<missing-url>";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function summarizeBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "empty response";
  }
  const prefix = bytes.slice(0, 240);
  const text = sanitizeErrorDetail(new TextDecoder().decode(prefix));
  const hex = Array.from(bytes.slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
  return text ? `${text}; hex ${hex}` : `hex ${hex}`;
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

async function createTemporaryPath(fileName: string): Promise<string> {
  const baseDir = typeof PathUtils !== "undefined"
    ? PathUtils.tempDir
    : OS.Constants.Path.tmpDir;
  const name = `${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`;
  return typeof PathUtils !== "undefined"
    ? PathUtils.join(baseDir, name)
    : OS.Path.join(baseDir, name);
}

async function removeFileIfExists(path: string): Promise<void> {
  try {
    if (typeof IOUtils !== "undefined") {
      await IOUtils.remove(path, { ignoreAbsent: true });
      return;
    }
    await OS.File.remove(path, { ignoreAbsent: true });
  } catch {
    // Temporary-file cleanup failure should not hide the parse result.
  }
}

function readZipFile(path: string): Map<string, string> | null {
  const xpcom = globalThis as typeof globalThis & {
    Components?: typeof Components;
  };
  const classes = xpcom.Components?.classes;
  const interfaces = xpcom.Components?.interfaces;
  if (!classes || !interfaces) {
    return null;
  }

  const classMap = classes as typeof classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const file = classMap["@mozilla.org/file/local;1"].createInstance(
    interfaces.nsIFile,
  ) as nsIFile;
  file.initWithPath(path);
  const reader = classMap["@mozilla.org/libjar/zip-reader;1"].createInstance(
    interfaces.nsIZipReader,
  ) as nsIZipReader;
  const entries = new Map<string, string>();
  try {
    reader.open(file);
    const names = reader.findEntries("*");
    while (names.hasMore()) {
      const name = names.getNext();
      if (reader.getEntry(name).isDirectory) {
        continue;
      }
      if (name === "full.md" || name.endsWith(".json")) {
        entries.set(name, readZipEntryText(reader, name));
      }
    }
  } finally {
    reader.close();
  }
  return entries.size > 0 ? entries : null;
}

function readZipEntryText(reader: nsIZipReader, name: string): string {
  const input = reader.getInputStream(name);
  const classMap = Components.classes as typeof Components.classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const binary = classMap["@mozilla.org/binaryinputstream;1"].createInstance(
    Components.interfaces.nsIBinaryInputStream,
  ) as nsIBinaryInputStream;
  try {
    binary.setInputStream(input);
    const entry = reader.getEntry(name);
    const bytes = new Uint8Array(binary.readByteArray(entry.realSize));
    return new TextDecoder().decode(bytes);
  } finally {
    input.close();
  }
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
  let firstJson: unknown | null = null;

  for (const [name, value] of zip) {
    if (name === "full.md") {
      continue;
    }
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      firstJson ??= parsed;
      if (hasPageBoxData(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return firstJson;
}

function hasPageBoxData(value: unknown): boolean {
  const raw = value as { pages?: unknown; pdf_info?: unknown };
  const pages = Array.isArray(raw.pages)
    ? raw.pages
    : Array.isArray(raw.pdf_info)
      ? raw.pdf_info
      : [];
  return pages.some((page) => {
    const rawPage = page as {
      blocks?: unknown;
      para_blocks?: unknown;
      layout_dets?: unknown;
    };
    return [
      rawPage.blocks,
      rawPage.para_blocks,
      rawPage.layout_dets,
    ].some((blocks) => Array.isArray(blocks) && blocks.some(hasBlockGeometry));
  });
}

function hasBlockGeometry(value: unknown): boolean {
  const block = value as { bbox?: unknown; poly?: unknown };
  return (
    (Array.isArray(block.bbox) && block.bbox.length >= 4) ||
    (Array.isArray(block.poly) && block.poly.length >= 4)
  );
}

function findCentralDirectoryOffset(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      return readUint32(bytes, offset + 16);
    }
  }
  throw new MinerUTaskError(
    `MinerU result zip is missing central directory: ${summarizeBytes(bytes)}`,
  );
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
