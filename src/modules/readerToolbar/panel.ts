import {
  applyReaderOverlayMode,
  clearReaderOverlaySelectionForReader,
  copySelectedBoxesForReader,
  getReaderOverlayStateForReader,
  getReaderSelectedBoxCount,
  renderReaderOverlayForReader,
} from "../readerOverlay";
import {
  getReaderToolbarClearSelectionSVG,
  getReaderToolbarCopySelectionSVG,
  getReaderToolbarModeSVG,
  normalizeReaderToolbarModeSVG,
} from "./assets";
import { readerString, runReaderToolbarCommand } from "./commands";
import type { ReaderOverlayMode } from "./types";

/** Creates the floating menu panel shown from the reader toolbar button. */
export function createReaderToolbarPanel(doc: Document): HTMLDivElement {
  const menu = doc.createElement("div");
  menu.className = "appearance-popup mineru-reader-toolbar-menu";
  menu.hidden = true;
  menu.style.position = "fixed";
  menu.style.zIndex = "2147483647";
  menu.style.width = "260px";
  menu.style.minWidth = "180px";
  menu.style.padding = "8px";
  menu.style.border = "1px solid var(--material-border, #d0d0d0)";
  menu.style.borderRadius = "6px";
  menu.style.background = "var(--material-toolbar)";
  menu.style.boxShadow =
    "0 0 3px 0 rgba(0,0,0,.55),0 8px 40px 0 rgba(0,0,0,.25),0 0 3px 0 rgba(255,255,255,.1) inset";
  menu.style.fontFamily =
    'var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif)';
  menu.style.fontSize = "13px";
  return menu;
}

/** Rebuilds the menu contents from current overlay and selection state. */
export function updateMenu(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
  menu: HTMLDivElement,
  sync: () => void,
): void {
  const currentMode = (getReaderOverlayStateForReader(reader)?.mode ??
    "off") as ReaderOverlayMode;
  const modeGroup = doc.createElement("div");
  modeGroup.className = "group";
  modeGroup.append(
    createReaderToolbarModeGroup(
      doc,
      currentMode,
      /** Applies a selected overlay mode and refreshes the menu state. */
      (mode) => {
        runReaderToolbarCommand(
          reader,
          `set-mode-${mode}`,
          /** Applies the selected overlay mode to the current reader. */
          () => {
            return applyReaderOverlayMode(reader, mode);
          },
        );
        updateMenu(reader, doc, menu, sync);
        sync();
      },
    ),
  );

  const commandGroup = doc.createElement("div");
  commandGroup.className = "group";
  createReaderToolbarActionRow(doc, commandGroup, {
    selectionLabel: readerString("reader-selected-boxes-label"),
    copySelectedLabel: readerString("reader-copy-selected-boxes"),
    copyFullMarkdownLabel: readerString("reader-copy-full-markdown"),
    selectedCount: getReaderSelectedBoxCount(reader),
    copyIconSVG: getReaderToolbarCopySelectionSVG(),
    clearLabel: readerString("reader-clear-selection"),
    clearIconSVG: getReaderToolbarClearSelectionSVG(),
    /** Copies the current selection or full Markdown fallback. */
    onCopy() {
      runReaderToolbarCommand(
        reader,
        "copy-selected-boxes",
        /** Dispatches copy behavior for the current reader selection. */
        () => {
          return copySelectedBoxesForReader(reader);
        },
      );
      updateMenu(reader, doc, menu, sync);
      sync();
    },
    /** Clears the current selection and rerenders the overlay. */
    onClear() {
      runReaderToolbarCommand(
        reader,
        "clear-selection",
        /** Clears overlay selection before rerendering the reader overlay. */
        () => {
          clearReaderOverlaySelectionForReader(reader);
          return renderReaderOverlayForReader(reader);
        },
      );
      updateMenu(reader, doc, menu, sync);
      sync();
    },
  });

  menu.replaceChildren();
  menu.append(modeGroup, commandGroup);
}

/** Creates the selection count and copy/clear action row. */
export function createReaderToolbarActionRow(
  doc: Document,
  group: HTMLDivElement,
  options: {
    selectionLabel: string;
    copySelectedLabel: string;
    copyFullMarkdownLabel: string;
    selectedCount: number;
    copyIconSVG: string;
    clearLabel: string;
    clearIconSVG: string;
    onCopy: () => void;
    onClear: () => void;
  },
): HTMLDivElement {
  const row = doc.createElement("div");
  row.className = "mineru-reader-toolbar-action-row";
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.justifyContent = "space-between";
  row.style.gap = "8px";
  row.style.width = "100%";

  row.append(
    createReaderToolbarSelectionLabel(
      doc,
      options.selectionLabel,
      options.selectedCount,
    ),
    createReaderToolbarActionButtons(doc, options),
  );
  group.append(row);
  return row;
}

/** Creates the label and selected-box count badge for the action row. */
export function createReaderToolbarSelectionLabel(
  doc: Document,
  label: string,
  selectedCount: number,
): HTMLDivElement {
  const container = doc.createElement("div");
  container.className = "mineru-reader-toolbar-selection-label";
  container.style.display = "inline-flex";
  container.style.alignItems = "center";
  container.style.gap = "6px";
  container.style.minWidth = "0";
  container.style.padding = "0";

  const text = doc.createElement("span");
  text.textContent = label;
  text.style.paddingBottom = "3px";

  const badge = doc.createElement("span");
  badge.className = "mineru-reader-toolbar-badge";
  badge.textContent = String(selectedCount);
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.justifyContent = "center";
  badge.style.minWidth = "16px";
  badge.style.height = "16px";
  badge.style.padding = "0 5px";
  badge.style.borderRadius = "4px";
  badge.style.background = "var(--fill-quinary, rgba(0, 0, 0, 0.08))";
  badge.style.fontSize = "11px";
  badge.style.lineHeight = "16px";
  badge.style.fontWeight = "600";

  container.append(text, badge);
  return container;
}

/** Creates the icon command buttons for selection actions. */
export function createReaderToolbarActionButtons(
  doc: Document,
  options: {
    copySelectedLabel: string;
    copyFullMarkdownLabel: string;
    selectedCount: number;
    copyIconSVG: string;
    clearLabel: string;
    clearIconSVG: string;
    onCopy: () => void;
    onClear: () => void;
  },
): HTMLDivElement {
  const actions = doc.createElement("div");
  actions.className = "mineru-reader-toolbar-action-buttons";
  actions.style.display = "inline-flex";
  actions.style.alignItems = "center";
  actions.style.gap = "4px";
  actions.append(
    createReaderToolbarIconCommandButton(
      doc,
      getReaderToolbarCopyLabel(options),
      options.copyIconSVG,
      options.onCopy,
    ),
    createReaderToolbarIconCommandButton(
      doc,
      options.clearLabel,
      options.clearIconSVG,
      options.onClear,
    ),
  );
  return actions;
}

/** Chooses the copy action label based on whether boxes are selected. */
export function getReaderToolbarCopyLabel(options: {
  copySelectedLabel: string;
  copyFullMarkdownLabel: string;
  selectedCount: number;
}): string {
  return options.selectedCount > 0
    ? options.copySelectedLabel
    : options.copyFullMarkdownLabel;
}

/** Creates an icon-only command button with accessible label text. */
export function createReaderToolbarIconCommandButton(
  doc: Document,
  label: string,
  svg: string,
  onCommand: () => void,
): HTMLButtonElement {
  const button = createReaderToolbarCommandButton(doc, "", onCommand);
  button.className = "mineru-reader-toolbar-icon-command";
  button.style.display = "inline-flex";
  button.style.alignItems = "center";
  button.style.justifyContent = "center";
  button.style.width = "24px";
  button.style.height = "24px";
  button.style.padding = "0";
  button.style.color = "var(--fill-secondary)";
  button.title = label;
  button.setAttribute("aria-label", label);

  setReaderToolbarInlineSVGButtonContent(button, label, svg);
  const icon = button.firstElementChild as HTMLElement | null;
  if (icon) {
    icon.style.display = "block";
    icon.style.width = "16px";
    icon.style.height = "16px";
    icon.style.pointerEvents = "none";
  }
  return button;
}

/** Creates the grouped mode toggle row for the toolbar menu. */
export function createReaderToolbarModeGroup(
  doc: Document,
  currentMode: ReaderOverlayMode,
  onCommand: (mode: ReaderOverlayMode) => void,
): HTMLDivElement {
  const option = doc.createElement("div");
  option.className = "option";
  option.style.display = "flex";
  option.style.justifyContent = "space-between";
  option.style.padding = "0 0 8px 0";

  const label = doc.createElement("label");
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.textContent = readerString("reader-mode-group-label");

  const group = doc.createElement("div");
  group.className = "split-toggle";
  group.setAttribute("data-tabstop", "1");

  const modes: Array<{ mode: ReaderOverlayMode; label: string }> = [
    { mode: "all", label: readerString("reader-show-all-boxes") },
    { mode: "hover", label: readerString("reader-show-hover-box") },
    { mode: "off", label: readerString("reader-disable-plugin") },
  ];

  for (const entry of modes) {
    group.append(
      createReaderToolbarModeButton(
        doc,
        entry.label,
        entry.mode,
        currentMode === entry.mode,
        /** Sends the selected mode back to the mode group command handler. */
        () => {
          onCommand(entry.mode);
        },
      ),
    );
  }

  option.append(label, group);
  return option;
}

/** Creates one mode toggle button. */
export function createReaderToolbarModeButton(
  doc: Document,
  label: string,
  mode: ReaderOverlayMode,
  active: boolean,
  onCommand: () => void,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = active ? "active" : "";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.addEventListener(
    "click",
    /** Handles mode button clicks without native toolbar propagation. */
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCommand();
    },
  );
  setReaderToolbarInlineSVGButtonContent(
    button,
    label,
    getReaderToolbarModeSVG(mode),
  );
  return button;
}

/** Creates a text command button with reader-popup styling. */
export function createReaderToolbarCommandButton(
  doc: Document,
  label: string,
  onCommand: () => void,
  _options?: { active?: boolean },
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.display = "block";
  button.style.width = "100%";
  button.style.margin = "0";
  button.style.padding = "4px 8px";
  button.style.border = "0";
  button.style.borderRadius = "4px";
  button.style.background = "transparent";
  button.style.fontFamily =
    'var(--font-family, "Microsoft YaHei UI", "Microsoft YaHei", sans-serif)';
  button.style.fontSize = "13px";
  button.style.fontWeight = "400";
  button.style.lineHeight = "1.35";
  button.style.textAlign = "left";
  button.addEventListener(
    "mouseenter",
    /** Applies hover background styling for command buttons. */
    () => {
      button.style.backgroundColor = "var(--fill-quinary, rgba(0, 0, 0, 0.08))";
    },
  );
  button.addEventListener(
    "mouseleave",
    /** Clears hover background styling for command buttons. */
    () => {
      button.style.backgroundColor = "";
    },
  );
  button.addEventListener(
    "click",
    /** Runs the command button action without native toolbar propagation. */
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCommand();
    },
  );
  return button;
}

/** Renders an image-backed toolbar button, falling back to text without an URI. */
export function setReaderToolbarIconButtonContent(
  button: HTMLButtonElement,
  doc: Document,
  label: string,
  iconURI: string,
): void {
  if (!iconURI) {
    button.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    return;
  }

  const existingIcon = button.firstElementChild as HTMLImageElement | null;
  if (
    !existingIcon ||
    existingIcon.tagName.toLowerCase() !== "img" ||
    existingIcon.src !== iconURI
  ) {
    const icon = doc.createElement("img");
    icon.src = iconURI;
    icon.alt = "";
    icon.draggable = false;
    icon.style.display = "block";
    icon.style.width = "16px";
    icon.style.height = "16px";
    icon.style.pointerEvents = "none";
    button.replaceChildren(icon);
  }

  button.title = label;
  button.setAttribute("aria-label", label);
}

/** Renders inline SVG button content, falling back to text without SVG content. */
export function setReaderToolbarInlineSVGButtonContent(
  button: HTMLButtonElement,
  label: string,
  svg: string,
): void {
  if (svg) {
    button.innerHTML = normalizeReaderToolbarModeSVG(svg);
  } else {
    button.textContent = label;
  }
  button.title = label;
  button.setAttribute("aria-label", label);
}
