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
  bbox?: number[];
  poly?: number[];
  markdown?: string;
  text?: string;
  content?: string;
  html?: string;
  latex?: string;
  formula?: string;
  blocks?: RawBlock[];
  lines?: Array<{ spans?: Array<{ content?: string; text?: string }> }>;
}

export function normalizeMinerUBoxes(result: unknown): NormalizedBox[] {
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
      boxes.push({
        rawIndex: boxes.length,
        page: pageNumber,
        type,
        bbox: {
          x: clamp01(x1 / width),
          y: clamp01(y1 / height),
          width: clamp01((x2 - x1) / width),
          height: clamp01((y2 - y1) / height),
        },
        markdown,
        formula: type === "formula" ? getBlockFormula(block, markdown) : null,
      });
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
  return [block, ...block.blocks.flatMap(flattenBlock)];
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
  const value = block.formula ?? block.latex ?? getLinesText(block) ?? markdown;
  const formula = String(value ?? "").trim();
  return formula ? formula : null;
}

function getLinesText(block: RawBlock): string | null {
  if (!Array.isArray(block.lines)) {
    return null;
  }

  const text = block.lines
    .map((line) =>
      (Array.isArray(line.spans) ? line.spans : [])
        .map((span) => span.content ?? span.text ?? "")
        .join(""),
    )
    .filter(Boolean)
    .join("\n");

  return text || null;
}

function normalizeType(type: unknown): MinerUBoxType {
  const value = String(type ?? "unknown").toLowerCase();
  if (["text", "title", "list", "table", "figure", "formula"].includes(value)) {
    return value as MinerUBoxType;
  }
  if (["image", "image_body"].includes(value)) {
    return "figure";
  }
  if (
    [
      "image_caption",
      "table_caption",
      "page_footnote",
      "footnote",
      "footer",
      "ref_text",
    ].includes(value)
  ) {
    return "text";
  }
  if (["interline_equation", "inline_equation", "equation"].includes(value)) {
    return "formula";
  }
  if (value.includes("table")) {
    return "table";
  }
  if (value.includes("list")) {
    return "list";
  }
  return "unknown";
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
