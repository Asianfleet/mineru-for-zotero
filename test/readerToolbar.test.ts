import { assert } from "chai";
import {
  createReaderToolbarActionRow,
  createReaderToolbarIconDataURI,
  createReaderToolbarCommandButton,
  createReaderToolbarMenuState,
  createReaderToolbarModeButton,
  createReaderToolbarPanel,
  createReaderToolbarPanelStore,
  findReaderToolbarAnchor,
  setReaderToolbarButtonContent,
  setReaderToolbarIconURI,
  setReaderToolbarModeIconSVG,
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

  it("styles the reader toolbar panel like Zotero reader popovers", function () {
    const doc = {
      createElement(tagName: string) {
        assert.equal(tagName, "div");
        return {
          style: {},
          hidden: false,
        } as unknown as HTMLDivElement;
      },
    } as unknown as Document;

    const panel = createReaderToolbarPanel(doc);

    assert.include(panel.className, "appearance-popup");
    assert.include(panel.className, "mineru-reader-toolbar-menu");
    assert.equal(panel.style.minWidth, "180px");
    assert.equal(panel.style.padding, "8px");
    assert.equal(
      panel.style.border,
      "1px solid var(--material-border, #d0d0d0)",
    );
    assert.equal(panel.style.borderRadius, "6px");
    assert.equal(panel.style.background, "var(--material-toolbar)");
    assert.equal(
      panel.style.boxShadow,
      "0 0 3px 0 rgba(0,0,0,.55),0 8px 40px 0 rgba(0,0,0,.25),0 0 3px 0 rgba(255,255,255,.1) inset",
    );
    assert.equal(panel.style.fontSize, "13px");
    assert.include(panel.style.fontFamily, "Microsoft YaHei");
  });

  it("uses compact Zotero-style typography for menu commands", function () {
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
      "仅显示鼠标所在 box",
      () => {},
    );

    assert.equal(button.style.padding, "4px 8px");
    assert.equal(button.style.borderRadius, "4px");
    assert.equal(button.style.fontSize, "13px");
    assert.equal(button.style.lineHeight, "1.35");
    assert.include(button.style.fontFamily, "Microsoft YaHei");
  });

  it("keeps selection status as a label and places copy before clear actions", function () {
    const children: unknown[] = [];
    const doc = {
      createElement(tagName: string) {
        return {
          tagName,
          className: "",
          textContent: "",
          innerHTML: "",
          style: { backgroundColor: "" },
          children: [] as unknown[],
          append(...nodes: unknown[]) {
            this.children.push(...nodes);
          },
          replaceChildren(...nodes: unknown[]) {
            this.children.splice(0, this.children.length, ...nodes);
          },
          setAttribute(name: string, value: string) {
            this[name] = value;
          },
          addEventListener() {},
        } as unknown as HTMLElement;
      },
    } as unknown as Document;

    const group = {
      className: "group",
      style: {},
      append(...nodes: unknown[]) {
        children.push(...nodes);
      },
    } as unknown as HTMLDivElement;

    createReaderToolbarActionRow(doc, group, {
      selectionLabel: "已选内容",
      copySelectedLabel: "复制已选内容",
      copyFullMarkdownLabel: "复制全文 markdown",
      selectedCount: 3,
      copyIconSVG:
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#333333"></path></svg>',
      clearLabel: "清空选择",
      clearIconSVG:
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#333333"></path></svg>',
      onCopy() {},
      onClear() {},
    });

    assert.equal(group.className, "group");
    assert.equal(children.length, 1);

    const row = children[0] as HTMLDivElement & { children: HTMLElement[] };
    assert.equal(row.className, "mineru-reader-toolbar-action-row");
    assert.equal(row.style.display, "flex");
    assert.equal(row.style.justifyContent, "space-between");

    const label = row.children[0] as HTMLDivElement & {
      children: HTMLElement[];
    };
    assert.equal(label.className, "mineru-reader-toolbar-selection-label");
    assert.equal(label.children[0].textContent, "已选内容");
    assert.equal(label.children[1].className, "mineru-reader-toolbar-badge");
    assert.equal(label.children[1].textContent, "3");

    const actions = row.children[1] as HTMLDivElement & {
      children: HTMLButtonElement[];
    };
    assert.equal(actions.className, "mineru-reader-toolbar-action-buttons");

    const copyButton = actions.children[0];
    assert.include(copyButton.className, "mineru-reader-toolbar-icon-command");
    assert.include(copyButton.innerHTML, "currentColor");
    assert.equal(copyButton.style.width, "24px");
    assert.equal(copyButton.style.height, "24px");
    assert.equal(copyButton.style.padding, "0");
    assert.equal(copyButton.style.color, "var(--fill-secondary)");
    assert.equal(copyButton.title, "复制已选内容");

    const clearButton = actions.children[1];
    assert.include(clearButton.className, "mineru-reader-toolbar-icon-command");
    assert.include(clearButton.innerHTML, "currentColor");
    assert.equal(clearButton.style.width, "24px");
    assert.equal(clearButton.style.height, "24px");
    assert.equal(clearButton.style.padding, "0");
    assert.equal(clearButton.style.color, "var(--fill-secondary)");
    assert.equal(clearButton.title, "清空选择");
  });

  it("uses full markdown copy text when no boxes are selected", function () {
    const children: unknown[] = [];
    const doc = {
      createElement(tagName: string) {
        return {
          tagName,
          className: "",
          textContent: "",
          innerHTML: "",
          style: { backgroundColor: "" },
          children: [] as unknown[],
          append(...nodes: unknown[]) {
            this.children.push(...nodes);
          },
          replaceChildren(...nodes: unknown[]) {
            this.children.splice(0, this.children.length, ...nodes);
          },
          setAttribute(name: string, value: string) {
            this[name] = value;
          },
          addEventListener() {},
        } as unknown as HTMLElement;
      },
    } as unknown as Document;
    const group = {
      className: "group",
      style: {},
      append(...nodes: unknown[]) {
        children.push(...nodes);
      },
    } as unknown as HTMLDivElement;

    createReaderToolbarActionRow(doc, group, {
      selectionLabel: "已选内容",
      copySelectedLabel: "复制已选内容",
      copyFullMarkdownLabel: "复制全文 markdown",
      selectedCount: 0,
      copyIconSVG:
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#333333"></path></svg>',
      clearLabel: "清空选择",
      clearIconSVG:
        '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#333333"></path></svg>',
      onCopy() {},
      onClear() {},
    });

    const row = children[0] as HTMLDivElement & { children: HTMLElement[] };
    const actions = row.children[1] as HTMLDivElement & {
      children: Array<HTMLButtonElement & { "aria-label"?: string }>;
    };
    const copyButton = actions.children[0];

    assert.equal(copyButton.title, "复制全文 markdown");
    assert.equal(copyButton["aria-label"], "复制全文 markdown");
  });

  it("creates active icon buttons for reader toolbar modes", function () {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"></path></svg>';
    setReaderToolbarModeIconSVG("hover", svg);
    let click: EventListener | undefined;
    const doc = {
      createElement(tagName: string) {
        return {
          tagName,
          innerHTML: "",
          style: {
            background: "",
            backgroundColor: "",
            border: "",
            padding: "",
          },
          setAttribute(name: string, value: string) {
            this[name] = value;
          },
          addEventListener(type: string, listener: EventListener) {
            if (type === "click") {
              click = listener;
            }
          },
        } as unknown as HTMLButtonElement;
      },
    } as unknown as Document;
    let clicked = false;

    const button = createReaderToolbarModeButton(
      doc,
      "仅显示鼠标所在 box",
      "hover",
      true,
      () => {
        clicked = true;
      },
    ) as HTMLButtonElement & {
      "aria-label"?: string;
      "aria-pressed"?: string;
    };
    click?.({
      preventDefault() {},
      stopPropagation() {},
    } as Event);

    assert.equal(button.className, "active");
    assert.equal(button.tabIndex, -1);
    assert.equal(button.innerHTML, svg);
    assert.equal(button.title, "仅显示鼠标所在 box");
    assert.equal(button["aria-label"], "仅显示鼠标所在 box");
    assert.equal(button["aria-pressed"], "true");
    assert.equal(button.style.background, "");
    assert.equal(button.style.border, "");
    assert.equal(button.style.padding, "");
    assert.isTrue(clicked);
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
