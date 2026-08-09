import { getString, initLocale } from "./utils/locale";
import { registerItemMenu } from "./modules/itemMenu";
import {
  registerMarkdownQueryApiEndpoint,
  unregisterMarkdownQueryApiEndpoint,
} from "./modules/markdownQuery/apiEndpoint";
import {
  registerItemTreeColumn,
  unregisterItemTreeColumn,
} from "./modules/itemTreeColumn";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { destroyAllReaderOverlays } from "./modules/readerOverlay";
import {
  registerReaderToolbar,
  unregisterReaderToolbar,
} from "./modules/readerToolbar";
import { createZToolkit } from "./utils/ztoolkit";
import { getAutoParsePageLimit } from "./utils/prefs";
import { parseAttachment } from "./modules/parseManager";

let notifierID: string | null = null;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerPreferencePane();
  registerMarkdownQueryApiEndpoint();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;

  notifierID = Zotero.Notifier.registerObserver(
    {
      notify: async (
        event: string,
        type: string,
        ids: Array<string | number>,
        extraData: Record<string, any>,
      ) => {
        if (event === "add" && type === "item") {
          const limit = getAutoParsePageLimit();
          if (limit > 0) {
            const items = await Zotero.Items.getAsync(ids as number[]);
            for (const item of items) {
              if (item.isPDFAttachment()) {
                // Check page count and parse if within limit
                // The Zotero attachment needs to be fully synced or indexed to have page count
                // But we can check standard file size or pdfinfo later
                // For now, let's just trigger parsing
                parseAttachment(item).catch((e) =>
                  ztoolkit.log("Auto-parse failed", e),
                );
              }
            }
          }
        }
      },
    },
    ["item"],
    "mineru-for-zotero",
  );
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  await new Promise((resolve) => {
    if (win.document.readyState !== "complete") {
      win.document.addEventListener("readystatechange", () => {
        if (win.document.readyState === "complete") {
          resolve(void 0);
        }
      });
    }
    resolve(void 0);
  });

  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );
  insertMainWindowStylesheet(win);

  registerItemMenu();
  await registerItemTreeColumn();
  await registerReaderToolbar(win);
}

function registerPreferencePane(): void {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

async function onMainWindowUnload(win: Window): Promise<void> {
  removeMainWindowFTL(win);
  removeMainWindowStylesheet(win);
  unregisterReaderToolbar(win);
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  Zotero.getMainWindows().forEach((win) => {
    removeMainWindowFTL(win);
    removeMainWindowStylesheet(win);
  });
  if (notifierID) {
    Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = null;
  }
  unregisterReaderToolbar();
  unregisterMarkdownQueryApiEndpoint();
  destroyAllReaderOverlays();
  unregisterItemTreeColumn();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

function removeMainWindowFTL(win: Window): void {
  win.document
    .querySelector(`[href="${addon.data.config.addonRef}-mainWindow.ftl"]`)
    ?.remove();
}

function getMainWindowStylesheetHref(): string {
  return `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`;
}

function insertMainWindowStylesheet(win: Window): void {
  const href = getMainWindowStylesheetHref();
  if (win.document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) {
    return;
  }

  const link = win.document.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", href);
  win.document.documentElement?.append(link);
}

function removeMainWindowStylesheet(win: Window): void {
  win.document
    .querySelector(
      `link[rel="stylesheet"][href="${getMainWindowStylesheetHref()}"]`,
    )
    ?.remove();
}

/**
 * Dispatches Notify events.
 * Keep the event-specific work in dedicated helpers to keep this function small.
 */
async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

/**
 * Dispatches Preference UI events.
 * Keep the event-specific work in dedicated helpers to keep this function small.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  ztoolkit.log("shortcut", type);
}

function onDialogEvents(type: string) {
  ztoolkit.log("dialog event", type);
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
