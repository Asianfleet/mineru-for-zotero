import { config } from "../../package.json";
import { getLocaleID } from "../utils/locale";
import { parseAttachment } from "./parseManager";

const PARSE_PDF_MENU_ID = `${config.addonRef}-parse-pdf`;

type ItemMenuContext = {
  items?: Zotero.Item[];
  menuElem?: Element;
  setVisible: (visible: boolean) => void;
};

type MenuCommandContext = {
  items?: Zotero.Item[];
};

type MenuRegistration = {
  menuID: string;
  pluginID: string;
  target: "main/library/item";
  menus: Array<{
    menuType: "menuitem";
    l10nID: string;
    icon: string;
    onCommand: (event: Event, context: MenuCommandContext) => void;
    onShowing: (event: Event, context: ItemMenuContext) => void;
  }>;
};

type MenuManager = {
  registerMenu: (options: MenuRegistration) => string | false;
};

export function registerItemMenu(menuManager = getMenuManager()): void {
  menuManager.registerMenu(createParsePdfMenuRegistration());
}

export function createParsePdfMenuRegistration(): MenuRegistration {
  return {
    menuID: PARSE_PDF_MENU_ID,
    pluginID: config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: getLocaleID("parse-pdf-menuitem"),
        icon: `chrome://${config.addonRef}/content/mineru.svg`,
        onCommand: (_event, context) => {
          const attachments = (context.items ?? []).filter(isPdfAttachment);
          attachments.forEach((attachment) => {
            void parseAttachment(attachment);
          });
        },
        onShowing: (_event, context) => {
          const items = context.items ?? [];
          const visible = shouldShowParsePdfMenu(items);
          context.setVisible(visible);
          syncMenuGroupSeparator(context.menuElem, visible);
        },
      },
    ],
  };
}

export function shouldShowParsePdfMenu(items: Zotero.Item[]): boolean {
  return items.length > 0 && items.every(isPdfAttachment);
}

function isPdfAttachment(item: Zotero.Item): boolean {
  return (
    typeof item.isAttachment === "function" &&
    typeof item.isPDFAttachment === "function" &&
    item.isAttachment() &&
    item.isPDFAttachment()
  );
}

function syncMenuGroupSeparator(
  menuElem: Element | undefined,
  visible: boolean,
): void {
  const separator = findCustomMenuGroupSeparator(menuElem);
  if (!separator) {
    return;
  }

  (separator as HTMLElement).hidden =
    !visible && !hasVisibleCustomMenuItemAfter(separator);
}

function findCustomMenuGroupSeparator(
  menuElem: Element | undefined,
): Element | null {
  if (!menuElem?.parentElement) {
    return null;
  }

  let sibling = menuElem.previousElementSibling;
  while (sibling?.classList.contains("zotero-custom-menu-item")) {
    if (sibling.classList.contains("zotero-custom-menu-group-separator")) {
      return sibling;
    }
    sibling = sibling.previousElementSibling;
  }

  return null;
}

function hasVisibleCustomMenuItemAfter(separator: Element): boolean {
  let sibling = separator.nextElementSibling;
  while (sibling?.classList.contains("zotero-custom-menu-item")) {
    if (
      !sibling.classList.contains("zotero-custom-menu-group-separator") &&
      !isHiddenElement(sibling)
    ) {
      return true;
    }
    sibling = sibling.nextElementSibling;
  }
  return false;
}

function isHiddenElement(element: Element): boolean {
  return Boolean(
    (element as HTMLElement).hidden ||
    element.getAttribute("hidden") === "true" ||
    element.getAttribute("collapsed") === "true",
  );
}

function getMenuManager(): MenuManager {
  return Zotero.MenuManager as unknown as MenuManager;
}
