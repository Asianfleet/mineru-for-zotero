import {
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
} from "../../utils/prefs";
import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
import {
  createMarkdownQueryService,
  MarkdownQueryService,
} from "./queryService";
import { MarkdownQueryError, ZoteroItemLike } from "./types";

interface MarkdownEndpointRequest {
  method: "GET" | "POST";
  pathname: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  data: unknown;
}

export const MARKDOWN_ENDPOINT_PATHS = [
  "/mineru-for-zotero/search",
  "/mineru-for-zotero/markdown",
] as const;

/**
 * 注册 Markdown 查询 HTTP endpoint，供外部本地客户端调用。
 */
export function registerMarkdownQueryApiEndpoint(): void {
  const service = createMarkdownQueryService({
    items: Zotero.Items,
    storage: createStorage(getMinerUStorageRoot()),
    searchItemsByTitle,
  });
  const endpoint = createMarkdownQueryEndpoint(service);

  for (const path of MARKDOWN_ENDPOINT_PATHS) {
    Zotero.Server.Endpoints[path] = toZoteroEndpoint(endpoint);
  }
}

/**
 * 卸载 Markdown 查询 HTTP endpoint，避免插件停用后残留路由。
 */
export function unregisterMarkdownQueryApiEndpoint(): void {
  for (const path of MARKDOWN_ENDPOINT_PATHS) {
    delete Zotero.Server.Endpoints[path];
  }
}

/**
 * 创建同时处理标题检索与 Markdown 读取的 endpoint 实例。
 */
export function createMarkdownQueryEndpoint(service: MarkdownQueryService) {
  return {
    supportedMethods: ["GET"],
    async init(options: MarkdownEndpointRequest) {
      try {
        authorize(options.query, options.headers);
        const payload =
          options.pathname === "/mineru-for-zotero/search"
            ? await service.searchByTitle({
                libraryID: requireInteger(options.query.libraryID, "libraryID"),
                title: requireString(options.query.title, "title"),
              })
            : await service.queryMarkdown({
                libraryID: requireInteger(options.query.libraryID, "libraryID"),
                key: requireString(options.query.key, "key"),
                attachmentKey: optionalString(options.query.attachmentKey),
                granularity: optionalString(options.query.granularity) as
                  | "full"
                  | "headings"
                  | "section"
                  | "search"
                  | undefined,
                sectionPath: parseSectionPath(options.query.sectionPath),
                q: optionalString(options.query.q),
                contextParagraphs: parseOptionalInteger(
                  options.query.contextParagraphs,
                ),
              });

        return json(200, payload);
      } catch (error) {
        return jsonError(error);
      }
    },
  };
}

/**
 * 将 promise-style endpoint 对象适配到 zotero-types 当前的 endpoint 注册类型。
 */
function toZoteroEndpoint(endpoint: unknown) {
  return endpoint as unknown as typeof _ZoteroTypes.Server.Endpoint;
}

/**
 * 通过 Zotero.Search 按标题模糊检索库内条目。
 */
async function searchItemsByTitle(input: {
  libraryID: number;
  title: string;
}): Promise<ZoteroItemLike[]> {
  const search = new Zotero.Search({ libraryID: input.libraryID });
  search.addCondition("title", "contains", input.title);
  const ids = await search.search();
  return Zotero.Items.getAsync(ids);
}

/**
 * 校验 API 开关与 token，支持 Bearer 和 query token 两种来源。
 */
function authorize(
  query: Record<string, string>,
  headers: Record<string, string>,
): void {
  if (!getMarkdownApiEnabled()) {
    throw new MarkdownQueryError(
      "api-disabled",
      403,
      "Markdown query API is disabled",
    );
  }
  if (!getMarkdownApiRequireToken()) {
    return;
  }

  const expected = getMarkdownApiToken();
  const provided = getBearerToken(headers) || optionalString(query.token) || "";
  if (!expected || provided !== expected) {
    throw new MarkdownQueryError("invalid-token", 403, "Invalid API token");
  }
}

/**
 * 从 Authorization header 提取 Bearer token。
 */
function getBearerToken(headers: Record<string, string>): string {
  const header = headers.authorization ?? headers.Authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

/**
 * 读取必填字符串参数，并在缺失时抛出标准请求错误。
 */
function requireString(value: string | undefined, name: string): string {
  const text = optionalString(value);
  if (!text) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Missing required parameter: ${name}`,
    );
  }
  return text;
}

/**
 * 读取必填整数参数，并拒绝非整数值。
 */
function requireInteger(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      `Invalid integer parameter: ${name}`,
    );
  }
  return parsed;
}

/**
 * 清理可选字符串参数，空白值会被视为未提供。
 */
function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 解析可选整数参数，非法值交给下游默认逻辑处理。
 */
function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * 允许 sectionPath 以 JSON 数组、slash path 或单值字符串形式传入。
 */
function parseSectionPath(
  value: string | undefined,
): string[] | string | undefined {
  const text = optionalString(value);
  if (!text) {
    return undefined;
  }
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (
        Array.isArray(parsed) &&
        parsed.every((part) => typeof part === "string")
      ) {
        return parsed;
      }
    } catch {
      // 保持回退到字符串路径解析。
    }
  }

  const parts = text
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : text;
}

/**
 * 生成标准 JSON HTTP 响应。
 */
function json(code: number, payload: unknown) {
  return [code, "application/json", JSON.stringify(payload)] as const;
}

/**
 * 将领域错误映射为稳定的 JSON 错误响应。
 */
function jsonError(error: unknown) {
  if (error instanceof MarkdownQueryError) {
    return json(error.status, {
      error: error.code,
      message: error.message,
      ...(typeof error.details === "object" && error.details
        ? (error.details as Record<string, unknown>)
        : {}),
    });
  }

  logUnexpectedError(error);
  return json(500, {
    error: "internal-error",
    message: "Unexpected internal error",
  });
}

/**
 * 将未知内部异常写入 Zotero debug，但不影响测试环境或 HTTP 响应。
 */
function logUnexpectedError(error: unknown): void {
  const debug = (
    globalThis as unknown as {
      Zotero?: { debug?: (message: string) => void };
    }
  ).Zotero?.debug;
  if (typeof debug !== "function") {
    return;
  }

  const detail =
    error instanceof Error
      ? (error.stack ?? error.message)
      : String(error ?? "Unknown error");
  debug(`[MinerU] Markdown query API internal error: ${detail}`);
}
