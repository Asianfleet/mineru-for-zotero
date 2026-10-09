import { createMcpQueryContext } from "./services";
import type { McpQueryContext } from "./services";
import { createMcpProtocol } from "./protocol";

/** MCP endpoint 在 Zotero 本地 HTTP server 上使用的固定路径。 */
export const MCP_ENDPOINT_PATH = "/mineru-for-zotero/mcp";

interface McpEndpointOptions {
  method: "GET" | "POST" | string;
  pathname: string;
  headers: Record<string, string>;
  data: unknown;
}

interface McpEndpointHandler {
  handle(
    options: McpEndpointOptions,
  ): Promise<readonly [number, string, string]>;
}

let context: McpQueryContext | undefined;

/** 创建可测试的 endpoint 外壳，并把请求交给 MCP 协议处理器。 */
export function createMcpQueryEndpoint(protocol: McpEndpointHandler) {
  return {
    supportedMethods: ["POST"],
    init(options: McpEndpointOptions) {
      return protocol.handle(options);
    },
  };
}

/** 注册 MCP endpoint，并在注册期间持有一份共享查询上下文。 */
export function registerMcpApiEndpoint(): void {
  unregisterMcpApiEndpoint();
  try {
    context = createMcpQueryContext();
    const endpoint = createMcpQueryEndpoint(
      createMcpProtocolForContext(context),
    );
    /** 适配 Zotero endpoint class 契约，复用注册时创建的协议上下文。 */
    const EndpointClass = class McpEndpoint {
      supportedMethods = endpoint.supportedMethods;

      /** 将 Zotero 请求委托给共享 MCP 协议处理器。 */
      init(options: McpEndpointOptions) {
        return endpoint.init(options);
      }
    };
    Zotero.Server.Endpoints[MCP_ENDPOINT_PATH] =
      EndpointClass as unknown as typeof _ZoteroTypes.Server.Endpoint;
    addon.data.mcp = { registered: true };
  } catch (error) {
    context = undefined;
    Zotero.debug(`[MinerU] MCP endpoint registration failed: ${String(error)}`);
  }
}

/** 注销 MCP endpoint 并丢弃共享查询上下文。 */
export function unregisterMcpApiEndpoint(): void {
  delete Zotero.Server.Endpoints[MCP_ENDPOINT_PATH];
  context = undefined;
  addon.data.mcp = undefined;
}

/** 为共享查询上下文创建 MCP 协议处理器。 */
function createMcpProtocolForContext(contextValue: McpQueryContext) {
  return createMcpProtocol({ context: contextValue });
}
