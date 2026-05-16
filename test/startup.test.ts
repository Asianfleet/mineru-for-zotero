import { config } from "../package.json";
import { assert } from "chai";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("does not inject the legacy item-context DOM menu", function () {
    const doc = Zotero.getMainWindow().document;

    assert.isNull(doc.getElementById("zotero-itemmenu-mineru-parse-pdf"));
    assert.isNull(
      doc.getElementById("zotero-itemmenu-mineru-parse-pdf-submenu"),
    );
  });

  it("removes the main-window Fluent resource on window unload", async function () {
    const win = Zotero.getMainWindow();
    const href = `${config.addonRef}-mainWindow.ftl`;

    win.MozXULElement.insertFTLIfNeeded(href);
    assert.isNotNull(win.document.querySelector(`[href="${href}"]`));

    await Zotero[config.addonInstance].hooks.onMainWindowUnload(win);

    assert.isNull(win.document.querySelector(`[href="${href}"]`));
  });
});
