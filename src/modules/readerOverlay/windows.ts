import type { ReaderOverlayState, ReaderOverlayKey } from "./types";
import { getReaderOverlayStateForReader } from "./state";

/** 判断当前 reader 的 overlay root 集合是否需要重新同步窗口。 */
export function readerOverlayNeedsWindowSync(
  reader: _ZoteroTypes.ReaderInstance,
): boolean {
  const state = getReaderOverlayStateForReader(reader);
  if (!state || state.mode === "off") {
    return false;
  }

  const windows = getReaderOverlayWindows(reader);
  if (windows.length !== state.rootsByWindow.size) {
    return true;
  }

  return windows.some((win) => !state.rootsByWindow.has(win));
}

/** 返回当前 reader 最终应操作的 overlay 窗口。 */
export function getReaderOverlayWindow(
  reader: _ZoteroTypes.ReaderInstance,
): Window | null {
  return getReaderOverlayWindows(reader).at(-1) ?? null;
}

/** 枚举 reader 及其同源嵌套 iframe 对应的全部窗口。 */
export function getReaderOverlayWindows(
  reader: _ZoteroTypes.ReaderInstance,
): Window[] {
  const windows = new Set<Window>();
  for (const view of getReaderViews(reader)) {
    const win = view?._iframeWindow ?? null;
    if (win) {
      addReaderOverlayWindowWithDescendants(windows, win);
    }
  }

  if (reader._iframeWindow) {
    addReaderOverlayWindowWithDescendants(windows, reader._iframeWindow);
  }

  return [...windows];
}

/** 把当前窗口及其同源子 frame 递归加入窗口集合。 */
export function addReaderOverlayWindowWithDescendants(
  windows: Set<Window>,
  win: Window,
): void {
  if (windows.has(win)) {
    return;
  }
  windows.add(win);

  const doc = getWindowDocument(win);
  const frames =
    typeof doc?.querySelectorAll === "function"
      ? (Array.from(doc.querySelectorAll("iframe, frame")) as Element[])
      : [];
  for (const frame of frames) {
    const childWindow = getFrameContentWindow(frame);
    if (childWindow) {
      addReaderOverlayWindowWithDescendants(windows, childWindow);
    }
  }
}

/** 安全读取 frame 的 contentWindow，只接受可访问且已就绪的同源窗口。 */
export function getFrameContentWindow(frame: Element): Window | null {
  try {
    const win = (frame as HTMLIFrameElement | HTMLFrameElement).contentWindow;
    if (!win?.document?.documentElement) {
      return null;
    }
    return win;
  } catch {
    return null;
  }
}

/** 收集 Zotero reader 在不同版本与 split view 下暴露的视图集合。 */
export function getReaderViews(
  reader: _ZoteroTypes.ReaderInstance,
): Array<{ _iframeWindow?: Window | null } | null> {
  const value = reader as _ZoteroTypes.ReaderInstance & {
    _views?: Array<{ _iframeWindow?: Window | null }>;
    _readerViews?: Array<{ _iframeWindow?: Window | null }>;
    _secondaryView?: { _iframeWindow?: Window | null };
  };
  const view = (reader._lastView ?? reader._primaryView ?? null) as {
    _iframeWindow?: Window | null;
  } | null;

  return [
    ...(Array.isArray(value._views) ? value._views : []),
    ...(Array.isArray(value._readerViews) ? value._readerViews : []),
    reader._primaryView as { _iframeWindow?: Window | null } | null,
    value._secondaryView ?? null,
    view,
  ];
}

/** 返回 positioning 需要监听键盘与 pointer 事件的窗口链。 */
export function getReaderOverlayEventWindows(win: Window): Window[] {
  const windows = new Set<Window>();
  let current: Window | null = win;
  while (current && !windows.has(current)) {
    windows.add(current);
    const parent = getParentWindow(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }
  return [...windows];
}

/** 安全读取 window.document，避免跨域或 dead object 异常。 */
export function getWindowDocument(win: Window): Document | null {
  try {
    return win.document ?? null;
  } catch {
    return null;
  }
}

/** 安全读取父窗口引用。 */
export function getParentWindow(win: Window): Window | null {
  try {
    return win.parent ?? null;
  } catch {
    return null;
  }
}

/** 从 reader 当前 attachment 中解析出 key。 */
export function getReaderAttachmentKey(
  reader: _ZoteroTypes.ReaderInstance,
): string | null {
  const key = reader._item?.key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/** 返回 storage 访问所需的 attachment 引用信息。 */
export function getReaderAttachmentRef(
  reader: _ZoteroTypes.ReaderInstance,
): { libraryID: number; key: string } | null {
  const item = reader._item;
  const key = item?.key;
  const libraryID = item?.libraryID;
  if (typeof key !== "string" || !key || typeof libraryID !== "number") {
    return null;
  }
  return { libraryID, key };
}

/** 返回 overlay root 应挂载的 reader 文档容器。 */
export function getReaderOverlayMountContainer(doc: Document): Element | null {
  return doc.body ?? doc.documentElement;
}
