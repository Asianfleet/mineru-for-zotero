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

.mineru-copy-box-label,
.mineru-copy-box-actions {
  display: none;
}

.mineru-copy-box:hover .mineru-copy-box-label,
.mineru-copy-box-hovered .mineru-copy-box-label {
  display: block;
}

.mineru-copy-box:hover .mineru-copy-box-actions,
.mineru-copy-box-hovered .mineru-copy-box-actions {
  display: flex;
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
  gap: 4px;
  padding-top: 3px;
}

.mineru-copy-button {
  border: 0;
  border-radius: 5px;
  background: var(--material-toolbar, ButtonFace);
  box-shadow:
    0 0 3px 0 rgba(0, 0, 0, 0.35),
    0 2px 8px 0 rgba(0, 0, 0, 0.22);
  color: var(--fill-primary, ButtonText);
  font-size: 13px;
  line-height: 1.35;
  padding: 4px 8px;
  white-space: nowrap;
  pointer-events: auto;
}

.mineru-copy-button:hover {
  background: var(--material-toolbar, ButtonFace);
  box-shadow:
    0 0 3px 0 rgba(0, 0, 0, 0.45),
    0 4px 14px 0 rgba(0, 0, 0, 0.28);
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
