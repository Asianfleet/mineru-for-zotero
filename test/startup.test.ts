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
});
