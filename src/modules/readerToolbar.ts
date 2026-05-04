import type { FluentMessageId } from "../../typings/i10n";
import {
  applyReaderOverlayMode,
  clearReaderOverlaySelectionForReader,
  destroyReaderOverlaysByReaderID,
  getReaderOverlayStateForReader,
  getReaderSelectedBoxCount,
} from "./readerOverlay";
import { getString } from "../utils/locale";

type ReaderMessageId =
  | "reader-clear-selection"
  | "reader-copy-selected-boxes"
  | "reader-disable-plugin"
  | "reader-show-all-boxes"
  | "reader-show-hover-box"
  | "reader-toolbar-label";

export interface ReaderToolbarMenuState {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

export interface ReaderToolbarPanelStore {
  ensure(readerInstanceID: string): ReaderToolbarMenuState;
  isOpen(readerInstanceID: string): boolean;
  toggle(readerInstanceID: string): void;
  close(readerInstanceID: string): void;
  delete(readerInstanceID: string): void;
  clear(): void;
}

export interface ReaderToolbarAnchor {
  parent: Element;
  after?: Element;
}

interface WindowToolbarRegistration {
  cleanup: () => void;
}

interface ReaderToolbarButtonBinding {
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  win: Window;
  cleanup: () => void;
}

export interface ReaderToolbarRegistration {
  windows: WeakMap<Window, WindowToolbarRegistration>;
  registeredWindows: Set<Window>;
}

interface ReaderToolbarDiagnosticState {
  command: string;
  mode: string | null;
  selectedCount: number;
}

const panelStore = createReaderToolbarPanelStore();
const buttonBindings = new Map<string, ReaderToolbarButtonBinding>();
const diagnosticStore = new Map<string, ReaderToolbarDiagnosticState>();

export function createReaderToolbarMenuState(): ReaderToolbarMenuState {
  let open = false;
  return {
    isOpen() {
      return open;
    },
    open() {
      open = true;
    },
    close() {
      open = false;
    },
    toggle() {
      open = !open;
    },
  };
}

export function createReaderToolbarPanelStore(): ReaderToolbarPanelStore {
  const panels = new Map<string, ReaderToolbarMenuState>();
  return {
    ensure(readerInstanceID) {
      let state = panels.get(readerInstanceID);
      if (!state) {
        state = createReaderToolbarMenuState();
        panels.set(readerInstanceID, state);
      }
      return state;
    },
    isOpen(readerInstanceID) {
      return panels.get(readerInstanceID)?.isOpen() ?? false;
    },
    toggle(readerInstanceID) {
      this.ensure(readerInstanceID).toggle();
    },
    close(readerInstanceID) {
      panels.get(readerInstanceID)?.close();
    },
    delete(readerInstanceID) {
      panels.delete(readerInstanceID);
    },
    clear() {
      panels.clear();
    },
  };
}

export function registerReaderToolbar(win: _ZoteroTypes.MainWindow): void {
  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  addon.data.readerToolbar ??= {
    windows: new WeakMap<Window, WindowToolbarRegistration>(),
    registeredWindows: new Set<Window>(),
  };

  if (addon.data.readerToolbar.registeredWindows.has(win)) {
    return;
  }

  const registration = registerReaderToolbarWindow(win);
  addon.data.readerToolbar.windows.set(win, registration);
  addon.data.readerToolbar.registeredWindows.add(win);
}

export function unregisterReaderToolbar(win?: Window): void {
  const registration = addon.data.readerToolbar;
  if (!registration) {
    return;
  }

  if (win && registration.registeredWindows.has(win)) {
    registration.windows.get(win)?.cleanup();
    registration.registeredWindows.delete(win);
  }

  if (!win) {
    for (const registeredWindow of registration.registeredWindows) {
      registration.windows.get(registeredWindow)?.cleanup();
    }
    registration.registeredWindows.clear();
  }

  if (!win || registration.registeredWindows.size === 0) {
    addon.data.readerToolbar = undefined;
    for (const readerInstanceID of [...buttonBindings.keys()]) {
      destroyButtonBinding(readerInstanceID);
    }
    panelStore.clear();
  }
}

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

function registerReaderToolbarWindow(
  win: _ZoteroTypes.MainWindow,
): WindowToolbarRegistration {
  let timer = 0;
  let destroyed = false;
  const observer = new win.MutationObserver(() => {
    syncWindowToolbar(win);
  });

  const start = () => {
    if (destroyed) {
      return;
    }
    observer.observe(win.document.documentElement, {
      childList: true,
      subtree: true,
    });
    syncWindowToolbar(win);
    timer = win.setInterval(() => {
      syncWindowToolbar(win);
    }, 500);
  };

  const stop = () => {
    destroyed = true;
    observer.disconnect();
    if (timer) {
      win.clearInterval(timer);
      timer = 0;
    }
    cleanupWindowBindings(win);
  };

  start();
  return { cleanup: stop };
}

function syncWindowToolbar(win: _ZoteroTypes.MainWindow): void {
  const readers = getWindowReaders(win);
  const activeIDs = new Set<string>();

  for (const reader of readers) {
    const binding = ensureButtonBinding(win, reader);
    if (binding) {
      activeIDs.add(reader._instanceID);
    }
  }

  for (const [readerInstanceID, binding] of [...buttonBindings]) {
    if (binding.win !== win) {
      continue;
    }
    if (!activeIDs.has(readerInstanceID)) {
      destroyButtonBinding(readerInstanceID);
      destroyReaderOverlaysByReaderID(readerInstanceID);
      panelStore.delete(readerInstanceID);
    }
  }
}

function ensureButtonBinding(
  win: Window,
  reader: _ZoteroTypes.ReaderInstance,
): ReaderToolbarButtonBinding | null {
  const attachment = getReaderAttachment(reader);
  const doc = getReaderToolbarDocument(reader);
  if (!attachment || !doc) {
    return null;
  }

  const existing = buttonBindings.get(reader._instanceID);
  if (existing) {
    if (!existing.button.isConnected || !existing.menu.isConnected) {
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
  button.style.paddingInline = "8px";
  button.style.minWidth = "auto";
  button.textContent = readerString("reader-toolbar-label");

  const menu = createPanel(doc);
  const menuState = panelStore.ensure(reader._instanceID);
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
  const setHover = (hovered: boolean) => {
    if (!menuState.isOpen()) {
      button.style.backgroundColor = hovered
        ? "var(--fill-quinary, rgba(0, 0, 0, 0.08))"
        : "";
    }
  };
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
  const onDocumentPointerDown = (event: Event) => {
    if (isOutsideToolbarMenu(event, button, menu)) {
      menuState.close();
      sync();
    }
  };
  const onMainWindowPointerDown = (event: Event) => {
    if (isOutsideToolbarMenu(event, button, menu)) {
      menuState.close();
      sync();
    }
  };

  button.addEventListener("mouseenter", () => setHover(true));
  button.addEventListener("mouseleave", () => setHover(false));
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
  const binding = { button, menu, win, cleanup };
  buttonBindings.set(reader._instanceID, binding);
  updateButtonBinding(reader, binding);
  sync();
  return binding;
}

function updateButtonBinding(
  reader: _ZoteroTypes.ReaderInstance,
  binding: ReaderToolbarButtonBinding,
): void {
  binding.button.textContent = readerString("reader-toolbar-label");
  binding.button.title = readerString("reader-toolbar-label");
}

function destroyButtonBinding(readerInstanceID: string): void {
  const binding = buttonBindings.get(readerInstanceID);
  if (!binding) {
    return;
  }
  binding.cleanup();
  buttonBindings.delete(readerInstanceID);
}

function cleanupWindowBindings(win: Window): void {
  for (const [readerInstanceID, binding] of [...buttonBindings]) {
    if (binding.win !== win) {
      continue;
    }
    destroyButtonBinding(readerInstanceID);
    destroyReaderOverlaysByReaderID(readerInstanceID);
    panelStore.delete(readerInstanceID);
  }
}

function createPanel(doc: Document): HTMLDivElement {
  const menu = doc.createElement("div");
  menu.className = "mineru-reader-toolbar-menu";
  menu.hidden = true;
  menu.style.position = "fixed";
  menu.style.zIndex = "2147483647";
  menu.style.minWidth = "220px";
  menu.style.padding = "6px";
  menu.style.border = "1px solid var(--fill-secondary, #c8c8c8)";
  menu.style.borderRadius = "8px";
  menu.style.background = "var(--material-background, #fff)";
  menu.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.18)";
  return menu;
}

function updateMenu(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
  menu: HTMLDivElement,
  sync: () => void,
): void {
  const state = getReaderOverlayStateForReader(reader);
  const activeMode = state?.mode ?? "off";
  menu.replaceChildren();
  menu.append(
    createReaderToolbarCommandButton(
      doc,
      readerString("reader-show-all-boxes"),
      () => {
        runReaderToolbarCommand(reader, "show-all-boxes", () => {
          void applyReaderOverlayMode(reader, "all");
        });
        updateMenu(reader, doc, menu, sync);
        sync();
      },
      { active: activeMode === "all" },
    ),
    createReaderToolbarCommandButton(
      doc,
      readerString("reader-show-hover-box"),
      () => {
        runReaderToolbarCommand(reader, "show-hover-box", () => {
          void applyReaderOverlayMode(reader, "hover");
        });
        updateMenu(reader, doc, menu, sync);
        sync();
      },
      { active: activeMode === "hover" },
    ),
    createReaderToolbarCommandButton(
      doc,
      readerString("reader-disable-plugin"),
      () => {
        runReaderToolbarCommand(reader, "disable-plugin", () => {
          void applyReaderOverlayMode(reader, "off");
        });
        updateMenu(reader, doc, menu, sync);
        sync();
      },
      { active: activeMode === "off" },
    ),
    createReaderToolbarCommandButton(
      doc,
      readerString("reader-copy-selected-boxes", {
        count: getReaderSelectedBoxCount(reader),
      }),
      () => {
        runReaderToolbarCommand(reader, "copy-selected-boxes", () => {
          getReaderOverlayStateForReader(reader);
        });
        updateMenu(reader, doc, menu, sync);
        sync();
      },
    ),
    createReaderToolbarCommandButton(
      doc,
      readerString("reader-clear-selection"),
      () => {
        runReaderToolbarCommand(reader, "clear-selection", () => {
          clearReaderOverlaySelectionForReader(reader);
        });
        updateMenu(reader, doc, menu, sync);
        sync();
      },
    ),
    createDiagnosticRow(doc, reader),
  );
}

export function createReaderToolbarCommandButton(
  doc: Document,
  label: string,
  onCommand: () => void,
  options?: { active?: boolean },
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.display = "block";
  button.style.width = "100%";
  button.style.margin = "0";
  button.style.padding = "6px 8px";
  button.style.border = "0";
  button.style.borderRadius = "4px";
  button.style.background = options?.active
    ? "var(--fill-quinary, rgba(0, 0, 0, 0.08))"
    : "transparent";
  button.style.fontWeight = options?.active ? "600" : "400";
  button.style.textAlign = "left";
  button.addEventListener("mouseenter", () => {
    button.style.backgroundColor = "var(--fill-quinary, rgba(0, 0, 0, 0.08))";
  });
  button.addEventListener("mouseleave", () => {
    button.style.backgroundColor = options?.active
      ? "var(--fill-quinary, rgba(0, 0, 0, 0.08))"
      : "";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCommand();
  });
  return button;
}

function runReaderToolbarCommand(
  reader: _ZoteroTypes.ReaderInstance,
  command: string,
  action: () => void,
): void {
  const beforeState = getReaderOverlayStateForReader(reader);
  emitReaderToolbarDiagnostic(reader, "MinerU reader toolbar command", {
    command,
    readerInstanceID: reader._instanceID,
    attachmentKey: reader._item?.key ?? null,
    beforeMode: beforeState?.mode ?? null,
    beforeSelectedCount: beforeState?.selectedRawIndexes.size ?? 0,
  });

  action();

  const afterState = getReaderOverlayStateForReader(reader);
  diagnosticStore.set(reader._instanceID, {
    command,
    mode: afterState?.mode ?? null,
    selectedCount: afterState?.selectedRawIndexes.size ?? 0,
  });
  emitReaderToolbarDiagnostic(reader, "MinerU reader toolbar state", {
    command,
    readerInstanceID: reader._instanceID,
    attachmentKey: reader._item?.key ?? null,
    afterMode: afterState?.mode ?? null,
    afterSelectedCount: afterState?.selectedRawIndexes.size ?? 0,
  });
}

function emitReaderToolbarDiagnostic(
  reader: _ZoteroTypes.ReaderInstance,
  message: string,
  payload: Record<string, unknown>,
): void {
  const text = `[MinerU for Zotero] ${message} ${JSON.stringify(payload)}`;

  try {
    ztoolkit.log(message, payload);
  } catch {
    // Keep diagnostics best-effort; menu commands must not fail because logging fails.
  }

  try {
    Zotero.debug(text);
  } catch {
    // Zotero.debug may be unavailable in isolated test/runtime contexts.
  }

  const consoles = new Set<Console>();
  if (typeof console !== "undefined") {
    consoles.add(console);
  }
  const readerConsole = reader._iframeWindow?.console;
  if (readerConsole) {
    consoles.add(readerConsole);
  }

  try {
    const mainWindowConsole = Zotero.getMainWindow?.().console;
    if (mainWindowConsole) {
      consoles.add(mainWindowConsole);
    }
  } catch {
    // The main window is not always available during teardown.
  }

  for (const targetConsole of consoles) {
    targetConsole.info(text);
  }
}

function createDiagnosticRow(
  doc: Document,
  reader: _ZoteroTypes.ReaderInstance,
): HTMLDivElement {
  const row = doc.createElement("div");
  row.style.marginTop = "6px";
  row.style.padding = "6px 8px 0";
  row.style.borderTop = "1px solid var(--fill-quaternary, rgba(0, 0, 0, 0.08))";
  row.style.fontSize = "11px";
  row.style.color = "var(--text-secondary, #666)";
  row.style.whiteSpace = "nowrap";
  row.style.overflow = "hidden";
  row.style.textOverflow = "ellipsis";

  const state = diagnosticStore.get(reader._instanceID);
  if (!state) {
    row.textContent = "debug: no command yet";
    return row;
  }

  row.textContent =
    `debug: ${state.command}; mode=${state.mode ?? "null"}; ` +
    `selected=${state.selectedCount}`;
  return row;
}

function isOutsideToolbarMenu(
  event: Event,
  button: HTMLButtonElement,
  menu: HTMLDivElement,
): boolean {
  const target = event.target as Node | null;
  return Boolean(target && !menu.contains(target) && !button.contains(target));
}

function positionMenu(button: HTMLButtonElement, menu: HTMLDivElement): void {
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

function getWindowReaders(
  win: _ZoteroTypes.MainWindow,
): _ZoteroTypes.ReaderInstance[] {
  const tabs = (win as Window & { Zotero_Tabs?: { _tabs?: Array<{ id: string }> } })
    .Zotero_Tabs?._tabs;
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

function getReaderToolbarDocument(
  reader: _ZoteroTypes.ReaderInstance,
): Document | null {
  const doc = reader._iframeWindow?.document ?? null;
  if (!doc?.documentElement) {
    return null;
  }
  return doc;
}

function getReaderAttachment(
  reader: _ZoteroTypes.ReaderInstance,
): Zotero.Item | null {
  const item = reader._item;
  if (!item?.isAttachment() || !item.isPDFAttachment()) {
    return null;
  }
  return item;
}

function getToolbarButtonID(readerInstanceID: string): string {
  return `mineru-reader-toolbar-${readerInstanceID}`;
}

function readerString(
  id: ReaderMessageId,
  args?: Record<string, string | number>,
): string {
  if (args) {
    return getString(id as FluentMessageId, { args });
  }
  return getString(id as FluentMessageId);
}
