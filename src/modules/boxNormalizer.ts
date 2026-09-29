import type { MinerUBoxType, NormalizedBox } from "./domain";

interface RawPage {
  pageNo?: number;
  page_idx?: number;
  page_size?: number[];
  page_width?: number;
  page_height?: number;
  width?: number;
  height?: number;
  blocks?: RawBlock[];
  para_blocks?: RawBlock[];
  layout_dets?: RawBlock[];
  discarded_blocks?: RawBlock[];
}

interface RawBlock {
  type?: string;
  block_type?: string;
  category_type?: string;
  index?: number;
  bbox?: number[];
  poly?: number[];
  markdown?: string;
  text?: string;
  content?: unknown;
  html?: string;
  latex?: string;
  formula?: string;
  image_path?: string;
  img_path?: string;
  blocks?: RawBlock[];
  lines?: Array<{ spans?: RawSpan[] }>;
}

interface RawSpan {
  type?: string;
  content?: unknown;
  text?: string;
  markdown?: string;
  html?: string;
  latex?: string;
  tsv?: string;
  table_body?: string;
  image_path?: string;
}

/** Middle JSON 2.0 visual containers that own exactly one body child. */
const V2_VISUAL_CONTAINERS = new Set(["image", "table", "chart", "code"]);

/** Middle JSON 2.0 structural containers whose text children become boxes. */
const V2_STRUCTURE_CONTAINERS = new Set(["list", "index"]);

/** Middle JSON 2.0 body block types. */
const V2_BODY_TYPES = new Set([
  "image_body",
  "table_body",
  "chart_body",
  "code_body",
  "algorithm_body",
]);

/** Middle JSON 2.0 annotation block types (caption / footnote). */
const V2_ANNOTATION_TYPES = new Set([
  "image_caption",
  "image_footnote",
  "table_caption",
  "table_footnote",
  "chart_caption",
  "chart_footnote",
  "code_caption",
  "code_footnote",
]);

export function normalizeMinerUBoxes(result: unknown): NormalizedBox[] {
  return isDocumentV2(result)
    ? normalizeDocumentV2(result as { pages?: V2Page[] })
    : normalizeLegacy(result);
}

// ── Middle JSON 2.0 (docvortex) ─────────────────────────────────────

interface V2Page {
  page_idx?: number;
  blocks?: V2Block[];
}

interface V2Block extends RawBlock {
  content?: unknown;
}

function isDocumentV2(result: unknown): boolean {
  const schema = String(
    (result as { schema?: unknown } | null | undefined)?.schema ?? "",
  ).toLowerCase();
  return schema.startsWith("docvortex.");
}

function normalizeDocumentV2(result: { pages?: V2Page[] }): NormalizedBox[] {
  const boxes: NormalizedBox[] = [];
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  for (const page of pages) {
    const pageNumber = getPageNumber(page as RawPage);
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const block of blocks) {
      walkV2Block(block, pageNumber, boxes);
    }
  }
  return boxes;
}

function walkV2Block(
  block: V2Block,
  pageNumber: number,
  boxes: NormalizedBox[],
): void {
  const raw = rawType(block);
  if (V2_VISUAL_CONTAINERS.has(raw)) {
    emitV2VisualContainer(block, normalizeType(raw), pageNumber, boxes);
    return;
  }
  const children = getV2ChildBlocks(block);
  if (
    children.length > 0 &&
    V2_STRUCTURE_CONTAINERS.has(raw) &&
    children.some((child) => getBlockBbox(child))
  ) {
    for (const child of children) {
      walkV2Block(child, pageNumber, boxes);
    }
    return;
  }
  emitV2LeafBox(block, normalizeType(raw), pageNumber, boxes);
}

function rawType(block: V2Block): string {
  return String(block.type ?? "")
    .trim()
    .toLowerCase();
}

function emitV2VisualContainer(
  block: V2Block,
  type: MinerUBoxType,
  pageNumber: number,
  boxes: NormalizedBox[],
): void {
  const bbox = getBlockBbox(block);
  if (!bbox) {
    return;
  }
  const children = getV2ChildBlocks(block);
  const body = children.find((child) => V2_BODY_TYPES.has(rawType(child)));
  const annotations = children.filter((child) =>
    V2_ANNOTATION_TYPES.has(rawType(child)),
  );
  const annotationText = annotations
    .map((child) => getV2BlockText(child))
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
  const bodyText = body ? getV2BlockText(body).trim() : "";
  const markdown = [bodyText, annotationText].filter(Boolean).join("\n");
  const imagePath = body ? getBlockImagePath(body) : getBlockImagePath(block);
  const box: NormalizedBox = {
    rawIndex: boxes.length,
    sourceIndex: getSourceIndex(block),
    page: pageNumber,
    type,
    bbox: normalizedBboxFromV2(bbox),
    markdown,
    formula: null,
  };
  if (imagePath) {
    box.imagePath = imagePath;
  }
  if (type === "table") {
    const tableFormats = getV2TableFormats(body, markdown);
    if (tableFormats) {
      box.tableFormats = tableFormats;
    }
  }
  boxes.push(box);
}

function emitV2LeafBox(
  block: V2Block,
  type: MinerUBoxType,
  pageNumber: number,
  boxes: NormalizedBox[],
): void {
  const bbox = getBlockBbox(block);
  if (!bbox) {
    return;
  }
  const markdown = getV2BlockText(block);
  const imagePath = getBlockImagePath(block);
  const box: NormalizedBox = {
    rawIndex: boxes.length,
    sourceIndex: getSourceIndex(block),
    page: pageNumber,
    type,
    bbox: normalizedBboxFromV2(bbox),
    markdown,
    formula: isFormulaType(type) ? getV2Formula(block, markdown) : null,
  };
  if (imagePath) {
    box.imagePath = imagePath;
  }
  boxes.push(box);
}

function normalizedBboxFromV2(bbox: [number, number, number, number]) {
  const [x1, y1, x2, y2] = bbox;
  return {
    x: clamp01(x1),
    y: clamp01(y1),
    width: clamp01(x2 - x1),
    height: clamp01(y2 - y1),
  };
}

function getV2Formula(block: V2Block, markdown: string): string | null {
  const content = block.content;
  const value = typeof content === "string" ? content : markdown;
  const formula = String(value ?? "").trim();
  return formula ? formula : null;
}

function getV2TableFormats(
  body: V2Block | undefined,
  markdown: string,
): NonNullable<NormalizedBox["tableFormats"]> | undefined {
  const rawContent =
    typeof body?.content === "string" ? body.content : undefined;
  return compactTableFormats({
    latex: normalizeFormatText(body?.latex),
    markdown: normalizeFormatText(body?.markdown ?? markdown),
    html: normalizeFormatText(body?.html ?? rawContent),
    tsv: normalizeFormatText(readRawField(body, "tsv")),
  });
}

function getV2ChildBlocks(block: V2Block): V2Block[] {
  const content = block.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(isBlockElement) as V2Block[];
}

function isBlockElement(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return "index" in record || "bbox" in record || "blocks" in record;
}

function getV2BlockText(block: V2Block): string {
  const content = block.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    if (content.some(isBlockElement)) {
      return getV2ChildBlocks(block)
        .map((child) => getV2BlockText(child))
        .filter(Boolean)
        .join("\n");
    }
    return joinInlineSpans(content as RawSpan[]);
  }
  return "";
}

function joinInlineSpans(spans: RawSpan[]): string {
  return spans
    .map((span) => {
      const type = String(span.type ?? "").toLowerCase();
      const content = span.content ?? span.text ?? "";
      if (type === "hyperlink" || Array.isArray(content)) {
        return Array.isArray(content)
          ? joinInlineSpans(content as RawSpan[])
          : "";
      }
      if (type === "equation_inline") {
        return `$${String(content)}$`;
      }
      if (type === "code_inline") {
        return `\`${String(content)}\``;
      }
      return String(content);
    })
    .join("");
}

// ── Legacy (pdf_info / para_blocks / layout_dets) ───────────────────

function normalizeLegacy(result: unknown): NormalizedBox[] {
  const pages = extractPages(result);
  const boxes: NormalizedBox[] = [];

  for (const page of pages) {
    const [width, height] = getPageSize(page);
    const pageNumber = getPageNumber(page);

    for (const block of getPageBlocks(page)) {
      const bbox = getBlockBbox(block);
      if (!bbox) {
        continue;
      }

      const [x1, y1, x2, y2] = bbox;
      const type = normalizeType(
        block.type ?? block.block_type ?? block.category_type,
      );
      const markdown = getBlockMarkdown(block);
      const imagePath = getBlockImagePath(block);
      const tableFormats = isTableType(type)
        ? getBlockTableFormats(block, markdown)
        : undefined;
      const box: NormalizedBox = {
        rawIndex: boxes.length,
        sourceIndex: getSourceIndex(block),
        page: pageNumber,
        type,
        bbox: {
          x: clamp01(x1 / width),
          y: clamp01(y1 / height),
          width: clamp01((x2 - x1) / width),
          height: clamp01((y2 - y1) / height),
        },
        markdown,
        formula: isFormulaType(type) ? getBlockFormula(block, markdown) : null,
      };
      if (imagePath) {
        box.imagePath = imagePath;
      }
      if (tableFormats) {
        box.tableFormats = tableFormats;
      }
      boxes.push(box);
    }
  }

  return boxes;
}

function extractPages(result: unknown): RawPage[] {
  const value = result as { pages?: RawPage[]; pdf_info?: RawPage[] };
  return value.pages ?? value.pdf_info ?? [];
}

function getPageSize(page: RawPage): [number, number] {
  const width = Number(
    page.width ?? page.page_width ?? page.page_size?.[0] ?? 1,
  );
  const height = Number(
    page.height ?? page.page_height ?? page.page_size?.[1] ?? 1,
  );
  return [positiveOrOne(width), positiveOrOne(height)];
}

function getPageNumber(page: RawPage): number {
  if (Number.isFinite(Number(page.pageNo))) {
    return Number(page.pageNo);
  }
  if (Number.isFinite(Number(page.page_idx))) {
    return Number(page.page_idx) + 1;
  }
  return 1;
}

function getPageBlocks(page: RawPage): RawBlock[] {
  const blocks = [
    ...(Array.isArray(page.blocks) ? page.blocks : []),
    ...(Array.isArray(page.para_blocks) ? page.para_blocks : []),
    ...(Array.isArray(page.layout_dets) ? page.layout_dets : []),
    ...(Array.isArray(page.discarded_blocks) ? page.discarded_blocks : []),
  ];
  return blocks.flatMap(flattenBlock);
}

function flattenBlock(block: RawBlock): RawBlock[] {
  if (!Array.isArray(block.blocks) || block.blocks.length === 0) {
    return [block];
  }
  const children = block.blocks.flatMap(flattenBlock);
  if (shouldDropStructuralParentBlock(block, children)) {
    return children;
  }
  return [block, ...children];
}

function shouldDropStructuralParentBlock(
  block: RawBlock,
  children: RawBlock[],
): boolean {
  const type = normalizeType(
    block.type ?? block.block_type ?? block.category_type,
  );
  return (
    type === "list" &&
    children.some((child) => {
      const childType = normalizeType(
        child.type ?? child.block_type ?? child.category_type,
      );
      return isReferenceType(childType);
    })
  );
}

function getBlockBbox(
  block: RawBlock,
): [number, number, number, number] | null {
  if (Array.isArray(block.bbox) && block.bbox.length >= 4) {
    const [x1, y1, x2, y2] = block.bbox.map(Number);
    return normalizeBbox(x1, y1, x2, y2);
  }

  if (Array.isArray(block.poly) && block.poly.length >= 4) {
    const xs = block.poly.filter((_, index) => index % 2 === 0).map(Number);
    const ys = block.poly.filter((_, index) => index % 2 === 1).map(Number);
    return normalizeBbox(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    );
  }

  return null;
}

function normalizeBbox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): [number, number, number, number] | null {
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  return [
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.max(x1, x2),
    Math.max(y1, y2),
  ];
}

function getBlockMarkdown(block: RawBlock): string {
  return String(
    block.markdown ??
      block.text ??
      block.content ??
      block.html ??
      block.latex ??
      getLinesText(block) ??
      "",
  );
}

function getBlockFormula(block: RawBlock, markdown: string): string | null {
  const value =
    block.formula ?? block.latex ?? getLinesText(block, "visual") ?? markdown;
  const formula = String(value ?? "").trim();
  return formula ? formula : null;
}

function getBlockTableFormats(
  block: RawBlock,
  markdown: string,
): NonNullable<NormalizedBox["tableFormats"]> | undefined {
  const formats = {
    latex: normalizeFormatText(block.latex),
    markdown: normalizeFormatText(block.markdown ?? markdown),
    html: normalizeFormatText(block.html ?? readRawField(block, "table_body")),
    tsv: normalizeFormatText(readRawField(block, "tsv")),
  };

  for (const line of block.lines ?? []) {
    for (const span of line.spans ?? []) {
      formats.latex ??= normalizeFormatText(span.latex);
      formats.markdown ??= normalizeFormatText(span.markdown);
      formats.html ??= normalizeFormatText(span.html ?? span.table_body);
      formats.tsv ??= normalizeFormatText(span.tsv);
    }
  }

  for (const child of block.blocks ?? []) {
    const childType = normalizeType(
      child.type ?? child.block_type ?? child.category_type,
    );
    if (!isTableType(childType)) {
      continue;
    }
    const childMarkdown = getBlockMarkdown(child);
    const childFormats = getBlockTableFormats(child, childMarkdown);
    formats.latex ??= childFormats?.latex;
    formats.markdown ??= childFormats?.markdown;
    formats.html ??= childFormats?.html;
    formats.tsv ??= childFormats?.tsv;
  }
  return compactTableFormats(formats);
}

function compactTableFormats(
  formats: NonNullable<NormalizedBox["tableFormats"]>,
): NonNullable<NormalizedBox["tableFormats"]> | undefined {
  const compacted: NonNullable<NormalizedBox["tableFormats"]> = {};
  for (const format of ["latex", "markdown", "html", "tsv"] as const) {
    if (formats[format]) {
      compacted[format] = formats[format];
    }
  }
  return Object.values(compacted).some(Boolean) ? compacted : undefined;
}

function readRawField(block: RawBlock | undefined, key: string): unknown {
  return (block as Record<string, unknown> | undefined)?.[key];
}

function normalizeFormatText(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function getBlockImagePath(block: RawBlock): string | null {
  const direct =
    normalizeImagePath(block.image_path) ??
    normalizeImagePath((block as { img_path?: string }).img_path);
  if (direct) {
    return direct;
  }

  for (const line of block.lines ?? []) {
    for (const span of line.spans ?? []) {
      const spanPath =
        normalizeImagePath(span.image_path) ??
        normalizeImagePath((span as { img_path?: string }).img_path);
      if (spanPath) {
        return spanPath;
      }
    }
  }

  for (const child of block.blocks ?? []) {
    const childPath = getBlockImagePath(child);
    if (childPath) {
      return childPath;
    }
  }
  return null;
}

function normalizeImagePath(path: unknown): string | null {
  const value = String(path ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return value;
}

function getLinesText(
  block: RawBlock,
  mode: "paragraph" | "visual" = "paragraph",
): string | null {
  if (!Array.isArray(block.lines)) {
    return null;
  }

  const lineTexts = block.lines
    .map((line) => getLineText(line.spans, mode))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const text =
    mode === "visual" ? lineTexts.join("\n") : joinParagraphLines(lineTexts);

  return text || null;
}

function getLineText(
  spans: RawSpan[] | undefined,
  mode: "paragraph" | "visual",
): string {
  const values = Array.isArray(spans) ? spans : [];
  if (mode === "visual") {
    return values.map((span) => span.content ?? span.text ?? "").join("");
  }

  return values.reduce((text, span) => {
    const value = formatParagraphSpan(span);
    if (!value) {
      return text;
    }
    if (!text) {
      return value;
    }
    return shouldSeparateSpans(text, value, span)
      ? `${text} ${value}`
      : text + value;
  }, "");
}

function formatParagraphSpan(span: RawSpan): string {
  const value = String(span.content ?? span.text ?? "").trim();
  if (!value) {
    return "";
  }
  return isInlineEquationType(span.type) ? `$${value}$` : value;
}

function shouldSeparateSpans(
  text: string,
  value: string,
  span: RawSpan,
): boolean {
  return isInlineEquationType(span.type) || text.endsWith("$");
}

function isInlineEquationType(type: unknown): boolean {
  const value = String(type ?? "")
    .trim()
    .toLowerCase();
  return ["equation_inline", "inline_equation"].includes(value);
}

function joinParagraphLines(lines: string[]): string {
  return lines.reduce((text, line) => {
    if (!text) {
      return line;
    }

    if (isSoftHyphenBreak(text, line)) {
      return `${text.slice(0, -1)}${line}`;
    }

    if (isCompoundHyphenBreak(text, line)) {
      return `${text}${line}`;
    }

    return `${text} ${line}`;
  }, "");
}

/**
 * A visible hyphen followed by an upper-case continuation is a compound hyphen
 * ("Well-" / "Known"), so the next line joins it without an extra space.
 */
function isCompoundHyphenBreak(text: string, nextLine: string): boolean {
  return text.endsWith("-") && /^[A-Z]/.test(nextLine);
}

function isSoftHyphenBreak(text: string, nextLine: string): boolean {
  // A real soft hyphen (U+00AD) is always a line-break artifact, whatever the
  // case of the next line.
  if (text.endsWith("\u00ad")) {
    return true;
  }

  // A visible trailing hyphen is ambiguous: PDF text extraction emits it both
  // for words split across a line and for genuine compound hyphens. Only join
  // when the next line continues in lower case and the previous token carries
  // no other hyphen, which preserves "Well-Known" style compounds.
  if (!text.endsWith("-") || !/^[a-z]/.test(nextLine)) {
    return false;
  }

  const previousToken = text.slice(0, -1).split(/\s+/).pop() ?? "";
  return !previousToken.includes("-");
}

function getSourceIndex(block: RawBlock): number | undefined {
  return typeof block.index === "number" && Number.isFinite(block.index)
    ? block.index
    : undefined;
}

function normalizeType(type: unknown): MinerUBoxType {
  const value = String(type ?? "")
    .trim()
    .toLowerCase();
  if (["table_body"].includes(value)) {
    return "table";
  }
  if (["ref_text"].includes(value)) {
    return "reference";
  }
  return value || "unknown";
}

function isReferenceType(type: string): boolean {
  return ["reference", "citation", "bibliography"].includes(type);
}

function isFormulaType(type: string): boolean {
  return [
    "formula",
    "interline_equation",
    "equation_interline",
    "inline_equation",
    "equation_inline",
    "equation",
  ].includes(type);
}

function isTableType(type: string): boolean {
  return ["table", "table_body"].includes(type);
}

function positiveOrOne(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
