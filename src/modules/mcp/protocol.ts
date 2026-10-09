import type { McpQueryContext } from "./services";
import { McpError, errorText, toMcpError } from "./errorMapper";
import { callMcpTool, listMcpTools, McpToolDefinition } from "./tools";
import {
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
} from "../../utils/prefs";

/** MCP endpoint 使用的 HTTP 响应三元组。 */
export type McpHttpResponse = readonly [number, string, string];

/** MCP 协议处理器的最小接口，供 endpoint 和测试复用。 */
export interface McpProtocol {
  handle(options: {
    method: string;
    pathname: string;
    headers: Record<string, string>;
    data: unknown;
  }): Promise<McpHttpResponse>;
}

interface ProtocolDeps {
  context: McpQueryContext;
  authorize?: (headers: Record<string, string>) => void;
  listTools?: () => McpToolDefinition[];
  callTool?: (
    name: string,
    args: unknown,
    context: McpQueryContext,
  ) => Promise<
    ReturnType<typeof import("./tools").callMcpTool> extends Promise<infer T>
      ? T
      : never
  >;
}

/** 创建无状态 MCP JSON-RPC 处理器。 */
export function createMcpProtocol(deps: ProtocolDeps): McpProtocol {
  const authorize = deps.authorize ?? authorizeMcp;
  const getTools = deps.listTools ?? listMcpTools;
  const invokeTool = deps.callTool ?? callMcpTool;
  return {
    async handle(options) {
      if (options.method !== "POST") {
        return response(405, {
          error: { code: -32000, message: "Method not allowed" },
        });
      }

      let request: McpRequest;
      try {
        request = parseMcpRequest(options.data);
      } catch (error) {
        const mapped = toMcpError(error);
        return errorResponse(
          null,
          mapped.code === "parse-error" ? -32700 : -32600,
          mapped.message,
          400,
        );
      }
      const notification = request.id === undefined;

      try {
        if (
          request.method === "tools/list" ||
          request.method === "tools/call"
        ) {
          authorize(options.headers);
        }
        if (request.method === "notifications/initialized") {
          return emptyResponse();
        }
        if (request.method === "initialize") {
          return jsonResponse(request.id, {
            protocolVersion: protocolVersion(request.params),
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "mineru-for-zotero", version: "1.0.0" },
          });
        }
        if (request.method === "ping") {
          return jsonResponse(request.id, {});
        }
        if (request.method === "tools/list") {
          return jsonResponse(request.id, { tools: getTools() });
        }
        if (request.method === "tools/call") {
          const params = objectParams(request.params);
          const name = requiredString(params.name, "name");
          try {
            const result = await invokeTool(
              name,
              params.arguments,
              deps.context,
            );
            return jsonResponse(request.id, result);
          } catch (error) {
            const mapped = toMcpError(error);
            if (
              mapped.code === "invalid-params" ||
              mapped.code === "unknown-tool"
            ) {
              return errorResponse(
                request.id,
                -32602,
                errorText(mapped),
                mapped.status,
              );
            }
            const content = [
              { type: "text" as const, text: errorText(mapped) },
            ];
            return jsonResponse(request.id, {
              isError: true,
              content,
              structuredContent: mapped.data,
            });
          }
        }
        throw new McpError("method-not-found", "Method not found", 404);
      } catch (error) {
        if (notification) return emptyResponse();
        const mapped = toMcpError(error);
        const code =
          mapped.code === "invalid-token" || mapped.code === "api-disabled"
            ? -32001
            : mapped.code === "invalid-params"
              ? -32602
              : -32601;
        return errorResponse(
          request.id ?? null,
          code,
          errorText(mapped),
          mapped.status,
        );
      }
    },
  };
}

/** 解析 endpoint 收到的 JSON body，供协议测试和运行时共用。 */
export function parseMcpRequest(data: unknown): McpRequest {
  let value = data;
  if (value instanceof Uint8Array) {
    value = new TextDecoder().decode(value);
  }
  if (typeof value === "string") {
    if (value.length > 1024 * 1024)
      throw new McpError("invalid-request", "Request body is too large");
    try {
      value = JSON.parse(value);
    } catch {
      throw new McpError("parse-error", "Invalid JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpError("invalid-request", "Invalid JSON-RPC request");
  }
  const request = value as Partial<McpRequest>;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    throw new McpError("invalid-request", "Invalid JSON-RPC request");
  }
  if (request.id !== undefined && !isValidId(request.id)) {
    throw new McpError("invalid-request", "Invalid JSON-RPC id");
  }
  return request as McpRequest;
}

interface McpRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/** 检查 JSON-RPC id 类型，防止序列化不稳定值。 */
function isValidId(value: unknown): value is string | number | null {
  return (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** 选择兼容客户端请求的 MCP 协议版本，未知版本回退到实现版本。 */
function protocolVersion(params: unknown): string {
  const version =
    params && typeof params === "object" && "protocolVersion" in params
      ? (params as { protocolVersion?: unknown }).protocolVersion
      : undefined;
  return typeof version === "string" &&
    ["2024-11-05", "2025-03-26", "2025-06-18"].includes(version)
    ? version
    : "2025-06-18";
}

/** 验证 method params 是对象。 */
function objectParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpError("invalid-params", "Invalid method parameters");
  }
  return value as Record<string, unknown>;
}

/** 读取 JSON-RPC method 的必填字符串参数。 */
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new McpError("invalid-params", `Missing ${name}`);
  }
  return value.trim();
}

/** 复用本地查询 API 开关和 Bearer token 校验 MCP 请求。 */
function authorizeMcp(headers: Record<string, string>): void {
  if (!getMarkdownApiEnabled())
    throw new McpError("api-disabled", "Markdown query API is disabled", 403);
  if (!getMarkdownApiRequireToken()) return;
  const header = headers.authorization ?? headers.Authorization ?? "";
  const provided = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? "";
  if (!provided || provided !== getMarkdownApiToken()) {
    throw new McpError("invalid-token", "Invalid API token", 403);
  }
}

/** 创建 Zotero HTTP endpoint 可返回的 JSON 响应。 */
function response(status: number, payload: unknown): McpHttpResponse {
  return [status, "application/json", JSON.stringify(payload)];
}

/** 包装普通 JSON-RPC result，通知请求不生成响应体。 */
function jsonResponse(id: McpRequest["id"], result: unknown): McpHttpResponse {
  if (id === undefined) return emptyResponse();
  return response(200, { jsonrpc: "2.0", id, result });
}

/** 包装稳定 JSON-RPC error。 */
function errorResponse(
  id: McpRequest["id"],
  code: number,
  message: string,
  status: number,
): McpHttpResponse {
  return response(status, { jsonrpc: "2.0", id, error: { code, message } });
}

/** 为已接受的 notification 返回空响应。 */
function emptyResponse(): McpHttpResponse {
  return [204, "application/json", ""];
}
