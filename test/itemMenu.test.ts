import { assert } from "chai";
import * as itemMenu from "../src/modules/itemMenu";
import { config } from "../package.json";

const { createParsePdfMenuRegistration, shouldShowParsePdfMenu } = itemMenu;

describe("itemMenu", function () {
  it("shows the parse command only when every selected item is a PDF attachment", function () {
    assert.isTrue(shouldShowParsePdfMenu([pdfAttachment()]));
    assert.isTrue(shouldShowParsePdfMenu([pdfAttachment(), pdfAttachment()]));
    assert.isFalse(shouldShowParsePdfMenu([]));
    assert.isFalse(shouldShowParsePdfMenu([regularItem()]));
    assert.isFalse(shouldShowParsePdfMenu([pdfAttachment(), regularItem()]));
    assert.isFalse(shouldShowParsePdfMenu([nonPdfAttachment()]));
    assert.isFalse(shouldShowParsePdfMenu([{} as Zotero.Item]));
  });

  it("registers a PDF attachment item-menu command through Zotero MenuManager", function () {
    const registration = createParsePdfMenuRegistration();
    const menu = registration.menus[0];

    assert.equal(registration.menuID, `${config.addonRef}-parse-pdf`);
    assert.equal(registration.pluginID, config.addonID);
    assert.equal(registration.target, "main/library/item");
    assert.equal(menu.menuType, "menuitem");
    assert.equal(menu.l10nID, `${config.addonRef}-parse-pdf-menuitem`);
    assert.equal(menu.icon, `chrome://${config.addonRef}/content/mineru.svg`);
  });

  it("submits selected PDF attachments through the batch parse entry", function () {
    const parsedBatches: Zotero.Item[][] = [];
    const firstAttachment = pdfAttachment();
    const secondAttachment = pdfAttachment();
    const menu = createParsePdfMenuRegistration({
      parseAttachments: async (attachments) => {
        parsedBatches.push(attachments);
      },
    }).menus[0];

    menu.onCommand(new Event("command"), {
      items: [firstAttachment, secondAttachment],
    });

    assert.deepEqual(parsedBatches, [[firstAttachment, secondAttachment]]);
  });

  it("does not expose a separate MenuManager unregister path", function () {
    assert.notProperty(itemMenu, "unregisterItemMenu");
  });

  it("hides the MenuManager command for mixed or regular-item selections", function () {
    const menu = createParsePdfMenuRegistration().menus[0];
    const visibleStates: boolean[] = [];

    menu.onShowing(new Event("popupshowing"), {
      items: [pdfAttachment(), regularItem()],
      setVisible: (visible) => visibleStates.push(visible),
    });
    menu.onShowing(new Event("popupshowing"), {
      items: [pdfAttachment()],
      setVisible: (visible) => visibleStates.push(visible),
    });

    assert.deepEqual(visibleStates, [false, true]);
  });

  it("hides the trailing custom-menu separator when the command is hidden", function () {
    const doc = document.implementation.createHTMLDocument("");
    const popup = doc.createElement("menupopup");
    const separator = doc.createElement("menuseparator");
    const menuElem = doc.createElement("menuitem");
    const menu = createParsePdfMenuRegistration().menus[0];

    separator.classList.add(
      "zotero-custom-menu-item",
      "zotero-custom-menu-group-separator",
    );
    menuElem.classList.add("zotero-custom-menu-item");
    popup.append(separator, menuElem);

    menu.onShowing(new Event("popupshowing"), {
      items: [regularItem()],
      menuElem,
      setVisible: (visible) => {
        menuElem.hidden = !visible;
      },
    } as Parameters<typeof menu.onShowing>[1]);

    assert.isTrue(menuElem.hidden);
    assert.isTrue(separator.hidden);
  });
});

function pdfAttachment(): Zotero.Item {
  return {
    isAttachment: () => true,
    isPDFAttachment: () => true,
  } as unknown as Zotero.Item;
}

function nonPdfAttachment(): Zotero.Item {
  return {
    isAttachment: () => true,
    isPDFAttachment: () => false,
  } as unknown as Zotero.Item;
}

function regularItem(): Zotero.Item {
  return {
    isAttachment: () => false,
    isPDFAttachment: () => false,
  } as unknown as Zotero.Item;
}
