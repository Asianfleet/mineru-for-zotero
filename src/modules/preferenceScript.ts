import { config } from "../../package.json";
import {
  getMarkdownApiEnabled,
  getSaveImages,
  getLocalApiTimeoutMinutes,
  getOnlineApiTimeoutMinutes,
  getParseTier,
  getParseSource,
  setMarkdownApiEnabled,
  setApiKey,
  setLocalApiBaseURL,
  setLocalApiTimeoutMinutes,
  setOnlineApiTimeoutMinutes,
  setParseTier,
  setParseSource,
  setSaveImages,
  getStatusTagsEnabled,
  setStatusTagsEnabled,
  getSyncFolder,
  setSyncFolder,
  getAutoParsePageLimit,
  setAutoParsePageLimit,
  type ParseSource,
  type ParseTier,
} from "../utils/prefs";
import { createStorage } from "./storage";
import { getMinerUStorageRoot } from "./storageLocation";

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
    .getElementById(`${config.addonRef}-open-task-manager`)
    ?.addEventListener("click", () => {
      const addonObj = (Zotero as any).MinerUForZotero;
      if (addonObj?.api?.openTaskManagerWindow) {
        addonObj.api.openTaskManagerWindow();
      }
    });

  const syncAllButton = document.getElementById(`${config.addonRef}-sync-all`);
  if (syncAllButton) {
    // Labels are formatted asynchronously; only the latest request may land,
    // so a late progress label never overwrites the final one.
    let labelRequest = 0;
    const setSyncLabel = (
      id: string,
      args?: Record<string, string | number>,
    ): Promise<void> => {
      const request = ++labelRequest;
      return formatL10n(_window, id, args).then((label) => {
        if (request === labelRequest) {
          syncAllButton.textContent = label;
        }
      });
    };
    syncAllButton.addEventListener("click", async () => {
      syncAllButton.setAttribute("disabled", "true");
      void setSyncLabel("pref-sync-all-syncing");
      try {
        const addonObj = (Zotero as any).MinerUForZotero;
        if (addonObj?.api?.syncAllToAgentFolder) {
          const syncedCount = await addonObj.api.syncAllToAgentFolder(
            storage,
            (synced: number, total: number) => {
              void setSyncLabel("pref-sync-all-progress", { synced, total });
            },
          );
          await setSyncLabel("pref-sync-all-done", { count: syncedCount });
        }
      } catch (e) {
        await setSyncLabel("pref-sync-all-error");
      }
      setTimeout(() => {
        syncAllButton.removeAttribute("disabled");
        void setSyncLabel("pref-sync-all-button");
      }, 3000);
    });
  }

  registerExternalLink(
    document,
    `${config.addonRef}-github-link`,
    "https://github.com/dingzy53/mineru-for-zotero",
  );
  registerExternalLink(
    document,
    `${config.addonRef}-mineru-link`,
    "https://mineru.net/",
  );
}

export { getMinerUStorageRoot };

/**
 * Explicitly synchronize preferences.xhtml control values to prevent stale preferences before Zotero restarts.
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
  registerChoicePreferenceSync<ParseTier>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-tier`,
    ["flash", "basic", "standard", "advanced"],
    getParseTier,
    setParseTier,
  );
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-local-api-base-url`,
    setLocalApiBaseURL,
  );
  registerNumberPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-online-api-timeout-minutes`,
    getOnlineApiTimeoutMinutes,
    setOnlineApiTimeoutMinutes,
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
    `zotero-prefpane-${config.addonRef}-save-images`,
    getSaveImages,
    setSaveImages,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-status-tags`,
    getStatusTagsEnabled,
    setStatusTagsEnabled,
  );
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-sync-folder`,
    setSyncFolder,
  );
  registerNumberPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-auto-parse-page-limit`,
    getAutoParsePageLimit,
    setAutoParsePageLimit,
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
 * Register preference persistence logic for text input controls.
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
 * Register preference persistence logic for numeric input controls, ignoring unparseable values.
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
 * Register preference synchronization logic for choice/enum controls, ignoring unknown values.
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
 * Register preference persistence logic for checkbox controls.
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

/** English text used when Fluent cannot format a preferences string. */
const L10N_FALLBACKS: Record<string, string> = {
  "pref-data-folder-path": "Data folder: { $path }",
  "pref-parsed-count": "Parsed PDFs: { $count }",
  "pref-parsed-count-error": "Parsed PDFs: failed to read",
  "pref-sync-all-button": "Sync All Results Now",
  "pref-sync-all-syncing": "Syncing...",
  "pref-sync-all-progress": "Syncing... ({ $synced }/{ $total })",
  "pref-sync-all-done": "Done ({ $count })",
  "pref-sync-all-error": "Sync failed",
};

/**
 * Format a preferences string. `id` is the key as written in
 * `preferences.ftl`; the build prefixes every message id with the addon ref,
 * so the lookup uses the prefixed id.
 */
async function formatL10n(
  _window: Window,
  id: string,
  args?: Record<string, string | number>,
): Promise<string> {
  const l10n = _window.document.l10n;
  if (l10n?.formatValue) {
    try {
      const value = await l10n.formatValue(`${config.addonRef}-${id}`, args);
      if (value) {
        return value;
      }
    } catch {
      // Fall back to the English text below.
    }
  }

  return (L10N_FALLBACKS[id] ?? id).replace(
    /\{\s*\$(\w+)\s*\}/g,
    (_, name: string) => String(args?.[name] ?? ""),
  );
}

function setText(document: Document, id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}
