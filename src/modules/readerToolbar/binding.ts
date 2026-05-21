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

/** Finds the PDF reader toolbar location where the MinerU button should mount. */
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

/** Ensures a reader has a toolbar button and floating menu binding. */
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
  /** Synchronizes the menu visibility and button active styling. */
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
  /** Applies hover styling while the menu is closed. */
  const setHover = (hovered: boolean) => {
    if (!menuState.isOpen()) {
      button.style.backgroundColor = hovered
        ? "var(--fill-quinary, rgba(0, 0, 0, 0.08))"
        : "";
    }
  };
  /** Toggles the toolbar menu from a primary mouse click. */
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
  /** Closes the menu when the reader document receives an outside pointer event. */
  const onDocumentPointerDown = (event: Event) => {
    if (isOutsideToolbarMenu(event, button, menu)) {
      menuState.close();
      sync();
    }
  };
  /** Closes the menu when the Zotero main window receives an outside pointer event. */
  const onMainWindowPointerDown = (event: Event) => {
    if (isOutsideToolbarMenu(event, button, menu)) {
      menuState.close();
      sync();
    }
  };

  button.addEventListener(
    "mouseenter",
    /** Applies hover styling when the pointer enters the toolbar button. */
    () => setHover(true),
  );
  button.addEventListener(
    "mouseleave",
    /** Clears hover styling when the pointer leaves the toolbar button. */
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

  /** Removes DOM listeners and toolbar nodes for this binding. */
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

/** Refreshes toolbar button content for an existing reader binding. */
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

/** Applies the current toolbar icon state to the reader toolbar button. */
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

/** Destroys a single reader toolbar button binding. */
export function destroyButtonBinding(readerInstanceID: string): void {
  const binding = buttonBindings.get(readerInstanceID);
  if (!binding) {
    return;
  }
  binding.cleanup();
  buttonBindings.delete(readerInstanceID);
}

/** Destroys every toolbar binding owned by a main window. */
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

/** Returns whether an event target is outside both the toolbar button and menu. */
export function isOutsideToolbarMenu(
  event: Event,
  button: HTMLButtonElement,
  menu: HTMLDivElement,
): boolean {
  const target = event.target as Node | null;
  return Boolean(target && !menu.contains(target) && !button.contains(target));
}

/** Positions the floating menu near the reader toolbar button. */
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

/** Gets all PDF reader instances in a Zotero main window. */
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

/** Gets the PDF reader iframe document when it is ready for toolbar insertion. */
export function getReaderToolbarDocument(
  reader: _ZoteroTypes.ReaderInstance,
): Document | null {
  const doc = reader._iframeWindow?.document ?? null;
  if (!doc?.documentElement) {
    return null;
  }
  return doc;
}

/** Gets the active PDF attachment backing a reader instance. */
export function getReaderAttachment(
  reader: _ZoteroTypes.ReaderInstance,
): Zotero.Item | null {
  const item = reader._item;
  if (!item?.isAttachment() || !item.isPDFAttachment()) {
    return null;
  }
  return item;
}

/** Builds a stable DOM id for the reader toolbar button. */
export function getToolbarButtonID(readerInstanceID: string): string {
  return `mineru-reader-toolbar-${readerInstanceID}`;
}

/** Returns a snapshot of toolbar button bindings for registration cleanup. */
export function getButtonBindingsSnapshot(): Array<
  [string, ReaderToolbarButtonBinding]
> {
  return [...buttonBindings];
}
