import { authorizeMarkdownQueryApi } from "../markdownQuery/apiEndpoint";
import { MarkdownQueryError } from "../markdownQuery/types";
import { parseReaderQueryScope } from "./queryService";
import { createZoteroReaderQueryService } from "./runtime";
import type { ReaderQueryService } from "./types";

/** 阅读上下文的只读 HTTP 查询路径。 */
export const READER_QUERY_ENDPOINT_PATHS = [
  "/mineru-for-zotero/tabs",
  "/mineru-for-zotero/boxes/selected",
] as const;

/** Zotero HTTP server 提供的请求信息。 */
interface ReaderEndpointRequest {
  method: string;
  pathname: string;
  query?: Record<string, string>;
  searchParams?: URLSearchParams;
  headers: Record<string, string>;
  data: unknown;
}

/** 创建可注入服务和鉴权边界的只读 endpoint。 */
export function createReaderQueryEndpoint(
  service: ReaderQueryService,
  authorize = authorizeMarkdownQueryApi,
) {
  return {
    supportedMethods: ["GET"],
    /** 鉴权后读取一次运行时快照，不暴露内部异常。 */
    async init(
      options: ReaderEndpointRequest,
    ): Promise<[number, string, string]> {
      if (options.method !== "GET")
        return json(405, {
          error: "method-not-allowed",
          message: "GET required",
        });
      try {
        const query = options.searchParams
          ? Object.fromEntries(options.searchParams.entries())
          : (options.query ?? {});
        authorize(query, options.headers);
        const scope = parseReaderQueryScope(query.scope);
        switch (options.pathname) {
          case "/mineru-for-zotero/tabs":
            return json(200, await service.listTabs(scope));
          case "/mineru-for-zotero/boxes/selected":
            return json(200, await service.selectedBoxes(scope));
          default:
            return json(404, {
              error: "not-found",
              message: "Unknown endpoint",
            });
        }
      } catch (error) {
        if (error instanceof MarkdownQueryError) {
          return json(error.status, {
            error: error.code,
            message: error.message,
          });
        }
        return json(500, {
          error: "internal-error",
          message: "Unexpected internal error",
        });
      }
    },
  };
}

/** 注册一次共享服务，窗口加载不重复注册 endpoint。 */
export function registerReaderQueryApiEndpoint(): void {
  const endpoint = createReaderQueryEndpoint(createZoteroReaderQueryService());
  /** Zotero endpoint 构造器，委托给同一查询服务。 */
  class ReaderQueryEndpoint {
    supportedMethods = endpoint.supportedMethods;

    /** 将 Zotero 请求转交给查询 handler。 */
    init(options: ReaderEndpointRequest) {
      return endpoint.init(options);
    }
  }
  for (const path of READER_QUERY_ENDPOINT_PATHS) {
    Zotero.Server.Endpoints[path] =
      ReaderQueryEndpoint as unknown as typeof _ZoteroTypes.Server.Endpoint;
  }
}

/** 注销查询路由，释放 endpoint 持有的服务引用。 */
export function unregisterReaderQueryApiEndpoint(): void {
  for (const path of READER_QUERY_ENDPOINT_PATHS)
    delete Zotero.Server.Endpoints[path];
}

/** 将外部可见数据编码为 Zotero HTTP 响应。 */
function json(status: number, value: unknown): [number, string, string] {
  return [status, "application/json", JSON.stringify(value)];
}
