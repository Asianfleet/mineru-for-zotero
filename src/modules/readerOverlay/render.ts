import { formatBoxesForCopy, formatFormulaForCopy } from "../copyFormatter";
import { safeReaderOverlayCleanup } from "./diagnostics";
import { readerOverlayString } from "./notice";
import { copyText } from "./copy";
import { setBoxSelectedClass, selectBoxRange } from "./selection";
import type {
  NormalizedBox,
  OverlayMode,
  ReaderOverlayBoxStyle,
  ReaderOverlaySelectionOptions,
} from "./types";

const ACTIVE_BOX_ACTIONS_CLASS = "mineru-copy-box-actions-active";
const SELECT_PANEL_TOP_GUARD_PX = 80;
const VIEWPORT_EDGE_GUARD_PX = 8;
const selectPanelCloseHandlerDocs = new WeakSet<Document>();
const HORIZONTAL_PLACEMENT_CLASSES = [
  "mineru-copy-toolbar-shift-right",
  "mineru-copy-toolbar-shift-left",
  "mineru-copy-select-panel-right",
  "mineru-copy-select-panel-left",
] as const;

/** 把归一化 bbox 转成可直接赋给 DOM style 的百分比定位样式。 */
export function computeBoxStyle(box: NormalizedBox): ReaderOverlayBoxStyle {
  return {
    left: `${formatPercent(box.bbox.x)}`,
    top: `${formatPercent(box.bbox.y)}`,
    width: `${formatPercent(box.bbox.width)}`,
    height: `${formatPercent(box.bbox.height)}`,
  };
}

/** 根据当前 boxes 和 mode 构建完整 overlay root。 */
export function buildReaderOverlayRoot(
  doc: Document,
  boxes: NormalizedBox[],
  mode: Exclude<OverlayMode, "off">,
  selectionOptions: ReaderOverlaySelectionOptions = {},
): HTMLDivElement {
  const root = doc.createElement("div");
  root.className = `mineru-copy-overlay-root mineru-copy-mode-${mode}`;
  const selectableRawIndexes = [
    ...(selectionOptions.selectableRawIndexes ?? []),
  ];

  for (const page of groupBoxesByPage(boxes)) {
    const layer = doc.createElement("div");
    layer.className = "mineru-copy-page-layer";
    layer.dataset.pageNumber = String(page.page);

    for (const box of getRenderablePageBoxes(page.boxes)) {
      if (!selectableRawIndexes.includes(box.rawIndex)) {
        selectableRawIndexes.push(box.rawIndex);
      }
      layer.append(createBoxElement(doc, box, selectionOptions));
    }
    root.append(layer);
  }
  selectionOptions.selectableRawIndexes = selectableRawIndexes;
  root.dataset.selectableRawIndexes = selectableRawIndexes.join(",");

  return root;
}

/** 安全移除 overlay root，兼容 dead object teardown。 */
export function removeReaderOverlayRoot(root: Element | null): void {
  safeReaderOverlayCleanup(() => root?.remove());
}

/** 创建单个 box 的 DOM 节点，并挂载选择与复制交互。 */
export function createBoxElement(
  doc: Document,
  box: NormalizedBox,
  selectionOptions: ReaderOverlaySelectionOptions,
): HTMLDivElement {
  const element = doc.createElement("div");
  element.className = "mineru-copy-box";
  element.dataset.rawIndex = String(box.rawIndex);
  element.dataset.mineruBoxType = box.type;
  Object.assign(element.style, computeBoxStyle(box));
  setBoxSelectedClass(
    element,
    selectionOptions.selectedRawIndexes?.has(box.rawIndex) ?? false,
  );
  element.addEventListener("mousedown", (event) => {
    const mouseEvent = event as MouseEvent;
    if (!mouseEvent.shiftKey && !mouseEvent.ctrlKey) {
      return;
    }

    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
  });
  element.addEventListener("click", (event) => {
    const mouseEvent = event as MouseEvent;
    if (!mouseEvent.shiftKey && !mouseEvent.ctrlKey) {
      return;
    }

    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    const selectedRawIndexes = selectionOptions.selectedRawIndexes;
    if (!selectedRawIndexes) {
      return;
    }

    if (mouseEvent.shiftKey) {
      selectBoxRange(box.rawIndex, selectionOptions);
    } else if (selectedRawIndexes.has(box.rawIndex)) {
      selectedRawIndexes.delete(box.rawIndex);
    } else {
      selectedRawIndexes.add(box.rawIndex);
    }
    selectionOptions.setSelectionAnchorRawIndex?.(box.rawIndex);
    setBoxSelectedClass(element, selectedRawIndexes.has(box.rawIndex));
    selectionOptions.onSelectionChange?.();
  });
  element.append(createBoxLabel(doc, box), createBoxActions(doc, box));
  return element;
}

/** 为 box 渲染顶部标签。 */
export function createBoxLabel(
  doc: Document,
  box: NormalizedBox,
): HTMLSpanElement {
  const label = doc.createElement("span");
  label.className = "mineru-copy-box-label";
  label.textContent = formatBoxTypeLabel(box.type);
  return label;
}

/** 为 box 渲染复制动作区域，公式与普通文本走不同按钮集合。 */
export function createBoxActions(
  doc: Document,
  box: NormalizedBox,
): HTMLDivElement {
  const actions = doc.createElement("div");
  actions.className =
    "mineru-copy-box-actions mineru-copy-toolbar-below mineru-copy-select-panel-above";
  actions.dataset.rawIndex = String(box.rawIndex);

  const toolbar = doc.createElement("div");
  toolbar.className = "mineru-copy-box-toolbar";
  toolbar.addEventListener("mousedown", stopOverlayActionEvent);
  toolbar.addEventListener("click", stopOverlayActionEvent);
  toolbar.append(
    createToolbarCopyControl(doc, box),
    createToolbarDivider(doc),
    createToolbarButton(doc, {
      action: "select-copy",
      className: "mineru-copy-toolbar-button-select",
      label: readerOverlayString("reader-select-copy-box", "Select copy"),
      onClick: () => {
        closeOpenSelectPanels(doc);
        actions.classList.add("mineru-copy-select-panel-open");
        setBoxActionsActive(actions, true);
        updateBoxActionPlacement(doc, actions);
      },
    }),
  );

  const panel = createSelectCopyPanel(doc, box);
  actions.append(toolbar, panel);
  actions.addEventListener("mouseenter", () => {
    setBoxActionsActive(actions, true);
    updateBoxActionPlacement(doc, actions);
  });
  actions.addEventListener("mouseleave", () => {
    if (!hasClassName(actions, "mineru-copy-select-panel-open")) {
      setBoxActionsActive(actions, false);
    }
  });
  ensureSelectPanelCloseHandlers(doc);
  return actions;
}

interface ToolbarButtonOptions {
  action?: string;
  className: string;
  label: string;
  onClick: () => void;
  showText?: boolean;
}

/** 创建普通文本或公式复制入口。 */
function createToolbarCopyControl(
  doc: Document,
  box: NormalizedBox,
): HTMLButtonElement | HTMLDivElement {
  if (!isFormulaBox(box)) {
    return createToolbarButton(doc, {
      action: "copy",
      className: "mineru-copy-toolbar-button-copy",
      label: readerOverlayString("reader-copy-box", "Copy"),
      onClick: () => {
        copyText(formatBoxesForCopy([box]));
      },
    });
  }

  const group = doc.createElement("div");
  group.className = "mineru-copy-formula-copy-group";
  const label = readerOverlayString(
    "reader-copy-formula-menu",
    "Formula copy options",
  );
  group.title = label;

  const trigger = createToolbarButton(doc, {
    action: "copy",
    className: "mineru-copy-toolbar-button-copy",
    label,
    onClick: () => {},
  });
  const menu = doc.createElement("div");
  menu.className = "mineru-copy-formula-menu";
  menu.title = label;
  menu.append(
    createFormulaMenuItem(
      doc,
      readerOverlayString("reader-copy-formula-with-dollar", "Copy with $"),
      () => {
        copyText(
          formatFormulaForCopy(box.formula ?? box.markdown, "with-dollar"),
        );
      },
    ),
    createFormulaMenuItem(
      doc,
      readerOverlayString(
        "reader-copy-formula-without-dollar",
        "Copy without $",
      ),
      () => {
        copyText(
          formatFormulaForCopy(box.formula ?? box.markdown, "without-dollar"),
        );
      },
    ),
  );
  group.append(trigger, menu);
  return group;
}

/** 创建 toolbar 按钮并阻止事件继续进入 PDF.js 选择逻辑。 */
function createToolbarButton(
  doc: Document,
  options: ToolbarButtonOptions,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = `mineru-copy-toolbar-button ${options.className}`;
  button.title = options.label;
  button.textContent = options.showText ? options.label : "";
  button.setAttribute("aria-label", options.label);
  if (options.action) {
    button.dataset.mineruAction = options.action;
  }
  button.addEventListener("click", (event) => {
    stopOverlayActionEvent(event);
    options.onClick();
  });
  return button;
}

/** 创建 toolbar 分隔线。 */
function createToolbarDivider(doc: Document): HTMLSpanElement {
  const divider = doc.createElement("span");
  divider.className = "mineru-copy-toolbar-divider";
  divider.setAttribute("aria-hidden", "true");
  return divider;
}

/** 创建公式复制下拉菜单中的具体复制动作。 */
function createFormulaMenuItem(
  doc: Document,
  label: string,
  onCopy: () => void,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "mineru-copy-formula-menu-item";
  button.textContent = label;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", (event) => {
    stopOverlayActionEvent(event);
    onCopy();
  });
  return button;
}

/** 创建可选中文本的 readonly 面板。 */
function createSelectCopyPanel(
  doc: Document,
  box: NormalizedBox,
): HTMLTextAreaElement {
  const panel = doc.createElement("textarea");
  panel.className = "mineru-copy-select-panel";
  panel.value = getSelectableBoxText(box);
  panel.readOnly = true;
  panel.setAttribute(
    "aria-label",
    readerOverlayString("reader-select-copy-box", "Select copy"),
  );
  panel.addEventListener("mousedown", stopOverlayActionEvent);
  panel.addEventListener("click", stopOverlayActionEvent);
  panel.addEventListener("keydown", stopSelectPanelKeydownEvent);
  return panel;
}

/** 获取 select-copy 面板中允许用户手动选择的文本。 */
export function getSelectableBoxText(box: NormalizedBox): string {
  if (!isFormulaBox(box)) {
    return box.markdown || formatBoxesForCopy([box]);
  }

  if (hasDollarWrappedFormula(box.markdown)) {
    return box.markdown.trim();
  }
  const value = box.formula || box.markdown || formatBoxesForCopy([box]);
  if (hasDollarWrappedFormula(value)) {
    return value;
  }
  return `$${stripOuterDollars(value)}$`;
}

/** 判断公式文本是否已经由单层 dollar 包裹。 */
export function hasDollarWrappedFormula(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 2 && trimmed.startsWith("$") && trimmed.endsWith("$")
  );
}

/** 移除公式文本最外层 dollar，便于统一重新包裹。 */
export function stripOuterDollars(value: string): string {
  let stripped = value.trim();
  while (hasDollarWrappedFormula(stripped)) {
    stripped = stripped.slice(1, -1).trim();
  }
  return stripped;
}

/** 阻止 overlay action 的事件继续触发 PDF.js 或 box 选择。 */
export function stopOverlayActionEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

/** 只隔离 textarea 键盘事件冒泡，保留原生选择与复制行为。 */
function stopSelectPanelKeydownEvent(event: Event): void {
  event.stopPropagation();
}

function closeOpenSelectPanels(doc: Document): void {
  safeReaderOverlayCleanup(() => {
    for (const actions of doc.querySelectorAll(
      ".mineru-copy-select-panel-open",
    )) {
      actions.classList.remove("mineru-copy-select-panel-open");
      setBoxActionsActive(actions as HTMLDivElement, false);
    }
  });
}

function updateBoxActionPlacement(
  doc: Document,
  actions: HTMLDivElement,
): void {
  clearHorizontalPlacement(actions);
  const rect = actions.getBoundingClientRect();
  const viewportHeight = getViewportHeight(doc);
  const viewportWidth = getViewportWidth(doc);
  const toolbarAbove = viewportHeight > 0 && rect.bottom > viewportHeight;
  const panelBelow = rect.top < SELECT_PANEL_TOP_GUARD_PX;
  const shiftRight = viewportWidth > 0 && rect.left < VIEWPORT_EDGE_GUARD_PX;
  const shiftLeft =
    !shiftRight &&
    viewportWidth > 0 &&
    rect.right > viewportWidth - VIEWPORT_EDGE_GUARD_PX;

  actions.classList.toggle("mineru-copy-toolbar-above", toolbarAbove);
  actions.classList.toggle("mineru-copy-toolbar-below", !toolbarAbove);
  actions.classList.toggle("mineru-copy-select-panel-below", panelBelow);
  actions.classList.toggle("mineru-copy-select-panel-above", !panelBelow);
  actions.classList.toggle("mineru-copy-toolbar-shift-right", shiftRight);
  actions.classList.toggle("mineru-copy-toolbar-shift-left", shiftLeft);
  actions.classList.toggle("mineru-copy-select-panel-right", shiftRight);
  actions.classList.toggle("mineru-copy-select-panel-left", shiftLeft);
}

function clearHorizontalPlacement(actions: HTMLDivElement): void {
  actions.classList.remove(...HORIZONTAL_PLACEMENT_CLASSES);
}

function getViewportHeight(doc: Document): number {
  return (
    doc.defaultView?.innerHeight ??
    doc.documentElement?.clientHeight ??
    doc.body?.clientHeight ??
    0
  );
}

function getViewportWidth(doc: Document): number {
  return (
    doc.defaultView?.innerWidth ??
    doc.documentElement?.clientWidth ??
    doc.body?.clientWidth ??
    0
  );
}

function isInsideActions(target: EventTarget | null): boolean {
  const closest = (target as { closest?: (selector: string) => Element | null })
    ?.closest;
  if (typeof closest === "function") {
    try {
      if (closest.call(target, ".mineru-copy-box-actions")) {
        return true;
      }
    } catch {
      // Cross-window dead objects can throw during reader teardown.
    }
  }

  let element = target as {
    className?: unknown;
    classList?: { contains: (className: string) => boolean };
    parentElement?: unknown;
  } | null;
  while (element) {
    if (hasClassName(element, "mineru-copy-box-actions")) {
      return true;
    }
    element = element.parentElement as typeof element;
  }
  return false;
}

function hasClassName(
  element: {
    className?: unknown;
    classList?: { contains: (className: string) => boolean };
  },
  className: string,
): boolean {
  if (element.classList?.contains(className)) {
    return true;
  }
  return (
    typeof element.className === "string" &&
    element.className.split(/\s+/).includes(className)
  );
}

function setBoxActionsActive(actions: HTMLDivElement, active: boolean): void {
  actions.parentElement?.classList.toggle(ACTIVE_BOX_ACTIONS_CLASS, active);
}

function ensureSelectPanelCloseHandlers(doc: Document): void {
  if (selectPanelCloseHandlerDocs.has(doc)) {
    return;
  }
  selectPanelCloseHandlerDocs.add(doc);

  doc.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") {
      closeOpenSelectPanels(doc);
    }
  });
  doc.addEventListener(
    "mousedown",
    (event) => {
      if (!isInsideActions(event.target)) {
        closeOpenSelectPanels(doc);
      }
    },
    true,
  );
}

/** 创建一个不会把点击继续冒泡到 PDF.js 的复制按钮。 */
export function createCopyButton(
  doc: Document,
  label: string,
  onCopy: () => void,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "mineru-copy-button";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCopy();
  });
  return button;
}

/** 判断当前 box 是否属于公式类。 */
export function isFormulaBox(box: NormalizedBox): boolean {
  return [
    "formula",
    "interline_equation",
    "inline_equation",
    "equation",
  ].includes(box.type);
}

/** 过滤出当前页真正需要渲染的 box 集合。 */
export function getRenderablePageBoxes(
  boxes: NormalizedBox[],
): NormalizedBox[] {
  return boxes.filter((box) => !isStructuralReferenceContainerBox(box, boxes));
}

/** 判断 list 容器是否只是 reference boxes 的结构包裹层。 */
export function isStructuralReferenceContainerBox(
  box: NormalizedBox,
  boxes: NormalizedBox[],
): boolean {
  return (
    normalizeBoxType(box.type) === "list" &&
    boxes.some(
      (candidate) =>
        candidate !== box &&
        isReferenceBoxType(candidate.type) &&
        containsBox(box, candidate),
    )
  );
}

/** 判断 child 是否完全位于 container 内部。 */
export function containsBox(
  container: NormalizedBox,
  child: NormalizedBox,
): boolean {
  if (container.page !== child.page) {
    return false;
  }

  const epsilon = 0.0001;
  const containerRight = container.bbox.x + container.bbox.width;
  const containerBottom = container.bbox.y + container.bbox.height;
  const childRight = child.bbox.x + child.bbox.width;
  const childBottom = child.bbox.y + child.bbox.height;

  return (
    child.bbox.x + epsilon >= container.bbox.x &&
    child.bbox.y + epsilon >= container.bbox.y &&
    childRight <= containerRight + epsilon &&
    childBottom <= containerBottom + epsilon
  );
}

/** 把内部 box type 归一成 reader UI 展示标签。 */
export function formatBoxTypeLabel(type: string): string {
  const normalized = normalizeBoxType(type);
  const labels: Record<string, { id: string; fallback: string }> = {
    text: { id: "reader-box-type-text", fallback: "Text" },
    title: { id: "reader-box-type-title", fallback: "Title" },
    list: { id: "reader-box-type-list", fallback: "List" },
    table: { id: "reader-box-type-table", fallback: "Table" },
    table_body: { id: "reader-box-type-table", fallback: "Table" },
    figure: { id: "reader-box-type-image", fallback: "Image" },
    image: { id: "reader-box-type-image", fallback: "Image" },
    image_body: { id: "reader-box-type-image", fallback: "Image" },
    image_caption: {
      id: "reader-box-type-image-caption",
      fallback: "Image caption",
    },
    table_caption: {
      id: "reader-box-type-table-caption",
      fallback: "Table caption",
    },
    page_header: { id: "reader-box-type-page-header", fallback: "Header" },
    header: { id: "reader-box-type-page-header", fallback: "Header" },
    page_footer: { id: "reader-box-type-page-footer", fallback: "Footer" },
    footer: { id: "reader-box-type-page-footer", fallback: "Footer" },
    page_footnote: { id: "reader-box-type-footnote", fallback: "Footnote" },
    footnote: { id: "reader-box-type-footnote", fallback: "Footnote" },
    page_number: { id: "reader-box-type-page-number", fallback: "Page number" },
    ref_text: { id: "reader-box-type-reference", fallback: "Reference" },
    reference: { id: "reader-box-type-reference", fallback: "Reference" },
    citation: { id: "reader-box-type-reference", fallback: "Reference" },
    bibliography: { id: "reader-box-type-reference", fallback: "Reference" },
    formula: { id: "reader-box-type-formula", fallback: "Formula" },
    interline_equation: { id: "reader-box-type-formula", fallback: "Formula" },
    inline_equation: { id: "reader-box-type-formula", fallback: "Formula" },
    equation: { id: "reader-box-type-formula", fallback: "Formula" },
    unknown: { id: "reader-box-type-unknown", fallback: "Unknown" },
  };
  const label = labels[normalized];
  return label
    ? readerOverlayString(label.id as never, label.fallback)
    : normalized;
}

/** 判断当前 type 是否属于 reference 类 box。 */
export function isReferenceBoxType(type: string): boolean {
  return ["ref_text", "reference", "citation", "bibliography"].includes(
    normalizeBoxType(type),
  );
}

/** 统一 box type 的大小写与空白，便于后续判断。 */
export function normalizeBoxType(type: string): string {
  return type.trim().toLowerCase();
}

/** 按页对 boxes 分组，并保持页码升序。 */
export function groupBoxesByPage(
  boxes: NormalizedBox[],
): Array<{ page: number; boxes: NormalizedBox[] }> {
  const pages = new Map<number, NormalizedBox[]>();
  for (const box of boxes) {
    const page = Number.isFinite(box.page) ? box.page : 1;
    const pageBoxes = pages.get(page);
    if (pageBoxes) {
      pageBoxes.push(box);
    } else {
      pages.set(page, [box]);
    }
  }
  return [...pages]
    .sort(([a], [b]) => a - b)
    .map(([page, pageBoxes]) => ({ page, boxes: pageBoxes }));
}

/** 把 0-1 范围的数值格式化成最多四位小数的百分比字符串。 */
export function formatPercent(value: number): string {
  const percent = clamp01(value) * 100;
  return `${Number(percent.toFixed(4))}%`;
}

/** 把非法或越界数值钳制到 0-1 区间。 */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
