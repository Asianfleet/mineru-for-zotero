import { resolveAttachment } from "./attachmentResolver";
import { parseHeadings, readSection, searchMarkdown } from "./markdownParser";
import {
  AttachmentSummary,
  ItemSummary,
  MarkdownGranularity,
  MarkdownQueryError,
  ParseStatusReader,
  ZoteroItemsGateway,
  ZoteroItemLike,
} from "./types";

/**
 * 表示可读取优先 Markdown 结果与解析状态的存储接口。
 */
export interface PreferredMarkdownReader extends ParseStatusReader {
  readPreferredMarkdown(ref: {
    libraryID: number;
    key: string;
  }): Promise<string>;
}

/**
 * 表示 Markdown Query API 对外提供的服务接口。
 */
export interface MarkdownQueryService {
  searchByTitle(input: { libraryID: number; title: string }): Promise<unknown>;
  queryMarkdown(input: {
    libraryID: number;
    key: string;
    attachmentKey?: string;
    granularity?: MarkdownGranularity;
    sectionPath?: string[] | string;
    q?: string;
    contextParagraphs?: number;
  }): Promise<unknown>;
}

/**
 * 创建负责标题检索与 Markdown 读取的查询服务。
 */
export function createMarkdownQueryService(deps: {
  items: ZoteroItemsGateway;
  storage: PreferredMarkdownReader;
  searchItemsByTitle(input: {
    libraryID: number;
    title: string;
  }): Promise<ZoteroItemLike[]>;
}): MarkdownQueryService {
  return {
    async searchByTitle(input) {
      if (!input.title.trim()) {
        throw new MarkdownQueryError("invalid-request", 400, "Missing title");
      }

      const items = await deps.searchItemsByTitle(input);
      return {
        candidates: await Promise.all(
          items.map(async (item) => ({
            item: summarizeItem(item),
            attachments: item.isRegularItem()
              ? await summarizeAttachments(item, deps.items, deps.storage)
              : item.isPDFAttachment()
                ? [await summarizeAttachment(item, deps.storage)]
                : [],
          })),
        ),
      };
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
        result: { source: "preferred" as const },
      };
      const granularity = input.granularity ?? "full";

      if (granularity === "full") {
        return { ...base, granularity, content: markdown };
      }
      if (granularity === "headings") {
        return { ...base, granularity, headings: parseHeadings(markdown) };
      }
      if (granularity === "section") {
        const section = readSection(markdown, input.sectionPath ?? []);
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

      throw new MarkdownQueryError(
        "invalid-request",
        400,
        "Invalid granularity",
      );
    },
  };
}

/**
 * 为返回结果提取稳定的条目摘要。
 */
function summarizeItem(item: ZoteroItemLike): ItemSummary {
  return {
    itemID: item.id,
    libraryID: item.libraryID,
    key: item.key,
    type: item.isPDFAttachment() ? "attachment" : "regular",
    title: item.getDisplayTitle() || item.getField("title"),
  };
}

/**
 * 为普通条目下的 PDF 附件生成摘要列表。
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
 * 为单个 PDF 附件生成包含解析状态的摘要。
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
