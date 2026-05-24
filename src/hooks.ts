import { getString, initLocale } from "./utils/locale";
import { registerItemMenu } from "./modules/itemMenu";
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

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerPreferencePane();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
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
  unregisterReaderToolbar(win);
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  Zotero.getMainWindows().forEach((win) => {
    removeMainWindowFTL(win);
  });
  unregisterReaderToolbar();
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
