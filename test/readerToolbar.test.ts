import { assert } from "chai";
import {
  createReaderToolbarIconDataURI,
  createReaderToolbarCommandButton,
  createReaderToolbarMenuState,
  createReaderToolbarPanelStore,
  findReaderToolbarAnchor,
  setReaderToolbarButtonContent,
  setReaderToolbarIconURI,
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

  it("creates a reader-safe data URI from SVG content", function () {
    const iconSource = createReaderToolbarIconDataURI(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"></path></svg>',
    );

    assert.match(iconSource, /^data:image\/svg\+xml;charset=UTF-8,/);
    assert.notMatch(iconSource, /^chrome:/);
    assert.include(
      decodeURIComponent(iconSource.split(",", 2)[1] ?? ""),
      '<path d="M1 1"',
    );
  });

  it("uses the configured MinerU SVG as the toolbar button content", function () {
    const children: unknown[] = [];
    const configuredIconURI = createReaderToolbarIconDataURI(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1"></circle></svg>',
    );
    setReaderToolbarIconURI(configuredIconURI);
    const button = {
      textContent: "MinerU boxes",
      title: "",
      style: {},
      setAttribute(name: string, value: string) {
        this[name] = value;
      },
      replaceChildren(...nodes: unknown[]) {
        children.splice(0, children.length, ...nodes);
        this.textContent = "";
      },
    } as unknown as HTMLButtonElement & { "aria-label"?: string };
    const doc = {
      createElement(tagName: string) {
        assert.equal(tagName, "img");
        return {
          tagName,
          alt: "",
          draggable: true,
          style: {},
        } as unknown as HTMLImageElement;
      },
    } as unknown as Document;

    setReaderToolbarButtonContent(button, doc, "MinerU boxes");

    assert.equal(button.textContent, "");
    assert.equal(children.length, 1);
    const iconSource = (children[0] as HTMLImageElement).src;
    assert.equal(iconSource, configuredIconURI);
    assert.equal((children[0] as HTMLImageElement).alt, "");
    assert.isFalse((children[0] as HTMLImageElement).draggable);
    assert.equal((children[0] as HTMLImageElement).style.width, "16px");
    assert.equal((children[0] as HTMLImageElement).style.height, "16px");
    assert.equal(button.title, "MinerU boxes");
    assert.equal(button["aria-label"], "MinerU boxes");
  });

  it("keeps the existing toolbar icon when only the label changes", function () {
    const children: unknown[] = [];
    setReaderToolbarIconURI(
      createReaderToolbarIconDataURI(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"></rect></svg>',
      ),
    );
    let createElementCount = 0;
    let replaceChildrenCount = 0;
    const button = {
      title: "MinerU boxes",
      get firstElementChild() {
        return children[0] ?? null;
      },
      setAttribute(name: string, value: string) {
        this[name] = value;
      },
      replaceChildren(...nodes: unknown[]) {
        replaceChildrenCount += 1;
        children.splice(0, children.length, ...nodes);
      },
    } as unknown as HTMLButtonElement & { "aria-label"?: string };
    const doc = {
      createElement(tagName: string) {
        createElementCount += 1;
        return {
          tagName,
          alt: "",
          draggable: true,
          style: {},
        } as unknown as HTMLImageElement;
      },
    } as unknown as Document;

    setReaderToolbarButtonContent(button, doc, "MinerU boxes");
    setReaderToolbarButtonContent(button, doc, "MinerU box");

    assert.equal(createElementCount, 1);
    assert.equal(replaceChildrenCount, 1);
    assert.equal(button.title, "MinerU box");
    assert.equal(button["aria-label"], "MinerU box");
  });
});
