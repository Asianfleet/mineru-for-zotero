import { assert } from "chai";
import {
  applyReaderOverlayMode,
  buildReaderOverlayRoot,
  createReaderOverlayPositioningController,
  ensureReaderOverlayStyles,
  getReaderOverlayNoticeText,
  getReaderOverlayWindows,
  getReaderSelectedBoxCount,
  findPageElement,
  setReaderOverlayModeForReader,
  setReaderOverlayRootForReader,
} from "../src/modules/readerOverlay";
import { normalizedBoxes } from "./domainFixtures";

describe("readerOverlay", function () {
  it("cleans up the existing overlay root when mode switches to off", async function () {
    const removed: string[] = [];
    const root = {
      remove() {
        removed.push("removed");
      },
    } as unknown as HTMLElement;
    const reader = createReader({
      instanceID: "reader-1",
      attachmentKey: "ABC123",
      views: [createView("primary")],
    });

    const state = setReaderOverlayModeForReader(reader, "all");
    if (!state) {
      assert.fail("Expected overlay state");
    }
    setReaderOverlayRootForReader(reader, root);

    state.cleanupPositioning = () => {
      removed.push("cleanup");
    };

    await applyReaderOverlayMode(reader, "off");

    assert.deepEqual(removed, ["cleanup", "removed"]);
    assert.isNull(state.root);
  });

  it("marks hover mode on the root so mode-specific rendering can differ", function () {
    const doc = createDocumentStub();

    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      normalizedBoxes,
      "hover",
    );

    assert.include(root.className, "mineru-copy-mode-hover");
  });

  it("renders hover labels and copy buttons", function () {
    const doc = createDocumentStub();

    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [
        createBox(0, "text", "第一段"),
        createBox(1, "title", "标题"),
        createBox(2, "image_caption", "图片标题"),
        createBox(3, "page_header", "页眉"),
        createBox(4, "page_number", "1"),
        createBox(5, "interline_equation", "E=mc^2", "E=mc^2"),
      ],
      "hover",
    );

    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-box-label").map(
        (element) => element.textContent,
      ),
      ["文本", "标题", "图片标题", "页眉", "页码", "公式"],
    );
    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-button").map(
        (element) => element.textContent,
      ),
      ["复制", "复制", "复制", "复制", "复制", "带 $ 复制", "不带 $ 复制"],
    );
  });

  it("renders labels and copy buttons in all mode", function () {
    const doc = createDocumentStub();

    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [
        createBox(0, "text", "第一段"),
        createBox(1, "title", "标题"),
        createBox(2, "image_caption", "图片标题"),
        createBox(3, "page_header", "页眉"),
        createBox(4, "page_number", "1"),
        createBox(5, "interline_equation", "E=mc^2", "E=mc^2"),
      ],
      "all",
    );

    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-box-label").map(
        (element) => element.textContent,
      ),
      ["文本", "标题", "图片标题", "页眉", "页码", "公式"],
    );
    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-button").map(
        (element) => element.textContent,
      ),
      ["复制", "复制", "复制", "复制", "复制", "带 $ 复制", "不带 $ 复制"],
    );
  });

  it("hides controls until a box is hovered", function () {
    const doc = createDocumentStub();

    ensureReaderOverlayStyles(doc as unknown as Document);

    const style = doc.headChildren[0];
    assert.include(
      style.textContent,
      ".mineru-copy-box-label,\n.mineru-copy-box-actions",
    );
    assert.include(
      style.textContent,
      ".mineru-copy-box:hover .mineru-copy-box-label",
    );
    assert.include(
      style.textContent,
      ".mineru-copy-box:hover .mineru-copy-box-actions",
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box:hover\s*\{[^}]*z-index:\s*10/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-actions\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/s,
    );
    assert.notMatch(
      style.textContent,
      /\.mineru-copy-box-actions\s*\{\s*position:[^}]*display:/s,
    );
  });

  it("provides a local fallback for the missing-result prompt", function () {
    assert.equal(
      getReaderOverlayNoticeText("reader-overlay-missing-result"),
      "当前 PDF 还没有可用的 MinerU 解析结果，请先解析后再开启 box",
    );
  });

  it("prefers page elements over bare page attributes", function () {
    const page = { id: "page" } as unknown as Element;
    const bare = { id: "bare" } as unknown as Element;
    const doc = {
      querySelector(selector: string) {
        if (selector === '.pdfViewer .page[data-page-number="2"]') {
          return null;
        }
        if (selector === '.page[data-page-number="2"]') {
          return page;
        }
        if (selector === '.pdfViewer .page[data-page="2"]') {
          return null;
        }
        if (selector === '.page[data-page="2"]') {
          return null;
        }
        if (selector === '[data-page-number="2"]') {
          return bare;
        }
        return null;
      },
    };

    assert.strictEqual(findPageElement(doc as unknown as Document, 2), page);
  });

  it("forwards wheel events over overlay boxes to the reader scroll container", function () {
    let wheelListener: ((event: WheelEvent) => void) | null = null;
    const target = {} as Node;
    const scrollCalls: ScrollToOptions[] = [];
    const root = {
      contains(node: Node) {
        return node === target;
      },
    } as unknown as HTMLDivElement;
    const scrollContainer = {
      addEventListener() {},
      removeEventListener() {},
      scrollBy(options: ScrollToOptions) {
        scrollCalls.push(options);
      },
    } as unknown as Element;
    const doc = {
      querySelector(selector: string) {
        return selector === "#viewerContainer" ? scrollContainer : null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = {
      addEventListener(type: string, listener: EventListener) {
        if (type === "wheel") {
          wheelListener = listener as (event: WheelEvent) => void;
        }
      },
      removeEventListener() {},
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout() {
        return 1;
      },
      clearTimeout() {},
      setInterval() {
        return 1;
      },
      clearInterval() {},
    } as unknown as Window;

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    let prevented = false;
    wheelListener?.({
      target,
      deltaX: 4,
      deltaY: 120,
      deltaMode: 0,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {},
    } as unknown as WheelEvent);

    assert.isTrue(prevented);
    assert.deepEqual(scrollCalls, [
      { left: 4, top: 120, behavior: "auto" },
    ]);
  });

  it("redispatches wheel events over overlay boxes to the underlying PDF element", function () {
    let wheelListener: ((event: WheelEvent) => void) | null = null;
    const target = {} as Node;
    const dispatched: WheelEvent[] = [];
    const underlying = {
      dispatchEvent(event: Event) {
        dispatched.push(event as WheelEvent);
        return true;
      },
    } as unknown as Element;
    const root = {
      style: { display: "" },
      contains(node: Node) {
        return node === target;
      },
    } as unknown as HTMLDivElement;
    const scrollContainer = {
      addEventListener() {},
      removeEventListener() {},
      scrollBy() {
        assert.fail("Expected wheel to be forwarded before scroll fallback");
      },
    } as unknown as Element;
    const doc = {
      querySelector(selector: string) {
        return selector === "#viewerContainer" ? scrollContainer : null;
      },
      elementFromPoint(clientX: number, clientY: number) {
        assert.equal(clientX, 10);
        assert.equal(clientY, 20);
        assert.equal(root.style.display, "none");
        return underlying;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = {
      addEventListener(type: string, listener: EventListener) {
        if (type === "wheel") {
          wheelListener = listener as (event: WheelEvent) => void;
        }
      },
      removeEventListener() {},
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout() {
        return 1;
      },
      clearTimeout() {},
      setInterval() {
        return 1;
      },
      clearInterval() {},
    } as unknown as Window;

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    let prevented = false;
    let stopped = false;
    wheelListener?.({
      target,
      clientX: 10,
      clientY: 20,
      screenX: 30,
      screenY: 40,
      deltaX: 4,
      deltaY: 120,
      deltaZ: 0,
      deltaMode: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      stopImmediatePropagation() {},
    } as unknown as WheelEvent);

    assert.isTrue(prevented);
    assert.isTrue(stopped);
    assert.equal(root.style.display, "");
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].deltaY, 120);
  });

  it("returns every reader pane window for split views", function () {
    const primary = createView("primary");
    const secondary = createView("secondary");
    const reader = createReader({
      instanceID: "reader-1",
      attachmentKey: "ABC123",
      views: [primary, secondary],
    });

    assert.deepEqual(getReaderOverlayWindows(reader), [
      primary._iframeWindow,
      secondary._iframeWindow,
    ]);
  });

  it("tracks selection count per reader state", async function () {
    const reader = createReader({
      instanceID: "reader-1",
      attachmentKey: "ABC123",
      views: [createView("primary")],
    });

    const state = setReaderOverlayModeForReader(reader, "all");
    if (!state) {
      assert.fail("Expected overlay state");
    }
    state.selectedRawIndexes.add(1);
    state.selectedRawIndexes.add(2);

    assert.equal(getReaderSelectedBoxCount(reader), 2);
  });
});

function createReader(input: {
  instanceID: string;
  attachmentKey: string;
  views: Array<{ _iframeWindow: Window }>;
}): _ZoteroTypes.ReaderInstance {
  const [primary, ...rest] = input.views;
  const last = rest.at(-1) ?? primary;
  const attachment = {
    key: input.attachmentKey,
    libraryID: 1,
  };

  return {
    _instanceID: input.instanceID,
    _item: attachment,
    _primaryView: primary,
    _lastView: last,
    _iframeWindow: last._iframeWindow,
  } as unknown as _ZoteroTypes.ReaderInstance;
}

function createView(name: string): { _iframeWindow: Window } {
  return {
    _iframeWindow: {
      name,
      document: createDocumentStub(),
      requestAnimationFrame(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout(handler: TimerHandler) {
        if (typeof handler === "function") {
          handler();
        }
        return 1;
      },
      clearTimeout() {},
      setInterval() {
        return 1;
      },
      clearInterval() {},
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Window,
  };
}

function createBox(
  rawIndex: number,
  type: string,
  markdown: string,
  formula: string | null = null,
): import("../src/modules/domain").NormalizedBox {
  return {
    rawIndex,
    page: 1,
    type,
    bbox: { x: 0.1, y: 0.2 + rawIndex * 0.05, width: 0.3, height: 0.05 },
    markdown,
    formula,
  };
}

function createDocumentStub(): Document & {
  headChildren: FakeElement[];
  bodyChildren: FakeElement[];
} {
  const rootChildren: FakeElement[] = [];
  const bodyChildren: FakeElement[] = [];

  const doc = {
    head: {
      append(child: FakeElement) {
        rootChildren.push(child);
      },
    },
    body: {
      append(child: FakeElement) {
        bodyChildren.push(child);
      },
      clientWidth: 1000,
      clientHeight: 2000,
    },
    documentElement: {
      clientWidth: 1000,
      clientHeight: 2000,
    },
    createElement(_tagName: string) {
      return createFakeElement();
    },
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
  };

  return Object.assign(doc, {
    headChildren: rootChildren,
    bodyChildren,
  }) as unknown as Document & {
    headChildren: FakeElement[];
    bodyChildren: FakeElement[];
  };
}

interface FakeElement {
  className: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  textContent: string;
  hidden: boolean;
  children: FakeElement[];
  append: (...children: FakeElement[]) => void;
  addEventListener: (_type: string, _listener: EventListener) => void;
  querySelectorAll: (_selector: string) => FakeElement[];
  remove: () => void;
}

function createFakeElement(): FakeElement {
  return {
    className: "",
    dataset: {},
    style: {},
    textContent: "",
    hidden: false,
    children: [],
    append(...children: FakeElement[]) {
      this.children.push(...children);
    },
    addEventListener() {},
    querySelectorAll(selector: string) {
      if (selector !== ".mineru-copy-page-layer") {
        return [];
      }
      return this.children.filter((child) =>
        child.className.includes("mineru-copy-page-layer"),
      );
    },
    remove() {},
  };
}

function findElementsByClass(
  root: FakeElement,
  className: string,
): FakeElement[] {
  const matches: FakeElement[] = [];
  const visit = (element: FakeElement) => {
    if (element.className.split(/\s+/).includes(className)) {
      matches.push(element);
    }
    for (const child of element.children) {
      visit(child);
    }
  };
  visit(root);
  return matches;
}
