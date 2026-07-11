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
}

/**
 * 表示按标题路径读取出的章节内容。
 */
export interface MarkdownSectionResult {
  heading: MarkdownHeading;
  content: string;
}

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
