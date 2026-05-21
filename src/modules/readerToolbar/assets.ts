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

/** 返回已加载的 toolbar button icon URI，未加载时返回空字符串。 */
export function getReaderToolbarIconURI(): string {
  return readerToolbarIconURI;
}

/** 返回某个 toolbar mode 已加载的 icon SVG，未加载时返回空字符串。 */
export function getReaderToolbarModeSVG(mode: ReaderOverlayMode): string {
  return readerToolbarModeSVGs[mode] ?? "";
}

/** 返回已加载的清空选择 action SVG，未加载时返回空字符串。 */
export function getReaderToolbarClearSelectionSVG(): string {
  return readerToolbarClearSelectionSVG;
}

/** 返回已加载的复制选择 action SVG，未加载时返回空字符串。 */
export function getReaderToolbarCopySelectionSVG(): string {
  return readerToolbarCopySelectionSVG;
}

/** 保存已加载的 mode SVG，供后续 toolbar 渲染使用。 */
export function setReaderToolbarModeIconSVG(
  mode: ReaderOverlayMode,
  svg: string,
): void {
  readerToolbarModeSVGs[mode] = svg;
}

/** 保存清空选择 action SVG，供后续 toolbar 渲染使用。 */
export function setReaderToolbarClearSelectionSVG(svg: string): void {
  readerToolbarClearSelectionSVG = svg;
}

/** 保存复制选择 action SVG，供后续 toolbar 渲染使用。 */
export function setReaderToolbarCopySelectionSVG(svg: string): void {
  readerToolbarCopySelectionSVG = svg;
}

/** 保存主 toolbar icon 的 data URI，供后续 button 渲染使用。 */
export function setReaderToolbarIconURI(iconURI: string): void {
  readerToolbarIconURI = iconURI;
}

/** 将 SVG 字符串转换为适合 image source 的 data URI。 */
export function createReaderToolbarIconDataURI(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** 确保主 toolbar icon 只加载一次。 */
export async function ensureReaderToolbarIconLoaded(): Promise<void> {
  readerToolbarIconLoadPromise ??= loadReaderToolbarIconURI();
  await readerToolbarIconLoadPromise;
}

/** 确保所有 mode SVG icon 只加载一次。 */
export async function ensureReaderToolbarModeIconLoaded(): Promise<void> {
  readerToolbarModeIconLoadPromise ??= loadReaderToolbarModeSVGs();
  await readerToolbarModeIconLoadPromise;
}

/** 确保所有 action SVG icon 只加载一次。 */
export async function ensureReaderToolbarActionIconLoaded(): Promise<void> {
  readerToolbarActionIconLoadPromise ??= loadReaderToolbarActionIconSVGs();
  await readerToolbarActionIconLoadPromise;
}

/** 确保所有 toolbar asset 组都已加载。 */
export async function ensureReaderToolbarAssetsLoaded(): Promise<void> {
  await Promise.all([
    ensureReaderToolbarIconLoaded(),
    ensureReaderToolbarModeIconLoaded(),
    ensureReaderToolbarActionIconLoaded(),
  ]);
}

/** 从插件 chrome root 加载主 toolbar icon。 */
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

/** 从插件 chrome root 加载 mode SVG。 */
export async function loadReaderToolbarModeSVGs(): Promise<void> {
  const entries = Object.entries(READER_TOOLBAR_MODE_ICON_PATHS) as Array<
    [ReaderOverlayMode, string]
  >;
  await Promise.all(
    entries.map(
      /** 加载并保存一个 toolbar mode 的 SVG。 */
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

/** 从插件 chrome root 加载 action SVG。 */
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

/** 从插件 chrome root 加载一个 action SVG。 */
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

/** 规范化内置 SVG 颜色，使 toolbar button 继承 currentColor。 */
export function normalizeReaderToolbarModeSVG(svg: string): string {
  return svg
    .replace(/\sfill="#333333"/g, ' fill="currentColor"')
    .replace(/\sfill="#333"/g, ' fill="currentColor"')
    .replace(/\sstroke="#333333"/g, ' stroke="currentColor"')
    .replace(/\sstroke="#333"/g, ' stroke="currentColor"');
}
