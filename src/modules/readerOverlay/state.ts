import { removeReaderOverlayRoot } from "./render";
import type {
  OverlayMode,
  ReaderOverlayKey,
  ReaderOverlayState,
} from "./types";
import { getReaderAttachmentKey } from "./windows";

export const fallbackStates = new Map<ReaderOverlayKey, ReaderOverlayState>();

/** 根据 reader 实例和 attachment 生成唯一 overlay key。 */
export function getReaderOverlayKey(
  readerInstanceID: string,
  attachmentKey: string,
): ReaderOverlayKey {
  return `${readerInstanceID}:${attachmentKey}`;
}

/** 读取或创建指定 attachment 的 overlay state。 */
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

/** 根据 reader 当前 attachment 返回对应 overlay state。 */
export function getReaderOverlayStateForReader(
  reader: _ZoteroTypes.ReaderInstance,
): ReaderOverlayState | null {
  const attachmentKey = getReaderAttachmentKey(reader);
  if (!attachmentKey) {
    return null;
  }
  return getReaderOverlayState(reader._instanceID, attachmentKey);
}

/** 更新 reader 的 overlay mode，但不触发渲染。 */
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

/** 为当前 reader 记录最新 root，并同步到按窗口索引的 root 映射。 */
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

/** 返回当前 reader 已选中的 box 数量。 */
export function getReaderSelectedBoxCount(
  reader: _ZoteroTypes.ReaderInstance,
): number {
  return getReaderOverlayStateForReader(reader)?.selectedRawIndexes.size ?? 0;
}

/** 销毁指定 key 的 overlay state 及其关联 root。 */
export function destroyReaderOverlay(key: ReaderOverlayKey): void {
  const state = getOverlayStates().get(key);
  if (!state) {
    return;
  }
  state.renderRevision += 1;
  cleanupReaderOverlayRoot(state);
  getOverlayStates().delete(key);
}

/** 销毁某个 reader 实例下的全部 overlay state。 */
export function destroyReaderOverlaysForReader(
  reader: _ZoteroTypes.ReaderInstance,
): void {
  destroyReaderOverlaysByReaderID(reader._instanceID);
}

/** 通过 reader instance ID 销毁对应的全部 overlay state。 */
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

/** 销毁当前插件进程内的全部 overlay state。 */
export function destroyAllReaderOverlays(): void {
  for (const state of getOverlayStates().values()) {
    state.renderRevision += 1;
    cleanupReaderOverlayRoot(state);
  }
  getOverlayStates().clear();
}

/** 清理 state 中持有的 root 与 positioning cleanup 引用。 */
export function cleanupReaderOverlayRoot(state: ReaderOverlayState): void {
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

/** 确保老 state 总是带有新拆分后的窗口映射字段。 */
export function ensureReaderOverlayStateMaps(
  state: ReaderOverlayState,
): ReaderOverlayState {
  state.rootsByWindow ??= new Map<Window, HTMLElement>();
  state.cleanupPositioningByWindow ??= new Map<Window, () => void>();
  return state;
}

/** 校验当前 state 仍然对应同一轮 render 请求。 */
export function isCurrentRenderState(
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

/** 返回插件运行时持有的 overlay state 容器。 */
export function getOverlayStates(): Map<ReaderOverlayKey, ReaderOverlayState> {
  if (typeof addon === "undefined") {
    return fallbackStates;
  }

  addon.data.readerOverlays ??= new Map<ReaderOverlayKey, ReaderOverlayState>();
  return addon.data.readerOverlays;
}
