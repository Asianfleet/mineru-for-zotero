import { normalizeMinerUBoxes } from "./boxNormalizer";
import type { MinerUImageFile, NormalizedBox } from "./domain";

/** Raw result returned by a single MinerU chunk task. */
export interface MinerUChunkResult {
  rawResult?: unknown;
  markdown: string;
  images?: MinerUImageFile[];
  /** Page count recorded per chunk, used to offset merged box pages. */
  _chunkPageCount?: number;
}

/** Merge of one or more chunk results into the final parse result. */
export type MergedParseResult =
  | { kind: "lite"; markdown: string }
  | {
      kind: "precise";
      rawResult: unknown;
      markdown: string;
      images: MinerUImageFile[];
      _mergedBoxes: NormalizedBox[];
    };

/**
 * Combine chunk results into a single parse result.
 *
 * Lite results only concatenate Markdown. Precise results either pass through
 * a single chunk or stitch multiple chunks together: image paths are namespaced
 * per part, box page numbers are offset by the preceding chunk page counts so
 * overlays keep pointing at the right page, and box `rawIndex` values are
 * offset by the preceding box counts so they stay unique. The overlay uses
 * `rawIndex` as the box identity for selection and copy.
 */
export function mergeChunkResults(
  results: MinerUChunkResult[],
  mode: "precise" | "lite",
): MergedParseResult {
  if (mode === "lite") {
    return {
      kind: "lite",
      markdown: results.map((result) => result.markdown).join("\n\n---\n\n"),
    };
  }

  if (results.length === 1) {
    const single = results[0];
    return {
      kind: "precise",
      rawResult: single.rawResult,
      markdown: single.markdown,
      images: single.images || [],
      _mergedBoxes: normalizeMinerUBoxes(single.rawResult),
    };
  }

  let mergedMarkdown = "";
  const mergedImages: MinerUImageFile[] = [];
  const rawResults: unknown[] = [];
  const mergedBoxes: NormalizedBox[] = [];
  let pageOffset = 0;

  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    rawResults.push(result.rawResult);

    let markdown = result.markdown;
    const images = result.images || [];
    for (const image of images) {
      const oldPath = image.path;
      const newPath = `part${index}_${oldPath.replace("images/", "")}`;
      image.path = `images/${newPath}`;
      markdown = markdown.split(oldPath).join(image.path);
    }
    mergedImages.push(...images);
    mergedMarkdown +=
      markdown + (index < results.length - 1 ? "\n\n---\n\n" : "");

    const boxes = normalizeMinerUBoxes(result.rawResult);
    const rawIndexOffset = mergedBoxes.length;
    for (const box of boxes) {
      box.page += pageOffset;
      box.rawIndex += rawIndexOffset;
    }
    mergedBoxes.push(...boxes);

    pageOffset += result._chunkPageCount || 200;
  }

  return {
    kind: "precise",
    rawResult: rawResults,
    markdown: mergedMarkdown,
    images: mergedImages,
    _mergedBoxes: mergedBoxes,
  };
}
