import { assert } from "chai";
import {
  createReaderToolbarMenuState,
  createReaderToolbarPanelStore,
  findReaderToolbarAnchor,
} from "../src/modules/readerToolbar";

describe("readerToolbar", function () {
  it("opens and closes the menu with explicit state", function () {
    const menu = createReaderToolbarMenuState();

    assert.isFalse(menu.isOpen());

    menu.open();
    assert.isTrue(menu.isOpen());

    menu.open();
    assert.isTrue(menu.isOpen());

    menu.close();
    assert.isFalse(menu.isOpen());

    menu.close();
    assert.isFalse(menu.isOpen());

    menu.toggle();
    assert.isTrue(menu.isOpen());

    menu.toggle();
    assert.isFalse(menu.isOpen());
  });

  it("keeps panel open state per reader across toolbar rerenders", function () {
    const panels = createReaderToolbarPanelStore();

    assert.isFalse(panels.isOpen("reader-1"));

    panels.toggle("reader-1");
    assert.isTrue(panels.isOpen("reader-1"));

    panels.ensure("reader-1");
    assert.isTrue(panels.isOpen("reader-1"));

    panels.close("reader-1");
    assert.isFalse(panels.isOpen("reader-1"));

    panels.toggle("reader-2");
    assert.isFalse(panels.isOpen("reader-1"));
    assert.isTrue(panels.isOpen("reader-2"));
  });

  it("anchors the button after the reader next-page button", function () {
    const parent = { id: "start" };
    const next = { id: "next", parentElement: parent };
    const doc = {
      getElementById(id: string) {
        return id === "next" ? (next as unknown as HTMLElement) : null;
      },
      querySelector(selector: string) {
        return selector === ".toolbar .start"
          ? (parent as unknown as Element)
          : null;
      },
    };

    const anchor = findReaderToolbarAnchor(doc);

    assert.strictEqual(anchor?.parent, parent);
    assert.strictEqual(anchor?.after, next);
  });

  it("falls back to the reader toolbar start section", function () {
    const parent = { id: "start" };
    const doc = {
      getElementById() {
        return null;
      },
      querySelector(selector: string) {
        return selector === ".toolbar .start"
          ? (parent as unknown as Element)
          : null;
      },
    };

    const anchor = findReaderToolbarAnchor(doc);

    assert.strictEqual(anchor?.parent, parent);
    assert.isUndefined(anchor?.after);
  });
});
