import { resolveAttachment } from "./attachmentResolver";
import {
  parseHeadings,
  readSection,
  searchMarkdown,
  searchBoxes,
} from "./markdownParser";
import {
  AttachmentSummary,
  CollectionSummary,
  ItemSearchInput,
  ItemSummary,
  LibrarySummary,
  MarkdownGranularity,
  MarkdownQueryError,
  ParseStatusReader,
  TagSummary,
  ZoteroItemsGateway,
  ZoteroItemLike,
} from "./types";
import { parseAttachment } from "../parseManager";
import { taskStore, type TaskRecord } from "../taskStore";
import { exportBibTeX } from "../agentSync";
import { extractItemYear } from "./itemYear";
import type { NormalizedBox } from "../domain";

/**
 * Storage interface capable of reading preferred Markdown results and parse statuses.
 */
export interface PreferredMarkdownReader extends ParseStatusReader {
  readPreferredMarkdown(ref: {
    libraryID: number;
    key: string;
  }): Promise<string>;
  readBoxes(ref: { libraryID: number; key: string }): Promise<NormalizedBox[]>;
}

/**
 * Service interface exposed by the Markdown Query API.
 */
export interface MarkdownQueryService {
  searchByTitle(input: ItemSearchInput): Promise<{
    candidates: Array<{
      item: ItemSummary;
      attachments: AttachmentSummary[];
    }>;
  }>;
  queryMarkdown(input: {
    libraryID: number;
    key: string;
    attachmentKey?: string;
    granularity?: MarkdownGranularity;
    sectionPath?: string[] | string;
    includeSubsections?: boolean;
    q?: string;
    contextParagraphs?: number;
  }): Promise<unknown>;
  triggerParse(input: {
    libraryID: number;
    key: string;
    attachmentKey?: string;
  }): Promise<unknown>;
  getTasks(): Promise<unknown>;
  getLibraries(): Promise<{ libraries: LibrarySummary[] }>;
  getCollections(input: {
    libraryID: number;
    parentKey?: string;
  }): Promise<{ libraryID: number; collections: CollectionSummary[] }>;
  getTags(input: {
    libraryID: number;
    limit?: number;
  }): Promise<{ libraryID: number; tags: TagSummary[] }>;
}

/**
 * Create a query service responsible for title search and Markdown retrieval.
 */
export function createMarkdownQueryService(deps: {
  items: ZoteroItemsGateway;
  storage: PreferredMarkdownReader;
  searchItems(input: ItemSearchInput): Promise<ZoteroItemLike[]>;
  getLibraries?(): Promise<LibrarySummary[]> | LibrarySummary[];
  getCollections?(
    libraryID: number,
  ): Promise<CollectionSummary[]> | CollectionSummary[];
  getTags?(
    libraryID: number,
    limit?: number,
  ): Promise<TagSummary[]> | TagSummary[];
}): MarkdownQueryService {
  return {
    async getLibraries() {
      if (deps.getLibraries) {
        const libraries = await deps.getLibraries();
        return { libraries };
      }
      if (typeof Zotero !== "undefined" && (Zotero as any).Libraries?.getAll) {
        const libs = (Zotero as any).Libraries.getAll();
        const libraries: LibrarySummary[] = libs.map((lib: any) => ({
          libraryID: Number(lib.id ?? lib.libraryID),
          name: lib.name || (lib.id === 1 ? "My Library" : `Group ${lib.id}`),
          type:
            lib.libraryType === "user" ? "user" : ("group" as "user" | "group"),
        }));
        return { libraries };
      }
      return {
        libraries: [{ libraryID: 1, name: "My Library", type: "user" }],
      };
    },

    async getCollections(input) {
      if (deps.getCollections) {
        let collections = await deps.getCollections(input.libraryID);
        if (input.parentKey) {
          collections = collections.filter(
            (col) => col.parentKey === input.parentKey,
          );
        }
        return { libraryID: input.libraryID, collections };
      }
      if (
        typeof Zotero !== "undefined" &&
        (Zotero as any).Collections?.getByLibrary
      ) {
        const rawCols = (Zotero as any).Collections.getByLibrary(
          input.libraryID,
        );
        let collections: CollectionSummary[] = rawCols.map((col: any) => ({
          id: Number(col.id),
          key: String(col.key),
          name: String(col.name),
          libraryID: Number(col.libraryID ?? input.libraryID),
          parentKey: col.parentKey || undefined,
          parentID: col.parentID || undefined,
        }));
        if (input.parentKey) {
          collections = collections.filter(
            (col) => col.parentKey === input.parentKey,
          );
        }
        return { libraryID: input.libraryID, collections };
      }
      return { libraryID: input.libraryID, collections: [] };
    },

    async getTags(input) {
      if (deps.getTags) {
        const tags = await deps.getTags(input.libraryID, input.limit);
        return { libraryID: input.libraryID, tags };
      }
      if (typeof Zotero !== "undefined" && (Zotero as any).Tags?.getAll) {
        const rawTags = (Zotero as any).Tags.getAll(input.libraryID);
        let tags: TagSummary[] = (Array.isArray(rawTags) ? rawTags : [])
          .map((t: any) => ({
            tag: typeof t === "string" ? t : String(t.tag || t.name || ""),
            numItems: typeof t === "object" ? Number(t.numItems) : undefined,
          }))
          .filter((t: TagSummary) => Boolean(t.tag));
        if (input.limit !== undefined && input.limit > 0) {
          tags = tags.slice(0, input.limit);
        }
        return { libraryID: input.libraryID, tags };
      }
      return { libraryID: input.libraryID, tags: [] };
    },

    async getTasks() {
      return { tasks: taskStore.getTasks().map(summarizeTask) };
    },
    async triggerParse(input) {
      const resolved = await resolveAttachment({
        libraryID: input.libraryID,
        key: input.key,
        attachmentKey: input.attachmentKey,
        items: deps.items,
        storage: deps.storage,
      });
      // Try to parse using Zotero backend. This won't wait for it to finish.
      // We don't await because it blocks the HTTP response. `force` keeps the
      // request non-interactive: an HTTP caller must never be able to open a
      // modal reparse prompt in the Zotero window.
      const item = Zotero.Items.getByLibraryAndKey(
        input.libraryID,
        resolved.attachment.key,
      );
      if (item) {
        parseAttachment(item, { force: true }).catch((e) =>
          ztoolkit.log("API Trigger Parse Error", e),
        );
      }
      return {
        status: "submitted",
        itemID: resolved.attachment.id,
        key: resolved.attachment.key,
      };
    },
    async searchByTitle(input) {
      const hasFilter = Boolean(
        input.title?.trim() ||
        input.creator?.trim() ||
        input.collection?.trim() ||
        input.tag?.trim() ||
        input.abstract?.trim() ||
        input.publication?.trim() ||
        input.citekey?.trim() ||
        input.doi?.trim() ||
        input.itemType?.trim() ||
        input.since?.trim() ||
        input.year?.trim() ||
        input.hasPdf ||
        input.parsedOnly ||
        input.limit !== undefined ||
        input.sortBy,
      );

      if (!hasFilter) {
        throw new MarkdownQueryError(
          "invalid-request",
          400,
          "Missing title or creator",
        );
      }

      const items = await deps.searchItems(input);
      let candidates = await Promise.all(
        items.map(async (item) => ({
          item: summarizeItem(item),
          attachments: item.isRegularItem()
            ? await summarizeAttachments(item, deps.items, deps.storage)
            : item.isPDFAttachment()
              ? [await summarizeAttachment(item, deps.storage)]
              : [],
        })),
      );

      if (input.parsedOnly) {
        candidates = candidates.filter((candidate) =>
          candidate.attachments.some(
            (att) => att.preciseReady || att.liteReady,
          ),
        );
      }

      return { candidates };
    },

    async queryMarkdown(input) {
      const resolved = await resolveAttachment({
        libraryID: input.libraryID,
        key: input.key,
        attachmentKey: input.attachmentKey,
        items: deps.items,
        storage: deps.storage,
      });
      const parseStatus = await deps.storage.readParseStatus({
        libraryID: resolved.attachment.libraryID,
        key: resolved.attachment.key,
      });

      let markdown: string;
      try {
        markdown = await deps.storage.readPreferredMarkdown({
          libraryID: resolved.attachment.libraryID,
          key: resolved.attachment.key,
        });
      } catch (error) {
        if (!parseStatus.preciseReady && !parseStatus.liteReady) {
          throw new MarkdownQueryError(
            "parse-result-not-found",
            404,
            "Target PDF has no available parse result",
          );
        }

        throw error;
      }

      const attachment = {
        itemID: resolved.attachment.id,
        libraryID: resolved.attachment.libraryID,
        key: resolved.attachment.key,
        fileName:
          resolved.attachment.attachmentFilename ||
          resolved.attachment.getDisplayTitle(),
        preciseReady: parseStatus.preciseReady,
        liteReady: parseStatus.liteReady,
      };

      const base = {
        item: summarizeItem(resolved.item),
        attachment,
        result: {
          mode: parseStatus.preciseReady ? "precise" : ("lite" as const),
          source: "preferred" as const,
        },
      };

      try {
        const item = Zotero.Items.getByLibraryAndKey(
          input.libraryID,
          resolved.item.key,
        );
        if (item) {
          const bibtex = await exportBibTeX(item);
          if (bibtex) {
            (base as any).bibtex = bibtex;
          }
        }
      } catch (e) {
        // ignore error
      }
      const granularity = input.granularity ?? "full";

      if (granularity === "full") {
        return { ...base, granularity, content: markdown };
      }
      if (granularity === "headings") {
        return { ...base, granularity, headings: parseHeadings(markdown) };
      }
      if (granularity === "section") {
        const section = readSection(markdown, input.sectionPath ?? [], {
          includeSubsections: input.includeSubsections,
        });
        return { ...base, granularity, ...section };
      }
      if (granularity === "search") {
        return {
          ...base,
          granularity,
          query: input.q ?? "",
          matches: searchMarkdown(
            markdown,
            input.q ?? "",
            input.contextParagraphs,
          ),
        };
      }
      if (granularity === "locate") {
        if (!parseStatus.preciseReady) {
          throw new MarkdownQueryError(
            "invalid-request",
            400,
            "Locate granularity is only available for precise parse results",
          );
        }
        const boxes = await deps.storage.readBoxes({
          libraryID: resolved.attachment.libraryID,
          key: resolved.attachment.key,
        });
        return {
          ...base,
          granularity,
          query: input.q ?? "",
          matches: searchBoxes(boxes, input.q ?? "", input.contextParagraphs),
        };
      }

      throw new MarkdownQueryError(
        "invalid-request",
        400,
        "Invalid granularity",
      );
    },
  };
}

/**
 * Extract a stable item summary for return results, including year, creator info, and academic metadata.
 */
function summarizeItem(item: ZoteroItemLike): ItemSummary {
  const summary: ItemSummary = {
    itemID: item.id,
    libraryID: item.libraryID,
    key: item.key,
    type: item.isPDFAttachment() ? "attachment" : "regular",
    title: item.getDisplayTitle() || item.getField("title"),
  };

  const year = extractYear(item);
  if (year) {
    summary.year = year;
  }
  const creators = extractCreators(item);
  if (creators.length > 0) {
    summary.creators = creators;
  }
  const itemType = extractItemType(item);
  if (itemType) {
    summary.itemType = itemType;
  }
  const publication = extractPublication(item);
  if (publication) {
    summary.publication = publication;
  }
  const citekey = extractCitekey(item);
  if (citekey) {
    summary.citekey = citekey;
  }
  const doi = extractDoi(item);
  if (doi) {
    summary.doi = doi;
  }
  return summary;
}

function extractItemType(item: ZoteroItemLike): string | undefined {
  const type =
    item.itemType ||
    (typeof item.getField === "function" ? item.getField("itemType") : "");
  return type && type !== "attachment" ? type : undefined;
}

function extractPublication(item: ZoteroItemLike): string | undefined {
  if (typeof item.getField !== "function") return undefined;
  const pub =
    item.getField("publicationTitle") || item.getField("proceedingsTitle");
  return pub ? pub.trim() : undefined;
}

function extractCitekey(item: ZoteroItemLike): string | undefined {
  if (typeof item.getField !== "function") return undefined;
  const extra = item.getField("extra") || "";
  const match = /Citation Key:\s*([^\s\n]+)/i.exec(extra);
  if (match?.[1]) {
    return match[1].trim();
  }
  try {
    const directKey = item.getField("citationKey");
    if (directKey) return directKey.trim();
  } catch {
    // ignore
  }
  return undefined;
}

function extractDoi(item: ZoteroItemLike): string | undefined {
  if (typeof item.getField !== "function") return undefined;
  const doi = item.getField("DOI");
  return doi ? doi.trim() : undefined;
}

/**
 * Extract a four-digit year from the item.
 */
function extractYear(item: ZoteroItemLike): string | undefined {
  return extractItemYear(item);
}

/**
 * Reduce a task record to the fields an HTTP client needs.
 *
 * Absolute PDF paths and per-chunk resume bookkeeping stay local: any process
 * on the machine can reach this endpoint, so it must not disclose more of the
 * library layout than necessary.
 */
function summarizeTask(task: TaskRecord) {
  return {
    id: task.id,
    attachmentID: task.attachment.id,
    libraryID: task.attachment.libraryID,
    key: task.attachment.key,
    fileName: task.attachment.fileName,
    title: task.title,
    status: task.status,
    progress: task.progress,
    detail: task.detail,
    error: task.error,
    resumeAvailable: Boolean(task.resume),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Format Zotero creators into "Last, First" or single-name representation.
 */
function extractCreators(item: ZoteroItemLike): string[] {
  if (typeof item.getCreators !== "function") {
    return [];
  }
  return item
    .getCreators()
    .map((creator) =>
      creator.name
        ? creator.name
        : [creator.lastName, creator.firstName]
            .filter((part): part is string => Boolean(part && part.trim()))
            .map((part) => part.trim())
            .join(", "),
    )
    .filter(Boolean);
}

/**
 * Generate a summary list of PDF attachments under a regular item.
 */
async function summarizeAttachments(
  item: ZoteroItemLike,
  items: ZoteroItemsGateway,
  storage: ParseStatusReader,
): Promise<AttachmentSummary[]> {
  const attachments = (await items.getAsync(item.getAttachments(false))).filter(
    (candidate) => candidate.isPDFAttachment(),
  );

  return Promise.all(
    attachments.map((attachment) => summarizeAttachment(attachment, storage)),
  );
}

/**
 * Generate a summary for a single PDF attachment, including its parse status.
 */
async function summarizeAttachment(
  attachment: ZoteroItemLike,
  storage: ParseStatusReader,
): Promise<AttachmentSummary> {
  const status = await storage.readParseStatus({
    libraryID: attachment.libraryID,
    key: attachment.key,
  });

  return {
    itemID: attachment.id,
    libraryID: attachment.libraryID,
    key: attachment.key,
    fileName: attachment.attachmentFilename || attachment.getDisplayTitle(),
    preciseReady: status.preciseReady,
    liteReady: status.liteReady,
  };
}
