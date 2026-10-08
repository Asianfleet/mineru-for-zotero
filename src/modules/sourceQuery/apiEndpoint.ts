import {
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
} from "../../utils/prefs";
import { getMinerUStorageRoot } from "../preferenceScript";
import { createTexSourceStorage } from "../texSource/storage";
import { extractArxivId } from "../texSource/arxivId";
import { decodeSourceArchive } from "../texSource/archive";
import { createLatexQueryService } from "../latexQuery/service";

export const SOURCE_ENDPOINT_PATHS = [
  "/mineru-for-zotero/latex/read",
  "/mineru-for-zotero/latex/table",
  "/mineru-for-zotero/latex/image",
  "/mineru-for-zotero/latex/fetch",
] as const;

interface EndpointOptions {
  pathname: string;
  method: "GET" | "POST";
  query: Record<string, string>;
  searchParams?: URLSearchParams;
  headers: Record<string, string>;
}

interface SourceEndpointDeps {
  authorized(
    query: Record<string, string>,
    headers: Record<string, string>,
  ): void;
  read(input: {
    libraryID: number;
    key: string;
    granularity?: string;
    query?: string;
    sectionPath?: string;
    sectionNumber?: string;
  }): Promise<unknown>;
  table(input: {
    libraryID: number;
    key: string;
    query: string;
  }): Promise<unknown>;
  image(input: {
    libraryID: number;
    key: string;
    path: string;
  }): Promise<unknown>;
  fetch(input: {
    libraryID: number;
    key: string;
    refresh: boolean;
  }): Promise<unknown>;
}

/** 创建可单元测试的 LaTeX endpoint 分发器。 */
export function createSourceQueryEndpoint(deps: SourceEndpointDeps) {
  return {
    supportedMethods: ["GET", "POST"],
    async init(options: EndpointOptions) {
      try {
        const query = options.searchParams
          ? Object.fromEntries(options.searchParams.entries())
          : options.query;
        deps.authorized(query, options.headers);
        const libraryID = integer(query.libraryID);
        const key = required(query.key);
        if (options.pathname.endsWith("/fetch")) {
          if (options.method !== "POST") throw new Error("invalid-request");
          return json(
            200,
            await deps.fetch({
              libraryID,
              key,
              refresh: query.refresh === "true",
            }),
          );
        }
        if (options.method !== "GET") throw new Error("invalid-request");
        if (options.pathname.endsWith("/read"))
          return json(
            200,
            await deps.read({
              libraryID,
              key,
              granularity: query.granularity,
              query: query.q ?? query.sectionPath ?? query.sectionNumber,
              sectionPath: query.sectionPath,
              sectionNumber: query.sectionNumber,
            }),
          );
        if (options.pathname.endsWith("/table"))
          return json(
            200,
            await deps.table({ libraryID, key, query: required(query.q) }),
          );
        if (options.pathname.endsWith("/image"))
          return json(
            200,
            await deps.image({ libraryID, key, path: required(query.path) }),
          );
        throw new Error("invalid-request");
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

/** 注册来源分层 API。 */
export function registerSourceQueryApiEndpoint(): void {
  const store = createTexSourceStorage(getMinerUStorageRoot());
  const service = createLatexQueryService({
    store,
    getItem: (libraryID, key) =>
      Zotero.Items.getByLibraryAndKeyAsync(libraryID, key),
  });
  const endpoint = createSourceQueryEndpoint({
    authorized: authorize,
    read: (input) => service.read(input as never),
    table: (input) => service.table(input),
    image: async (input) => {
      const image = await store.readImage(input, input.path);
      return {
        images: [
          {
            path: image.path,
            status: "ok",
            mime: image.mime,
            dataURL: `data:${image.mime};base64,${bytesToBase64(image.bytes)}`,
          },
        ],
      };
    },
    fetch: (input) =>
      fetchLatex(store, input.libraryID, input.key, input.refresh),
  });
  class SourceQueryEndpoint {
    supportedMethods = endpoint.supportedMethods;
    init(options: EndpointOptions) {
      return endpoint.init(options);
    }
  }
  for (const path of SOURCE_ENDPOINT_PATHS)
    Zotero.Server.Endpoints[path] = SourceQueryEndpoint as never;
}

/** 清理来源分层 API。 */
export function unregisterSourceQueryApiEndpoint(): void {
  for (const path of SOURCE_ENDPOINT_PATHS)
    delete Zotero.Server.Endpoints[path];
}

async function fetchLatex(
  store: ReturnType<typeof createTexSourceStorage>,
  libraryID: number,
  key: string,
  refresh: boolean,
) {
  if (!refresh) {
    try {
      return await store.read({ libraryID, key });
    } catch {
      /* fetch below */
    }
  }
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  if (!item) throw new Error("item-not-found");
  const id = extractArxivId({
    extra: item.getField("extra"),
    url: item.getField("url"),
  });
  const response = await fetch(`https://export.arxiv.org/src/${id}`);
  if (!response.ok) throw new Error("arxiv-download-failed");
  const files = await decodeSourceArchive(
    new Uint8Array(await response.arrayBuffer()),
  );
  const mainFile = files.find((file) =>
    /\\documentclass|\\begin\s*\{document\}/.test(
      new TextDecoder().decode(file.bytes),
    ),
  )?.path;
  if (!mainFile) throw new Error("ambiguous-main-file");
  const manifest = {
    libraryID,
    itemKey: key,
    arxivID: id,
    resolvedVersion: id.match(/v\d+$/i)?.[0] ?? "latest",
    downloadedAt: new Date().toISOString(),
    mainFile,
    files: files.map((file) => file.path),
    fileCount: files.length,
    status: "ready" as const,
    resultVersion: 1 as const,
  };
  await store.write({ libraryID, key, files, manifest });
  return manifest;
}

/** 校验 LaTeX 请求使用的同一个本地 API 开关和 token。 */
function authorize(
  query: Record<string, string>,
  headers: Record<string, string>,
): void {
  if (!getMarkdownApiEnabled()) throw new Error("api-disabled");
  if (!getMarkdownApiRequireToken()) return;
  const provided =
    (headers.authorization ?? headers.Authorization ?? "").replace(
      /^Bearer\s+/i,
      "",
    ) || query.token;
  if (!provided || provided !== getMarkdownApiToken())
    throw new Error("invalid-token");
}

/** 将图片字节转成 data URL 使用的 base64 文本。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function required(value: string | undefined): string {
  if (!value?.trim()) throw new Error("invalid-request");
  return value.trim();
}
function integer(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("invalid-request");
  return parsed;
}
function json(status: number, payload: unknown) {
  return [status, "application/json", JSON.stringify(payload)] as const;
}
function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : "internal-error";
  const status =
    code === "api-disabled" || code === "invalid-token"
      ? 403
      : code === "tex-source-not-found"
        ? 404
        : 400;
  return json(status, { error: code, message: code });
}
