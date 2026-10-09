import type { McpQueryContext } from "./services";
import { McpError } from "./errorMapper";
import {
  mapImageResult,
  mapQueryResult,
  McpContentBlock,
} from "./resultMapper";

/** MCP 工具描述的最小结构，避免引入 Node 专用 SDK。 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 单次 MCP 工具调用返回的 result 结构。 */
export interface McpToolResult {
  content: McpContentBlock[];
  structuredContent: unknown;
  isError?: boolean;
}

const identifiers = {
  type: "object",
  properties: {
    libraryId: { type: "integer" },
    itemKey: { type: "string" },
  },
  required: ["libraryId", "itemKey"],
  additionalProperties: false,
} as const;

/** 返回 MCP 客户端可发现的 MinerU 查询工具元数据。 */
export function listMcpTools(): McpToolDefinition[] {
  return [
    {
      name: "zotero_search_items",
      description: "Search Zotero items by title and show PDF parse status.",
      inputSchema: {
        type: "object",
        properties: {
          libraryId: { type: "integer" },
          title: { type: "string" },
        },
        required: ["libraryId", "title"],
        additionalProperties: false,
      },
    },
    {
      name: "mineru_read_markdown",
      description: "Read a parsed PDF Markdown result.",
      inputSchema: {
        ...identifiers,
        properties: {
          ...identifiers.properties,
          attachmentKey: { type: "string" },
          granularity: { enum: ["full", "headings", "section", "search"] },
          sectionNumber: { type: "string" },
          sectionPath: { type: "array", items: { type: "string" } },
          query: { type: "string" },
          contextParagraphs: { type: "integer", minimum: 0 },
        },
      },
    },
    {
      name: "mineru_query_markdown_table",
      description: "Find tables in a parsed PDF Markdown result.",
      inputSchema: {
        ...identifiers,
        properties: {
          ...identifiers.properties,
          attachmentKey: { type: "string" },
          query: { type: "string" },
          match: { enum: ["caption", "content", "both", "caption-exact"] },
          tableFormat: { enum: ["html", "markdown", "tsv", "latex", "json"] },
        },
        required: ["libraryId", "itemKey", "query"],
      },
    },
    {
      name: "mineru_get_markdown_image",
      description: "Read verified images referenced by parsed Markdown.",
      inputSchema: {
        ...identifiers,
        properties: {
          ...identifiers.properties,
          attachmentKey: { type: "string" },
          paths: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["libraryId", "itemKey", "paths"],
      },
    },
    {
      name: "mineru_fetch_latex",
      description:
        "Read or download the cached arXiv LaTeX source for an item.",
      inputSchema: {
        ...identifiers,
        properties: {
          ...identifiers.properties,
          refresh: { type: "boolean" },
          mainFile: { type: "string" },
        },
      },
    },
    {
      name: "mineru_read_latex",
      description: "Read headings, sections, searches, or full LaTeX source.",
      inputSchema: {
        ...identifiers,
        properties: {
          ...identifiers.properties,
          granularity: { enum: ["full", "headings", "section", "search"] },
          sectionPath: { type: "string" },
          query: { type: "string" },
          contextParagraphs: { type: "integer", minimum: 0 },
        },
      },
    },
    {
      name: "mineru_query_latex_table",
      description: "Find raw LaTeX tables by caption, label, or content.",
      inputSchema: {
        ...identifiers,
        properties: { ...identifiers.properties, query: { type: "string" } },
        required: ["libraryId", "itemKey", "query"],
      },
    },
    {
      name: "mineru_get_latex_image",
      description: "Read verified images from a cached LaTeX source archive.",
      inputSchema: {
        ...identifiers,
        properties: {
          ...identifiers.properties,
          paths: { type: "array", items: { type: "string" }, minItems: 1 },
        },
        required: ["libraryId", "itemKey", "paths"],
      },
    },
  ];
}

/** 根据工具名校验参数并调用对应的现有查询 service。 */
export async function callMcpTool(
  name: string,
  rawArguments: unknown,
  context: McpQueryContext,
): Promise<McpToolResult> {
  const args = objectArguments(rawArguments);
  switch (name) {
    case "zotero_search_items":
      return mapQueryResult(
        await context.markdown.searchByTitle({
          libraryID: integer(args.libraryId, "libraryId"),
          title: stringValue(args.title, "title"),
        }),
      );
    case "mineru_read_markdown": {
      const libraryID = integer(args.libraryId, "libraryId");
      const key = stringValue(args.itemKey, "itemKey");
      const attachmentKey = optionalString(args.attachmentKey);
      const granularity = optionalEnum(args.granularity, [
        "full",
        "headings",
        "section",
        "search",
      ]);
      const requestedSectionPath = sectionPath(args.sectionPath);
      const sectionNumber = optionalString(args.sectionNumber);
      const query = optionalString(args.query);
      const contextParagraphs = optionalNonNegativeInteger(
        args.contextParagraphs,
      );
      return mapQueryResult(
        await context.markdown.queryMarkdown(
          omitUndefined({
            libraryID,
            key,
            attachmentKey,
            granularity,
            sectionPath: requestedSectionPath,
            sectionNumber,
            q: query,
            contextParagraphs,
          }),
        ),
      );
    }
    case "mineru_query_markdown_table":
      return mapQueryResult(
        await context.markdown.queryTables({
          libraryID: integer(args.libraryId, "libraryId"),
          key: stringValue(args.itemKey, "itemKey"),
          attachmentKey: optionalString(args.attachmentKey),
          q: stringValue(args.query, "query"),
          match: optionalEnum(args.match, [
            "caption",
            "content",
            "both",
            "caption-exact",
          ]),
          tableFormat: optionalEnum(args.tableFormat, [
            "html",
            "markdown",
            "tsv",
            "latex",
            "json",
          ]),
        }),
      );
    case "mineru_get_markdown_image": {
      const paths = stringArray(args.paths, "paths");
      const uniquePaths = [...new Set(paths)];
      const readResult = await context.markdown.readImages({
        libraryID: integer(args.libraryId, "libraryId"),
        key: stringValue(args.itemKey, "itemKey"),
        attachmentKey: optionalString(args.attachmentKey),
        path: uniquePaths.join(","),
      });
      const seen = new Set<string>();
      const images = paths.map((path) => {
        if (seen.has(path)) return { path, status: "duplicate-path" as const };
        seen.add(path);
        return (
          readResult.images.find((image) => image.path === path) ?? {
            path,
            status: "not-found" as const,
          }
        );
      });
      return mapImageResult(images);
    }
    case "mineru_fetch_latex": {
      const libraryID = integer(args.libraryId, "libraryId");
      const key = stringValue(args.itemKey, "itemKey");
      const refresh = optionalBoolean(args.refresh, "refresh") ?? false;
      const mainFile = optionalString(args.mainFile);
      return mapQueryResult(
        await context.fetchLatex({ libraryID, key, refresh, mainFile }),
      );
    }
    case "mineru_read_latex":
      return mapQueryResult(
        await context.latex.read({
          libraryID: integer(args.libraryId, "libraryId"),
          key: stringValue(args.itemKey, "itemKey"),
          granularity: optionalEnum(args.granularity, [
            "full",
            "headings",
            "section",
            "search",
          ]),
          sectionPath: optionalString(args.sectionPath),
          query: optionalString(args.query),
          contextParagraphs: optionalNonNegativeInteger(args.contextParagraphs),
        }),
      );
    case "mineru_query_latex_table":
      return mapQueryResult(
        await context.latex.table({
          libraryID: integer(args.libraryId, "libraryId"),
          key: stringValue(args.itemKey, "itemKey"),
          query: stringValue(args.query, "query"),
        }),
      );
    case "mineru_get_latex_image":
      return mapImageResult(
        await context.readLatexImages({
          libraryID: integer(args.libraryId, "libraryId"),
          key: stringValue(args.itemKey, "itemKey"),
          paths: stringArray(args.paths, "paths"),
        }),
      );
    default:
      throw new McpError("unknown-tool", `Unknown tool: ${name}`, 404);
  }
}

/** 检查工具参数为普通对象，拒绝数组或空值。 */
function objectArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpError("invalid-params", "Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

/** 检查必填数字参数为整数。 */
function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new McpError("invalid-params", `Invalid ${name}`);
  }
  return value;
}

/** 读取非空的必填字符串参数。 */
function stringValue(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new McpError("invalid-params", `Missing ${name}`);
  }
  return value.trim();
}

/** 将空白的可选字符串视为未提供。 */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** 检查可选上下文段落数为非负整数。 */
function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new McpError("invalid-params", "Invalid contextParagraphs");
  }
  return value;
}

/** 检查可选布尔参数，避免把错误值静默转换成默认值。 */
function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new McpError("invalid-params", `Invalid ${name}`);
  }
  return value;
}

/** 校验可选参数属于明确的工具枚举。 */
function optionalEnum<T extends string>(
  value: unknown,
  values: T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new McpError("invalid-params", "Invalid enum value");
  }
  return value as T;
}

/** 将 MCP 的章节路径转换为 Markdown service 使用的路径数组。 */
function sectionPath(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return stringArray(value, "sectionPath");
}

/** 检查图片或章节路径数组不含空白元素。 */
function stringArray(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((part) => typeof part !== "string" || !part.trim())
  ) {
    throw new McpError("invalid-params", `Invalid ${name}`);
  }
  return value.map((part) => (part as string).trim());
}

/** 删除可选参数中的 undefined，保持 query service 输入简洁稳定。 */
function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<
      T[K],
      undefined
    >;
  };
}
