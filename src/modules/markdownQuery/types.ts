import type { TableCopyTextFormat } from "../domain";

/**
 * Markdown Query API 使用的标准错误码集合。
 */
export type MarkdownQueryErrorCode =
  | "api-disabled"
  | "invalid-token"
  | "invalid-request"
  | "item-not-found"
  | "pdf-attachment-not-found"
  | "attachment-not-found"
  | "ambiguous-attachment"
  | "parse-result-not-found"
  | "section-not-found"
  | "ambiguous-section"
  | "missing-query"
  | "internal-error";

/**
 * 封装 Markdown Query API 的错误码、HTTP 状态与附加细节。
 */
export class MarkdownQueryError extends Error {
  constructor(
    public readonly code: MarkdownQueryErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "MarkdownQueryError";
  }
}

/**
 * 表示一个带层级路径信息的 Markdown 标题。
 */
export interface MarkdownHeading {
  level: number;
  title: string;
  path: string[];
  line: number;
  number?: string;
}

/**
 * 表示按标题路径读取出的章节内容。
 */
export interface MarkdownSectionResult {
  heading: MarkdownHeading;
  content: string;
}

/**
 * 表示章节分组查询的输入类型。
 */
export type MarkdownSectionQueryKind =
  | "section-number"
  | "section-number-range"
  | "section-path";

/**
 * 表示章节分组查询的匹配状态。
 */
export type MarkdownSectionGroupStatus =
  | "ok"
  | "not-found"
  | "ambiguous"
  | "invalid-range";

/**
 * 表示章节分组查询中命中的单个章节及其图片引用。
 */
export interface MarkdownSectionMatch extends MarkdownSectionResult {
  images: string[];
}

/**
 * 表示按章节号、章节号范围或模糊路径分组后的查询结果。
 */
export interface MarkdownSectionGroup {
  query: string;
  kind: MarkdownSectionQueryKind;
  status: MarkdownSectionGroupStatus;
  matches: MarkdownSectionMatch[];
  candidates?: MarkdownHeading[];
  warnings?: string[];
}

/**
 * 表示从 Markdown 中提取出的表格来源。
 */
export interface MarkdownTableSource {
  rawIndex?: number;
  page?: number;
  caption?: string;
  html?: string;
  markdown?: string;
  tsv?: string;
  latex?: string;
  text: string;
}

/**
 * 表示单个 Markdown 图片读取请求的状态。
 */
export type MarkdownImageStatus = "ok" | "not-found" | "invalid-path";

/**
 * 表示 Markdown Query API 返回的单个图片读取结果。
 */
export interface MarkdownImageResult {
  path: string;
  status: MarkdownImageStatus;
  mime?: string;
  dataURL?: string;
  bytes?: Uint8Array;
}

/**
 * 表示 Markdown Query API 图片读取响应。
 */
export interface MarkdownImageQueryResult {
  images: MarkdownImageResult[];
}

/**
 * 表示表格查询匹配标题、内容、两者，或精确标题表号。
 */
export type MarkdownTableMatchMode =
  | "caption"
  | "content"
  | "both"
  | "caption-exact";

/**
 * 表示表格查询返回内容时使用的格式。
 */
export type MarkdownTableFormat = TableCopyTextFormat | "json";

/**
 * 表示一个带前后文的 Markdown 段落搜索命中。
 */
export interface MarkdownSearchMatch {
  paragraphIndex: number;
  context: string;
  before: string[];
  hit: string;
  after: string[];
}

/**
 * 表示 Markdown Query API 解析附件时依赖的最小 Zotero item 视图。
 */
export interface ZoteroItemLike {
  id: number;
  key: string;
  libraryID: number;
  dateAdded?: string;
  attachmentFilename?: string;
  parentItemID?: number | false;
  isRegularItem(): boolean;
  isPDFAttachment(): boolean;
  getDisplayTitle(): string;
  getField(field: string): string;
  getAttachments(includeTrashed?: boolean): number[];
  getBestAttachments(): Promise<ZoteroItemLike[]>;
}

/**
 * 表示 Attachment Resolver 读取 Zotero items 所需的最小网关接口。
 */
export interface ZoteroItemsGateway {
  getAsync(ids: number[]): Promise<ZoteroItemLike[]>;
  getByLibraryAndKeyAsync(
    libraryID: number,
    key: string,
  ): Promise<ZoteroItemLike | false>;
}

/**
 * 表示一个 PDF 附件候选项的评分与状态信息。
 */
export interface AttachmentCandidate {
  itemID: number;
  libraryID: number;
  key: string;
  fileName: string;
  preciseReady: boolean;
  liteReady: boolean;
  score: number;
  reasons: string[];
}

/**
 * 表示附件解析完成后的父条目、目标附件与可选候选列表。
 */
export interface ResolvedAttachment {
  item: ZoteroItemLike;
  attachment: ZoteroItemLike;
  candidates?: AttachmentCandidate[];
}

/**
 * 表示读取附件解析状态所需的最小存储接口。
 */
export interface ParseStatusReader {
  readParseStatus(ref: {
    libraryID: number;
    key: string;
  }): Promise<{ preciseReady: boolean; liteReady: boolean }>;
}

/**
 * 表示 Markdown 查询返回内容的粒度。
 */
export type MarkdownGranularity = "full" | "headings" | "section" | "search";

/**
 * 表示查询结果中的条目摘要信息。
 */
export interface ItemSummary {
  itemID: number;
  libraryID: number;
  key: string;
  type: "regular" | "attachment";
  title: string;
}

/**
 * 表示查询结果中的附件摘要信息。
 */
export interface AttachmentSummary {
  itemID: number;
  libraryID: number;
  key: string;
  fileName: string;
  preciseReady?: boolean;
  liteReady?: boolean;
}
