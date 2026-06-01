import { getParentWindow, getWindowDocument } from "./windows";

export const READER_OVERLAY_STYLE_ID = "mineru-copy-overlay-styles";
export const READER_OVERLAY_THEME_VARIABLES = [
  "--material-toolbar",
  "--fill-primary",
] as const;
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
.mineru-copy-select-panel-open {
  display: block;
}

.mineru-copy-toolbar-above {
  top: auto;
  bottom: 100%;
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
  width: 32px;
  height: 28px;
  border: 0;
  margin: 0;
  padding: 0;
  border-radius: 0;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 16px 16px;
  color: inherit;
  -moz-context-properties: fill, fill-opacity, stroke, stroke-opacity;
}

.mineru-copy-toolbar-button:hover,
.mineru-copy-formula-copy-group:hover > .mineru-copy-toolbar-button {
  background-color: rgba(0, 0, 0, 0.08);
}

.mineru-copy-toolbar-button-copy {
  border-radius: 999px 0 0 999px;
  background-image: url("chrome://mineruForZotero/content/box-toolbar-copy.svg");
}

.mineru-copy-toolbar-button-select {
  border-radius: 0 999px 999px 0;
  background-image: url("chrome://mineruForZotero/content/box-toolbar-select-copy.svg");
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
