import { MinerUTaskError } from "./errors";
import type { FetchLike } from "./types";

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

export function fetchUploadBinary(request: FetchLike) {
  return async (url: string, body: Uint8Array): Promise<Response> =>
    request(url, { method: "PUT", body });
}

export function fetchDownloadBinary(request: FetchLike) {
  return async (url: string): Promise<Response> =>
    request(url, { method: "GET" });
}

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

export function xhrUploadBinary(url: string, body: Uint8Array): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => resolve(xhrToResponse(xhr));
    xhr.onerror = () => reject(new Error("XMLHttpRequest upload failed"));
    xhr.send(toStandaloneArrayBuffer(body));
  });
}

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

export function xhrToResponse(xhr: XMLHttpRequest): Response {
  const status = normalizeResponseStatus(xhr.status, xhr.response);
  const body = [204, 205, 304].includes(status) ? null : xhr.response;
  return new Response(body, {
    status,
    statusText: xhr.statusText,
    headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
  });
}

export function normalizeResponseStatus(status: number, response: unknown): number {
  if (status !== 0) {
    return status;
  }
  return response == null ? 500 : 200;
}

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

export function getRequestURL(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

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

export function normalizeBinary(body: ArrayBufferView): Uint8Array {
  if (!ArrayBuffer.isView(body)) {
    throw new MinerUTaskError("Unsupported MinerU binary body type");
  }
  return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
}

export function toStandaloneArrayBuffer(body: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

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

export function parseResponseHeaders(rawHeaders: string): Record<string, string> {
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

export function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function responseErrorDetail(response: Response): Promise<string> {
  const text = (await response.clone().text()).trim();
  const summary = summarizeErrorBody(text);
  return summary
    ? `status ${response.status}; ${summary}`
    : `status ${response.status}`;
}

export function summarizeErrorBody(text: string): string {
  if (!text) {
    return "";
  }
  const code = extractXmlTag(text, "Code");
  const message = extractXmlTag(text, "Message");
  const summary = [code, message].filter(Boolean).join(": ");
  return sanitizeErrorDetail(summary || text);
}

export function extractXmlTag(text: string, tagName: string): string {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i").exec(
    text,
  );
  return match?.[1]?.trim() ?? "";
}

export function sanitizeErrorDetail(value: string): string {
  return value.replace(/\s+/g, " ").slice(0, 240);
}
