import type { NormalizedBox, OverlayMode } from "../domain";

export type ReaderOverlayKey = `${string}:${string}`;

export interface ReaderOverlayState {
  key: ReaderOverlayKey;
  readerInstanceID: string;
  attachmentKey: string;
  mode: OverlayMode;
  selectedRawIndexes: Set<number>;
  selectionAnchorRawIndex: number | null;
  hoverRawIndex: number | null;
  selectPanelActive: boolean;
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
  isSelectPanelActive?: () => boolean;
  onSelectPanelActiveChange?: (active: boolean) => void;
}

export interface PageRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type { NormalizedBox, OverlayMode };
