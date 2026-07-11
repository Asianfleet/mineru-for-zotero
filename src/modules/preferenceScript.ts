import { config } from "../../package.json";
import {
  generateMarkdownApiToken,
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
  getSaveImages,
  getLocalApiTimeoutMinutes,
  getParseMode,
  getParseSource,
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
  setApiKey,
  setLocalApiBaseURL,
  setLocalApiTimeoutMinutes,
  setParseMode,
  setParseSource,
  setSaveImages,
  type ParseMode,
  type ParseSource,
} from "../utils/prefs";
import { createStorage } from "./storage";

const STORAGE_ROOT = "ProfD/mineru-copy";

interface ZoteroURLLauncher {
  launchURL(url: string): void;
}

interface ChoicePreferenceElement extends Element {
  value?: string;
}

interface CheckboxPreferenceElement extends Element {
  checked?: boolean;
}

export async function registerPrefsScripts(_window: Window) {
  const storageRoot = getMinerUStorageRoot();
  const storage = createStorage(storageRoot);
  const document = _window.document;

  registerPreferenceValueSync(document);
  void updateMarkdownApiTokenStatus(_window);

  setText(
    document,
    `${config.addonRef}-data-folder-path`,
    await formatL10n(_window, "pref-data-folder-path", { path: storageRoot }),
  );

  void updateParsedCount(_window, storage);

  document
    .getElementById(`${config.addonRef}-open-data-folder`)
    ?.addEventListener("click", () => {
      void storage.openDataFolder();
    });
  document
    .getElementById(`${config.addonRef}-api-regenerate-token`)
    ?.addEventListener("click", () => {
      setMarkdownApiToken(generateMarkdownApiToken());
      void updateMarkdownApiTokenStatus(_window);
    });

  registerExternalLink(
    document,
    `${config.addonRef}-github-link`,
    "https://github.com/Asianfleet/mineru-for-zotero",
  );
  registerExternalLink(
    document,
    `${config.addonRef}-mineru-link`,
    "https://mineru.net/",
  );
}

export function getMinerUStorageRoot(): string {
  return STORAGE_ROOT;
}

/**
 * 显式同步 preferences.xhtml 控件值，避免 Zotero 重启前读取到旧偏好。
 */
export function registerPreferenceValueSync(document: Document): void {
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-api-key`,
    setApiKey,
  );
  registerChoicePreferenceSync<ParseSource>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-source`,
    ["online", "local"],
    getParseSource,
    setParseSource,
  );
  registerChoicePreferenceSync<ParseMode>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-mode`,
    ["precise", "lite"],
    getParseMode,
    setParseMode,
  );
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-local-api-base-url`,
    setLocalApiBaseURL,
  );
  registerNumberPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-local-api-timeout-minutes`,
    getLocalApiTimeoutMinutes,
    setLocalApiTimeoutMinutes,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-api-enabled`,
    getMarkdownApiEnabled,
    setMarkdownApiEnabled,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-api-require-token`,
    getMarkdownApiRequireToken,
    setMarkdownApiRequireToken,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-save-images`,
    getSaveImages,
    setSaveImages,
  );
}

export function openExternalURL(
  url: string,
  launcher: ZoteroURLLauncher = Zotero as unknown as ZoteroURLLauncher,
): void {
  launcher.launchURL(url);
}

function registerExternalLink(
  document: Document,
  id: string,
  url: string,
): void {
  const link = document.getElementById(id);
  link?.addEventListener("click", (event: Event) => {
    event.preventDefault();
    openExternalURL(url);
  });
}

/**
 * 注册文本输入控件的 preference 写入逻辑。
 */
function registerTextPreferenceSync(
  document: Document,
  id: string,
  persist: (value: string) => void,
): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  element?.addEventListener("change", () => {
    persist(element.value);
  });
}

/**
 * 注册数字输入控件的 preference 写入逻辑，并忽略无法解析的值。
 */
function registerNumberPreferenceSync(
  document: Document,
  id: string,
  read: () => number,
  persist: (value: number) => void,
): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (!element) {
    return;
  }

  element.value = String(read());
  element.setAttribute("value", element.value);
  element.addEventListener("change", () => {
    const value = Number(element.value);
    if (Number.isFinite(value)) {
      persist(value);
    }
  });
}

/**
 * 注册枚举控件的 preference 同步逻辑，并忽略未知值。
 */
function registerChoicePreferenceSync<T extends string>(
  document: Document,
  id: string,
  allowedValues: readonly T[],
  read: () => T,
  persist: (value: T) => void,
): void {
  const element = document.getElementById(id) as ChoicePreferenceElement | null;
  if (!element) {
    return;
  }

  setChoiceValue(element, read());
  const syncValue = () => {
    const value = getChoiceValue(element);
    if (allowedValues.includes(value as T)) {
      persist(value as T);
    }
  };

  element.addEventListener("command", syncValue);
  element.addEventListener("change", syncValue);
}

function getChoiceValue(element: ChoicePreferenceElement): string {
  return element.value ?? element.getAttribute("value") ?? "";
}

function setChoiceValue(element: ChoicePreferenceElement, value: string): void {
  element.value = value;
  element.setAttribute("value", value);
}

/**
 * 注册 checkbox 控件的 preference 写入逻辑。
 */
function registerCheckboxPreferenceSync(
  document: Document,
  id: string,
  read: () => boolean,
  persist: (value: boolean) => void,
): void {
  const element = document.getElementById(
    id,
  ) as CheckboxPreferenceElement | null;
  if (!element) {
    return;
  }

  setCheckboxChecked(element, read());
  const syncChecked = () => {
    persist(getCheckboxChecked(element));
  };

  element.addEventListener("command", syncChecked);
  element.addEventListener("change", syncChecked);
}

function getCheckboxChecked(element: CheckboxPreferenceElement): boolean {
  if (typeof element.checked === "boolean") {
    return element.checked;
  }
  return element.getAttribute("checked") === "true";
}

function setCheckboxChecked(
  element: CheckboxPreferenceElement,
  checked: boolean,
): void {
  element.checked = checked;
  element.setAttribute("checked", String(checked));
}

async function updateParsedCount(
  _window: Window,
  storage: ReturnType<typeof createStorage>,
): Promise<void> {
  try {
    const count = await storage.countReadyResults();
    setText(
      _window.document,
      `${config.addonRef}-parsed-count`,
      await formatL10n(_window, "pref-parsed-count", { count }),
    );
  } catch {
    setText(
      _window.document,
      `${config.addonRef}-parsed-count`,
      await formatL10n(_window, "pref-parsed-count-error"),
    );
  }
}

/**
 * 刷新 Markdown 查询 API token 的状态文案。
 */
async function updateMarkdownApiTokenStatus(_window: Window): Promise<void> {
  const hasToken = Boolean(getMarkdownApiToken());
  setText(
    _window.document,
    `${config.addonRef}-api-token-status`,
    await formatL10n(
      _window,
      hasToken ? "pref-query-api-token-ready" : "pref-query-api-token-empty",
    ),
  );
}

async function formatL10n(
  _window: Window,
  id: string,
  args?: Record<string, string | number>,
): Promise<string> {
  const l10n = _window.document.l10n;
  if (l10n?.formatValue) {
    const value = await l10n.formatValue(id, args);
    if (value) {
      return value;
    }
  }

  if (id === "pref-data-folder-path") {
    return `Data folder: ${args?.path ?? ""}`;
  }
  if (id === "pref-parsed-count") {
    return `Parsed PDFs: ${args?.count ?? 0}`;
  }
  if (id === "pref-query-api-token-ready") {
    return "Token generated";
  }
  if (id === "pref-query-api-token-empty") {
    return "No token generated";
  }
  return "Parsed PDFs: failed to read";
}

function setText(document: Document, id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}
