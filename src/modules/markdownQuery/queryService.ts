import { formatTableBoxForCopy } from "../copyFormatter";
import type { MinerUImageReadResult, NormalizedBox } from "../domain";
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
  MarkdownImageQueryResult,
  MarkdownImageResult,
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
  readImage(
    ref: { libraryID: number; key: string },
    path: string,
  ): Promise<MinerUImageReadResult | null>;
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
  readImages(input: {
    libraryID: number;
    key: string;
    attachmentKey?: string;
    path: string;
  }): Promise<MarkdownImageQueryResult>;
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

    async readImages(input) {
      const resolved = await resolveAttachment({
        libraryID: input.libraryID,
        key: input.key,
        attachmentKey: input.attachmentKey,
        items: deps.items,
        storage: deps.storage,
      });
      const ref = {
        libraryID: resolved.attachment.libraryID,
        key: resolved.attachment.key,
      };
      const paths = splitCsv(input.path);
      if (paths.length === 0) {
        throw new MarkdownQueryError(
          "invalid-request",
          400,
          "Missing image path",
        );
      }
      const images = await Promise.all(
        paths.map((path) => readImageResult(deps.storage, ref, path)),
      );
      return { images };
    },
  };
}

/**
 * 读取单个图片并转换为 Markdown Query API 的状态结果。
 */
async function readImageResult(
  storage: PreferredMarkdownReader,
  ref: { libraryID: number; key: string },
  path: string,
): Promise<MarkdownImageResult> {
  if (!isMarkdownImagePath(path)) {
    return { path, status: "invalid-path" };
  }

  const image = await storage.readImage(ref, path);
  if (!image) {
    return { path, status: "not-found" };
  }

  return {
    path,
    status: "ok",
    mime: image.mime,
    dataURL: image.dataURL,
    bytes: image.bytes,
  };
}

interface TableQueryResult {
  rawIndex?: number;
  page?: number;
  caption?: string;
  content: unknown;
  formats?: Partial<Record<Exclude<MarkdownTableFormat, "json">, string>>;
}

interface TableQueryCandidate extends TableQueryResult {
  searchContent: string;
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
  const boxTables = tableResultsFromBoxes(input.boxes, input.tableFormat);
  const markdownTables = extractMarkdownTables(input.markdown).map((table) => ({
    ...tableResultFromMarkdown(table, input.tableFormat),
  }));
  const candidateTables = boxTables.length > 0 ? boxTables : markdownTables;

  return candidateTables
    .filter((table) => tableMatches(table, normalizedQuery, input.match))
    .map(stripTableSearchFields);
}

/**
 * 从 normalized boxes 构造表格候选，并绑定同页相邻的独立表格标题。
 */
function tableResultsFromBoxes(
  boxes: NormalizedBox[],
  tableFormat: MarkdownTableFormat,
): TableQueryCandidate[] {
  const usedCaptionBoxes = new Set<NormalizedBox>();
  return boxes
    .map((box, index) => {
      if (!isTableBox(box)) {
        return null;
      }

      const explicitCaption = extractTableCaption(box);
      const adjacentCaption = explicitCaption
        ? undefined
        : findAdjacentTableCaption(boxes, index, usedCaptionBoxes);
      if (adjacentCaption) {
        usedCaptionBoxes.add(adjacentCaption);
      }

      return tableResultFromBox(
        box,
        tableFormat,
        explicitCaption ??
          (adjacentCaption ? extractTableCaption(adjacentCaption) : undefined),
      );
    })
    .filter((table): table is TableQueryCandidate => table !== null);
}

/**
 * 将 normalized table box 转换为 API 表格结果，文本格式复用复制格式化逻辑。
 */
function tableResultFromBox(
  box: NormalizedBox,
  tableFormat: MarkdownTableFormat,
  caption?: string,
): TableQueryCandidate {
  return {
    rawIndex: box.rawIndex,
    page: box.page,
    caption: caption ?? extractTableCaption(box),
    content:
      tableFormat === "json" ? box : formatTableBoxForCopy(box, tableFormat),
    formats: box.tableFormats,
    searchContent: tableBoxSearchContent(box),
  };
}

/**
 * 将 Markdown fallback table 转换为 API 表格结果，并按请求格式降级输出。
 */
function tableResultFromMarkdown(
  table: MarkdownTableSource,
  tableFormat: MarkdownTableFormat,
): TableQueryCandidate {
  const formats = tableFormatsFromMarkdown(table);
  return {
    rawIndex: table.rawIndex,
    page: table.page,
    caption: table.caption,
    content: markdownTableContent(table, tableFormat, formats),
    formats,
    searchContent: [
      table.text,
      table.markdown,
      table.html,
      formats.markdown,
      formats.html,
    ].join("\n"),
  };
}

/**
 * 判断 normalized box 是否表示可查询的表格主体。
 */
function isTableBox(box: NormalizedBox): boolean {
  return ["table", "table_body"].includes(box.type.toLowerCase());
}

/**
 * 判断 normalized box 是否表示独立表格标题。
 */
function isTableCaptionBox(box: NormalizedBox): boolean {
  return box.type.toLowerCase() === "table_caption";
}

/**
 * 查找同页相邻且尚未绑定的独立表格标题，优先绑定后置 caption。
 */
function findAdjacentTableCaption(
  boxes: NormalizedBox[],
  tableIndex: number,
  usedCaptionBoxes: Set<NormalizedBox>,
): NormalizedBox | undefined {
  const table = boxes[tableIndex];
  const next = boxes[tableIndex + 1];
  if (isUsableAdjacentCaption(table, next, usedCaptionBoxes)) {
    return next;
  }

  const previous = boxes[tableIndex - 1];
  if (isUsableAdjacentCaption(table, previous, usedCaptionBoxes)) {
    return previous;
  }

  return undefined;
}

/**
 * 判断候选 box 是否可作为当前表格的同页相邻标题。
 */
function isUsableAdjacentCaption(
  table: NormalizedBox,
  candidate: NormalizedBox | undefined,
  usedCaptionBoxes: Set<NormalizedBox>,
): candidate is NormalizedBox {
  return Boolean(
    candidate &&
    candidate.page === table.page &&
    isTableCaptionBox(candidate) &&
    !usedCaptionBoxes.has(candidate) &&
    extractTableCaption(candidate),
  );
}

/**
 * 构造与返回格式无关的稳定表格正文搜索内容。
 */
function tableBoxSearchContent(box: NormalizedBox): string {
  return [
    box.markdown,
    box.tableFormats?.markdown,
    box.tableFormats?.html,
    box.tableFormats?.tsv,
  ].join("\n");
}

/**
 * 移除仅供服务端匹配使用的内部搜索字段，避免污染 API 输出。
 */
function stripTableSearchFields(table: TableQueryCandidate): TableQueryResult {
  const { searchContent: _searchContent, ...result } = table;
  return result;
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
    return decodeHtmlEntities(
      htmlCaption[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Table\b.+$/i.test(line));
}

/**
 * 解码 caption 查询所需的基础 HTML entity，保证搜索词与可见文本一致。
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
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
  table: TableQueryCandidate,
  normalizedQuery: string,
  match: MarkdownTableMatchMode,
): boolean {
  const caption = normalizeTableSearchText(table.caption ?? "");
  const content = normalizeTableSearchText(table.searchContent);
  if (match === "caption-exact") {
    return tableCaptionNumberMatches(table.caption ?? "", normalizedQuery);
  }
  if (match === "caption") {
    return caption.includes(normalizedQuery);
  }
  if (match === "content") {
    return content.includes(normalizedQuery);
  }
  return caption.includes(normalizedQuery) || content.includes(normalizedQuery);
}

/**
 * 判断 caption 是否包含与查询完全一致的表号 token。
 */
function tableCaptionNumberMatches(
  caption: string,
  normalizedQuery: string,
): boolean {
  const tableNumber = extractNormalizedTableNumber(normalizedQuery);
  if (!tableNumber) {
    return false;
  }

  const normalizedCaption = normalizeTableSearchText(caption);
  return normalizedCaption.split(" ").some((part, index, parts) => {
    return part === "table" && parts[index + 1] === tableNumber;
  });
}

/**
 * 从已标准化的查询中提取单一表号，非表号查询不参与精确匹配。
 */
function extractNormalizedTableNumber(
  normalizedQuery: string,
): string | undefined {
  const match = /^table ([\p{N}]+(?:[./][\p{N}]+)*)$/u.exec(normalizedQuery);
  return match?.[1];
}

/**
 * 将逗号分隔参数拆为非空查询项。
 */
function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 判断图片路径是否限定在 MinerU Markdown 的 images/ 相对目录内。
 */
function isMarkdownImagePath(path: string): boolean {
  if (path.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return false;
  }

  const withoutAnchor = path.split("#", 1)[0] ?? "";
  const withoutQuery = withoutAnchor.split("?", 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    decoded = withoutQuery;
  }

  if (decoded.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    return false;
  }

  const normalized = decoded.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized.startsWith("images/")) {
    return false;
  }

  const parts = normalized.split("/");
  return !parts.some((part) => !part || part === "." || part === "..");
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
