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

/** 创建由 reader toolbar button 弹出的浮动菜单面板。 */
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

/** 根据当前 overlay 和选择状态重建菜单内容。 */
export function updateMenu(
  reader: _ZoteroTypes.ReaderInstance,
  doc: Document,
  menu: HTMLDivElement,
  sync: () => void,
  options?: {
    applyMode?: (mode: ReaderOverlayMode) => void | Promise<unknown>;
  },
): void {
  const currentMode = (getReaderOverlayStateForReader(reader)?.mode ??
    "off") as ReaderOverlayMode;
  const applyMode: (mode: ReaderOverlayMode) => void | Promise<unknown> =
    options?.applyMode ??
    ((mode: ReaderOverlayMode) => applyReaderOverlayMode(reader, mode));
  const modeGroup = doc.createElement("div");
  modeGroup.className = "group";
  modeGroup.append(
    createReaderToolbarModeGroup(
      doc,
      currentMode,
      /** 应用选中的 overlay 模式并刷新菜单状态。 */
      (mode) => {
        void runReaderToolbarCommand(
          reader,
          `set-mode-${mode}`,
          /** 将选中的 overlay 模式应用到当前 reader。 */
          () => applyMode(mode),
        ).finally(() => {
          updateMenu(reader, doc, menu, sync, options);
          sync();
        });
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
    /** 复制当前选择，或回退为完整 Markdown。 */
    onCopy() {
      runReaderToolbarCommand(
        reader,
        "copy-selected-boxes",
        /** 分发当前 reader 选择内容的复制行为。 */
        () => {
          return copySelectedBoxesForReader(reader);
        },
      );
      updateMenu(reader, doc, menu, sync);
      sync();
    },
    /** 清空当前选择并重新渲染 overlay。 */
    onClear() {
      runReaderToolbarCommand(
        reader,
        "clear-selection",
        /** 在重新渲染 reader overlay 之前清空 overlay 选择。 */
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

/** 创建选择数量以及复制/清空操作行。 */
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

/** 为操作行创建标签和已选 box 数量徽标。 */
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

/** 创建用于选择操作的图标命令按钮。 */
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

/** 根据是否选中了 box 选择复制操作标签。 */
export function getReaderToolbarCopyLabel(options: {
  copySelectedLabel: string;
  copyFullMarkdownLabel: string;
  selectedCount: number;
}): string {
  return options.selectedCount > 0
    ? options.copySelectedLabel
    : options.copyFullMarkdownLabel;
}

/** 创建仅图标的命令按钮，并提供可访问的 label 文本。 */
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

/** 为 toolbar 菜单创建分组的模式切换行。 */
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
        /** 将选中的模式回传给模式组命令处理器。 */
        () => {
          onCommand(entry.mode);
        },
      ),
    );
  }

  option.append(label, group);
  return option;
}

/** 创建一个模式切换按钮。 */
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
    /** 处理模式按钮点击，并阻止原生 toolbar 冒泡。 */
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

/** 创建带 reader-popup 样式的文本命令按钮。 */
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
    /** 为命令按钮应用悬停背景样式。 */
    () => {
      button.style.backgroundColor = "var(--fill-quinary, rgba(0, 0, 0, 0.08))";
    },
  );
  button.addEventListener(
    "mouseleave",
    /** 清除命令按钮的悬停背景样式。 */
    () => {
      button.style.backgroundColor = "";
    },
  );
  button.addEventListener(
    "click",
    /** 执行命令按钮动作，并阻止原生 toolbar 冒泡。 */
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onCommand();
    },
  );
  return button;
}

/** 渲染基于图片的 toolbar button，在没有 URI 时回退为文本。 */
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

/** 渲染内联 SVG button 内容，在没有 SVG 内容时回退为文本。 */
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
