import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
import { logReaderOverlayDiagnostic } from "./diagnostics";
import { showReaderOverlayNotice } from "./notice";
import {
  createReaderOverlayPositioningController,
  positionPageLayers,
} from "./positioning";
import { buildReaderOverlayRoot } from "./render";
import { setHoveredBox, syncSelectedBoxClasses } from "./selection";
import {
  cleanupReaderOverlayRoot,
  destroyReaderOverlay,
  getReaderOverlayStateForReader,
  isCurrentRenderState,
  setReaderOverlayModeForReader,
} from "./state";
import { ensureReaderOverlayStyles } from "./styles";
import type { NormalizedBox, ReaderOverlayState } from "./types";
import {
  getReaderAttachmentRef,
  getReaderOverlayMountContainer,
  getReaderOverlayWindows,
} from "./windows";

export { copySelectedBoxesForReader, formatSelectedBoxesForCopy } from "./copy";
export { getReaderOverlayNoticeText } from "./notice";
export {
  createFallbackPageRect,
  createReaderOverlayPositioningController,
  findPageElement,
  positionPageLayers,
} from "./positioning";
export {
  buildReaderOverlayRoot,
  computeBoxStyle,
  removeReaderOverlayRoot,
} from "./render";
export { clearReaderOverlaySelectionForReader } from "./selection";
export {
  destroyAllReaderOverlays,
  destroyReaderOverlay,
  destroyReaderOverlaysByReaderID,
  destroyReaderOverlaysForReader,
  getReaderOverlayKey,
  getReaderOverlayState,
  getReaderOverlayStateForReader,
  getReaderSelectedBoxCount,
  setReaderOverlayModeForReader,
  setReaderOverlayRootForReader,
} from "./state";
export { ensureReaderOverlayStyles } from "./styles";
export {
  getReaderOverlayWindow,
  getReaderOverlayWindows,
  readerOverlayNeedsWindowSync,
} from "./windows";
export type {
  PageRect,
  ReaderOverlayBoxStyle,
  ReaderOverlayKey,
  ReaderOverlayPositioningController,
  ReaderOverlayPositioningControllerOptions,
  ReaderOverlaySelectionOptions,
  ReaderOverlayState,
} from "./types";

/** 设置 reader overlay mode，并触发对应的重渲染。 */
export async function applyReaderOverlayMode(
  reader: _ZoteroTypes.ReaderInstance,
  mode: import("./types").OverlayMode,
): Promise<ReaderOverlayState | null> {
  const state = setReaderOverlayModeForReader(reader, mode);
  if (!state) {
    return null;
  }
  state.renderRevision += 1;
  await renderReaderOverlayForReader(reader, state.renderRevision);
  return state;
}

/** 读取当前 attachment 的 boxes，并把 overlay 渲染到 reader 的所有相关窗口。 */
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
  if (mode === "off") {
    destroyReaderOverlay(state.key);
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
    const selectionOptions = createSelectionOptions(state);
    const root = buildReaderOverlayRoot(doc, boxes, mode, selectionOptions);
    ensureReaderOverlayStyles(doc);
    positionPageLayers(doc, root);
    mountContainer?.append(root);

    const cleanup = createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition: () => positionPageLayers(doc, root),
      selectionOptions,
    }).cleanup;
    state.rootsByWindow.set(win, root);
    state.cleanupPositioningByWindow.set(win, cleanup);
    state.root = root;
    state.cleanupPositioning = cleanup;
  }
  return state;
}

/** 基于当前 state 构造渲染与定位共用的 selection options。 */
function createSelectionOptions(
  state: ReaderOverlayState,
): import("./types").ReaderOverlaySelectionOptions {
  return {
    selectedRawIndexes: state.selectedRawIndexes,
    getSelectionAnchorRawIndex: () => state.selectionAnchorRawIndex,
    setSelectionAnchorRawIndex: (rawIndex) => {
      state.selectionAnchorRawIndex = rawIndex;
    },
    onSelectionChange: () => syncSelectedBoxClasses(state),
    isSelectPanelActive: () => state.selectPanelActive,
    onSelectPanelActiveChange: (active) => {
      syncSelectPanelActiveClasses(state, active);
    },
  };
}

/** 同步 select-copy 面板交互锁，避免 split/iframe roots 继续激活下层 box。 */
function syncSelectPanelActiveClasses(
  state: ReaderOverlayState,
  active: boolean,
): void {
  state.selectPanelActive = active;
  for (const root of state.rootsByWindow.values()) {
    root.classList.toggle("mineru-copy-select-panel-active", active);
    if (active) {
      setHoveredBox(root, null);
    }
  }
}
