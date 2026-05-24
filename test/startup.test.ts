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

  it("registers the MinerU parse status item tree column after main window load", async function () {
    await waitForPluginInitialization();
    const win = Zotero.getMainWindow();

    await Zotero[config.addonInstance].hooks.onMainWindowLoad(win);
    const registeredDataKey =
      Zotero[config.addonInstance].data.itemTreeColumn?.registeredDataKey;

    try {
      assert.isString(registeredDataKey);
      assert.isTrue(
        Zotero.ItemTreeManager.isCustomColumn(registeredDataKey),
        "stored registered data key should be a custom column",
      );
    } finally {
      await Zotero[config.addonInstance].hooks.onMainWindowUnload(win);
    }
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

async function waitForPluginInitialization(): Promise<void> {
  const addonInstance = Zotero[config.addonInstance] as
    | { data?: { initialized?: boolean } }
    | undefined;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (addonInstance?.data?.initialized) {
      return;
    }
    await Zotero.Promise.delay(20);
  }

  assert.fail("plugin did not finish initialization before timeout");
}
