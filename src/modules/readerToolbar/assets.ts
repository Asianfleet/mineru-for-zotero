import type { ReaderOverlayMode } from "./types";
import { emitReaderToolbarDiagnostic, errorMessage } from "./diagnostics";

export const READER_TOOLBAR_ICON_PATH = "content/mineru.svg";
export const READER_TOOLBAR_MODE_ICON_PATHS: Record<ReaderOverlayMode, string> =
  {
    all: "content/box-mode-all.svg",
    hover: "content/box-mode-hover.svg",
    off: "content/box-mode-off.svg",
  };
export const READER_TOOLBAR_CLEAR_SELECTION_ICON_PATH =
  "content/box-action-clear-selection.svg";
export const READER_TOOLBAR_COPY_SELECTION_ICON_PATH =
  "content/box-action-copy-selection.svg";

export let readerToolbarIconURI = "";
export const readerToolbarModeSVGs: Partial<Record<ReaderOverlayMode, string>> =
  {};
export let readerToolbarClearSelectionSVG = "";
export let readerToolbarCopySelectionSVG = "";
export let readerToolbarIconLoadPromise: Promise<void> | undefined;
export let readerToolbarModeIconLoadPromise: Promise<void> | undefined;
export let readerToolbarActionIconLoadPromise: Promise<void> | undefined;

/** Returns the loaded toolbar button icon URI, or an empty string before load. */
export function getReaderToolbarIconURI(): string {
  return readerToolbarIconURI;
}

/** Returns the loaded mode icon SVG for a toolbar mode, or an empty string. */
export function getReaderToolbarModeSVG(mode: ReaderOverlayMode): string {
  return readerToolbarModeSVGs[mode] ?? "";
}

/** Returns the loaded clear-selection action SVG, or an empty string. */
export function getReaderToolbarClearSelectionSVG(): string {
  return readerToolbarClearSelectionSVG;
}

/** Returns the loaded copy-selection action SVG, or an empty string. */
export function getReaderToolbarCopySelectionSVG(): string {
  return readerToolbarCopySelectionSVG;
}

/** Stores a loaded mode SVG for later toolbar rendering. */
export function setReaderToolbarModeIconSVG(
  mode: ReaderOverlayMode,
  svg: string,
): void {
  readerToolbarModeSVGs[mode] = svg;
}

/** Stores the clear-selection action SVG for later toolbar rendering. */
export function setReaderToolbarClearSelectionSVG(svg: string): void {
  readerToolbarClearSelectionSVG = svg;
}

/** Stores the copy-selection action SVG for later toolbar rendering. */
export function setReaderToolbarCopySelectionSVG(svg: string): void {
  readerToolbarCopySelectionSVG = svg;
}

/** Stores the main toolbar icon data URI for later button rendering. */
export function setReaderToolbarIconURI(iconURI: string): void {
  readerToolbarIconURI = iconURI;
}

/** Converts an SVG string into a data URI suitable for an image source. */
export function createReaderToolbarIconDataURI(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Ensures the main toolbar icon has been loaded once. */
export async function ensureReaderToolbarIconLoaded(): Promise<void> {
  readerToolbarIconLoadPromise ??= loadReaderToolbarIconURI();
  await readerToolbarIconLoadPromise;
}

/** Ensures all mode SVG icons have been loaded once. */
export async function ensureReaderToolbarModeIconLoaded(): Promise<void> {
  readerToolbarModeIconLoadPromise ??= loadReaderToolbarModeSVGs();
  await readerToolbarModeIconLoadPromise;
}

/** Ensures all action SVG icons have been loaded once. */
export async function ensureReaderToolbarActionIconLoaded(): Promise<void> {
  readerToolbarActionIconLoadPromise ??= loadReaderToolbarActionIconSVGs();
  await readerToolbarActionIconLoadPromise;
}

/** Ensures every toolbar asset group has been loaded. */
export async function ensureReaderToolbarAssetsLoaded(): Promise<void> {
  await Promise.all([
    ensureReaderToolbarIconLoaded(),
    ensureReaderToolbarModeIconLoaded(),
    ensureReaderToolbarActionIconLoaded(),
  ]);
}

/** Loads the main toolbar icon from the plugin chrome root. */
export async function loadReaderToolbarIconURI(): Promise<void> {
  try {
    const response = await fetch(rootURI + READER_TOOLBAR_ICON_PATH);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setReaderToolbarIconURI(
      createReaderToolbarIconDataURI(await response.text()),
    );
  } catch (error) {
    emitReaderToolbarDiagnostic(undefined, "MinerU toolbar icon load failed", {
      error: errorMessage(error),
    });
  }
}

/** Loads mode SVGs from the plugin chrome root. */
export async function loadReaderToolbarModeSVGs(): Promise<void> {
  const entries = Object.entries(READER_TOOLBAR_MODE_ICON_PATHS) as Array<
    [ReaderOverlayMode, string]
  >;
  await Promise.all(
    entries.map(
      /** Loads and stores the SVG for one toolbar mode. */
      async ([mode, path]) => {
        try {
          const response = await fetch(rootURI + path);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          setReaderToolbarModeIconSVG(mode, await response.text());
        } catch (error) {
          emitReaderToolbarDiagnostic(
            undefined,
            "MinerU toolbar mode icon load failed",
            {
              mode,
              error: errorMessage(error),
            },
          );
        }
      },
    ),
  );
}

/** Loads action SVGs from the plugin chrome root. */
export async function loadReaderToolbarActionIconSVGs(): Promise<void> {
  await Promise.all([
    loadReaderToolbarActionIconSVG(
      "copy-selection",
      READER_TOOLBAR_COPY_SELECTION_ICON_PATH,
      setReaderToolbarCopySelectionSVG,
    ),
    loadReaderToolbarActionIconSVG(
      "clear-selection",
      READER_TOOLBAR_CLEAR_SELECTION_ICON_PATH,
      setReaderToolbarClearSelectionSVG,
    ),
  ]);
}

/** Loads one action SVG from the plugin chrome root. */
export async function loadReaderToolbarActionIconSVG(
  action: string,
  path: string,
  setSVG: (svg: string) => void,
): Promise<void> {
  try {
    const response = await fetch(rootURI + path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setSVG(await response.text());
  } catch (error) {
    emitReaderToolbarDiagnostic(
      undefined,
      "MinerU toolbar action icon load failed",
      {
        action,
        error: errorMessage(error),
      },
    );
  }
}

/** Normalizes bundled SVG colors so toolbar buttons inherit currentColor. */
export function normalizeReaderToolbarModeSVG(svg: string): string {
  return svg
    .replace(/\sfill="#333333"/g, ' fill="currentColor"')
    .replace(/\sfill="#333"/g, ' fill="currentColor"')
    .replace(/\sstroke="#333333"/g, ' stroke="currentColor"')
    .replace(/\sstroke="#333"/g, ' stroke="currentColor"');
}
