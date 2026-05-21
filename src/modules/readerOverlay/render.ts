import { formatBoxesForCopy, formatFormulaForCopy } from "../copyFormatter";
import { safeReaderOverlayCleanup } from "./diagnostics";
import { readerOverlayString } from "./notice";
import { copyText } from "./copy";
import {
  setBoxSelectedClass,
  selectBoxRange,
} from "./selection";
import type {
  NormalizedBox,
  OverlayMode,
  ReaderOverlayBoxStyle,
  ReaderOverlaySelectionOptions,
} from "./types";

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
  actions.className = "mineru-copy-box-actions";
  if (isFormulaBox(box) && box.formula) {
    actions.append(
      createCopyButton(
        doc,
        readerOverlayString("reader-copy-formula-with-dollar", "Copy with $"),
        () => {
          copyText(formatFormulaForCopy(box.formula ?? "", "with-dollar"));
        },
      ),
      createCopyButton(
        doc,
        readerOverlayString(
          "reader-copy-formula-without-dollar",
          "Copy without $",
        ),
        () => {
          copyText(formatFormulaForCopy(box.formula ?? "", "without-dollar"));
        },
      ),
    );
    return actions;
  }

  actions.append(
    createCopyButton(
      doc,
      readerOverlayString("reader-copy-box", "Copy"),
      () => {
        copyText(formatBoxesForCopy([box]));
      },
    ),
  );
  return actions;
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
export function getRenderablePageBoxes(boxes: NormalizedBox[]): NormalizedBox[] {
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
  return label ? readerOverlayString(label.id as never, label.fallback) : normalized;
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
