import type { NormalizedBox, OverlayMode } from "./domain";
import { getMinerUStorageRoot } from "./preferenceScript";
import { createStorage } from "./storage";

export type ReaderOverlayKey = `${string}:${string}`;

export interface ReaderOverlayState {
  key: ReaderOverlayKey;
  readerInstanceID: string;
  attachmentKey: string;
  mode: OverlayMode;
  selectedRawIndexes: Set<number>;
  hoverRawIndex: number | null;
  root: HTMLElement | null;
  cleanupPositioning: (() => void) | null;
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
  intervalMS?: number;
}

export interface ReaderOverlayPositioningController {
  schedule(): void;
  cleanup(): void;
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

.mineru-copy-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(33, 99, 235, 0.9);
  background: transparent;
  pointer-events: auto;
}

.mineru-copy-box:hover {
  background: rgba(64, 156, 255, 0.18);
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
    return existing;
  }

  const state: ReaderOverlayState = {
    key,
    readerInstanceID,
    attachmentKey,
    mode: "off",
    selectedRawIndexes: new Set<number>(),
    hoverRawIndex: null,
    root: null,
    cleanupPositioning: null,
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
    return state;
  }

  const win = getReaderOverlayWindow(reader);
  const doc = win?.document ?? null;
  const attachment = getReaderAttachmentRef(reader);
  if (!win || !doc?.documentElement || !attachment) {
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
    cleanupReaderOverlayRoot(state);
    state.root = null;
    return state;
  }

  if (!isCurrentRenderState(state, revision, mode)) {
    return state;
  }

  cleanupReaderOverlayRoot(state);
  const root = buildReaderOverlayRoot(doc, boxes, mode);
  ensureReaderOverlayStyles(doc);
  positionPageLayers(doc, root);
  doc.body?.append(root);
  state.cleanupPositioning = createReaderOverlayPositioningController({
    doc,
    win,
    root,
    reposition: () => positionPageLayers(doc, root),
  }).cleanup;
  state.root = root;
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
  state.hoverRawIndex = null;
  return state;
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
  return state;
}

export function getReaderSelectedBoxCount(
  reader: _ZoteroTypes.ReaderInstance,
): number {
  return getReaderOverlayStateForReader(reader)?.selectedRawIndexes.size ?? 0;
}

export function getReaderOverlayWindow(
  reader: _ZoteroTypes.ReaderInstance,
): Window | null {
  const view = (
    reader._lastView ??
    reader._primaryView ??
    null
  ) as { _iframeWindow?: Window | null } | null;
  return view?._iframeWindow ?? reader._iframeWindow ?? null;
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

export function destroyReaderOverlaysByReaderID(readerInstanceID: string): void {
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
): HTMLDivElement {
  const root = doc.createElement("div");
  root.className = `mineru-copy-overlay-root mineru-copy-mode-${mode}`;

  for (const page of groupBoxesByPage(boxes)) {
    const layer = doc.createElement("div");
    layer.className = "mineru-copy-page-layer";
    layer.dataset.pageNumber = String(page.page);

    for (const box of page.boxes) {
      layer.append(createBoxElement(doc, box));
    }
    root.append(layer);
  }

  return root;
}

export function removeReaderOverlayRoot(root: Element | null): void {
  root?.remove();
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
  let cleaned = false;

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
      options.win.removeEventListener("scroll", schedule, true);
      options.win.removeEventListener("resize", schedule);
      for (const container of scrollContainers) {
        container.removeEventListener("scroll", schedule, true);
      }
      if (intervalHandle !== null) {
        options.win.clearInterval(intervalHandle);
        intervalHandle = null;
      }

      if (scheduledHandle === null) {
        return;
      }

      if (options.win.cancelAnimationFrame) {
        options.win.cancelAnimationFrame(scheduledHandle);
      } else {
        options.win.clearTimeout(scheduledHandle);
      }
      scheduledHandle = null;
    },
  };
}

function cleanupReaderOverlayRoot(state: ReaderOverlayState): void {
  state.cleanupPositioning?.();
  state.cleanupPositioning = null;
  removeReaderOverlayRoot(state.root);
  state.root = null;
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

export function ensureReaderOverlayStyles(doc: Document): void {
  if (doc.getElementById(READER_OVERLAY_STYLE_ID)) {
    return;
  }

  const style = doc.createElement("style");
  style.id = READER_OVERLAY_STYLE_ID;
  style.textContent = READER_OVERLAY_CSS;
  doc.head?.append(style);
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
): HTMLDivElement {
  const element = doc.createElement("div");
  element.className = "mineru-copy-box";
  element.dataset.rawIndex = String(box.rawIndex);
  element.dataset.mineruBoxType = box.type;
  Object.assign(element.style, computeBoxStyle(box));
  return element;
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

export function findPageElement(doc: Document, pageNumber: number): Element | null {
  const escapedPageNumber = String(pageNumber).replace(/"/g, '\\"');
  return (
    doc.querySelector(`.pdfViewer .page[data-page-number="${escapedPageNumber}"]`) ??
    doc.querySelector(`.page[data-page-number="${escapedPageNumber}"]`) ??
    doc.querySelector(`[data-page-number="${escapedPageNumber}"]`) ??
    doc.querySelector(`[data-page="${escapedPageNumber}"]`) ??
    null
  );
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
