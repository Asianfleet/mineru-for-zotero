import { safeReaderOverlayCleanup } from "./diagnostics";
import { hasClassName, isInsideClassTarget } from "./dom";
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

const forwardedWheelEvents = new WeakSet<Event>();

/** Returns a fallback page rectangle based on viewport dimensions when page elements are missing. */
export function createFallbackPageRect(doc: Document): PageRect {
  const root = doc.documentElement ?? null;
  const body = doc.body;
  const width = root?.clientWidth || body?.clientWidth || 1;
  const height = root?.clientHeight || body?.clientHeight || 1;
  return createPageRect(0, 0, width, height);
}

/** Creates the overlay positioning and interaction controller responsible for scroll, hover, and modifier mode synchronization. */
export function createReaderOverlayPositioningController(
  options: ReaderOverlayPositioningControllerOptions,
): ReaderOverlayPositioningController {
  let scheduledHandle: number | null = null;
  let hoverScheduledHandle: number | null = null;
  let intervalHandle: number | null = null;
  let blurCleanupHandle: number | null = null;
  let cleaned = false;
  let modifierActive = false;
  let pendingMouseMove: MouseEvent | null = null;
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
        if (hoverScheduledHandle !== null) {
          cancelHoverFrame();
        }
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
      if (hoverScheduledHandle !== null) {
        cancelHoverFrame();
      }
    },
  };

  /** Coalesces high-frequency scroll and resize updates, refreshing style bridging before each reposition. */
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

  /** Intercepts wheel events on the overlay and preferentially forwards them to underlying PDF elements. */
  function onWheel(event: WheelEvent): void {
    if (forwardedWheelEvents.has(event)) {
      return;
    }
    if (cleaned || !scrollContainer) {
      return;
    }

    const target = event.target as Node | null;
    if (!target || !options.root.contains(target)) {
      return;
    }
    if (isInsideSelectPanelTarget(target)) {
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

  /** Toggles the overlay's interactive mode based on keyboard modifier keys. */
  function onModifierKeyChange(event: Event): void {
    if (cleaned) {
      return;
    }

    const keyEvent = event as KeyboardEvent;
    const active = Boolean(keyEvent.shiftKey || keyEvent.ctrlKey);
    clearPendingModifierBlurCleanup();
    modifierActive = active;
    setOverlayModifierActive(options.root, active);
  }

  /** Handles window blur by resetting modifier state to avoid getting stuck in interactive mode. */
  function onWindowBlur(): void {
    pendingMouseMove = null;
    if (hoverScheduledHandle !== null) {
      cancelHoverFrame();
    }
    if (!modifierActive) {
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
    } else {
      scheduleModifierBlurCleanup();
    }
  }

  /** Synchronizes the hovered box and modifier active state on mouse move. */
  function onMouseMove(event: Event): void {
    if (cleaned) {
      return;
    }

    pendingMouseMove = event as MouseEvent;
    scheduleHoverUpdate();
  }

  /** Coalesces high-frequency mouse move events, processing only the latest position per frame. */
  function scheduleHoverUpdate(): void {
    if (cleaned || hoverScheduledHandle !== null) {
      return;
    }

    let timerRan = false;
    const handle = options.win.setTimeout(() => {
      timerRan = true;
      hoverScheduledHandle = null;
      processPendingMouseMove();
    }, 16);
    if (!timerRan) {
      hoverScheduledHandle = handle;
    }
  }

  /** Synchronizes hovered box and modifier active state according to the latest mouse position. */
  function processPendingMouseMove(): void {
    if (cleaned || !pendingMouseMove) {
      return;
    }

    const mouseEvent = pendingMouseMove;
    pendingMouseMove = null;
    const selectPanelActive =
      options.selectionOptions?.isSelectPanelActive?.() ?? false;
    const formulaMenuActive =
      options.selectionOptions?.isFormulaMenuActive?.() ?? false;
    const actionsOwnerBox = selectPanelActive
      ? null
      : findActionsOwnerBoxFromTarget(options.root, mouseEvent.target);
    const hitBox =
      actionsOwnerBox ??
      (selectPanelActive
        ? null
        : findBoxAtPoint(options.root, mouseEvent.clientX, mouseEvent.clientY, {
            formulaMenuActive,
          }));
    clearPendingModifierBlurCleanup();
    modifierActive = Boolean(mouseEvent.shiftKey || mouseEvent.ctrlKey);
    setOverlayModifierActive(options.root, modifierActive);
    setHoveredBox(options.root, hitBox);
  }

  /** Cancels pending hover frames to avoid asynchronously restoring old hovers after cleanup/blur. */
  function cancelHoverFrame(): void {
    const handle = hoverScheduledHandle;
    hoverScheduledHandle = null;
    pendingMouseMove = null;
    if (handle === null) {
      return;
    }
    options.win.clearTimeout(handle);
  }

  /** Applies the overlay's own multi-selection semantics on Shift- or Ctrl-click. */
  function onReaderModifiedDown(event: Event): void {
    const mouseEvent = event as MouseEvent;
    if (!mouseEvent.shiftKey && !mouseEvent.ctrlKey) {
      return;
    }
    if (mouseEvent.button !== undefined && mouseEvent.button !== 0) {
      return;
    }
    if (
      isInsideSelectPanelTarget(event.target) ||
      isInsideFormulaMenuTarget(event.target)
    ) {
      return;
    }

    const box = findBoxAtPoint(
      options.root,
      mouseEvent.clientX,
      mouseEvent.clientY,
      {
        prioritizeActiveActions: false,
        selectPanelActive:
          options.selectionOptions?.isSelectPanelActive?.() ?? false,
        formulaMenuActive:
          options.selectionOptions?.isFormulaMenuActive?.() ?? false,
      },
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

  /** Defers clearing modifier state after blur to accommodate brief focus switches. */
  function scheduleModifierBlurCleanup(): void {
    clearPendingModifierBlurCleanup();
    blurCleanupHandle = options.win.setTimeout(() => {
      blurCleanupHandle = null;
      modifierActive = false;
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
    }, 250);
  }

  /** Cancels unexecuted blur cleanup timers. */
  function clearPendingModifierBlurCleanup(): void {
    if (blurCleanupHandle === null) {
      return;
    }
    const handle = blurCleanupHandle;
    blurCleanupHandle = null;
    options.win.clearTimeout(handle);
  }
}

/** Determines whether the event target is within a select-copy panel to avoid intercepting native textarea interactions. */
function isInsideSelectPanelTarget(target: EventTarget | null): boolean {
  return isInsideClassTarget(
    target,
    ".mineru-copy-select-panel, .mineru-copy-select-panel-textarea",
    ["mineru-copy-select-panel", "mineru-copy-select-panel-textarea"],
  );
}

/** Determines whether the event target is within a formula copy menu to avoid modifier clicks penetrating as box selections. */
function isInsideFormulaMenuTarget(target: EventTarget | null): boolean {
  return isInsideClassTarget(
    target,
    ".mineru-copy-formula-menu, .mineru-copy-formula-menu-item",
    ["mineru-copy-formula-menu", "mineru-copy-formula-menu-item"],
  );
}

/** Resolves the box owning the actions toolbar from the event target to prevent hover penetration into underlying boxes when floating. */
function findActionsOwnerBoxFromTarget(
  root: HTMLElement,
  target: EventTarget | null,
): HTMLElement | null {
  let element = target as {
    className?: unknown;
    classList?: { contains: (className: string) => boolean };
    parentElement?: unknown;
  } | null;
  let actions: typeof element = null;

  while (element) {
    if (hasClassName(element, "mineru-copy-box-actions")) {
      actions = element;
      break;
    }
    if (element === root) {
      return null;
    }
    element = element.parentElement as typeof element;
  }
  if (!actions) {
    return null;
  }

  element = actions.parentElement as typeof element;
  while (element) {
    if (hasClassName(element, "mineru-copy-box")) {
      return isElementWithinRoot(root, element)
        ? (element as HTMLElement)
        : null;
    }
    if (element === root) {
      return null;
    }
    element = element.parentElement as typeof element;
  }
  return null;
}

/** Checks ancestor relationships compatibility across real DOM and test stubs. */
function isElementWithinRoot(
  root: HTMLElement,
  element: {
    parentElement?: unknown;
  },
): boolean {
  const contains = root.contains?.bind(root);
  if (contains) {
    try {
      return contains(element as Node);
    } catch {
      // Test stubs may not be Nodes; continue checking via the parentElement chain.
    }
  }

  let current: typeof element | null = element;
  while (current) {
    if (current === root) {
      return true;
    }
    current = current.parentElement as typeof current;
  }
  return false;
}

/** Returns the set of containers in the reader that may host PDF scrolling. */
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

/** Returns the primary scroll container used by the overlay by default. */
export function getPrimaryScrollContainer(doc: Document): Element | null {
  return (
    getReaderScrollContainers(doc)[0] ??
    doc.scrollingElement ??
    doc.documentElement ??
    doc.body ??
    null
  );
}

/** Synchronizes overlay page layers according to the positions of PDF.js page elements. */
export function positionPageLayers(doc: Document, root: HTMLDivElement): void {
  const layers = Array.from(
    root.querySelectorAll(".mineru-copy-page-layer"),
  ) as HTMLElement[];
  let pages = pageElementsByRoot.get(root);
  if (!pages) {
    pages = new Map();
    pageElementsByRoot.set(root, pages);
  }

  // Read every page position before writing any style: interleaving reads
  // and writes would force a synchronous layout for each layer, which is
  // expensive on long documents and runs on every scroll frame.
  const placements = layers.map((layer) => {
    const pageNumber = Number(layer.dataset.pageNumber ?? 1);
    const pageElement = getCachedPageElement(doc, pages!, pageNumber);
    return { layer, rect: pageElement?.getBoundingClientRect() ?? null };
  });

  for (const { layer, rect } of placements) {
    if (!rect) {
      layer.hidden = true;
      appliedLayerGeometry.delete(layer);
      continue;
    }
    const left = `${rect.left}px`;
    const top = `${rect.top}px`;
    const width = `${Math.max(1, rect.width)}px`;
    const height = `${Math.max(1, rect.height)}px`;
    const geometry = `${left} ${top} ${width} ${height}`;
    // The positioning interval also fires while nothing moves; leave
    // unchanged layers alone so it does not invalidate styles.
    if (!layer.hidden && appliedLayerGeometry.get(layer) === geometry) {
      continue;
    }
    layer.hidden = false;
    layer.style.left = left;
    layer.style.top = top;
    layer.style.width = width;
    layer.style.height = height;
    appliedLayerGeometry.set(layer, geometry);
  }
}

/** PDF page elements found for each overlay root, keyed by page number. */
const pageElementsByRoot = new WeakMap<HTMLElement, Map<number, Element>>();

/** Last geometry written to each page layer. */
const appliedLayerGeometry = new WeakMap<HTMLElement, string>();

/**
 * Look up a page element once and reuse it while it stays in the document,
 * instead of running up to four selector queries per layer on every pass.
 */
function getCachedPageElement(
  doc: Document,
  pages: Map<number, Element>,
  pageNumber: number,
): Element | null {
  const cached = pages.get(pageNumber);
  if (cached && cached.isConnected !== false) {
    return cached;
  }
  const found = findPageElement(doc, pageNumber);
  if (found) {
    pages.set(pageNumber, found);
  } else {
    pages.delete(pageNumber);
  }
  return found;
}

/** Finds the most suitable PDF page element in the reader document by page number. */
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

/** Preferentially forwards wheel events to real PDF elements beneath the overlay to preserve native scrolling behavior. */
export function forwardWheelToUnderlyingElement(
  doc: Document,
  root: HTMLElement,
  event: WheelEvent,
): boolean {
  const elementFromPoint = doc.elementFromPoint?.bind(doc);
  if (!elementFromPoint) {
    return false;
  }

  let target: Element | null = null;
  const restoreOverlayHitTesting = disableOverlayHitTesting(root);
  try {
    target = elementFromPoint(event.clientX, event.clientY);
  } finally {
    restoreOverlayHitTesting();
  }

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
  forwardedWheelEvents.add(forwarded);
  try {
    target.dispatchEvent(forwarded);
  } finally {
    forwardedWheelEvents.delete(forwarded);
  }
  return true;
}

/** Temporarily disables overlay hit testing to avoid toolbar flicker when forwarding wheel events. */
function disableOverlayHitTesting(root: HTMLElement): () => void {
  const elements = [root, ...Array.from(root.querySelectorAll?.("*") ?? [])];
  const previousPointerEvents = elements.map((element) => ({
    element: element as HTMLElement,
    pointerEvents: (element as HTMLElement).style.pointerEvents,
  }));

  for (const { element } of previousPointerEvents) {
    element.style.pointerEvents = "none";
  }

  return () => {
    for (const { element, pointerEvents } of previousPointerEvents) {
      element.style.pointerEvents = pointerEvents;
    }
  };
}

/** Resolves WheelEvent constructor from the reader window when absent in the plugin global. */
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

/** Drives the scroll container directly by deltas when wheel forwarding is unavailable. */
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

/** Constructs a normalized page rect object. */
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
