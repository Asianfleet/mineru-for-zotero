import { getString, initLocale } from "./utils/locale";
import {
  getSelectedParseContext,
  parseAttachment,
  parseAttachments,
  parseSelectedAttachment,
  type ItemParseContext,
} from "./modules/parseManager";
import { registerItemMenu } from "./modules/itemMenu";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { destroyAllReaderOverlays } from "./modules/readerOverlay";
import {
  registerReaderToolbar,
  unregisterReaderToolbar,
} from "./modules/readerToolbar";
import { createZToolkit } from "./utils/ztoolkit";

const PARSE_MENU_ID = "zotero-itemmenu-mineru-parse-pdf";
const PARSE_SUBMENU_ID = "zotero-itemmenu-mineru-parse-pdf-submenu";

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

function registerLegacyItemMenu(win: _ZoteroTypes.MainWindow): void {
  const doc = win.document;
  const menu = doc.getElementById("zotero-itemmenu");
  if (!menu || doc.getElementById(PARSE_MENU_ID)) {
    return;
  }

  const menuItem = createParseMenuItem(doc);
  const submenu = createParseSubmenu(doc);
  collapseMenuElement(submenu);
  menu.appendChild(menuItem);
  menu.appendChild(submenu);
  menu.addEventListener("popupshowing", (event: Event) => {
    if (event.target !== menu) {
      return;
    }
    void updateParseMenu(win, menu, menuItem, submenu);
  });
}

async function updateParseMenu(
  win: _ZoteroTypes.MainWindow,
  parentMenu: Element,
  menuItem: Element,
  submenu: Element,
): Promise<void> {
  const context = await getSelectedParseContext();
  const doc = win.document;

  if (!context || context.kind === "unsupported") {
    attachParseMenuItem(parentMenu, menuItem);
    showMenuElement(menuItem);
    detachMenuElement(submenu);
    clearRegularItemParseSubmenu(submenu);
    menuItem.setAttribute("disabled", "true");
    return;
  }

  if (context.kind === "attachment") {
    attachParseMenuItem(parentMenu, menuItem);
    showMenuElement(menuItem);
    detachMenuElement(submenu);
    clearRegularItemParseSubmenu(submenu);
    menuItem.removeAttribute("disabled");
    return;
  }

  detachMenuElement(menuItem);
  attachParseSubmenu(parentMenu, submenu);
  showMenuElement(submenu);
  submenu.removeAttribute("disabled");
  renderRegularItemParseSubmenu(doc, submenu, context);
}

function createParseMenuItem(doc: Document): Element {
  const menuItem = doc.createXULElement("menuitem");
  menuItem.id = PARSE_MENU_ID;
  menuItem.setAttribute("class", "menuitem-iconic");
  menuItem.setAttribute("label", getString("parse-menuitem-label"));
  menuItem.setAttribute(
    "image",
    `chrome://${addon.data.config.addonRef}/content/mineru.svg`,
  );
  menuItem.addEventListener("command", () => {
    void parseSelectedAttachment();
  });
  return menuItem;
}

function createParseSubmenu(doc: Document): Element {
  const menu = doc.createXULElement("menu");
  menu.id = PARSE_SUBMENU_ID;
  menu.setAttribute("class", "menu-iconic");
  menu.setAttribute("label", getString("parse-menuitem-label"));
  menu.setAttribute(
    "image",
    `chrome://${addon.data.config.addonRef}/content/mineru.svg`,
  );
  menu.appendChild(doc.createXULElement("menupopup"));
  return menu;
}

function clearRegularItemParseSubmenu(menu: Element): void {
  const popup = menu.querySelector("menupopup");
  if (popup) {
    removeChildren(popup);
  }
}

function renderRegularItemParseSubmenu(
  doc: Document,
  menu: Element,
  context: Extract<ItemParseContext, { kind: "regular" }>,
): void {
  const popup =
    menu.querySelector("menupopup") ?? doc.createXULElement("menupopup");
  removeChildren(popup);
  if (!popup.parentElement) {
    menu.appendChild(popup);
  }

  const parseAllItem = doc.createXULElement("menuitem");
  parseAllItem.setAttribute("label", getString("parse-all-menuitem-label"));
  parseAllItem.addEventListener("command", () => {
    void parseAttachments(context.attachments);
  });
  popup.appendChild(parseAllItem);
  popup.appendChild(doc.createXULElement("menuseparator"));

  for (const attachment of context.attachments) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", getAttachmentMenuLabel(attachment));
    item.addEventListener("command", () => {
      void parseAttachment(attachment);
    });
    popup.appendChild(item);
  }

  menu.appendChild(popup);
}

function removeChildren(element: Element): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function attachParseMenuItem(parent: Element, menuItem: Element): void {
  if (!menuItem.parentElement) {
    parent.appendChild(menuItem);
  }
}

function attachParseSubmenu(parent: Element, submenu: Element): void {
  if (!submenu.parentElement) {
    parent.appendChild(submenu);
  }
}

function detachMenuElement(element: Element): void {
  if (element.parentElement) {
    element.parentElement.removeChild(element);
  }
  collapseMenuElement(element);
}

function collapseMenuElement(element: Element): void {
  element.setAttribute("collapsed", "true");
  element.setAttribute("hidden", "true");
  element.setAttribute("style", "display: none;");
}

function showMenuElement(element: Element): void {
  element.removeAttribute("collapsed");
  element.removeAttribute("hidden");
  element.removeAttribute("style");
}

function getAttachmentMenuLabel(attachment: Zotero.Item): string {
  return attachment.attachmentFilename || `PDF ${attachment.id}`;
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
