import type { MinerUImageFile } from "../domain";
import { isSafeRelativePath } from "./path";
import type { ZipEntries } from "./types";
import { decodeText } from "./zip";

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

export function readImagesFromZip(zip: ZipEntries): MinerUImageFile[] | undefined {
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

export function shouldKeepZipEntry(name: string): boolean {
  return name === "full.md" || name.endsWith(".json") || isZipImageEntry(name);
}

export function isZipImageEntry(name: string): boolean {
  return Boolean(getZipImagePath(name));
}

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

export function hasBlockGeometry(value: unknown): boolean {
  const block = value as { bbox?: unknown; poly?: unknown };
  return (
    (Array.isArray(block.bbox) && block.bbox.length >= 4) ||
    (Array.isArray(block.poly) && block.poly.length >= 4)
  );
}
