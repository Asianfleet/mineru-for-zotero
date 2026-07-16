import { formatTableBoxForCopy } from "../copyFormatter";
import type { NormalizedBox } from "../domain";
import { resolveAttachment } from "./attachmentResolver";
import {
  extractMarkdownTables,
  extractMarkdownImageLinks,
  parseHeadings,
  readSection,
  readSectionGroups,
  searchMarkdown,
} from "./markdownParser";
import {
  AttachmentSummary,
  ItemSummary,
  MarkdownGranularity,
  MarkdownQueryError,
  MarkdownTableSource,
  MarkdownTableFormat,
  MarkdownTableMatchMode,
  MarkdownSectionGroup,
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
  readBoxes(ref: { libraryID: number; key: string }): Promise<NormalizedBox[]>;
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
    sectionNumber?: string;
    q?: string;
    contextParagraphs?: number;
  }): Promise<unknown>;
  queryTables(input: {
    libraryID: number;
    key: string;
    attachmentKey?: string;
    q: string;
    match?: MarkdownTableMatchMode;
    tableFormat?: MarkdownTableFormat;
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
        result: {
          mode: parseStatus.preciseReady ? "precise" : ("lite" as const),
          source: "preferred" as const,
        },
      };
      const granularity = input.granularity ?? "full";

      if (granularity === "full") {
        return { ...base, granularity, content: markdown };
      }
      if (granularity === "headings") {
        return { ...base, granularity, headings: parseHeadings(markdown) };
      }
      if (granularity === "section") {
        if (Array.isArray(input.sectionPath)) {
          const group = readExactSectionPathGroup(
            markdown,
            input.sectionPath,
            input.sectionNumber,
          );
          return { ...base, granularity, groups: [group] };
        }

        const groups = readSectionGroups(markdown, {
          sectionNumber: input.sectionNumber,
          sectionPath: input.sectionPath,
        });
        return { ...base, granularity, groups };
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

    async queryTables(input) {
      const resolved = await resolveAttachment({
        libraryID: input.libraryID,
        key: input.key,
        attachmentKey: input.attachmentKey,
        items: deps.items,
        storage: deps.storage,
      });
      const query = input.q.trim();
      if (!query) {
        throw new MarkdownQueryError("missing-query", 400, "missing-query");
      }

      const parseStatus = await deps.storage.readParseStatus({
        libraryID: resolved.attachment.libraryID,
        key: resolved.attachment.key,
      });
      const markdown = await deps.storage.readPreferredMarkdown({
        libraryID: resolved.attachment.libraryID,
        key: resolved.attachment.key,
      });
      const boxes = await readBoxesOrEmpty(deps.storage, resolved.attachment);
      const tableFormat = input.tableFormat ?? "html";
      const match = input.match ?? "both";
      const tables = buildTableResults({
        boxes,
        markdown,
        query,
        match,
        tableFormat,
      });

      return {
        item: summarizeItem(resolved.item),
        attachment: summarizeAttachmentPayload(
          resolved.attachment,
          parseStatus,
        ),
        result: {
          mode: parseStatus.preciseReady ? "precise" : ("lite" as const),
          source: "preferred" as const,
        },
        query,
        match,
        tableFormat,
        tables,
      };
    },
  };
}

interface TableQueryResult {
  rawIndex?: number;
  page?: number;
  caption?: string;
  content: unknown;
  formats?: Partial<Record<Exclude<MarkdownTableFormat, "json">, string>>;
}

/**
 * 读取 normalized boxes，读取失败时降级为空数组以保留 Markdown 表格查询能力。
 */
async function readBoxesOrEmpty(
  storage: PreferredMarkdownReader,
  attachment: ZoteroItemLike,
): Promise<NormalizedBox[]> {
  try {
    return await storage.readBoxes({
      libraryID: attachment.libraryID,
      key: attachment.key,
    });
  } catch {
    return [];
  }
}

/**
 * 从 precise boxes 与 Markdown HTML tables 构造统一的表格查询结果。
 */
function buildTableResults(input: {
  boxes: NormalizedBox[];
  markdown: string;
  query: string;
  match: MarkdownTableMatchMode;
  tableFormat: MarkdownTableFormat;
}): TableQueryResult[] {
  const normalizedQuery = normalizeTableSearchText(input.query);
  const boxTables = input.boxes
    .filter((box) => ["table", "table_body"].includes(box.type.toLowerCase()))
    .map((box) => tableResultFromBox(box, input.tableFormat));
  const markdownTables = extractMarkdownTables(input.markdown).map((table) => ({
    ...tableResultFromMarkdown(table, input.tableFormat),
  }));

  return [...boxTables, ...markdownTables].filter((table) =>
    tableMatches(table, normalizedQuery, input.match),
  );
}

/**
 * 将 normalized table box 转换为 API 表格结果，文本格式复用复制格式化逻辑。
 */
function tableResultFromBox(
  box: NormalizedBox,
  tableFormat: MarkdownTableFormat,
): TableQueryResult {
  return {
    rawIndex: box.rawIndex,
    page: box.page,
    caption: extractTableCaption(box),
    content:
      tableFormat === "json" ? box : formatTableBoxForCopy(box, tableFormat),
    formats: box.tableFormats,
  };
}

/**
 * 将 Markdown fallback table 转换为 API 表格结果，并按请求格式降级输出。
 */
function tableResultFromMarkdown(
  table: MarkdownTableSource,
  tableFormat: MarkdownTableFormat,
): TableQueryResult {
  const formats = tableFormatsFromMarkdown(table);
  return {
    rawIndex: table.rawIndex,
    page: table.page,
    caption: table.caption,
    content: markdownTableContent(table, tableFormat, formats),
    formats,
  };
}

/**
 * 为 Markdown fallback table 声明实际可用的格式。
 */
function tableFormatsFromMarkdown(
  table: MarkdownTableSource,
): Partial<Record<Exclude<MarkdownTableFormat, "json">, string>> {
  const formats: Partial<Record<Exclude<MarkdownTableFormat, "json">, string>> =
    {};
  if (table.html) {
    formats.html = table.html;
  }
  if (table.markdown?.trim()) {
    formats.markdown = table.markdown.trim();
  } else if (table.text) {
    formats.markdown = table.text;
  }
  return formats;
}

/**
 * 选择 Markdown fallback table 的返回正文，不能推导的格式退回可读文本。
 */
function markdownTableContent(
  table: MarkdownTableSource,
  tableFormat: MarkdownTableFormat,
  formats: Partial<Record<Exclude<MarkdownTableFormat, "json">, string>>,
): unknown {
  if (tableFormat === "json") {
    return {
      rawIndex: table.rawIndex,
      page: table.page,
      caption: table.caption,
      html: table.html,
      markdown: formats.markdown,
      text: table.text,
    };
  }
  if (tableFormat === "html") {
    return formats.html ?? formats.markdown ?? table.text;
  }
  return formats[tableFormat] ?? formats.markdown ?? table.text;
}

/**
 * 从 normalized table box 的 Markdown 或表格格式中提取表格标题。
 */
function extractTableCaption(box: NormalizedBox): string | undefined {
  const candidates = [
    box.markdown,
    box.tableFormats?.markdown,
    box.tableFormats?.html,
  ];
  for (const candidate of candidates) {
    const caption = extractCaptionLine(candidate ?? "");
    if (caption) {
      return caption;
    }
  }
  return undefined;
}

/**
 * 从表格文本中提取第一条 Markdown 或 HTML caption。
 */
function extractCaptionLine(value: string): string | undefined {
  const htmlCaption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(value);
  if (htmlCaption) {
    return htmlCaption[1]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Table\b.+$/i.test(line));
}

/**
 * 将表格搜索文本标准化为大小写无关、空白稳定的比较文本。
 */
function normalizeTableSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 判断表格结果是否命中指定的标题、内容或混合匹配策略。
 */
function tableMatches(
  table: TableQueryResult,
  normalizedQuery: string,
  match: MarkdownTableMatchMode,
): boolean {
  const caption = normalizeTableSearchText(table.caption ?? "");
  const content = normalizeTableSearchText(tableContentForSearch(table));
  if (match === "caption") {
    return caption.includes(normalizedQuery);
  }
  if (match === "content") {
    return content.includes(normalizedQuery);
  }
  return caption.includes(normalizedQuery) || content.includes(normalizedQuery);
}

/**
 * 提取用于搜索的表格正文，JSON 内容会序列化后参与匹配。
 */
function tableContentForSearch(table: TableQueryResult): string {
  if (typeof table.content === "string") {
    return table.content;
  }
  return JSON.stringify(table.content);
}

/**
 * 用旧 sectionPath 数组语义精确读取一个章节，并包装为分组结果。
 */
function readExactSectionPathGroup(
  markdown: string,
  sectionPath: string[],
  sectionNumber?: string,
): MarkdownSectionGroup {
  if (sectionNumber?.trim()) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      "sectionNumber and sectionPath cannot be used together",
    );
  }

  const query = sectionPath
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" / ");
  try {
    const section = readSection(markdown, sectionPath);
    return {
      query,
      kind: "section-path",
      status: "ok",
      matches: [
        {
          ...section,
          images: extractMarkdownImageLinks(section.content),
        },
      ],
      warnings: [],
    };
  } catch (error) {
    if (error instanceof MarkdownQueryError) {
      if (error.code === "section-not-found") {
        return {
          query,
          kind: "section-path",
          status: "not-found",
          matches: [],
          warnings: [],
        };
      }
      if (error.code === "ambiguous-section") {
        return {
          query,
          kind: "section-path",
          status: "ambiguous",
          matches: [],
          candidates: (
            error.details as { candidates?: MarkdownSectionGroup["candidates"] }
          )?.candidates,
          warnings: [],
        };
      }
    }

    throw error;
  }
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

/**
 * 为查询结果生成附件摘要，复用已读取的解析状态避免重复访问存储。
 */
function summarizeAttachmentPayload(
  attachment: ZoteroItemLike,
  status: { preciseReady: boolean; liteReady: boolean },
): AttachmentSummary {
  return {
    itemID: attachment.id,
    libraryID: attachment.libraryID,
    key: attachment.key,
    fileName: attachment.attachmentFilename || attachment.getDisplayTitle(),
    preciseReady: status.preciseReady,
    liteReady: status.liteReady,
  };
}
