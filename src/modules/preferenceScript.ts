import { config } from "../../package.json";
import {
  setApiKey,
  setLocalApiBaseURL,
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

export async function registerPrefsScripts(_window: Window) {
  const storageRoot = getMinerUStorageRoot();
  const storage = createStorage(storageRoot);
  const document = _window.document;

  registerPreferenceValueSync(document);

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
  registerSelectPreferenceSync<ParseSource>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-source`,
    ["online", "local"],
    setParseSource,
  );
  registerSelectPreferenceSync<ParseMode>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-mode`,
    ["precise", "lite"],
    setParseMode,
  );
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-local-api-base-url`,
    setLocalApiBaseURL,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-save-images`,
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
 * 注册 select 控件的 preference 写入逻辑，并忽略未知值。
 */
function registerSelectPreferenceSync<T extends string>(
  document: Document,
  id: string,
  allowedValues: readonly T[],
  persist: (value: T) => void,
): void {
  const element = document.getElementById(id) as HTMLSelectElement | null;
  element?.addEventListener("change", () => {
    const value = element.value;
    if (allowedValues.includes(value as T)) {
      persist(value as T);
    }
  });
}

/**
 * 注册 checkbox 控件的 preference 写入逻辑。
 */
function registerCheckboxPreferenceSync(
  document: Document,
  id: string,
  persist: (value: boolean) => void,
): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  element?.addEventListener("change", () => {
    persist(element.checked);
  });
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
  return "Parsed PDFs: failed to read";
}

function setText(document: Document, id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}
