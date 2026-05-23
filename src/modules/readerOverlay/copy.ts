import { formatBoxesForCopy } from "../copyFormatter";
import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
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
