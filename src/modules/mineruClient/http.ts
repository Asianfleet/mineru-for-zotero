import { MinerUTaskError } from "./errors";
import type { FetchLike } from "./types";

/**
 * 选择 Zotero HTTP、全局 fetch 或错误回退作为默认请求实现。
 */
export function createDefaultRequest(): FetchLike {
  const zotero = (
    globalThis as typeof globalThis & {
      Zotero?: typeof Zotero;
    }
  ).Zotero;
  if (typeof zotero?.HTTP?.request === "function") {
    return zoteroHttpFetch;
  }

  const fallbackFetch = (
    globalThis as typeof globalThis & {
      fetch?: typeof fetch;
    }
  ).fetch;
  if (fallbackFetch) {
    return fallbackFetch.bind(globalThis);
  }

  return async () => {
    throw new MinerUTaskError(
      "No HTTP client is available for MinerU requests",
    );
  };
}

/**
 * 选择可提交 FormData 的请求实现，用于本地 multipart API。
 */
export function createFormDataRequest(): FetchLike {
  const fallbackFetch = (
    globalThis as typeof globalThis & {
      fetch?: typeof fetch;
    }
  ).fetch;
  if (fallbackFetch) {
    return fallbackFetch.bind(globalThis);
  }
  if (typeof XMLHttpRequest !== "undefined") {
    return xhrFetch;
  }
  return createDefaultRequest();
}

/**
 * 基于 fetch-like 请求器创建裸 PUT 二进制上传函数。
 */
export function fetchUploadBinary(request: FetchLike) {
  return async (url: string, body: Uint8Array): Promise<Response> =>
    request(url, { method: "PUT", body });
}

/**
 * 基于 fetch-like 请求器创建 GET 二进制下载函数。
 */
export function fetchDownloadBinary(request: FetchLike) {
  return async (url: string): Promise<Response> =>
    request(url, { method: "GET" });
}

/**
 * 创建失败后自动改用备用下载实现的下载函数。
 */
export function fallbackDownloadBinary(
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

/**
 * 使用 XMLHttpRequest 向预签名 URL 上传 PDF 字节。
 */
export function xhrUploadBinary(
  url: string,
  body: Uint8Array,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest upload failed"));
    xhr.send(toStandaloneArrayBuffer(body));
  });
}

/**
 * 使用 XMLHttpRequest 下载二进制响应并包装为 Response。
 */
export function xhrDownloadBinary(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest download failed"));
    xhr.send();
  });
}

/**
 * 把 Zotero.HTTP.request 适配为 fetch-like Response 接口。
 */
export async function zoteroHttpFetch(
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

/**
 * 使用 XMLHttpRequest 实现 fetch-like 请求，支持 FormData body。
 */
export function xhrFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(getRequestMethod(input, init), getRequestURL(input));
    xhr.responseType = "arraybuffer";
    const headers = normalizeHeaders(init?.headers);
    for (const [name, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest request failed"));
    xhr.send(toXHRBody(init?.body));
  });
}

/**
 * 把 XMLHttpRequest 响应转换为标准 Response 对象。
 */
export function xhrToResponse(xhr: XMLHttpRequest): Response {
  const status = normalizeResponseStatus(xhr.status, xhr.response);
  const body = [204, 205, 304].includes(status) ? null : xhr.response;
  return new Response(body, {
    status,
    statusText: xhr.statusText,
    headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
  });
}

/**
 * 标准化 XHR 状态码，兼容本地运行时可能返回的 status 0。
 */
export function normalizeResponseStatus(
  status: number,
  response: unknown,
): number {
  if (status !== 0) {
    return status;
  }
  return response == null ? 500 : 200;
}

/**
 * 从 RequestInit 或 Request 对象中解析 HTTP 方法。
 */
export function getRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  if (init?.method) {
    return init.method;
  }
  if (isRequest(input)) {
    return input.method;
  }
  return "GET";
}

/**
 * 从字符串、URL 或 Request 中解析请求 URL。
 */
export function getRequestURL(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/**
 * 把 fetch body 标准化为 Zotero.HTTP 可接受的字符串或字节数组。
 */
export function normalizeRequestBody(
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

/**
 * 把 fetch body 转换为 XMLHttpRequest.send 可接受的 body。
 */
export function toXHRBody(
  body: BodyInit | ArrayBufferView | null | undefined,
): Document | XMLHttpRequestBodyInit | null {
  if (body == null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return body;
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return body;
  }
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  ) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    return toStandaloneArrayBuffer(normalizeBinary(body));
  }
  if (isArrayBuffer(body)) {
    return body;
  }
  throw new MinerUTaskError("Unsupported MinerU request body type");
}

/**
 * 把 ArrayBufferView 标准化为 Uint8Array 视图。
 */
export function normalizeBinary(body: ArrayBufferView): Uint8Array {
  if (!ArrayBuffer.isView(body)) {
    throw new MinerUTaskError("Unsupported MinerU binary body type");
  }
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

/**
 * 复制 Uint8Array 到独立 ArrayBuffer，避免上传多余底层缓冲区内容。
 */
export function toStandaloneArrayBuffer(body: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

/**
 * 把 HeadersInit 标准化为普通对象，便于 Zotero.HTTP 使用。
 */
export function normalizeHeaders(
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

/**
 * 解析 XHR 原始响应头字符串为键值对象。
 */
export function parseResponseHeaders(
  rawHeaders: string,
): Record<string, string> {
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

/**
 * 判断输入是否是标准 Request 对象。
 */
export function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

/**
 * 判断未知值是否是 ArrayBuffer。
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/**
 * 把未知错误值转换为可读错误消息。
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 读取错误响应正文并生成简短 HTTP 错误详情。
 */
export async function responseErrorDetail(response: Response): Promise<string> {
  const text = (await response.clone().text()).trim();
  const summary = summarizeErrorBody(text);
  return summary
    ? `status ${response.status}; ${summary}`
    : `status ${response.status}`;
}

/**
 * 从错误响应正文中提取 XML 错误摘要或截断后的文本摘要。
 */
export function summarizeErrorBody(text: string): string {
  if (!text) {
    return "";
  }
  const code = extractXmlTag(text, "Code");
  const message = extractXmlTag(text, "Message");
  const summary = [code, message].filter(Boolean).join(": ");
  return sanitizeErrorDetail(summary || text);
}

/**
 * 从 XML 文本中提取指定标签的内容。
 */
export function extractXmlTag(text: string, tagName: string): string {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i").exec(
    text,
  );
  return match?.[1]?.trim() ?? "";
}

/**
 * 压缩并截断错误详情，避免日志和异常消息过长。
 */
export function sanitizeErrorDetail(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}
