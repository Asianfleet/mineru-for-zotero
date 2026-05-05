import { assert } from "chai";
import {
  createReaderToolbarCommandButton,
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

  it("runs a menu command when the menu button is clicked", function () {
    let clicked = false;
    const doc = {
      createElement(tagName: string) {
        assert.equal(tagName, "button");
        return {
          style: {},
          addEventListener(type: string, listener: EventListener) {
            if (type === "click") {
              this.click = listener;
            }
          },
          click: undefined as EventListener | undefined,
        } as unknown as HTMLButtonElement;
      },
    } as unknown as Document;

    const button = createReaderToolbarCommandButton(doc, "显示全部 box", () => {
      clicked = true;
    }) as HTMLButtonElement & { click?: EventListener };

    button.click?.({
      preventDefault() {},
      stopPropagation() {},
    } as Event);

    assert.isTrue(clicked);
  });

  it("does not style active menu commands as selected debug state", function () {
    const doc = {
      createElement(tagName: string) {
        assert.equal(tagName, "button");
        return {
          style: { backgroundColor: "" },
          addEventListener() {},
        } as unknown as HTMLButtonElement;
      },
    } as unknown as Document;

    const button = createReaderToolbarCommandButton(
      doc,
      "关闭插件能力",
      () => {},
      { active: true },
    );

    assert.equal(button.style.background, "transparent");
    assert.equal(button.style.fontWeight, "400");
    assert.equal(button.style.backgroundColor, "");
  });
});
