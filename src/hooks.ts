import { getString, initLocale } from "./utils/locale";
import {
  parseSelectedAttachment,
  selectedHasPDFAttachment,
} from "./modules/parseManager";
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
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  registerItemMenu(win);
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

function registerItemMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  const menu = doc.getElementById("zotero-itemmenu");
  if (!menu || doc.getElementById("zotero-itemmenu-mineru-parse-pdf")) {
    return;
  }

  const menuItem = doc.createXULElement("menuitem");
  menuItem.id = "zotero-itemmenu-mineru-parse-pdf";
  menuItem.setAttribute("label", getString("parse-menuitem-label"));
  menuItem.setAttribute(
    "image",
    `chrome://${addon.data.config.addonRef}/content/mineru.svg`,
  );
  menuItem.addEventListener("command", () => {
    void parseSelectedAttachment();
  });
  menu.appendChild(menuItem);
  menu.addEventListener("popupshowing", () => {
    void updateParseMenuItemState(menuItem);
  });
}

async function updateParseMenuItemState(menuItem: Element): Promise<void> {
  const enabled = await selectedHasPDFAttachment();
  if (enabled) {
    menuItem.removeAttribute("disabled");
  } else {
    menuItem.setAttribute("disabled", "true");
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterReaderToolbar(win);
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  unregisterReaderToolbar();
  destroyAllReaderOverlays();
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

/**
 * This function is just an example of dispatcher for Notify events.
 * Any operations should be placed in a function to keep this funcion clear.
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
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
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
