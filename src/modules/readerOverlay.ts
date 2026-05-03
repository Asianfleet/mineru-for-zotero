import type { OverlayMode } from "./domain";

export type ReaderOverlayKey = `${string}:${string}`;

export interface ReaderOverlayState {
  key: ReaderOverlayKey;
  readerInstanceID: string;
  attachmentKey: string;
  mode: OverlayMode;
  selectedRawIndexes: Set<number>;
  hoverRawIndex: number | null;
  root: HTMLElement | null;
}

const fallbackStates = new Map<ReaderOverlayKey, ReaderOverlayState>();

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

export function destroyReaderOverlay(key: ReaderOverlayKey): void {
  const state = getOverlayStates().get(key);
  if (!state) {
    return;
  }
  state.root?.remove();
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
      state.root?.remove();
      states.delete(key);
    }
  }
}

export function destroyAllReaderOverlays(): void {
  for (const state of getOverlayStates().values()) {
    state.root?.remove();
  }
  getOverlayStates().clear();
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
