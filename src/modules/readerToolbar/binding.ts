import { destroyReaderOverlaysByReaderID } from "../readerOverlay";
import { getReaderToolbarIconURI } from "./assets";
import { readerString } from "./commands";
import {
  createReaderToolbarPanel,
  setReaderToolbarIconButtonContent,
  updateMenu,
} from "./panel";
import type {
  ReaderToolbarAnchor,
  ReaderToolbarButtonBinding,
  ReaderToolbarPanelStore,
} from "./types";

const buttonBindings = new Map<string, ReaderToolbarButtonBinding>();

/** 查找 MinerU button 应挂载的 PDF reader toolbar 位置。 */
export function findReaderToolbarAnchor(doc: {
  getElementById(id: string): Element | null;
  querySelector(selector: string): Element | null;
}): ReaderToolbarAnchor | null {
  const nextButton = doc.getElementById("next");
  if (nextButton?.parentElement) {
    return {
      parent: nextButton.parentElement,
      after: nextButton,
    };
  }

  const start = doc.querySelector(".toolbar .start");
  if (start) {
    return { parent: start };
  }

  return null;
}

/** 确保某个 reader 具有 toolbar button 和浮动菜单绑定。 */
export function ensureButtonBinding(
  win: Window,
  reader: _ZoteroTypes.ReaderInstance,
  panelStore: ReaderToolbarPanelStore,
): ReaderToolbarButtonBinding | null {
  const attachment = getReaderAttachment(reader);
  const doc = getReaderToolbarDocument(reader);
  if (!attachment || !doc) {
    return null;
  }

  const existing = buttonBindings.get(reader._instanceID);
  if (existing) {
    if (existing.attachmentKey !== attachment.key) {
      destroyReaderOverlaysByReaderID(reader._instanceID);
      destroyButtonBinding(reader._instanceID);
      panelStore.delete(reader._instanceID);
    } else if (!existing.button.isConnected || !existing.menu.isConnected) {
      destroyButtonBinding(reader._instanceID);
    } else {
      updateButtonBinding(reader, existing);
      return existing;
    }
  }

  const anchor = findReaderToolbarAnchor(doc);
  if (!anchor) {
    return null;
  }

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "toolbar-button mineru-reader-toolbar-button";
  button.id = getToolbarButtonID(reader._instanceID);
  button.title = readerString("reader-toolbar-label");
  button.setAttribute("aria-label", readerString("reader-toolbar-label"));
  button.tabIndex = -1;
  button.style.marginInlineStart = "4px";
  button.style.borderRadius = "4px";
  button.style.paddingInline = "6px";
  button.style.minWidth = "auto";
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  setReaderToolbarButtonContent(
    button,
    doc,
    readerString("reader-toolbar-label"),
  );

  const menu = createReaderToolbarPanel(doc);
  const menuState = panelStore.ensure(reader._instanceID);
  /** 同步菜单可见性和 button 激活样式。 */
  const sync = () => {
    const open = menuState.isOpen();
    menu.hidden = !open;
    button.style.backgroundColor = open
      ? "var(--fill-quinary, rgba(0, 0, 0, 0.08))"
      : "";
    button.style.borderRadius = "4px";
    if (open) {
      positionMenu(button, menu);
    }
  };
  /** 在菜单关闭时应用悬停样式。 */
  const setHover = (hovered: boolean) => {
    if (!menuState.isOpen()) {
      button.style.backgroundColor = hovered
        ? "var(--fill-quinary, rgba(0, 0, 0, 0.08))"
        : "";
    }
  };
  /** 通过主键鼠标点击切换 toolbar 菜单。 */
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    panelStore.toggle(reader._instanceID);
    updateMenu(reader, doc, menu, sync);
    sync();
  };
  /** 当 reader document 收到外部 pointer event 时关闭菜单。 */
  const onDocumentPointerDown = (event: Event) => {
    if (isOutsideToolbarMenu(event, button, menu)) {
      menuState.close();
      sync();
    }
  };
  /** 当 Zotero main window 收到外部 pointer event 时关闭菜单。 */
  const onMainWindowPointerDown = (event: Event) => {
    if (isOutsideToolbarMenu(event, button, menu)) {
      menuState.close();
      sync();
    }
  };

  button.addEventListener(
    "mouseenter",
    /** 当 pointer 进入 toolbar button 时应用悬停样式。 */
    () => setHover(true),
  );
  button.addEventListener(
    "mouseleave",
    /** 当 pointer 离开 toolbar button 时清除悬停样式。 */
    () => setHover(false),
  );
  button.addEventListener("click", onClick);
  doc.addEventListener("pointerdown", onDocumentPointerDown, true);
  win.document.addEventListener("pointerdown", onMainWindowPointerDown, true);

  const root = doc.documentElement;
  if (!root) {
    return null;
  }
  root.append(menu);
  if (anchor.after?.parentNode === anchor.parent) {
    anchor.after.insertAdjacentElement("afterend", button);
  } else {
    anchor.parent.append(button);
  }

  /** 移除此绑定对应的 DOM listener 和 toolbar 节点。 */
  const cleanup = () => {
    doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
    win.document.removeEventListener(
      "pointerdown",
      onMainWindowPointerDown,
      true,
    );
    button.remove();
    menu.remove();
  };
  const binding = { button, menu, win, attachmentKey: attachment.key, cleanup };
  buttonBindings.set(reader._instanceID, binding);
  updateButtonBinding(reader, binding);
  sync();
  return binding;
}

/** 刷新现有 reader 绑定的 toolbar button 内容。 */
export function updateButtonBinding(
  reader: _ZoteroTypes.ReaderInstance,
  binding: ReaderToolbarButtonBinding,
): void {
  const doc = binding.button.ownerDocument ?? getReaderToolbarDocument(reader);
  if (!doc) {
    return;
  }
  setReaderToolbarButtonContent(
    binding.button,
    doc,
    readerString("reader-toolbar-label"),
  );
}

/** 将当前 toolbar icon 状态应用到 reader toolbar button。 */
export function setReaderToolbarButtonContent(
  button: HTMLButtonElement,
  doc: Document,
  label: string,
): void {
  setReaderToolbarIconButtonContent(
    button,
    doc,
    label,
    getReaderToolbarIconURI(),
  );
}

/** 销毁单个 reader toolbar button 绑定。 */
export function destroyButtonBinding(readerInstanceID: string): void {
  const binding = buttonBindings.get(readerInstanceID);
  if (!binding) {
    return;
  }
  binding.cleanup();
  buttonBindings.delete(readerInstanceID);
}

/** 销毁某个 main window 拥有的全部 toolbar 绑定。 */
export function cleanupWindowBindings(
  win: Window,
  panelStore: ReaderToolbarPanelStore,
): void {
  for (const [readerInstanceID, binding] of [...buttonBindings]) {
    if (binding.win !== win) {
      continue;
    }
    destroyButtonBinding(readerInstanceID);
    destroyReaderOverlaysByReaderID(readerInstanceID);
    panelStore.delete(readerInstanceID);
  }
}

/** 返回事件 target 是否同时位于 toolbar button 和菜单之外。 */
export function isOutsideToolbarMenu(
  event: Event,
  button: HTMLButtonElement,
  menu: HTMLDivElement,
): boolean {
  const target = event.target as Node | null;
  return Boolean(target && !menu.contains(target) && !button.contains(target));
}

/** 将浮动菜单定位到 reader toolbar button 附近。 */
export function positionMenu(
  button: HTMLButtonElement,
  menu: HTMLDivElement,
): void {
  const rect = button.getBoundingClientRect();
  const doc = button.ownerDocument;
  const root = doc?.documentElement;
  if (!root) {
    return;
  }
  const viewportWidth = root.clientWidth;
  const viewportHeight = root.clientHeight;

  menu.style.visibility = "hidden";
  menu.hidden = false;
  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(
    4,
    Math.min(rect.left, viewportWidth - menuRect.width - 4),
  );
  const top = rect.bottom + 4;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.min(top, viewportHeight - menuRect.height - 4)}px`;
  menu.style.visibility = "";
}

/** 获取 Zotero main window 中所有 PDF reader 实例。 */
export function getWindowReaders(
  win: _ZoteroTypes.MainWindow,
): _ZoteroTypes.ReaderInstance[] {
  const tabs = (
    win as Window & { Zotero_Tabs?: { _tabs?: Array<{ id: string }> } }
  ).Zotero_Tabs?._tabs;
  if (!Array.isArray(tabs)) {
    return [];
  }

  const readers: _ZoteroTypes.ReaderInstance[] = [];
  for (const tab of tabs) {
    const reader = Zotero.Reader.getByTabID(tab.id);
    if (!reader || reader.type !== "pdf" || !getReaderAttachment(reader)) {
      continue;
    }
    readers.push(reader);
  }
  return readers;
}

/** 在 PDF reader iframe document 准备好插入 toolbar 时获取它。 */
export function getReaderToolbarDocument(
  reader: _ZoteroTypes.ReaderInstance,
): Document | null {
  const doc = reader._iframeWindow?.document ?? null;
  if (!doc?.documentElement) {
    return null;
  }
  return doc;
}

/** 获取支撑某个 reader 实例的活动 PDF attachment。 */
export function getReaderAttachment(
  reader: _ZoteroTypes.ReaderInstance,
): Zotero.Item | null {
  const item = reader._item;
  if (!item?.isAttachment() || !item.isPDFAttachment()) {
    return null;
  }
  return item;
}

/** 为 reader toolbar button 构建稳定的 DOM id。 */
export function getToolbarButtonID(readerInstanceID: string): string {
  return `mineru-reader-toolbar-${readerInstanceID}`;
}

/** 返回 toolbar button 绑定快照，供注册清理使用。 */
export function getButtonBindingsSnapshot(): Array<
  [string, ReaderToolbarButtonBinding]
> {
  return [...buttonBindings];
}
