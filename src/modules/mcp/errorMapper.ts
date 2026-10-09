import { MarkdownQueryError } from "../markdownQuery/types";

/** MCP 适配层可以安全暴露给调用方的稳定错误。 */
export class McpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }
}

/** 将现有查询 service 错误转换为 MCP 稳定错误码和状态。 */
export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof MarkdownQueryError) {
    return new McpError(error.code, error.message, error.status, error.details);
  }
  const code = error instanceof Error ? error.message : "internal-error";
  const candidates =
    error && typeof error === "object" && "candidates" in error
      ? (error as { candidates?: unknown }).candidates
      : undefined;
  const knownCodes = new Set([
    "parse-error",
    "invalid-request",
    "api-disabled",
    "invalid-token",
    "item-not-found",
    "pdf-attachment-not-found",
    "attachment-not-found",
    "ambiguous-attachment",
    "parse-result-not-found",
    "section-not-found",
    "ambiguous-section",
    "missing-query",
    "tex-source-not-found",
    "arxiv-id-not-found",
    "arxiv-download-failed",
    "invalid-main-file",
    "ambiguous-main-file",
    "invalid-path",
    "tex-image-not-found",
  ]);
  if (knownCodes.has(code)) {
    const status =
      code === "api-disabled" || code === "invalid-token"
        ? 403
        : code.endsWith("not-found")
          ? 404
          : 400;
    return new McpError(
      code,
      code,
      status,
      candidates ? { candidates } : undefined,
    );
  }
  return new McpError("internal-error", "Unexpected internal error", 500);
}

/** 将 MCP 错误转换为客户端可读且不泄露内部细节的文本。 */
export function errorText(error: McpError): string {
  if (error.data === undefined) return `${error.code}: ${error.message}`;
  return `${error.code}: ${error.message}\n${JSON.stringify(error.data)}`;
}
