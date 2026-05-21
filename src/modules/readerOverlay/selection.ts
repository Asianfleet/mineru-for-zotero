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
): HTMLElement | null {
  const boxes = getBoxElements(root);
  const hoveredBox = boxes.find((box) =>
    box.className.split(/\s+/).includes("mineru-copy-box-hovered"),
  );
  const hoveredRect = hoveredBox?.getBoundingClientRect?.();
  if (
    hoveredBox &&
    hoveredRect &&
    isPointInBoxActionsHoverArea(hoveredBox, hoveredRect, clientX, clientY)
  ) {
    return hoveredBox;
  }

  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    const rect = box.getBoundingClientRect?.();
    if (rect && isPointInRect(clientX, clientY, rect)) {
      return box;
    }
  }
  return null;
}

/** 保持 box actions 下方 hover 区域可命中，避免鼠标轻微下移就丢失 hover。 */
export function isPointInBoxActionsHoverArea(
  box: HTMLElement,
  rect: DOMRect,
  clientX: number,
  clientY: number,
): boolean {
  const actions = getBoxActionsElement(box);
  const actionsRect = actions?.getBoundingClientRect?.() ?? null;
  if (!actionsRect) {
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.bottom &&
      clientY <= rect.bottom + 36
    );
  }

  if (isPointInRect(clientX, clientY, actionsRect)) {
    return true;
  }

  return (
    clientX >= actionsRect.left &&
    clientX <= actionsRect.right &&
    clientY >= Math.min(rect.bottom, actionsRect.top) &&
    clientY <= Math.max(rect.bottom, actionsRect.top)
  );
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
    element.classList.toggle(className, enabled);
    return;
  }

  const currentClassName =
    typeof element.className === "string" ? element.className : "";
  const classes = new Set(currentClassName.split(/\s+/).filter(Boolean));
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
    selectionOptions.selectableRawIndexes ?? [],
    anchorRawIndex,
    rawIndex,
  );
  for (const rangeRawIndex of rangeRawIndexes) {
    selectedRawIndexes.add(rangeRawIndex);
  }
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
