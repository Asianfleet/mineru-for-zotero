import type { FluentMessageId } from "../../../typings/i10n";
import { getString } from "../../utils/locale";

/** 读取 overlay 相关本地化文案，并在失败时回退到内置文本。 */
export function readerOverlayString(
  id: FluentMessageId,
  fallback: string,
): string {
  try {
    const value = getString(id);
    if (value && value !== id && !value.endsWith(`-${id}`)) {
      return value;
    }
  } catch {
    // 继续回退到内置文本。
  }
  return fallback;
}

/** 在 reader 中弹出 overlay 提示，但提示失败不能影响主流程。 */
export function showReaderOverlayNotice(id: FluentMessageId): void {
  const text = getReaderOverlayNoticeText(id);
  try {
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeTime: 4000,
    })
      .createLine({
        text,
        type: "default",
        progress: 100,
      })
      .show();
  } catch {
    // 提示窗口不能影响 reader 交互。
  }
}

/** 返回 overlay 提示文案，并为关键场景提供本地 fallback。 */
export function getReaderOverlayNoticeText(id: FluentMessageId): string {
  try {
    const value = getString(id);
    if (value && value !== id) {
      return value;
    }
  } catch {
    // 继续回退到内置文本。
  }

  if (id === "reader-overlay-missing-result") {
    return (
      "This PDF does not have a MinerU parse result yet. " +
      "Parse it before enabling boxes."
    );
  }
  if (id === "reader-copy-image-missing") {
    return "This box does not have an image to copy.";
  }
  return id;
}
