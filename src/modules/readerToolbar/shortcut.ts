import type { ReaderOverlayMode } from "./types";

/** 返回下一个 box 显示模式，关闭状态从全部显示开始。 */
export function getNextReaderOverlayMode(
  mode: ReaderOverlayMode,
): ReaderOverlayMode {
  return mode === "all" ? "hover" : mode === "hover" ? "off" : "all";
}

/** 将组合键序列化为稳定的物理键绑定，忽略不适合绑定的按键。 */
export function getReaderShortcutFromEvent(event: KeyboardEvent): string {
  if (
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    !event.code ||
    /^(Shift|Control|Alt|Meta)/.test(event.code) ||
    ["Tab", "Escape", "Backspace", "Delete"].includes(event.code) ||
    !(event.ctrlKey || event.altKey || event.metaKey)
  ) {
    return "";
  }
  return [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Meta",
    event.code,
  ]
    .filter(Boolean)
    .join("+");
}

/** 将存储的物理键名称转换为偏好页可读的组合键。 */
export function formatReaderShortcut(shortcut: string): string {
  return shortcut.replace(/Key([A-Z])$/, "$1").replace(/Digit([0-9])$/, "$1");
}

/** 精确匹配快捷键，并保护文本编辑、输入法和已有事件处理。 */
export function matchesReaderShortcut(
  event: KeyboardEvent,
  shortcut: string,
): boolean {
  if (!shortcut || event.defaultPrevented) {
    return false;
  }
  const target = event.target as Element | null;
  if (
    target?.closest?.(
      "input, textarea, select, textbox, [contenteditable]:not([contenteditable='false'])",
    )
  ) {
    return false;
  }
  return getReaderShortcutFromEvent(event) === shortcut;
}

/** 同步阅读器窗口的快捷键监听，并在异步命令完成前阻止重复切换。 */
export function createReaderShortcutController(
  readShortcut: () => string,
  cycle: () => Promise<void>,
): { sync: (windows: Window[]) => void; cleanup: () => void } {
  const windows = new Set<Window>();
  let pending = false;
  /** 消费有效按键并执行当前阅读器的模式切换。 */
  const onKeyDown = (event: KeyboardEvent) => {
    if (!matchesReaderShortcut(event, readShortcut())) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (pending) {
      return;
    }
    pending = true;
    void cycle().finally(() => {
      pending = false;
    });
  };
  return {
    /** 添加新出现的 iframe，并移除消失窗口的监听。 */
    sync(currentWindows) {
      const current = new Set(currentWindows);
      for (const win of windows) {
        if (!current.has(win)) {
          win.removeEventListener("keydown", onKeyDown, true);
          windows.delete(win);
        }
      }
      for (const win of current) {
        if (!windows.has(win)) {
          win.addEventListener("keydown", onKeyDown, true);
          windows.add(win);
        }
      }
    },
    /** 释放阅读器的所有按键监听。 */
    cleanup() {
      for (const win of windows) {
        win.removeEventListener("keydown", onKeyDown, true);
      }
      windows.clear();
    },
  };
}
