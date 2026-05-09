import type { NormalizedBox, OverlayMode } from "./domain";
import type { FluentMessageId } from "../../typings/i10n";
import { formatBoxesForCopy, formatFormulaForCopy } from "./copyFormatter";
import { getMinerUStorageRoot } from "./preferenceScript";
import { createStorage } from "./storage";
import { getString } from "../utils/locale";

export type ReaderOverlayKey = `${string}:${string}`;

export interface ReaderOverlayState {
  key: ReaderOverlayKey;
  readerInstanceID: string;
  attachmentKey: string;
  mode: OverlayMode;
  selectedRawIndexes: Set<number>;
  selectionAnchorRawIndex: number | null;
  hoverRawIndex: number | null;
  root: HTMLElement | null;
  rootsByWindow: Map<Window, HTMLElement>;
  cleanupPositioning: (() => void) | null;
  cleanupPositioningByWindow: Map<Window, () => void>;
  renderRevision: number;
}

export interface ReaderOverlayBoxStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

export interface ReaderOverlayPositioningControllerOptions {
  doc: Document;
  win: Window;
  root: HTMLDivElement;
  reposition: () => void;
  selectionOptions?: ReaderOverlaySelectionOptions;
  intervalMS?: number;
}

export interface ReaderOverlayPositioningController {
  schedule(): void;
  cleanup(): void;
}

export interface ReaderOverlaySelectionOptions {
  selectedRawIndexes?: Set<number>;
  selectableRawIndexes?: number[];
  getSelectionAnchorRawIndex?: () => number | null;
  setSelectionAnchorRawIndex?: (rawIndex: number | null) => void;
  onSelectionChange?: () => void;
}

interface PageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const fallbackStates = new Map<ReaderOverlayKey, ReaderOverlayState>();
const READER_OVERLAY_STYLE_ID = "mineru-copy-overlay-styles";
const READER_OVERLAY_THEME_VARIABLES = ["--material-toolbar"] as const;
const READER_OVERLAY_CSS = `
.mineru-copy-overlay-root {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
}

.mineru-copy-page-layer {
  position: fixed;
  pointer-events: none;
}

.mineru-copy-overlay-modifier-active .mineru-copy-page-layer {
  pointer-events: auto;
}

.mineru-copy-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(33, 99, 235, 0.9);
  background: transparent;
  pointer-events: none;
}

.mineru-copy-overlay-modifier-active .mineru-copy-box {
  pointer-events: auto;
}

.mineru-copy-box:hover,
.mineru-copy-box-hovered {
  background: rgba(64, 156, 255, 0.18);
  z-index: 2147483001;
}

.mineru-copy-box-selected {
  border-color: rgba(217, 119, 6, 0.95);
  outline: 1px solid rgba(217, 119, 6, 0.95);
  background: rgba(245, 158, 11, 0.18);
}

.mineru-copy-mode-hover .mineru-copy-box {
  opacity: 0;
  border-color: transparent;
  background: transparent;
}

.mineru-copy-mode-hover .mineru-copy-box:hover,
.mineru-copy-mode-hover .mineru-copy-box-hovered {
  opacity: 1;
  border-color: rgba(33, 99, 235, 0.9);
  background: rgba(64, 156, 255, 0.18);
}

.mineru-copy-mode-hover .mineru-copy-box-selected {
  opacity: 1;
  border-color: rgba(217, 119, 6, 0.95);
  background: rgba(245, 158, 11, 0.18);
}

.mineru-copy-box-label,
.mineru-copy-box-actions {
  display: none;
}

.mineru-copy-box:hover .mineru-copy-box-label,
.mineru-copy-box-hovered .mineru-copy-box-label {
  display: block;
}

.mineru-copy-box:hover .mineru-copy-box-actions,
.mineru-copy-box-hovered .mineru-copy-box-actions {
  display: flex;
}

.mineru-copy-box-label {
  position: absolute;
  left: 0;
  top: 0;
  transform: translateY(-100%);
  padding: 2px 4px;
  border-radius: 3px 3px 0 0;
  background: rgba(33, 99, 235, 0.95);
  color: #fff;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  writing-mode: horizontal-tb;
  pointer-events: none;
}

.mineru-copy-box-actions {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  gap: 4px;
  padding-top: 3px;
}

.mineru-copy-button {
  border: 0;
  border-radius: 5px;
  background: var(--material-toolbar, ButtonFace);
  box-shadow:
    0 0 3px 0 rgba(0, 0, 0, 0.35),
    0 2px 8px 0 rgba(0, 0, 0, 0.22);
  color: inherit;
  font-size: 13px;
  line-height: 1.35;
  padding: 4px 8px;
  white-space: nowrap;
  pointer-events: auto;
}

.mineru-copy-button:hover {
  background: var(--material-toolbar, ButtonFace);
  box-shadow:
    0 0 3px 0 rgba(0, 0, 0, 0.45),
    0 4px 14px 0 rgba(0, 0, 0, 0.28);
}
`;

export function getReaderOverlayKey(
  readerInstanceID: string,
  attachmentKey: string,
): ReaderOverlayKey {
  return `${readerInstanceID}:${attachmentKey}`;
}

export function getReaderOverlayState(
  readerInstanceID: string,
  attachmentKey: string,
): ReaderOverlayState {
  const key = getReaderOverlayKey(readerInstanceID, attachmentKey);
  const states = getOverlayStates();
  const existing = states.get(key);
  if (existing) {
    ensureReaderOverlayStateMaps(existing);
    return existing;
  }

  const state: ReaderOverlayState = {
    key,
    readerInstanceID,
    attachmentKey,
    mode: "off",
    selectedRawIndexes: new Set<number>(),
    selectionAnchorRawIndex: null,
    hoverRawIndex: null,
    root: null,
    rootsByWindow: new Map<Window, HTMLElement>(),
    cleanupPositioning: null,
    cleanupPositioningByWindow: new Map<Window, () => void>(),
    renderRevision: 0,
  };
  states.set(key, state);
  return state;
}

export function getReaderOverlayStateForReader(
  reader: _ZoteroTypes.ReaderInstance,
): ReaderOverlayState | null {
  const attachmentKey = getReaderAttachmentKey(reader);
  if (!attachmentKey) {
    return null;
  }
  return getReaderOverlayState(reader._instanceID, attachmentKey);
}

export function setReaderOverlayModeForReader(
  reader: _ZoteroTypes.ReaderInstance,
  mode: OverlayMode,
): ReaderOverlayState | null {
  const state = getReaderOverlayStateForReader(reader);
  if (!state) {
    return null;
  }
  state.mode = mode;
  return state;
}

export async function applyReaderOverlayMode(
  reader: _ZoteroTypes.ReaderInstance,
  mode: OverlayMode,
): Promise<ReaderOverlayState | null> {
  const state = setReaderOverlayModeForReader(reader, mode);
  if (!state) {
    return null;
  }
  state.renderRevision += 1;
  await renderReaderOverlayForReader(reader, state.renderRevision);
  return state;
}

export async function renderReaderOverlayForReader(
  reader: _ZoteroTypes.ReaderInstance,
  expectedRevision?: number,
): Promise<ReaderOverlayState | null> {
  const state = getReaderOverlayStateForReader(reader);
  if (!state) {
    return null;
  }

  const revision = expectedRevision ?? state.renderRevision;
  const mode = state.mode;

  if (state.mode === "off") {
    cleanupReaderOverlayRoot(state);
    getOverlayStates().delete(state.key);
    return state;
  }

  const windows = getReaderOverlayWindows(reader);
  const attachment = getReaderAttachmentRef(reader);
  if (windows.length === 0 || !attachment) {
    cleanupReaderOverlayRoot(state);
    state.root = null;
    return state;
  }

  let boxes: NormalizedBox[];
  try {
    boxes = await createStorage(getMinerUStorageRoot()).readBoxes(attachment);
  } catch (error) {
    logReaderOverlayDiagnostic("failed to read MinerU boxes", {
      readerInstanceID: reader._instanceID,
      attachmentKey: attachment.key,
      error: error instanceof Error ? error.message : String(error),
    });
    showReaderOverlayNotice("reader-overlay-missing-result");
    state.mode = "off";
    cleanupReaderOverlayRoot(state);
    state.root = null;
    return state;
  }

  if (!isCurrentRenderState(state, revision, mode)) {
    return state;
  }

  cleanupReaderOverlayRoot(state);
  for (const win of windows) {
    const doc = win.document ?? null;
    if (!doc?.documentElement) {
      continue;
    }

    const mountContainer = getReaderOverlayMountContainer(doc);
    const root = buildReaderOverlayRoot(doc, boxes, mode, {
      selectedRawIndexes: state.selectedRawIndexes,
      getSelectionAnchorRawIndex: () => state.selectionAnchorRawIndex,
      setSelectionAnchorRawIndex: (rawIndex) => {
        state.selectionAnchorRawIndex = rawIndex;
      },
      onSelectionChange: () => syncSelectedBoxClasses(state),
    });
    ensureReaderOverlayStyles(doc);
    positionPageLayers(doc, root);
    mountContainer?.append(root);
    const cleanup = createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition: () => positionPageLayers(doc, root),
      selectionOptions: {
        selectedRawIndexes: state.selectedRawIndexes,
        selectableRawIndexes:
          root.dataset.selectableRawIndexes
            ?.split(",")
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value)) ?? [],
        getSelectionAnchorRawIndex: () => state.selectionAnchorRawIndex,
        setSelectionAnchorRawIndex: (rawIndex) => {
          state.selectionAnchorRawIndex = rawIndex;
        },
        onSelectionChange: () => syncSelectedBoxClasses(state),
      },
    }).cleanup;
    state.rootsByWindow.set(win, root);
    state.cleanupPositioningByWindow.set(win, cleanup);
    state.root = root;
    state.cleanupPositioning = cleanup;
  }
  return state;
}

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

export async function copySelectedBoxesForReader(
  reader: _ZoteroTypes.ReaderInstance,
): Promise<string | null> {
  const state = getReaderOverlayStateForReader(reader);
  const attachment = getReaderAttachmentRef(reader);
  if (!state || !attachment || state.selectedRawIndexes.size === 0) {
    return null;
  }

  const boxes = await createStorage(getMinerUStorageRoot()).readBoxes(
    attachment,
  );
  const text = formatSelectedBoxesForCopy(boxes, state.selectedRawIndexes);
  copyText(text);
  return text || null;
}

export function formatSelectedBoxesForCopy(
  boxes: NormalizedBox[],
  selectedRawIndexes: Set<number>,
): string {
  return formatBoxesForCopy(
    boxes.filter((box) => selectedRawIndexes.has(box.rawIndex)),
  );
}

export function setReaderOverlayRootForReader(
  reader: _ZoteroTypes.ReaderInstance,
  root: HTMLElement | null,
): ReaderOverlayState | null {
  const state = getReaderOverlayStateForReader(reader);
  if (!state) {
    return null;
  }
  state.root = root;
  if (root) {
    const win = root.ownerDocument?.defaultView ?? null;
    if (win) {
      ensureReaderOverlayStateMaps(state).rootsByWindow.set(win, root);
    }
  }
  return state;
}

export function getReaderSelectedBoxCount(
  reader: _ZoteroTypes.ReaderInstance,
): number {
  return getReaderOverlayStateForReader(reader)?.selectedRawIndexes.size ?? 0;
}

export function readerOverlayNeedsWindowSync(
  reader: _ZoteroTypes.ReaderInstance,
): boolean {
  const state = getReaderOverlayStateForReader(reader);
  if (!state || state.mode === "off") {
    return false;
  }

  const windows = getReaderOverlayWindows(reader);
  if (windows.length !== state.rootsByWindow.size) {
    return true;
  }

  return windows.some((win) => !state.rootsByWindow.has(win));
}

export function getReaderOverlayWindow(
  reader: _ZoteroTypes.ReaderInstance,
): Window | null {
  return getReaderOverlayWindows(reader).at(-1) ?? null;
}

export function getReaderOverlayWindows(
  reader: _ZoteroTypes.ReaderInstance,
): Window[] {
  const windows = new Set<Window>();
  for (const view of getReaderViews(reader)) {
    const win = view?._iframeWindow ?? null;
    if (win) {
      addReaderOverlayWindowWithDescendants(windows, win);
    }
  }

  if (reader._iframeWindow) {
    addReaderOverlayWindowWithDescendants(windows, reader._iframeWindow);
  }

  return [...windows];
}

function addReaderOverlayWindowWithDescendants(
  windows: Set<Window>,
  win: Window,
): void {
  if (windows.has(win)) {
    return;
  }
  windows.add(win);

  const doc = getWindowDocument(win);
  const frames =
    typeof doc?.querySelectorAll === "function"
      ? (Array.from(doc.querySelectorAll("iframe, frame")) as Element[])
      : [];
  for (const frame of frames) {
    const childWindow = getFrameContentWindow(frame);
    if (childWindow) {
      addReaderOverlayWindowWithDescendants(windows, childWindow);
    }
  }
}

function getFrameContentWindow(frame: Element): Window | null {
  try {
    const win = (frame as HTMLIFrameElement | HTMLFrameElement).contentWindow;
    if (!win?.document?.documentElement) {
      return null;
    }
    return win;
  } catch {
    return null;
  }
}

function getReaderViews(
  reader: _ZoteroTypes.ReaderInstance,
): Array<{ _iframeWindow?: Window | null } | null> {
  const value = reader as _ZoteroTypes.ReaderInstance & {
    _views?: Array<{ _iframeWindow?: Window | null }>;
    _readerViews?: Array<{ _iframeWindow?: Window | null }>;
    _secondaryView?: { _iframeWindow?: Window | null };
  };
  const view = (reader._lastView ?? reader._primaryView ?? null) as {
    _iframeWindow?: Window | null;
  } | null;

  return [
    ...(Array.isArray(value._views) ? value._views : []),
    ...(Array.isArray(value._readerViews) ? value._readerViews : []),
    reader._primaryView as { _iframeWindow?: Window | null } | null,
    value._secondaryView ?? null,
    view,
  ];
}

export function destroyReaderOverlay(key: ReaderOverlayKey): void {
  const state = getOverlayStates().get(key);
  if (!state) {
    return;
  }
  state.renderRevision += 1;
  cleanupReaderOverlayRoot(state);
  getOverlayStates().delete(key);
}

export function destroyReaderOverlaysForReader(
  reader: _ZoteroTypes.ReaderInstance,
): void {
  destroyReaderOverlaysByReaderID(reader._instanceID);
}

export function destroyReaderOverlaysByReaderID(
  readerInstanceID: string,
): void {
  const states = getOverlayStates();
  for (const [key, state] of getOverlayStates()) {
    if (state.readerInstanceID === readerInstanceID) {
      state.renderRevision += 1;
      cleanupReaderOverlayRoot(state);
      states.delete(key);
    }
  }
}

export function destroyAllReaderOverlays(): void {
  for (const state of getOverlayStates().values()) {
    state.renderRevision += 1;
    cleanupReaderOverlayRoot(state);
  }
  getOverlayStates().clear();
}

export function computeBoxStyle(box: NormalizedBox): ReaderOverlayBoxStyle {
  return {
    left: `${formatPercent(box.bbox.x)}`,
    top: `${formatPercent(box.bbox.y)}`,
    width: `${formatPercent(box.bbox.width)}`,
    height: `${formatPercent(box.bbox.height)}`,
  };
}

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

export function removeReaderOverlayRoot(root: Element | null): void {
  safeReaderOverlayCleanup(() => root?.remove());
}

export function createFallbackPageRect(doc: Document): PageRect {
  const root = doc.documentElement ?? null;
  const body = doc.body;
  const width = root?.clientWidth || body?.clientWidth || 1;
  const height = root?.clientHeight || body?.clientHeight || 1;
  return createPageRect(0, 0, width, height);
}

export function createReaderOverlayPositioningController(
  options: ReaderOverlayPositioningControllerOptions,
): ReaderOverlayPositioningController {
  let scheduledHandle: number | null = null;
  let intervalHandle: number | null = null;
  let blurCleanupHandle: number | null = null;
  let cleaned = false;
  let modifierActive = false;
  const scrollContainer = getPrimaryScrollContainer(options.doc);

  const schedule = () => {
    if (cleaned || scheduledHandle !== null) {
      return;
    }

    const requestFrame = options.win.requestAnimationFrame;
    if (requestFrame) {
      scheduledHandle = requestFrame.call(options.win, () => {
        scheduledHandle = null;
        if (!cleaned) {
          options.reposition();
        }
      });
      return;
    }

    scheduledHandle = options.win.setTimeout(() => {
      scheduledHandle = null;
      if (!cleaned) {
        options.reposition();
      }
    }, 16);
  };

  const scrollContainers = getReaderScrollContainers(options.doc);

  options.win.addEventListener("scroll", schedule, true);
  options.win.addEventListener("resize", schedule);
  options.win.addEventListener("wheel", onWheel, {
    capture: true,
    passive: false,
  });
  const eventWindows = getReaderOverlayEventWindows(options.win);
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
  const readerDocumentEventTarget = isEventTarget(options.doc)
    ? options.doc
    : null;
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

  function onWindowBlur(): void {
    if (!modifierActive) {
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
    } else {
      scheduleModifierBlurCleanup();
    }
  }

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

  function scheduleModifierBlurCleanup(): void {
    clearPendingModifierBlurCleanup();
    blurCleanupHandle = options.win.setTimeout(() => {
      blurCleanupHandle = null;
      modifierActive = false;
      setOverlayModifierActive(options.root, false);
      setHoveredBox(options.root, null);
    }, 250);
  }

  function clearPendingModifierBlurCleanup(): void {
    if (blurCleanupHandle === null) {
      return;
    }
    const handle = blurCleanupHandle;
    blurCleanupHandle = null;
    options.win.clearTimeout(handle);
  }
}

function cleanupReaderOverlayRoot(state: ReaderOverlayState): void {
  ensureReaderOverlayStateMaps(state);
  const hadPositioningByWindow = state.cleanupPositioningByWindow.size > 0;
  const hadRootsByWindow = state.rootsByWindow.size > 0;
  for (const cleanup of state.cleanupPositioningByWindow.values()) {
    cleanup();
  }
  state.cleanupPositioningByWindow.clear();
  for (const root of state.rootsByWindow.values()) {
    removeReaderOverlayRoot(root);
  }
  state.rootsByWindow.clear();
  if (!hadPositioningByWindow) {
    state.cleanupPositioning?.();
  }
  state.cleanupPositioning = null;
  if (!hadRootsByWindow) {
    removeReaderOverlayRoot(state.root);
  }
  state.root = null;
}

function syncSelectedBoxClasses(state: ReaderOverlayState): void {
  ensureReaderOverlayStateMaps(state);
  for (const root of state.rootsByWindow.values()) {
    safeReaderOverlayCleanup(() => {
      for (const element of Array.from(
        root.querySelectorAll(".mineru-copy-box"),
      ) as HTMLElement[]) {
        const rawIndex = Number(element.dataset.rawIndex);
        setBoxSelectedClass(
          element,
          Number.isFinite(rawIndex) && state.selectedRawIndexes.has(rawIndex),
        );
      }
    });
  }
}

function setBoxSelectedClass(element: HTMLElement, selected: boolean): void {
  setElementClass(element, "mineru-copy-box-selected", selected);
}

function setOverlayModifierActive(element: HTMLElement, active: boolean): void {
  setElementClass(element, "mineru-copy-overlay-modifier-active", active);
}

function setHoveredBox(
  root: HTMLElement,
  hoveredBox: HTMLElement | null,
): void {
  for (const element of getBoxElements(root)) {
    setElementClass(element, "mineru-copy-box-hovered", element === hoveredBox);
  }
}

function findBoxAtPoint(
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

function isPointInBoxActionsHoverArea(
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

function isPointInRect(
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

function getBoxActionsElement(box: HTMLElement): HTMLElement | null {
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

function getBoxElements(root: HTMLElement): HTMLElement[] {
  if (typeof root.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(root.querySelectorAll(".mineru-copy-box")) as HTMLElement[];
}

function applyReaderOverlayBoxSelectionFromElement(
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

function getReaderOverlayEventWindows(win: Window): Window[] {
  const windows = new Set<Window>();
  let current: Window | null = win;
  while (current && !windows.has(current)) {
    windows.add(current);
    const parent = getParentWindow(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }
  return [...windows];
}

function isEventTarget(value: unknown): value is EventTarget {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as EventTarget).addEventListener === "function" &&
    typeof (value as EventTarget).removeEventListener === "function"
  );
}

function setElementClass(
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

function ensureReaderOverlayStateMaps(
  state: ReaderOverlayState,
): ReaderOverlayState {
  state.rootsByWindow ??= new Map<Window, HTMLElement>();
  state.cleanupPositioningByWindow ??= new Map<Window, () => void>();
  return state;
}

function isCurrentRenderState(
  state: ReaderOverlayState,
  revision: number,
  mode: OverlayMode,
): mode is Exclude<OverlayMode, "off"> {
  return (
    getOverlayStates().get(state.key) === state &&
    state.renderRevision === revision &&
    state.mode === mode &&
    mode !== "off"
  );
}

function getReaderScrollContainers(doc: Document): Element[] {
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

function getPrimaryScrollContainer(doc: Document): Element | null {
  return (
    getReaderScrollContainers(doc)[0] ??
    doc.scrollingElement ??
    doc.documentElement ??
    doc.body ??
    null
  );
}

export function ensureReaderOverlayStyles(doc: Document): void {
  const css = `${createReaderOverlayThemeCss(doc)}${READER_OVERLAY_CSS}`;
  const existingStyle = doc.getElementById(READER_OVERLAY_STYLE_ID);
  if (existingStyle) {
    if (existingStyle.textContent !== css) {
      existingStyle.textContent = css;
    }
    return;
  }

  const style = doc.createElement("style");
  style.id = READER_OVERLAY_STYLE_ID;
  style.textContent = css;
  doc.head?.append(style);
}

function createReaderOverlayThemeCss(doc: Document): string {
  const declarations = READER_OVERLAY_THEME_VARIABLES.flatMap((name) => {
    const value = resolveCssVariableFromWindowTree(doc, name);
    return value ? [`  ${name}: ${value};`] : [];
  });
  return declarations.length > 0
    ? `:root {\n${declarations.join("\n")}\n}\n`
    : "";
}

function resolveCssVariableFromWindowTree(
  doc: Document,
  name: string,
): string | null {
  const firstValue = readCssVariable(doc, name);
  if (firstValue) {
    return firstValue;
  }

  let win = doc.defaultView ?? null;
  const seen = new Set<Window>();
  while (win && !seen.has(win)) {
    seen.add(win);
    const candidateDoc = getWindowDocument(win);
    const value = candidateDoc ? readCssVariable(candidateDoc, name) : null;
    if (value) {
      return value;
    }

    const parent = getParentWindow(win);
    if (!parent || parent === win) {
      return null;
    }
    win = parent;
  }
  return null;
}

function readCssVariable(doc: Document, name: string): string | null {
  const win = doc.defaultView;
  if (!win) {
    return null;
  }

  for (const element of [doc.documentElement, doc.body]) {
    if (!element) {
      continue;
    }
    const computedStyle = win.getComputedStyle(element);
    if (!computedStyle) {
      continue;
    }
    const value = computedStyle.getPropertyValue(name).trim();
    if (isSafeCssCustomPropertyValue(value)) {
      return value;
    }
  }
  return null;
}

function isSafeCssCustomPropertyValue(value: string): boolean {
  return value.length > 0 && !/[;{}]/.test(value);
}

function getWindowDocument(win: Window): Document | null {
  try {
    return win.document ?? null;
  } catch {
    return null;
  }
}

function getParentWindow(win: Window): Window | null {
  try {
    return win.parent ?? null;
  } catch {
    return null;
  }
}

function getOverlayStates(): Map<ReaderOverlayKey, ReaderOverlayState> {
  if (typeof addon === "undefined") {
    return fallbackStates;
  }

  addon.data.readerOverlays ??= new Map<ReaderOverlayKey, ReaderOverlayState>();
  return addon.data.readerOverlays;
}

function getReaderAttachmentKey(
  reader: _ZoteroTypes.ReaderInstance,
): string | null {
  const key = reader._item?.key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

function getReaderAttachmentRef(
  reader: _ZoteroTypes.ReaderInstance,
): { libraryID: number; key: string } | null {
  const item = reader._item;
  const key = item?.key;
  const libraryID = item?.libraryID;
  if (typeof key !== "string" || !key || typeof libraryID !== "number") {
    return null;
  }
  return { libraryID, key };
}

function createBoxElement(
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

function selectBoxRange(
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

function getRawIndexRange(
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

function createBoxLabel(doc: Document, box: NormalizedBox): HTMLSpanElement {
  const label = doc.createElement("span");
  label.className = "mineru-copy-box-label";
  label.textContent = formatBoxTypeLabel(box.type);
  return label;
}

function createBoxActions(doc: Document, box: NormalizedBox): HTMLDivElement {
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

function isFormulaBox(box: NormalizedBox): boolean {
  return [
    "formula",
    "interline_equation",
    "inline_equation",
    "equation",
  ].includes(box.type);
}

function getRenderablePageBoxes(boxes: NormalizedBox[]): NormalizedBox[] {
  return boxes.filter((box) => !isStructuralReferenceContainerBox(box, boxes));
}

function isStructuralReferenceContainerBox(
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

function containsBox(container: NormalizedBox, child: NormalizedBox): boolean {
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

function formatBoxTypeLabel(type: string): string {
  const normalized = normalizeBoxType(type);
  const labels: Record<string, { id: FluentMessageId; fallback: string }> = {
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
  return label ? readerOverlayString(label.id, label.fallback) : normalized;
}

function readerOverlayString(id: FluentMessageId, fallback: string): string {
  try {
    const value = getString(id);
    if (value && value !== id && !value.endsWith(`-${id}`)) {
      return value;
    }
  } catch {
    // Fall through to the built-in fallback text.
  }
  return fallback;
}

function isReferenceBoxType(type: string): boolean {
  return ["ref_text", "reference", "citation", "bibliography"].includes(
    normalizeBoxType(type),
  );
}

function normalizeBoxType(type: string): string {
  return type.trim().toLowerCase();
}

function showReaderOverlayNotice(id: FluentMessageId): void {
  const text = getReaderOverlayNoticeText(id);
  try {
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeTime: 4000,
    })
      .createLine({
        text,
        type: "default",
        progress: 100,
      })
      .show();
  } catch {
    // 提示窗口不能影响 reader 交互。
  }
}

export function getReaderOverlayNoticeText(id: FluentMessageId): string {
  try {
    const value = getString(id);
    if (value && value !== id) {
      return value;
    }
  } catch {
    // Fall through to the built-in fallback text.
  }

  if (id === "reader-overlay-missing-result") {
    return (
      "This PDF does not have a MinerU parse result yet. " +
      "Parse it before enabling boxes."
    );
  }
  return id;
}

function createCopyButton(
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

function copyText(text: string): void {
  if (!text) {
    return;
  }
  new ztoolkit.Clipboard().addText(text, "text/unicode").copy();
}

function groupBoxesByPage(
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

function getReaderOverlayMountContainer(doc: Document): Element | null {
  return doc.body ?? doc.documentElement;
}

function forwardWheelToUnderlyingElement(
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

function getWheelEventConstructor(doc: Document): typeof WheelEvent | null {
  const readerWheelEvent = doc.defaultView?.WheelEvent;
  if (readerWheelEvent) {
    return readerWheelEvent;
  }

  if (typeof WheelEvent !== "undefined") {
    return WheelEvent;
  }

  return null;
}

function scrollElementBy(
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

function createPageRect(
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

function formatPercent(value: number): string {
  const percent = clamp01(value) * 100;
  return `${Number(percent.toFixed(4))}%`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function logReaderOverlayDiagnostic(
  message: string,
  payload: Record<string, unknown>,
): void {
  try {
    ztoolkit.log(`MinerU reader overlay ${message}`, payload);
  } catch {
    // 诊断不能影响 reader 交互。
  }

  try {
    Zotero.debug(
      `[MinerU for Zotero] reader overlay ${message} ${JSON.stringify(payload)}`,
    );
  } catch {
    // 测试或 teardown 阶段可能没有 Zotero.debug。
  }
}

function safeReaderOverlayCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch (error) {
    if (!isDeadObjectError(error)) {
      throw error;
    }
  }
}

function isDeadObjectError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    String(error.message).includes("can't access dead object")
  );
}
