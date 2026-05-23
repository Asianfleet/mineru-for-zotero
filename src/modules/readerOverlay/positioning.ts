import { safeReaderOverlayCleanup } from "./diagnostics";
import {
  applyReaderOverlayBoxSelectionFromElement,
  findBoxAtPoint,
  isEventTarget,
  setHoveredBox,
  setOverlayModifierActive,
} from "./selection";
import { ensureReaderOverlayStyles } from "./styles";
import type {
  PageRect,
  ReaderOverlayPositioningController,
  ReaderOverlayPositioningControllerOptions,
} from "./types";
import { getReaderOverlayEventWindows } from "./windows";

/** 在缺少 page 元素时，返回基于视口尺寸的后备页矩形。 */
export function createFallbackPageRect(doc: Document): PageRect {
  const root = doc.documentElement ?? null;
  const body = doc.body;
  const width = root?.clientWidth || body?.clientWidth || 1;
  const height = root?.clientHeight || body?.clientHeight || 1;
  return createPageRect(0, 0, width, height);
}

/** 创建 overlay 的定位与交互控制器，负责滚动、hover 与 modifier 模式同步。 */
export function createReaderOverlayPositioningController(
  options: ReaderOverlayPositioningControllerOptions,
): ReaderOverlayPositioningController {
  let scheduledHandle: number | null = null;
  let intervalHandle: number | null = null;
  let blurCleanupHandle: number | null = null;
  let cleaned = false;
  let modifierActive = false;
  const scrollContainer = getPrimaryScrollContainer(options.doc);
  const scrollContainers = getReaderScrollContainers(options.doc);
  const eventWindows = getReaderOverlayEventWindows(options.win);
  const readerDocumentEventTarget = isEventTarget(options.doc)
    ? options.doc
    : null;

  options.win.addEventListener("scroll", schedule, true);
  options.win.addEventListener("resize", schedule);
  options.win.addEventListener("wheel", onWheel, {
    capture: true,
    passive: false,
  });
  for (const eventWindow of eventWindows) {
    eventWindow.addEventListener("keydown", onModifierKeyChange);
    eventWindow.addEventListener("keyup", onModifierKeyChange);
    eventWindow.addEventListener("blur", onWindowBlur);
    eventWindow.addEventListener("pointerdown", onReaderModifiedDown, {
      capture: true,
      passive: false,
    });
    eventWindow.addEventListener("mousedown", onReaderModifiedDown, {
      capture: true,
      passive: false,
    });
  }
  options.win.addEventListener("mousemove", onMouseMove);
  options.win.addEventListener("pointermove", onMouseMove);
  readerDocumentEventTarget?.addEventListener(
    "pointerdown",
    onReaderModifiedDown,
    {
      capture: true,
      passive: false,
    },
  );
  readerDocumentEventTarget?.addEventListener(
    "mousedown",
    onReaderModifiedDown,
    {
      capture: true,
      passive: false,
    },
  );
  for (const container of scrollContainers) {
    container.addEventListener("scroll", schedule, true);
  }
  intervalHandle = options.win.setInterval(schedule, options.intervalMS ?? 500);

  schedule();

  return {
    schedule,
    cleanup() {
      if (cleaned) {
        return;
      }
      cleaned = true;
      safeReaderOverlayCleanup(() =>
        options.win.removeEventListener("scroll", schedule, true),
      );
      safeReaderOverlayCleanup(() =>
        options.win.removeEventListener("resize", schedule),
      );
      safeReaderOverlayCleanup(() =>
        options.win.removeEventListener("wheel", onWheel, true),
      );
      for (const eventWindow of eventWindows) {
        safeReaderOverlayCleanup(() =>
          eventWindow.removeEventListener("keydown", onModifierKeyChange),
        );
        safeReaderOverlayCleanup(() =>
          eventWindow.removeEventListener("keyup", onModifierKeyChange),
        );
        safeReaderOverlayCleanup(() =>
          eventWindow.removeEventListener("blur", onWindowBlur),
        );
        safeReaderOverlayCleanup(() =>
          eventWindow.removeEventListener(
            "pointerdown",
            onReaderModifiedDown,
            true,
          ),
        );
        safeReaderOverlayCleanup(() =>
          eventWindow.removeEventListener(
            "mousedown",
            onReaderModifiedDown,
            true,
          ),
        );
      }
      safeReaderOverlayCleanup(() =>
        options.win.removeEventListener("mousemove", onMouseMove),
      );
      safeReaderOverlayCleanup(() =>
        options.win.removeEventListener("pointermove", onMouseMove),
      );
      if (readerDocumentEventTarget) {
        safeReaderOverlayCleanup(() =>
          readerDocumentEventTarget.removeEventListener(
            "pointerdown",
            onReaderModifiedDown,
            true,
          ),
        );
        safeReaderOverlayCleanup(() =>
          readerDocumentEventTarget.removeEventListener(
            "mousedown",
            onReaderModifiedDown,
            true,
          ),
        );
      }
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
      for (const container of scrollContainers) {
        safeReaderOverlayCleanup(() =>
          container.removeEventListener("scroll", schedule, true),
        );
      }
      if (intervalHandle !== null) {
        const handle = intervalHandle;
        safeReaderOverlayCleanup(() => options.win.clearInterval(handle));
        intervalHandle = null;
      }
      if (blurCleanupHandle !== null) {
        const handle = blurCleanupHandle;
        safeReaderOverlayCleanup(() => options.win.clearTimeout(handle));
        blurCleanupHandle = null;
      }
      if (scheduledHandle === null) {
        return;
      }

      const handle = scheduledHandle;
      if (options.win.cancelAnimationFrame) {
        safeReaderOverlayCleanup(() =>
          options.win.cancelAnimationFrame(handle),
        );
      } else {
        safeReaderOverlayCleanup(() => options.win.clearTimeout(handle));
      }
      scheduledHandle = null;
    },
  };

  /** 合并高频滚动与 resize 更新，并在每次定位前刷新样式桥接。 */
  function schedule(): void {
    if (cleaned || scheduledHandle !== null) {
      return;
    }

    const requestFrame = options.win.requestAnimationFrame;
    if (requestFrame) {
      scheduledHandle = requestFrame.call(options.win, () => {
        scheduledHandle = null;
        if (!cleaned) {
          ensureReaderOverlayStyles(options.doc);
          options.reposition();
        }
      });
      return;
    }

    scheduledHandle = options.win.setTimeout(() => {
      scheduledHandle = null;
      if (!cleaned) {
        ensureReaderOverlayStyles(options.doc);
        options.reposition();
      }
    }, 16);
  }

  /** 拦截 overlay 上的滚轮事件，并优先转发给底层 PDF 元素。 */
  function onWheel(event: WheelEvent): void {
    if (cleaned || !scrollContainer) {
      return;
    }

    const target = event.target as Node | null;
    if (!target || !options.root.contains(target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (forwardWheelToUnderlyingElement(options.doc, options.root, event)) {
      return;
    }

    scrollElementBy(
      scrollContainer,
      event.deltaX,
      event.deltaY,
      event.deltaMode,
    );
  }

  /** 根据键盘修饰键切换 overlay 的可交互模式。 */
  function onModifierKeyChange(event: Event): void {
    if (cleaned) {
      return;
    }

    const keyEvent = event as KeyboardEvent;
    const active = keyEvent.shiftKey || keyEvent.ctrlKey;
    clearPendingModifierBlurCleanup();
    modifierActive = active;
    setOverlayModifierActive(options.root, active);
  }

  /** 处理窗口失焦时的 modifier 态回收，避免卡在可交互模式。 */
  function onWindowBlur(): void {
    if (!modifierActive) {
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
    } else {
      scheduleModifierBlurCleanup();
    }
  }

  /** 在鼠标移动时同步 hover box 与 modifier 激活状态。 */
  function onMouseMove(event: Event): void {
    if (cleaned) {
      return;
    }

    const mouseEvent = event as MouseEvent;
    clearPendingModifierBlurCleanup();
    modifierActive = mouseEvent.shiftKey || mouseEvent.ctrlKey;
    setOverlayModifierActive(options.root, modifierActive);
    setHoveredBox(
      options.root,
      findBoxAtPoint(options.root, mouseEvent.clientX, mouseEvent.clientY),
    );
  }

  /** 在按住 Shift 或 Ctrl 点击时走 overlay 自己的多选语义。 */
  function onReaderModifiedDown(event: Event): void {
    const mouseEvent = event as MouseEvent;
    if (!mouseEvent.shiftKey && !mouseEvent.ctrlKey) {
      return;
    }
    if (mouseEvent.button !== undefined && mouseEvent.button !== 0) {
      return;
    }

    const box = findBoxAtPoint(
      options.root,
      mouseEvent.clientX,
      mouseEvent.clientY,
    );
    if (!box) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    applyReaderOverlayBoxSelectionFromElement(
      box,
      mouseEvent.shiftKey,
      options.selectionOptions,
    );
  }

  /** 延迟清理 blur 后的 modifier 态，兼容焦点短暂切换。 */
  function scheduleModifierBlurCleanup(): void {
    clearPendingModifierBlurCleanup();
    blurCleanupHandle = options.win.setTimeout(() => {
      blurCleanupHandle = null;
      modifierActive = false;
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
    }, 250);
  }

  /** 取消尚未执行的 blur cleanup 定时器。 */
  function clearPendingModifierBlurCleanup(): void {
    if (blurCleanupHandle === null) {
      return;
    }
    const handle = blurCleanupHandle;
    blurCleanupHandle = null;
    options.win.clearTimeout(handle);
  }
}

/** 返回 reader 内可能承载 PDF 滚动的容器集合。 */
export function getReaderScrollContainers(doc: Document): Element[] {
  const selectors = [
    "#viewerContainer",
    ".viewerContainer",
    ".pdfViewer",
    ".mainContainer",
    ".reader",
  ];
  const containers = new Set<Element>();
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    if (element) {
      containers.add(element);
    }
  }
  return [...containers];
}

/** 返回 overlay 默认使用的主滚动容器。 */
export function getPrimaryScrollContainer(doc: Document): Element | null {
  return (
    getReaderScrollContainers(doc)[0] ??
    doc.scrollingElement ??
    doc.documentElement ??
    doc.body ??
    null
  );
}

/** 根据 PDF.js page 元素的位置同步 overlay page layer。 */
export function positionPageLayers(doc: Document, root: HTMLDivElement): void {
  for (const layer of Array.from(
    root.querySelectorAll(".mineru-copy-page-layer"),
  ) as HTMLElement[]) {
    const pageNumber = Number(layer.dataset.pageNumber ?? 1);
    const pageElement = findPageElement(doc, pageNumber);
    if (!pageElement) {
      layer.hidden = true;
      continue;
    }

    const rect = pageElement.getBoundingClientRect();
    layer.hidden = false;
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${Math.max(1, rect.width)}px`;
    layer.style.height = `${Math.max(1, rect.height)}px`;
  }
}

/** 通过 page number 在 reader 文档中查找最合适的 PDF page 元素。 */
export function findPageElement(
  doc: Document,
  pageNumber: number,
): Element | null {
  const escapedPageNumber = String(pageNumber).replace(/"/g, '\\"');
  return (
    doc.querySelector(
      `.pdfViewer .page[data-page-number="${escapedPageNumber}"]`,
    ) ??
    doc.querySelector(`.page[data-page-number="${escapedPageNumber}"]`) ??
    doc.querySelector(`.pdfViewer .page[data-page="${escapedPageNumber}"]`) ??
    doc.querySelector(`.page[data-page="${escapedPageNumber}"]`) ??
    null
  );
}

/** 优先把滚轮事件转发给 overlay 下方真实 PDF 元素，保持原生滚动行为。 */
export function forwardWheelToUnderlyingElement(
  doc: Document,
  root: HTMLElement,
  event: WheelEvent,
): boolean {
  const elementFromPoint = doc.elementFromPoint?.bind(doc);
  if (!elementFromPoint) {
    return false;
  }

  const previousDisplay = root.style.display;
  root.style.display = "none";
  const target = elementFromPoint(event.clientX, event.clientY);
  root.style.display = previousDisplay;

  if (!target || root.contains(target)) {
    return false;
  }

  const WheelEventConstructor = getWheelEventConstructor(doc);
  if (!WheelEventConstructor) {
    return false;
  }

  const forwarded = new WheelEventConstructor("wheel", {
    bubbles: true,
    cancelable: true,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  });
  target.dispatchEvent(forwarded);
  return true;
}

/** 兼容插件全局缺失 WheelEvent 时，从 reader window 获取构造器。 */
export function getWheelEventConstructor(
  doc: Document,
): typeof WheelEvent | null {
  const readerWheelEvent = doc.defaultView?.WheelEvent;
  if (readerWheelEvent) {
    return readerWheelEvent;
  }

  if (typeof WheelEvent !== "undefined") {
    return WheelEvent;
  }

  return null;
}

/** 在滚轮无法转发时，直接按 delta 驱动滚动容器。 */
export function scrollElementBy(
  element: Element,
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): void {
  const factor = deltaMode === 1 ? 16 : deltaMode === 2 ? 320 : 1;
  const target = element as HTMLElement & {
    scrollBy?: (options: ScrollToOptions) => void;
  };
  const left = deltaX * factor;
  const top = deltaY * factor;

  if (typeof target.scrollBy === "function") {
    target.scrollBy({ left, top, behavior: "auto" });
    return;
  }

  if (typeof target.scrollLeft === "number") {
    target.scrollLeft += left;
  }
  if (typeof target.scrollTop === "number") {
    target.scrollTop += top;
  }
}

/** 构造标准化的 page rect 对象。 */
export function createPageRect(
  left: number,
  top: number,
  width: number,
  height: number,
): PageRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}
