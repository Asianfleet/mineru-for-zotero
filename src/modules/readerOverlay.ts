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

.mineru-copy-mode-hover .mineru-copy-box {
  opacity: 0;
  border-color: transparent;
  background: transparent;
}

.mineru-copy-mode-hover .mineru-copy-box:hover {
  opacity: 1;
  border-color: rgba(33, 99, 235, 0.9);
  background: rgba(64, 156, 255, 0.18);
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
  font-size: 10px;
  line-height: 1.2;
  pointer-events: none;
}

.mineru-copy-box-actions {
  position: absolute;
  left: 0;
  top: 100%;
  display: flex;
  gap: 4px;
  padding-top: 3px;
}

.mineru-copy-button {
  border: 1px solid rgba(33, 99, 235, 0.9);
  border-radius: 4px;
  background: #fff;
  color: rgba(20, 64, 160, 1);
  font-size: 11px;
  line-height: 1.2;
  padding: 2px 5px;
  white-space: nowrap;
  pointer-events: auto;
}

.mineru-copy-button:hover {
  background: rgba(226, 239, 255, 1);
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

    const root = buildReaderOverlayRoot(doc, boxes, mode);
    ensureReaderOverlayStyles(doc);
    positionPageLayers(doc, root);
    doc.body?.append(root);
    const cleanup = createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition: () => positionPageLayers(doc, root),
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
      windows.add(win);
    }
  }

  if (reader._iframeWindow) {
    windows.add(reader._iframeWindow);
  }

  return [...windows];
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
  element.append(createBoxLabel(doc, box), createBoxActions(doc, box));
  return element;
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
      createCopyButton(doc, "带 $ 复制", () => {
        copyText(formatFormulaForCopy(box.formula ?? "", "with-dollar"));
      }),
      createCopyButton(doc, "不带 $ 复制", () => {
        copyText(formatFormulaForCopy(box.formula ?? "", "without-dollar"));
      }),
    );
    return actions;
  }

  actions.append(
    createCopyButton(doc, "复制", () => {
      copyText(formatBoxesForCopy([box]));
    }),
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

function formatBoxTypeLabel(type: string): string {
  const normalized = type.trim().toLowerCase();
  const labels: Record<string, string> = {
    text: "文本",
    title: "标题",
    list: "列表",
    table: "表格",
    figure: "图片",
    image: "图片",
    image_body: "图片",
    image_caption: "图片标题",
    table_caption: "表格标题",
    page_header: "页眉",
    header: "页眉",
    page_footer: "页脚",
    footer: "页脚",
    page_footnote: "脚注",
    footnote: "脚注",
    page_number: "页码",
    formula: "公式",
    interline_equation: "公式",
    inline_equation: "公式",
    equation: "公式",
    unknown: "未知",
  };
  return labels[normalized] ?? normalized;
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
    return "当前 PDF 还没有可用的 MinerU 解析结果，请先解析后再开启 box";
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
