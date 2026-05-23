import type { MinerUImageFile } from "../domain";
import { isSafeRelativePath } from "./path";
import type { ZipEntries } from "./types";
import { decodeText } from "./zip";

/**
 * 从 MinerU 结果 ZIP 中读取最合适的原始 JSON 结果。
 */
export function readRawResultFromZip(zip: ZipEntries): unknown | null {
  let firstJson: unknown | null = null;

  for (const [name, entry] of zip) {
    if (name === "full.md") {
      continue;
    }
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(decodeText(entry.bytes)) as unknown;
      firstJson ??= parsed;
      if (hasPageBoxData(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return firstJson;
}

/**
 * 从 MinerU 结果 ZIP 中提取可保存的图片资源。
 */
export function readImagesFromZip(
  zip: ZipEntries,
): MinerUImageFile[] | undefined {
  const images: MinerUImageFile[] = [];
  for (const [name, entry] of zip) {
    const imagePath = getZipImagePath(name);
    if (!imagePath) {
      continue;
    }
    images.push({ path: imagePath, bytes: entry.bytes });
  }
  return images.length > 0 ? images : undefined;
}

/**
 * 判断 ZIP 条目是否属于 Markdown、JSON 或图片结果。
 */
export function shouldKeepZipEntry(name: string): boolean {
  return (
    name.endsWith(".md") || name.endsWith(".json") || isZipImageEntry(name)
  );
}

/**
 * 判断 ZIP 条目是否是安全的 MinerU 图片结果。
 */
export function isZipImageEntry(name: string): boolean {
  return Boolean(getZipImagePath(name));
}

/**
 * 把 ZIP 内图片条目转换为存储使用的相对图片路径。
 */
export function getZipImagePath(name: string): string | null {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized.startsWith("images/")) {
    return null;
  }
  const relative = normalized.slice("images/".length);
  if (!isSafeRelativePath(relative)) {
    return null;
  }
  return relative;
}

/**
 * 判断原始 MinerU JSON 是否包含可归一化的页面 box 数据。
 */
export function hasPageBoxData(value: unknown): boolean {
  const raw = value as { pages?: unknown; pdf_info?: unknown };
  const pages = Array.isArray(raw.pages)
    ? raw.pages
    : Array.isArray(raw.pdf_info)
      ? raw.pdf_info
      : [];
  return pages.some((page) => {
    const rawPage = page as {
      blocks?: unknown;
      para_blocks?: unknown;
      layout_dets?: unknown;
    };
    return [rawPage.blocks, rawPage.para_blocks, rawPage.layout_dets].some(
      (blocks) => Array.isArray(blocks) && blocks.some(hasBlockGeometry),
    );
  });
}

/**
 * 判断单个 block 是否带有 bbox 或 poly 几何信息。
 */
export function hasBlockGeometry(value: unknown): boolean {
  const block = value as { bbox?: unknown; poly?: unknown };
  return (
    (Array.isArray(block.bbox) && block.bbox.length >= 4) ||
    (Array.isArray(block.poly) && block.poly.length >= 4)
  );
}
