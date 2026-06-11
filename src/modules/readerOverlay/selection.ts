import { safeReaderOverlayCleanup } from "./diagnostics";
import type {
  ReaderOverlaySelectionOptions,
  ReaderOverlayState,
} from "./types";
import { getReaderOverlayStateForReader } from "./state";

/** 清空当前 reader 的 box 选择，并同步更新所有已渲染 root。 */
export function clearReaderOverlaySelectionForReader(
  reader: _ZoteroTypes.ReaderInstance,
): ReaderOverlayState | null {
  const state = getReaderOverlayStateForReader(reader);
  if (!state) {
    return null;
  }
  state.selectedRawIndexes.clear();
  state.selectionAnchorRawIndex = null;
  state.hoverRawIndex = null;
  syncSelectedBoxClasses(state);
  return state;
}

/** 把 state 中的 selectedRawIndexes 同步到所有已渲染 box class。 */
export function syncSelectedBoxClasses(state: ReaderOverlayState): void {
  for (const root of state.rootsByWindow.values()) {
    safeReaderOverlayCleanup(() => {
      for (const element of getBoxElements(root)) {
        const rawIndex = Number(element.dataset.rawIndex);
        setBoxSelectedClass(
          element,
          Number.isFinite(rawIndex) && state.selectedRawIndexes.has(rawIndex),
        );
      }
    });
  }
}

/** 仅切换单个 box 的 selected class。 */
export function setBoxSelectedClass(
  element: HTMLElement,
  selected: boolean,
): void {
  setElementClass(element, "mineru-copy-box-selected", selected);
}

/** 切换 overlay 是否处于 modifier-key 可交互状态。 */
export function setOverlayModifierActive(
  element: HTMLElement,
  active: boolean,
): void {
  setElementClass(element, "mineru-copy-overlay-modifier-active", active);
}

/** 更新 hover 命中的 box，并保持其余 box 的 hover class 清理干净。 */
export function setHoveredBox(
  root: HTMLElement,
  hoveredBox: HTMLElement | null,
): void {
  for (const element of getBoxElements(root)) {
    setElementClass(element, "mineru-copy-box-hovered", element === hoveredBox);
  }
}

/** 根据坐标找到最上层可交互的 overlay box。 */
export function findBoxAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
  options: {
    prioritizeActiveActions?: boolean;
    selectPanelActive?: boolean;
    formulaMenuActive?: boolean;
  } = {},
): HTMLElement | null {
  const boxes = getBoxElements(root);
  const openSelectPanelBox = findOpenSelectPanelBoxAtPoint(
    boxes,
    clientX,
    clientY,
  );
  if (openSelectPanelBox.found) {
    return openSelectPanelBox.box;
  }
  if (options.selectPanelActive) {
    return null;
  }

  const openFormulaMenuBox = findOpenFormulaMenuBoxAtPoint(
    boxes,
    clientX,
    clientY,
  );
  if (openFormulaMenuBox.found) {
    return openFormulaMenuBox.box;
  }
  if (options.formulaMenuActive) {
    return null;
  }

  if (options.prioritizeActiveActions ?? true) {
    const activeBoxes = boxes.filter((box) =>
      hasClassName(box, "mineru-copy-box-actions-active"),
    );
    const activeBox =
      findLastBoxWithVisibleActions(activeBoxes) ??
      findBoxInActionsHoverArea(activeBoxes, clientX, clientY);
    if (activeBox) {
      return activeBox;
    }
  }

  const hoveredBox = boxes.find((box) =>
    box.className.split(/\s+/).includes("mineru-copy-box-hovered"),
  );
  const actionHoveredBox = findBoxInActionsHoverArea(
    hoveredBox ? [hoveredBox] : [],
    clientX,
    clientY,
  );
  if (actionHoveredBox) {
    return actionHoveredBox;
  }

  const visibleActionsBox = findBoxInVisibleActionsHoverArea(
    boxes,
    clientX,
    clientY,
  );
  if (visibleActionsBox) {
    return visibleActionsBox;
  }

  const normalHitTestBoxes = getNormalHitTestBoxes(
    root,
    boxes,
    clientX,
    clientY,
  );
  for (let index = normalHitTestBoxes.length - 1; index >= 0; index -= 1) {
    const box = normalHitTestBoxes[index];
    const rect = box.getBoundingClientRect?.();
    if (rect && isPointInRect(clientX, clientY, rect)) {
      return box;
    }
  }
  return null;
}

function findLastBoxWithVisibleActions(
  boxes: HTMLElement[],
): HTMLElement | null {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    const actions = getBoxActionsElement(box);
    if (actions && isElementVisiblyRected(actions)) {
      return box;
    }
  }
  return null;
}

function findBoxInVisibleActionsHoverArea(
  boxes: HTMLElement[],
  clientX: number,
  clientY: number,
): HTMLElement | null {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    const actions = getBoxActionsElement(box);
    if (!actions || !isElementVisiblyRected(actions)) {
      continue;
    }
    const rect = box.getBoundingClientRect?.();
    if (rect && isPointInBoxActionsHoverArea(box, rect, clientX, clientY)) {
      return box;
    }
  }
  return null;
}

function getNormalHitTestBoxes(
  root: HTMLElement,
  boxes: HTMLElement[],
  clientX: number,
  clientY: number,
): HTMLElement[] {
  const layers = getPageLayerElements(root);
  if (layers.length === 0) {
    return boxes;
  }

  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer.hidden) {
      continue;
    }
    const rect = layer.getBoundingClientRect?.();
    if (rect && isPointInRect(clientX, clientY, rect)) {
      return getBoxElements(layer);
    }
  }
  return boxes;
}

function getPageLayerElements(root: HTMLElement): HTMLElement[] {
  if (typeof root.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(
    root.querySelectorAll(".mineru-copy-page-layer"),
  ) as HTMLElement[];
}

function findOpenSelectPanelBoxAtPoint(
  boxes: HTMLElement[],
  clientX: number,
  clientY: number,
): { found: true; box: HTMLElement | null } | { found: false } {
  const openPanelBoxes = boxes.filter((box) =>
    hasClassName(getBoxActionsElement(box), "mineru-copy-select-panel-open"),
  );
  if (openPanelBoxes.length === 0) {
    return { found: false };
  }

  return {
    found: true,
    box: findBoxInActionsHoverArea(openPanelBoxes, clientX, clientY),
  };
}

function findOpenFormulaMenuBoxAtPoint(
  boxes: HTMLElement[],
  clientX: number,
  clientY: number,
): { found: true; box: HTMLElement | null } | { found: false } {
  const openMenuBoxes = boxes.filter((box) =>
    hasClassName(getBoxActionsElement(box), "mineru-copy-formula-menu-open"),
  );
  if (openMenuBoxes.length === 0) {
    return { found: false };
  }

  return {
    found: true,
    box: findBoxInActionsHoverArea(openMenuBoxes, clientX, clientY),
  };
}

function findBoxInActionsHoverArea(
  boxes: HTMLElement[],
  clientX: number,
  clientY: number,
): HTMLElement | null {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    const rect = box.getBoundingClientRect?.();
    if (rect && isPointInBoxActionsHoverArea(box, rect, clientX, clientY)) {
      return box;
    }
  }
  return null;
}

/** 兼容真实 DOM 与测试桩的 className / classList 判断。 */
function hasClassName(element: HTMLElement | null, className: string): boolean {
  if (element?.classList) {
    return element.classList.contains(className);
  }
  return String(element?.className ?? "")
    .split(/\s+/)
    .includes(className);
}

/** 保持 box actions 下方 hover 区域可命中，避免鼠标轻微下移就丢失 hover。 */
export function isPointInBoxActionsHoverArea(
  box: HTMLElement,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): boolean {
  const actions = getBoxActionsElement(box);
  const actionHoverRects = getBoxActionsHoverRects(actions);
  if (actionHoverRects.length === 0) {
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.bottom &&
      clientY <= rect.bottom + 36
    );
  }

  if (
    actionHoverRects.some((actionRect) =>
      isPointInRect(clientX, clientY, actionRect),
    )
  ) {
    return true;
  }

  const actionsRect = actionHoverRects[0];
  return (
    clientX >= actionsRect.left &&
    clientX <= actionsRect.right &&
    clientY >= Math.min(rect.bottom, actionsRect.top) &&
    clientY <= Math.max(rect.bottom, actionsRect.top)
  );
}

/** 返回 actions 本体和会伸出 box 的浮动子菜单矩形，用于保持 hover 命中。 */
export function getBoxActionsHoverRects(
  actions: HTMLElement | null,
): DOMRect[] {
  if (!actions?.getBoundingClientRect) {
    return [];
  }
  const rects = [actions.getBoundingClientRect()];
  const querySelectorAll = actions.querySelectorAll?.bind(actions);
  if (!querySelectorAll) {
    return rects;
  }
  for (const selector of [
    ".mineru-copy-formula-menu",
    ".mineru-copy-select-panel",
  ]) {
    for (const element of Array.from(
      querySelectorAll(selector),
    ) as HTMLElement[]) {
      const rect = element.getBoundingClientRect?.();
      if (rect) {
        rects.push(rect);
      }
    }
  }
  return rects;
}

/** 判断给定坐标是否落在指定矩形内。 */
export function isPointInRect(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): boolean {
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function isElementVisiblyRected(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect?.();
  return Boolean(
    rect &&
    (rect.width > 0 ||
      rect.height > 0 ||
      rect.right > rect.left ||
      rect.bottom > rect.top),
  );
}

/** 读取 box 上的 action 容器，兼容真实 DOM 与测试桩。 */
export function getBoxActionsElement(box: HTMLElement): HTMLElement | null {
  const querySelector = box.querySelector?.bind(box);
  if (querySelector) {
    return querySelector(".mineru-copy-box-actions") as HTMLElement | null;
  }

  const querySelectorAll = box.querySelectorAll?.bind(box);
  const firstAction = querySelectorAll?.(".mineru-copy-box-actions")[0] as
    | HTMLElement
    | undefined;
  return firstAction ?? null;
}

/** 读取 root 下的全部 overlay box 元素。 */
export function getBoxElements(root: HTMLElement): HTMLElement[] {
  if (typeof root.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(root.querySelectorAll(".mineru-copy-box")) as HTMLElement[];
}

/** 根据点击到的 box 元素更新选择集合，并刷新对应样式。 */
export function applyReaderOverlayBoxSelectionFromElement(
  element: HTMLElement,
  rangeSelection: boolean,
  selectionOptions: ReaderOverlaySelectionOptions | undefined,
): void {
  const selectedRawIndexes = selectionOptions?.selectedRawIndexes;
  if (!selectedRawIndexes) {
    return;
  }

  const rawIndex = Number(element.dataset.rawIndex);
  if (!Number.isFinite(rawIndex)) {
    return;
  }

  if (rangeSelection) {
    selectBoxRange(rawIndex, selectionOptions);
  } else if (selectedRawIndexes.has(rawIndex)) {
    selectedRawIndexes.delete(rawIndex);
  } else {
    selectedRawIndexes.add(rawIndex);
  }
  selectionOptions.setSelectionAnchorRawIndex?.(rawIndex);
  setBoxSelectedClass(element, selectedRawIndexes.has(rawIndex));
  selectionOptions.onSelectionChange?.();
}

/** 判断对象是否支持 add/removeEventListener，以便作为 EventTarget 使用。 */
export function isEventTarget(value: unknown): value is EventTarget {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as EventTarget).addEventListener === "function" &&
    typeof (value as EventTarget).removeEventListener === "function"
  );
}

/** 安全切换 class，兼容真实 DOM 与测试桩对象。 */
export function setElementClass(
  element: HTMLElement,
  className: string,
  enabled: boolean,
): void {
  if (element.classList) {
    if (element.classList.contains(className) === enabled) {
      return;
    }
    element.classList.toggle(className, enabled);
    return;
  }

  const currentClassName =
    typeof element.className === "string" ? element.className : "";
  const classes = new Set(currentClassName.split(/\s+/).filter(Boolean));
  if (classes.has(className) === enabled) {
    return;
  }
  if (enabled) {
    classes.add(className);
  } else {
    classes.delete(className);
  }
  element.className = [...classes].join(" ");
}

/** 按 selectableRawIndexes 范围补齐 Shift 多选。 */
export function selectBoxRange(
  rawIndex: number,
  selectionOptions: ReaderOverlaySelectionOptions,
): void {
  const selectedRawIndexes = selectionOptions.selectedRawIndexes;
  if (!selectedRawIndexes) {
    return;
  }

  const anchorRawIndex =
    selectionOptions.getSelectionAnchorRawIndex?.() ?? null;
  if (anchorRawIndex === null) {
    selectedRawIndexes.add(rawIndex);
    return;
  }

  const rangeRawIndexes = getRawIndexRange(
    getRangeSelectableRawIndexes(selectionOptions, anchorRawIndex, rawIndex),
    anchorRawIndex,
    rawIndex,
  );
  for (const rangeRawIndex of rangeRawIndexes) {
    selectedRawIndexes.add(rangeRawIndex);
  }
}

/** 优先使用过滤后的范围候选；端点不在候选内时回退到完整可选集合。 */
function getRangeSelectableRawIndexes(
  selectionOptions: ReaderOverlaySelectionOptions,
  anchorRawIndex: number,
  rawIndex: number,
): number[] {
  const rangeSelectableRawIndexes =
    selectionOptions.rangeSelectableRawIndexes ?? [];
  if (
    rangeSelectableRawIndexes.includes(anchorRawIndex) &&
    rangeSelectableRawIndexes.includes(rawIndex)
  ) {
    return rangeSelectableRawIndexes;
  }
  return selectionOptions.selectableRawIndexes ?? [];
}

/** 在 selectableRawIndexes 中计算两个 rawIndex 之间的闭区间。 */
export function getRawIndexRange(
  selectableRawIndexes: number[],
  startRawIndex: number,
  endRawIndex: number,
): number[] {
  const startPosition = selectableRawIndexes.indexOf(startRawIndex);
  const endPosition = selectableRawIndexes.indexOf(endRawIndex);
  if (startPosition >= 0 && endPosition >= 0) {
    const start = Math.min(startPosition, endPosition);
    const end = Math.max(startPosition, endPosition);
    return selectableRawIndexes.slice(start, end + 1);
  }

  const start = Math.min(startRawIndex, endRawIndex);
  const end = Math.max(startRawIndex, endRawIndex);
  return selectableRawIndexes.filter(
    (candidate) => candidate >= start && candidate <= end,
  );
}
