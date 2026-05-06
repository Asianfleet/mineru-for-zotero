import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("adds the MinerU icon to the item context menu command", function () {
    const menuItem = Zotero.getMainWindow().document.getElementById(
      "zotero-itemmenu-mineru-parse-pdf",
    );

    assert.equal(
      menuItem?.getAttribute("image"),
      `chrome://${config.addonRef}/content/mineru.svg`,
    );
  });

  it("registers a stable regular-item submenu command with label and icon", function () {
    const doc = Zotero.getMainWindow().document;
    const menuItem = doc.getElementById("zotero-itemmenu-mineru-parse-pdf");
    const submenu = doc.getElementById(
      "zotero-itemmenu-mineru-parse-pdf-submenu",
    );

    assert.equal(submenu?.localName, "menu");
    assert.isNotEmpty(submenu?.getAttribute("label"));
    assert.equal(
      submenu?.getAttribute("label"),
      menuItem?.getAttribute("label"),
    );
    assert.equal(
      submenu?.getAttribute("image"),
      `chrome://${config.addonRef}/content/mineru.svg`,
    );
    assert.include(submenu?.getAttribute("class") ?? "", "menu-iconic");
    assert.equal(submenu?.getAttribute("collapsed"), "true");
    assert.equal(submenu?.getAttribute("hidden"), "true");
    assert.include(submenu?.getAttribute("style") ?? "", "display: none");
  });

  it("detaches the regular-item submenu when the selected item is a PDF attachment", async function () {
    const win = Zotero.getMainWindow();
    const doc = win.document;
    const menu = doc.getElementById("zotero-itemmenu");
    const originalGetActiveZoteroPane = Zotero.getActiveZoteroPane;
    Zotero.getActiveZoteroPane = () =>
      ({
        getSelectedItems: () => [pdfAttachment()],
      }) as ReturnType<typeof Zotero.getActiveZoteroPane>;

    try {
      menu?.dispatchEvent(new win.Event("popupshowing", { bubbles: true }));
      await Zotero.Promise.delay(0);

      const menuItem = doc.getElementById("zotero-itemmenu-mineru-parse-pdf");
      const submenu = doc.getElementById(
        "zotero-itemmenu-mineru-parse-pdf-submenu",
      );

      assert.equal(menuItem?.parentElement, menu);
      assert.isNull(submenu);
    } finally {
      Zotero.getActiveZoteroPane = originalGetActiveZoteroPane;
    }
  });
});

function pdfAttachment(): Zotero.Item {
  return {
    id: 1,
    key: "ABC123",
    libraryID: 12,
    attachmentFilename: "a.pdf",
    attachmentModificationTime: Promise.resolve(1),
    isAttachment: () => true,
    isPDFAttachment: () => true,
    getFilePathAsync: async () => "C:/tmp/a.pdf",
  } as unknown as Zotero.Item;
}
