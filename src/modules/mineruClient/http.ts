import { errorCodeText, MinerUTaskError } from "./errors";
import type { FetchLike } from "./types";

/**
 * Selects Zotero HTTP, global fetch, or an error fallback as the default request implementation.
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
 * Creates a bare PUT binary upload function based on a fetch-like requester.
 */
export function fetchUploadBinary(request: FetchLike) {
  return async (
    url: string,
    body: Uint8Array,
    headers?: Record<string, string>,
  ): Promise<Response> =>
    request(url, {
      method: "PUT",
      body,
      ...(headers ? { headers } : {}),
    });
}

/**
 * Creates a GET binary download function based on a fetch-like requester.
 */
export function fetchDownloadBinary(request: FetchLike) {
  return async (
    url: string,
    headers?: Record<string, string>,
  ): Promise<Response> =>
    request(url, { method: "GET", ...(headers ? { headers } : {}) });
}

/**
 * Creates a download function that automatically falls back to an alternate download implementation on failure.
 */
export function fallbackDownloadBinary(
  primary: (url: string, headers?: Record<string, string>) => Promise<Response>,
  fallback: (
    url: string,
    headers?: Record<string, string>,
  ) => Promise<Response>,
) {
  return async (
    url: string,
    headers?: Record<string, string>,
  ): Promise<Response> => {
    try {
      return await primary(url, headers);
    } catch {
      return fallback(url, headers);
    }
  };
}

/**
 * Uploads PDF bytes to a pre-signed URL using XMLHttpRequest.
 */
export function xhrUploadBinary(
  url: string,
  body: Uint8Array,
  headers?: Record<string, string>,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.responseType = "arraybuffer";
    for (const [name, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest upload failed"));
    xhr.send(toStandaloneArrayBuffer(body));
  });
}

/**
 * Downloads a binary response using XMLHttpRequest and wraps it as a Response.
 */
export function xhrDownloadBinary(
  url: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    for (const [name, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest download failed"));
    xhr.send();
  });
}

/**
 * Adapts Zotero.HTTP.request to a fetch-like Response interface.
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
 * Converts an XMLHttpRequest response into a standard Response object.
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
 * Normalizes XHR status codes, accommodating status 0 that local runtimes may return.
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
 * Resolves the HTTP method from a RequestInit or Request object.
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
 * Resolves the request URL from a string, URL, or Request object.
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
 * Normalizes a fetch body into a string or byte array acceptable to Zotero.HTTP.
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
 * Converts a fetch body into a body acceptable to XMLHttpRequest.send.
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
 * Normalizes an ArrayBufferView into a Uint8Array view.
 */
export function normalizeBinary(body: ArrayBufferView): Uint8Array {
  if (!ArrayBuffer.isView(body)) {
    throw new MinerUTaskError("Unsupported MinerU binary body type");
  }
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

/**
 * Copies a Uint8Array into a standalone ArrayBuffer to avoid uploading surplus underlying buffer content.
 */
export function toStandaloneArrayBuffer(body: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

/**
 * Normalizes HeadersInit into a plain object convenient for Zotero.HTTP.
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
 * Parses raw XHR response header strings into a key-value object.
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
 * Determines whether the input is a standard Request object.
 */
export function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

/**
 * Determines whether the unknown value is an ArrayBuffer.
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/**
 * Computes the SHA-256 hex digest of bytes, returning null when unavailable in the runtime.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = (
    globalThis as typeof globalThis & {
      crypto?: { subtle?: SubtleCrypto };
    }
  ).crypto?.subtle;
  if (!subtle?.digest) {
    return null;
  }
  try {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

/**
 * Converts an unknown error value into a readable error message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads an error response body and produces short HTTP error details.
 */
export async function responseErrorDetail(response: Response): Promise<string> {
  const text = (await response.clone().text()).trim();
  const summary = summarizeErrorBody(text);
  return summary
    ? `status ${response.status}; ${summary}`
    : `status ${response.status}`;
}

/**
 * Extracts an XML error summary or truncated text summary from an error response body.
 */
export function summarizeErrorBody(text: string): string {
  if (!text) {
    return "";
  }
  const json = extractJsonError(text);
  if (json) {
    return sanitizeErrorDetail(json);
  }
  const code = extractXmlTag(text, "Code");
  const message = extractXmlTag(text, "Message");
  const summary = [code, message].filter(Boolean).join(": ");
  return sanitizeErrorDetail(summary || text);
}

/**
 * Extracts a `code: message` summary from a JSON error body.
 *
 * Covers the V1 envelope ({"error":{"code":..,"message":..}}), the official
 * v4 envelope ({"code":..,"msg":..}), and the official gateway envelope used
 * for failures such as an invalid token ({"msgCode":..,"msg":..}).
 */
export function extractJsonError(text: string): string {
  if (!text.startsWith("{")) {
    return "";
  }
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: string; message?: string };
      msg?: string;
      code?: string | number;
      msgCode?: string;
    };
    const error = parsed.error;
    if (error && (error.code || error.message)) {
      return [error.code, error.message].filter(Boolean).join(": ");
    }
    const code = errorCodeText(parsed.code) || errorCodeText(parsed.msgCode);
    if (code || parsed.msg) {
      return [code, parsed.msg].filter(Boolean).join(": ");
    }
  } catch {
    // Not JSON; fall through to XML/text handling.
  }
  return "";
}

/**
 * Extracts the content of a specified tag from XML text.
 */
export function extractXmlTag(text: string, tagName: string): string {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i").exec(
    text,
  );
  return match?.[1]?.trim() ?? "";
}

/**
 * Compresses and truncates error details to prevent log and exception messages from becoming overly long.
 */
export function sanitizeErrorDetail(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}
