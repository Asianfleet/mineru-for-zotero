import { getParentWindow, getWindowDocument } from "./windows";

export const READER_OVERLAY_STYLE_ID = "mineru-copy-overlay-styles";
export const READER_OVERLAY_THEME_VARIABLES = [
  "--material-toolbar",
  "--fill-primary",
] as const;

const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g fill="none" stroke="black" stroke-linejoin="round" stroke-width="4"><path stroke-linecap="round" d="M13 12.432v-4.62A2.813 2.813 0 0 1 15.813 5h24.374A2.813 2.813 0 0 1 43 7.813v24.375A2.813 2.813 0 0 1 40.188 35h-4.672"/><path d="M32.188 13H7.811A2.813 2.813 0 0 0 5 15.813v24.374A2.813 2.813 0 0 0 7.813 43h24.375A2.813 2.813 0 0 0 35 40.188V15.811A2.813 2.813 0 0 0 32.188 13Z"/></g></svg>';
const SELECT_COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M9.69001 7.39133L12.372 8.44066C13.9187 9.04533 14.692 9.34799 14.666 9.82799C14.6407 10.308 13.8333 10.528 12.2193 10.968C11.7387 11.0993 11.498 11.1653 11.332 11.332C11.1653 11.4987 11.0993 11.7387 10.9687 12.2187C10.5287 13.8333 10.3087 14.6406 9.82868 14.666C9.34868 14.692 9.04534 13.9186 8.44068 12.372L7.39068 9.68999C6.75734 8.07066 6.44067 7.26133 6.85067 6.85066C7.26134 6.44066 8.07068 6.75733 9.69068 7.39066L9.69001 7.39133Z" stroke="black" stroke-width="1.5" stroke-linejoin="round"/><path stroke="black" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" d="M1.33334 5.66666L1.33334 7.66666M7.66668 1.33333L5.66668 1.33333M5.66668 12L6.00001 12M12 5.99999L12 5.66666M3.00001 12C2.94542 12 2.89097 11.9973 2.83665 11.992C2.78232 11.9866 2.7284 11.9786 2.67486 11.968C2.62132 11.9573 2.56844 11.9441 2.5162 11.9283C2.46397 11.9124 2.41264 11.894 2.3622 11.8731C2.31177 11.8523 2.26249 11.8289 2.21435 11.8032C2.16621 11.7775 2.11944 11.7495 2.07406 11.7191C2.02868 11.6888 1.98489 11.6563 1.94269 11.6217C1.90049 11.5871 1.8601 11.5505 1.8215 11.5119C1.7829 11.4733 1.74629 11.4329 1.71166 11.3907C1.67703 11.3485 1.64455 11.3047 1.61423 11.2593C1.5839 11.2139 1.55587 11.1671 1.53014 11.119C1.50441 11.0709 1.4811 11.0216 1.46021 10.9711C1.43932 10.9207 1.42095 10.8693 1.40511 10.8171C1.38927 10.7649 1.37602 10.712 1.36537 10.6585C1.35472 10.6049 1.34672 10.551 1.34137 10.4967C1.33602 10.4423 1.33334 10.3879 1.33334 10.3333M1.33334 2.99999C1.33334 2.94541 1.33602 2.89095 1.34137 2.83663C1.34672 2.78231 1.35472 2.72838 1.36537 2.67484C1.37602 2.62131 1.38927 2.56842 1.40511 2.51619C1.42095 2.46395 1.43932 2.41262 1.46021 2.36219C1.4811 2.31175 1.50441 2.26248 1.53014 2.21433C1.55587 2.16619 1.5839 2.11943 1.61423 2.07404C1.64455 2.02866 1.67703 1.98487 1.71166 1.94267C1.74629 1.90048 1.7829 1.86008 1.8215 1.82148C1.8601 1.78289 1.90049 1.74627 1.94269 1.71164C1.98489 1.67701 2.02868 1.64454 2.07406 1.61421C2.11944 1.58389 2.16621 1.55586 2.21435 1.53013C2.26249 1.50439 2.31177 1.48108 2.3622 1.46019C2.41264 1.43931 2.46397 1.42094 2.5162 1.40509C2.56844 1.38925 2.62132 1.376 2.67486 1.36535C2.7284 1.35471 2.78232 1.34671 2.83665 1.34135C2.89097 1.336 2.94542 1.33333 3.00001 1.33333M12 2.99999C12 2.94541 11.9973 2.89095 11.992 2.83663C11.9866 2.78231 11.9786 2.72838 11.968 2.67484C11.9573 2.62131 11.9441 2.56842 11.9283 2.51619C11.9124 2.46395 11.894 2.41262 11.8731 2.36219C11.8523 2.31175 11.8289 2.26248 11.8032 2.21433C11.7775 2.16619 11.7495 2.11943 11.7191 2.07404C11.6888 2.02866 11.6563 1.98487 11.6217 1.94267C11.5871 1.90048 11.5505 1.86008 11.5119 1.82148C11.4733 1.78289 11.4329 1.74627 11.3907 1.71164C11.3485 1.67701 11.3047 1.64454 11.2593 1.61421C11.2139 1.58389 11.1671 1.55586 11.119 1.53013C11.0709 1.50439 11.0216 1.48108 10.9711 1.46019C10.9207 1.43931 10.8693 1.42094 10.8171 1.40509C10.7649 1.38925 10.712 1.376 10.6585 1.36535C10.6049 1.35471 10.551 1.34671 10.4967 1.34135C10.4423 1.336 10.3879 1.33333 10.3333 1.33333"/></svg>';
const COPY_ICON_DATA_URI = createSvgDataUri(COPY_ICON_SVG);
const SELECT_COPY_ICON_DATA_URI = createSvgDataUri(SELECT_COPY_ICON_SVG);

export const READER_OVERLAY_CSS = `
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

.mineru-copy-box-actions-active {
  z-index: 2147483002;
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

.mineru-copy-box-label {
  display: none;
}

.mineru-copy-box:hover .mineru-copy-box-label,
.mineru-copy-box-hovered .mineru-copy-box-label {
  display: block;
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

.mineru-copy-box-selected .mineru-copy-box-label,
.mineru-copy-mode-hover .mineru-copy-box-selected .mineru-copy-box-label {
  background: rgba(217, 119, 6, 0.95);
}

.mineru-copy-box-actions {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  display: none;
  pointer-events: none;
}

.mineru-copy-box:hover .mineru-copy-box-actions,
.mineru-copy-box-hovered .mineru-copy-box-actions,
.mineru-copy-box-actions-active .mineru-copy-box-actions,
.mineru-copy-select-panel-open {
  display: block;
}

.mineru-copy-toolbar-above {
  top: auto;
  bottom: 100%;
}

.mineru-copy-toolbar-shift-right {
  left: 0;
  transform: none;
}

.mineru-copy-toolbar-shift-left {
  left: auto;
  right: 0;
  transform: none;
}

.mineru-copy-box-toolbar {
  display: flex;
  align-items: center;
  overflow: visible;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 999px;
  background: var(--material-toolbar, ButtonFace);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.2),
    0 4px 12px rgba(0, 0, 0, 0.18);
  color: var(--fill-primary, ButtonText);
  pointer-events: auto;
}

.mineru-copy-toolbar-button {
  position: relative;
  width: 32px;
  height: 28px;
  border: 0;
  margin: 0;
  padding: 0;
  border-radius: 0;
  background-color: transparent;
  color: inherit;
}

.mineru-copy-toolbar-button:hover,
.mineru-copy-formula-copy-group:hover > .mineru-copy-toolbar-button {
  background-color: rgba(0, 0, 0, 0.08);
}

.mineru-copy-toolbar-button::before {
  content: "";
  position: absolute;
  inset: 6px 8px;
  background-color: currentColor;
  mask-position: center;
  mask-repeat: no-repeat;
  mask-size: 16px 16px;
}

.mineru-copy-toolbar-button-copy {
  border-radius: 999px 0 0 999px;
}

.mineru-copy-toolbar-button-copy::before {
  mask-image: url("${COPY_ICON_DATA_URI}");
}

.mineru-copy-toolbar-button-select {
  border-radius: 0 999px 999px 0;
}

.mineru-copy-toolbar-button-select::before {
  mask-image: url("${SELECT_COPY_ICON_DATA_URI}");
}

.mineru-copy-toolbar-divider {
  width: 0;
  height: 18px;
  border-left: 1px solid rgba(0, 0, 0, 0.18);
}

.mineru-copy-formula-copy-group {
  position: relative;
  display: flex;
}

.mineru-copy-formula-menu {
  position: absolute;
  left: 0;
  top: 100%;
  display: none;
  min-width: 150px;
  flex-direction: column;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 6px;
  background: var(--material-toolbar, ButtonFace);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
}

.mineru-copy-formula-copy-group:hover .mineru-copy-formula-menu {
  display: flex;
}

.mineru-copy-formula-menu-item {
  width: 100%;
  height: auto;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fill-primary, ButtonText);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  padding: 6px 8px;
  text-align: left;
  white-space: nowrap;
}

.mineru-copy-formula-menu-item:hover {
  background-color: rgba(0, 0, 0, 0.08);
}

.mineru-copy-select-panel {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  width: min(360px, 70vw);
  min-width: 180px;
  min-height: 48px;
  max-height: 220px;
  transform: translateX(-50%);
  display: none;
  resize: both;
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 7px;
  background: var(--material-toolbar, Field);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  color: var(--fill-primary, FieldText);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  padding: 8px 10px;
  user-select: text;
  pointer-events: auto;
}

.mineru-copy-select-panel-open .mineru-copy-select-panel {
  display: block;
}

.mineru-copy-select-panel-below .mineru-copy-select-panel {
  top: calc(100% + 6px);
  bottom: auto;
}

.mineru-copy-select-panel-right .mineru-copy-select-panel {
  left: 0;
  transform: none;
}

.mineru-copy-select-panel-left .mineru-copy-select-panel {
  left: auto;
  right: 0;
  transform: none;
}
`;

/** 确保 reader 文档已经注入 overlay 样式，并在主题变化时刷新内容。 */
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

/** 从父 reader 窗口桥接主题变量，生成 overlay 使用的前缀 CSS。 */
export function createReaderOverlayThemeCss(doc: Document): string {
  const declarations = READER_OVERLAY_THEME_VARIABLES.flatMap((name) => {
    const value = resolveCssVariableFromWindowTree(doc, name);
    return value ? [`  ${name}: ${value};`] : [];
  });
  return declarations.length > 0
    ? `:root {\n${declarations.join("\n")}\n}\n`
    : "";
}

/** 沿着父窗口链查找 reader 主题变量，避免读取到 overlay 自身注入的旧值。 */
export function resolveCssVariableFromWindowTree(
  doc: Document,
  name: string,
): string | null {
  const ownWindow = doc.defaultView ?? null;
  const parentWindow = ownWindow ? getParentWindow(ownWindow) : null;
  let win = parentWindow && parentWindow !== ownWindow ? parentWindow : null;
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

  return readCssVariable(doc, name);
}

/** 从当前文档的根元素或 body 读取单个 CSS 自定义属性。 */
export function readCssVariable(doc: Document, name: string): string | null {
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
    const value = getPropertyValue(computedStyle, name);
    if (isSafeCssCustomPropertyValue(value)) {
      return value;
    }
  }
  return null;
}

/** 校验 CSS 变量值是否可安全拼接进样式文本。 */
export function isSafeCssCustomPropertyValue(value: string): boolean {
  return value.length > 0 && !/[;{}]/.test(value);
}

/** 兼容测试桩对象，安全读取 getPropertyValue 的返回值。 */
function getPropertyValue(
  computedStyle:
    | CSSStyleDeclaration
    | { getPropertyValue: (name: string) => string },
  name: string,
): string {
  return computedStyle.getPropertyValue(name).trim();
}

function createSvgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
