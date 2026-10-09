import type { MarkdownImageResult } from "../markdownQuery/types";

/** MCP 内容 block 的最小结构，兼容 Zotero 运行时的旧 TypeScript 类型。 */
export type McpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** 将查询结果同时包装成结构化数据和模型可读文本。 */
export function mapQueryResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: formatValue(value) }],
    structuredContent: value,
  };
}

/** 将图片状态映射成结构化元数据和 MCP image content blocks。 */
export function mapImageResult(
  images: Array<MarkdownImageResult | ImageResult | DuplicateImageResult>,
) {
  const metadata = images.map((image) => {
    const record: {
      path: string;
      status: string;
      mime?: string;
      dataURL?: string;
    } = { path: image.path, status: image.status };
    if ("mime" in image && image.mime) record.mime = image.mime;
    return record;
  });
  const content: McpContentBlock[] = [
    { type: "text", text: formatValue({ images: metadata }) },
  ];
  for (const image of images) {
    if (image.status !== "ok" || !image.mime) continue;
    const data = image.bytes
      ? bytesToBase64(image.bytes)
      : decodeDataUrl(image.dataURL)?.data;
    if (data) content.push({ type: "image", data, mimeType: image.mime });
  }
  return { content, structuredContent: { images: metadata } };
}

/** LaTeX 图片读取器返回的带字节结果。 */
export interface ImageResult {
  path: string;
  status: string;
  mime?: string;
  dataURL?: string;
  bytes?: Uint8Array;
}

/** 标记同一请求中重复出现的图片路径。 */
export interface DuplicateImageResult {
  path: string;
  status: "duplicate-path";
}

/** 将任意查询结果格式化为可读 JSON 文本。 */
function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** 在 Zotero runtime 和 Node 测试中都可用的字节 base64 编码。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 从现有 HTTP 图片 data URL 提取 MIME 和 base64 数据。 */
function decodeDataUrl(value: string | undefined) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(value ?? "");
  return match ? { mime: match[1], data: match[2] } : undefined;
}
