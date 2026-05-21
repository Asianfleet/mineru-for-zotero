import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage } from "../storage";
import { logReaderOverlayDiagnostic } from "./diagnostics";
import { showReaderOverlayNotice } from "./notice";
import {
  createReaderOverlayPositioningController,
  positionPageLayers,
} from "./positioning";
import { buildReaderOverlayRoot } from "./render";
import { syncSelectedBoxClasses } from "./selection";
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
      selectionOptions: createSelectionOptions(state, root),
    }).cleanup;
    state.rootsByWindow.set(win, root);
    state.cleanupPositioningByWindow.set(win, cleanup);
    state.root = root;
    state.cleanupPositioning = cleanup;
  }
  return state;
}

/** 基于当前 state 与 root 构造 positioning controller 所需的 selection options。 */
function createSelectionOptions(
  state: ReaderOverlayState,
  root: HTMLDivElement,
): import("./types").ReaderOverlaySelectionOptions {
  return {
    selectedRawIndexes: state.selectedRawIndexes,
    selectableRawIndexes: readSelectableRawIndexes(root),
    getSelectionAnchorRawIndex: () => state.selectionAnchorRawIndex,
    setSelectionAnchorRawIndex: (rawIndex) => {
      state.selectionAnchorRawIndex = rawIndex;
    },
    onSelectionChange: () => syncSelectedBoxClasses(state),
  };
}

/** 从 root dataset 读取可选择的 rawIndex 列表。 */
function readSelectableRawIndexes(root: HTMLDivElement): number[] {
  return (
    root.dataset.selectableRawIndexes
      ?.split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)) ?? []
  );
}
