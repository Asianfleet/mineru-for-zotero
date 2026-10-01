/**
 * Standard error codes used by the Markdown Query API.
 */
export type MarkdownQueryErrorCode =
  | "api-disabled"
  | "invalid-request"
  | "item-not-found"
  | "pdf-attachment-not-found"
  | "attachment-not-found"
  | "collection-not-found"
  | "ambiguous-attachment"
  | "parse-result-not-found"
  | "section-not-found"
  | "ambiguous-section"
  | "missing-query"
  | "internal-error";

/**
 * Encapsulate error code, HTTP status, and additional details for the Markdown Query API.
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
 * Markdown heading with hierarchical path information.
 */
export interface MarkdownHeading {
  level: number;
  title: string;
  path: string[];
  line: number;
}

/**
 * Section content retrieved by heading path.
 */
export interface MarkdownSectionResult {
  heading: MarkdownHeading;
  content: string;
}

/**
 * Search hit in a Markdown paragraph with surrounding context.
 */
export interface MarkdownSearchMatch {
  paragraphIndex: number;
  context: string;
  before: string[];
  hit: string;
  after: string[];
}

/**
 * Represents a match found within precise layout boxes, including page and bounding box details.
 */
export interface MarkdownLocateMatch {
  boxIndex: number;
  page: number;
  type: string;
  hit: string;
  context: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Represents a Zotero library summary.
 */
export interface LibrarySummary {
  libraryID: number;
  name: string;
  type: "user" | "group";
}

/**
 * Represents a Zotero collection summary.
 */
export interface CollectionSummary {
  id: number;
  key: string;
  name: string;
  libraryID: number;
  parentKey?: string;
  parentID?: number | false;
}

/**
 * Represents a Zotero tag summary.
 */
export interface TagSummary {
  tag: string;
  numItems?: number;
}

/**
 * Combined query criteria permitted when searching items.
 */
export interface ItemSearchInput {
  libraryID: number;
  title?: string;
  creator?: string;
  /** Four-digit year filtered by item date field prefix. */
  year?: string;
  tag?: string;
  collection?: string;
  abstract?: string;
  publication?: string;
  citekey?: string;
  doi?: string;
  itemType?: string;
  since?: string;
  hasPdf?: boolean;
  parsedOnly?: boolean;
  sortBy?: "dateAdded" | "dateModified" | "title" | "year";
  sortOrder?: "asc" | "desc";
  limit?: number;
}

/**
 * Minimal view of a Zotero creator, compatible with single-name fields.
 */
export interface CreatorLike {
  firstName?: string;
  lastName?: string;
  name?: string;
}

/**
 * Minimal Zotero item view required for attachment resolution in the Markdown Query API.
 */
export interface ZoteroItemLike {
  id: number;
  key: string;
  libraryID: number;
  dateAdded?: string;
  dateModified?: string;
  itemType?: string;
  attachmentFilename?: string;
  parentItemID?: number | false;
  isRegularItem(): boolean;
  isPDFAttachment(): boolean;
  getDisplayTitle(): string;
  getField(field: string): string;
  getAttachments(includeTrashed?: boolean): number[];
  getBestAttachments(): Promise<ZoteroItemLike[]>;
  getCreators?(): CreatorLike[];
}

/**
 * Minimal gateway interface for the Attachment Resolver to fetch Zotero items.
 */
export interface ZoteroItemsGateway {
  getAsync(ids: number[]): Promise<ZoteroItemLike[]>;
  getByLibraryAndKeyAsync(
    libraryID: number,
    key: string,
  ): Promise<ZoteroItemLike | false>;
}

/**
 * Scoring and status information for a candidate PDF attachment.
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
 * Parent item, target attachment, and optional candidate list after attachment resolution.
 */
export interface ResolvedAttachment {
  item: ZoteroItemLike;
  attachment: ZoteroItemLike;
  candidates?: AttachmentCandidate[];
}

/**
 * Minimal storage interface for reading attachment parse statuses.
 */
export interface ParseStatusReader {
  readParseStatus(ref: {
    libraryID: number;
    key: string;
  }): Promise<{ preciseReady: boolean; liteReady: boolean }>;
}

/**
 * Content granularity returned by Markdown queries.
 */
export type MarkdownGranularity =
  | "full"
  | "headings"
  | "section"
  | "search"
  | "locate";

/**
 * Summary information for an item in query results.
 */
export interface ItemSummary {
  itemID: number;
  libraryID: number;
  key: string;
  type: "regular" | "attachment";
  title: string;
  /** Four-digit year in item date field; omitted when absent. */
  year?: string;
  /** Formatted creator list; omitted when absent or empty. */
  creators?: string[];
  itemType?: string;
  publication?: string;
  citekey?: string;
  doi?: string;
}

/**
 * Summary information for an attachment in query results.
 */
export interface AttachmentSummary {
  itemID: number;
  libraryID: number;
  key: string;
  fileName: string;
  preciseReady?: boolean;
  liteReady?: boolean;
}
