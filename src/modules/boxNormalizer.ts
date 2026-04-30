import type { MinerUBoxType, NormalizedBox } from "./domain";

interface RawPage {
  pageNo?: number;
  page_idx?: number;
  width?: number;
  height?: number;
  blocks?: RawBlock[];
}

interface RawBlock {
  type?: string;
  block_type?: string;
  bbox?: number[];
  markdown?: string;
  text?: string;
  formula?: string;
}

export function normalizeMinerUBoxes(result: unknown): NormalizedBox[] {
  const pages = extractPages(result);
  const boxes: NormalizedBox[] = [];

  for (const page of pages) {
    const width = Number(page.width || 1);
    const height = Number(page.height || 1);
    const pageNumber = Number(page.pageNo ?? page.page_idx ?? 0) || 1;

    for (const block of page.blocks ?? []) {
      const bbox = block.bbox;
      if (!Array.isArray(bbox) || bbox.length < 4) {
        continue;
      }

      const [x1, y1, x2, y2] = bbox.map(Number);
      boxes.push({
        rawIndex: boxes.length,
        page: pageNumber,
        type: normalizeType(block.type ?? block.block_type),
        bbox: {
          x: clamp01(x1 / width),
          y: clamp01(y1 / height),
          width: clamp01((x2 - x1) / width),
          height: clamp01((y2 - y1) / height),
        },
        markdown: String(block.markdown ?? block.text ?? ""),
        formula: block.formula ? String(block.formula) : null,
      });
    }
  }

  return boxes;
}

function extractPages(result: unknown): RawPage[] {
  const value = result as { pages?: RawPage[]; pdf_info?: RawPage[] };
  return value.pages ?? value.pdf_info ?? [];
}

function normalizeType(type: unknown): MinerUBoxType {
  const value = String(type ?? "unknown").toLowerCase();
  if (["text", "title", "list", "table", "figure", "formula"].includes(value)) {
    return value as MinerUBoxType;
  }
  return "unknown";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
