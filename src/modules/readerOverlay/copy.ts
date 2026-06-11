import { formatBoxesForCopy } from "../copyFormatter";
import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
import type { AttachmentRef } from "../domain";
import type { NormalizedBox } from "./types";
import { getReaderOverlayStateForReader } from "./state";
import { getReaderAttachmentRef } from "./windows";

/** 复制当前 reader 已选 box；若没有选择，则回退复制全文 markdown。 */
export async function copySelectedBoxesForReader(
  reader: _ZoteroTypes.ReaderInstance,
): Promise<string | null> {
  const state = getReaderOverlayStateForReader(reader);
  const attachment = getReaderAttachmentRef(reader);
  if (!state || !attachment) {
    return null;
  }

  const storage = createStorage(getMinerUStorageRoot());
  const text =
    state.selectedRawIndexes.size === 0
      ? await storage.readPreferredMarkdown(attachment)
      : formatSelectedBoxesForCopy(
          await storage.readBoxes(attachment),
          state.selectedRawIndexes,
        );
  copyText(text);
  return text || null;
}

/** 依照原始 rawIndex 过滤 box，并复用统一格式化逻辑生成复制文本。 */
export function formatSelectedBoxesForCopy(
  boxes: NormalizedBox[],
  selectedRawIndexes: Set<number>,
): string {
  return formatBoxesForCopy(
    boxes.filter((box) => selectedRawIndexes.has(box.rawIndex)),
  );
}

/** 把文本写入 Zotero clipboard；空字符串时保持静默。 */
export function copyText(text: string): void {
  if (!text) {
    return;
  }
  new ztoolkit.Clipboard().addText(text, "text/unicode").copy();
}

/** 复制视觉类 box 对应的解析图片，成功时返回 true。 */
export async function copyBoxImageFromStorage(
  box: NormalizedBox,
  attachment: Pick<AttachmentRef, "libraryID" | "key"> | undefined,
): Promise<boolean> {
  if (!attachment || !isImageCopyBox(box)) {
    return false;
  }

  const imagePath = getBoxImagePath(box);
  if (!imagePath) {
    return false;
  }

  try {
    const dataURL = await createStorage(
      getMinerUStorageRoot(),
    ).readImageDataURL(attachment, imagePath);
    if (!dataURL) {
      return false;
    }
    new ztoolkit.Clipboard().addImage(dataURL).copy();
    return true;
  } catch (error) {
    ztoolkit.log("failed to copy MinerU box image", error);
    return false;
  }
}

/** 判断当前 box 是否应优先按图片复制。 */
export function isImageCopyBox(box: NormalizedBox): boolean {
  return [
    "figure",
    "image",
    "image_body",
    "chart",
    "chart_body",
    "table",
    "table_body",
  ].includes(box.type.trim().toLowerCase());
}

/** 从 box markdown 中提取第一个 MinerU 图片链接。 */
export function extractFirstMinerUImagePath(markdown: string): string | null {
  for (const pattern of [
    /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
  ]) {
    const match = pattern.exec(markdown);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function getBoxImagePath(box: NormalizedBox): string | null {
  const normalizedPath = normalizeBoxImagePath(box.imagePath);
  if (normalizedPath) {
    return normalizedPath;
  }
  return extractFirstMinerUImagePath(box.markdown);
}

function normalizeBoxImagePath(path: string | null | undefined): string | null {
  const value = path?.trim();
  if (!value) {
    return null;
  }
  return value.startsWith("images/") ? value : `images/${value}`;
}
