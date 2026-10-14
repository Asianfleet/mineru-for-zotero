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
  onRelease: () => void = () => {},
): {
  sync: (windows: Window[]) => void;
  cleanup: () => void;
  isHeld: () => boolean;
} {
  const windows = new Set<Window>();
  const pressedKeys = new Set<string>();
  let held = false;
  let pending = false;
  /** 结束快捷键保持状态，并通知菜单关闭。 */
  const release = () => {
    pressedKeys.clear();
    if (held) {
      held = false;
      onRelease();
    }
  };
  /** 消费有效按键并执行当前阅读器的模式切换。 */
  const onKeyDown = (event: KeyboardEvent) => {
    const matches = matchesReaderShortcut(event, readShortcut());
    // 修饰键使用事件标志判断，普通键单独记录以支持任意释放顺序。
    if (
      (held || matches) &&
      event.code &&
      !/^(Shift|Control|Alt|Meta)/.test(event.code)
    ) {
      pressedKeys.add(event.code);
    }
    if (!matches) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (pending) {
      return;
    }
    held = true;
    pending = true;
    void cycle().finally(() => {
      pending = false;
    });
  };
  /** 最后一个普通键和全部修饰键释放后关闭快捷键面板。 */
  const onKeyUp = (event: KeyboardEvent) => {
    pressedKeys.delete(event.code);
    if (
      !pressedKeys.size &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      release();
    }
  };
  return {
    /** 返回快捷键面板是否仍受按键保持保护。 */
    isHeld: () => held,
    /** 添加新出现的 iframe，并移除消失窗口的监听。 */
    sync(currentWindows) {
      const current = new Set(currentWindows);
      for (const win of windows) {
        if (!current.has(win)) {
          win.removeEventListener("keydown", onKeyDown, true);
          win.removeEventListener("keyup", onKeyUp, true);
          win.removeEventListener("blur", release);
          windows.delete(win);
        }
      }
      for (const win of current) {
        if (!windows.has(win)) {
          win.addEventListener("keydown", onKeyDown, true);
          win.addEventListener("keyup", onKeyUp, true);
          win.addEventListener("blur", release);
          windows.add(win);
        }
      }
    },
    /** 释放阅读器的所有按键监听。 */
    cleanup() {
      for (const win of windows) {
        win.removeEventListener("keydown", onKeyDown, true);
        win.removeEventListener("keyup", onKeyUp, true);
        win.removeEventListener("blur", release);
      }
      windows.clear();
      release();
    },
  };
}
