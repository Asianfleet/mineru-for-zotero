import { assert } from "chai";
import {
  applyReaderOverlayMode,
  buildReaderOverlayRoot,
  clearReaderOverlaySelectionForReader,
  createReaderOverlayPositioningController,
  ensureReaderOverlayStyles,
  getReaderOverlayNoticeText,
  getReaderOverlayWindows,
  getReaderSelectedBoxCount,
  findPageElement,
  positionPageLayers,
  removeReaderOverlayRoot,
  setReaderOverlayModeForReader,
  setReaderOverlayRootForReader,
} from "../src/modules/readerOverlay";
import * as readerOverlay from "../src/modules/readerOverlay";
import { getMinerUStorageRoot } from "../src/modules/preferenceScript";
import { createStorage } from "../src/modules/storage";
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
        createBox(6, "table_body", "<table></table>"),
        createBox(7, "reference", "[1] Paper"),
      ],
      "hover",
    );

    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-box-label").map(
        (element) => element.textContent,
      ),
      [
        "Text",
        "Title",
        "Image caption",
        "Header",
        "Page number",
        "Formula",
        "Table",
        "Reference",
      ],
    );
    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-button").map(
        (element) => element.textContent,
      ),
      [
        "Copy",
        "Copy",
        "Copy",
        "Copy",
        "Copy",
        "Copy with $",
        "Copy without $",
        "Copy",
        "Copy",
      ],
    );
  });

  it("uses Fluent messages for hover labels and copy buttons", function () {
    const globals = globalThis as typeof globalThis & { addon?: unknown };
    const originalAddon = globals.addon;
    globals.addon = {
      data: {
        locale: {
          current: {
            formatMessagesSync(messages: Array<{ id: string }>) {
              const values: Record<string, string> = {
                "mineruForZotero-reader-box-type-text": "Text",
                "mineruForZotero-reader-box-type-title": "Title",
                "mineruForZotero-reader-box-type-image-caption":
                  "Image caption",
                "mineruForZotero-reader-box-type-formula": "Formula",
                "mineruForZotero-reader-copy-box": "Copy",
                "mineruForZotero-reader-copy-formula-with-dollar":
                  "Copy with $",
                "mineruForZotero-reader-copy-formula-without-dollar":
                  "Copy without $",
              };
              return messages.map(({ id }) => ({
                value: values[id] ?? null,
                attributes: null,
              }));
            },
          },
        },
      },
    };

    try {
      const doc = createDocumentStub();

      const root = buildReaderOverlayRoot(
        doc as unknown as Document,
        [
          createBox(0, "text", "First paragraph"),
          createBox(1, "title", "Title"),
          createBox(2, "image_caption", "Image caption"),
          createBox(3, "interline_equation", "E=mc^2", "E=mc^2"),
        ],
        "hover",
      );

      assert.deepEqual(
        findElementsByClass(root, "mineru-copy-box-label").map(
          (element) => element.textContent,
        ),
        ["Text", "Title", "Image caption", "Formula"],
      );
      assert.deepEqual(
        findElementsByClass(root, "mineru-copy-button").map(
          (element) => element.textContent,
        ),
        ["Copy", "Copy", "Copy", "Copy with $", "Copy without $"],
      );
    } finally {
      globals.addon = originalAddon;
    }
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
      ["Text", "Title", "Image caption", "Header", "Page number", "Formula"],
    );
    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-button").map(
        (element) => element.textContent,
      ),
      ["Copy", "Copy", "Copy", "Copy", "Copy", "Copy with $", "Copy without $"],
    );
  });

  it("does not render list container boxes that cover reference boxes", function () {
    const doc = createDocumentStub();

    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [
        {
          ...createBox(0, "list", ""),
          bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.24 },
        },
        {
          ...createBox(1, "ref_text", "[1] First paper."),
          bbox: { x: 0.12, y: 0.22, width: 0.76, height: 0.04 },
        },
        {
          ...createBox(2, "ref_text", "[2] Second paper."),
          bbox: { x: 0.12, y: 0.28, width: 0.76, height: 0.04 },
        },
      ],
      "hover",
    );

    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-box").map(
        (element) => element.dataset.rawIndex,
      ),
      ["1", "2"],
    );
    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-box-label").map(
        (element) => element.textContent,
      ),
      ["Reference", "Reference"],
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
    assert.match(
      style.textContent,
      /\.mineru-copy-box-label\s*\{[^}]*white-space:\s*nowrap/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-label\s*\{[^}]*writing-mode:\s*horizontal-tb/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-label\s*\{[^}]*font-size:\s*12px/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-button\s*\{[^}]*border:\s*0[^}]*background:\s*var\(--material-toolbar,\s*ButtonFace\)[^}]*box-shadow:/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-button\s*\{[^}]*color:\s*inherit[^}]*font-size:\s*13px[^}]*padding:\s*4px 8px/s,
    );
  });

  it("bridges the Zotero toolbar material variable from the parent reader window", function () {
    const doc = createDocumentStub();
    const parentDoc = createDocumentStub();
    const parentWindow = {
      document: parentDoc,
      parent: null,
      getComputedStyle() {
        return {
          getPropertyValue(name: string) {
            return name === "--material-toolbar" ? "rgb(252, 252, 252)" : "";
          },
        };
      },
    };
    parentWindow.parent = parentWindow;
    const childWindow = {
      document: doc,
      parent: parentWindow,
      getComputedStyle() {
        return {
          getPropertyValue() {
            return "";
          },
        };
      },
    };
    Object.assign(doc, { defaultView: childWindow });
    Object.assign(parentDoc, { defaultView: parentWindow });

    ensureReaderOverlayStyles(doc as unknown as Document);

    const style = doc.headChildren[0];
    assert.include(
      style.textContent,
      ":root {\n  --material-toolbar: rgb(252, 252, 252);\n}",
    );
  });

  it("provides a local fallback for the missing-result prompt", function () {
    assert.equal(
      getReaderOverlayNoticeText("reader-overlay-missing-result"),
      "This PDF does not have a MinerU parse result yet. Parse it before enabling boxes.",
    );
  });

  it("turns overlay mode off when boxes cannot be read", async function () {
    await createStorage(getMinerUStorageRoot()).writeFailedResult({
      attachment: {
        id: 1,
        key: "MISSINGBOX",
        libraryID: 1,
        fileName: "a.pdf",
        filePath: "a.pdf",
        mtime: 1,
      },
      mineruTaskID: "task-empty",
      rawResult: { content_list: [] },
      markdown: "",
      error: "empty boxes",
    });
    const reader = createReader({
      instanceID: "reader-missing-boxes",
      attachmentKey: "MISSINGBOX",
      views: [createView("primary")],
    });

    const state = await applyReaderOverlayMode(reader, "all");

    assert.equal(state?.mode, "off");
    assert.isNull(state?.root);
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

  it("hides only page layers whose PDF page cannot be mapped", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [
        createBox(0, "text", "missing page"),
        { ...createBox(1, "text", "mapped page"), page: 2 },
      ],
      "all",
    );
    const mappedPage = {
      getBoundingClientRect() {
        return { left: 10, top: 20, width: 300, height: 400 };
      },
    };
    doc.querySelector = (selector: string) =>
      selector === '.page[data-page-number="2"]'
        ? (mappedPage as unknown as Element)
        : null;

    positionPageLayers(doc as unknown as Document, root);

    const layers = findElementsByClass(
      root as unknown as FakeElement,
      "mineru-copy-page-layer",
    );
    assert.lengthOf(layers, 2);
    assert.isTrue(layers[0].hidden);
    assert.isFalse(layers[1].hidden);
    assert.include(layers[1].style, {
      left: "10px",
      top: "20px",
      width: "300px",
      height: "400px",
    });
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
    assert.deepEqual(scrollCalls, [{ left: 4, top: 120, behavior: "auto" }]);
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

  it("uses the reader window WheelEvent constructor when the plugin global lacks one", function () {
    const originalWheelEvent = globalThis.WheelEvent;
    Object.defineProperty(globalThis, "WheelEvent", {
      configurable: true,
      value: undefined,
    });

    try {
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
        defaultView: {
          WheelEvent: class FakeWheelEvent {
            deltaY: number;

            constructor(_type: string, init: WheelEventInit) {
              this.deltaY = init.deltaY ?? 0;
            }
          },
        },
        querySelector(selector: string) {
          return selector === "#viewerContainer" ? scrollContainer : null;
        },
        elementFromPoint() {
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

      assert.doesNotThrow(() => {
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
          preventDefault() {},
          stopPropagation() {},
          stopImmediatePropagation() {},
        } as unknown as WheelEvent);
      });

      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0].deltaY, 120);
    } finally {
      Object.defineProperty(globalThis, "WheelEvent", {
        configurable: true,
        value: originalWheelEvent,
      });
    }
  });

  it("does not throw when a split pane window dies before cleanup", function () {
    let intervalCleared = false;
    let animationCancelled = false;
    const root = {
      contains() {
        return false;
      },
    } as unknown as HTMLDivElement;
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = {
      addEventListener() {},
      removeEventListener() {
        throw new TypeError("can't access dead object");
      },
      requestAnimationFrame() {
        return 7;
      },
      cancelAnimationFrame() {
        animationCancelled = true;
      },
      setTimeout() {
        return 1;
      },
      clearTimeout() {},
      setInterval() {
        return 11;
      },
      clearInterval() {
        intervalCleared = true;
      },
    } as unknown as Window;

    const controller = createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    assert.doesNotThrow(() => controller.cleanup());
    assert.isTrue(intervalCleared);
    assert.isTrue(animationCancelled);
  });

  it("does not throw when a split pane root dies before removal", function () {
    const root = {
      remove() {
        throw new TypeError("can't access dead object");
      },
    } as unknown as HTMLElement;

    assert.doesNotThrow(() => removeReaderOverlayRoot(root));
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

  it("clears selected box classes across rendered split roots", function () {
    const reader = createReader({
      instanceID: "reader-clear-selection",
      attachmentKey: "ABC123",
      views: [createView("primary"), createView("secondary")],
    });
    const state = setReaderOverlayModeForReader(reader, "all");
    if (!state) {
      assert.fail("Expected overlay state");
    }
    state.selectedRawIndexes.add(0);
    state.selectedRawIndexes.add(1);

    const primaryRoot = buildReaderOverlayRoot(
      createDocumentStub() as unknown as Document,
      normalizedBoxes,
      "all",
      { selectedRawIndexes: state.selectedRawIndexes },
    );
    const secondaryRoot = buildReaderOverlayRoot(
      createDocumentStub() as unknown as Document,
      normalizedBoxes,
      "all",
      { selectedRawIndexes: state.selectedRawIndexes },
    );
    state.rootsByWindow.set(
      {} as Window,
      primaryRoot as unknown as HTMLElement,
    );
    state.rootsByWindow.set(
      {} as Window,
      secondaryRoot as unknown as HTMLElement,
    );
    const primaryBoxes = findElementsByClass(primaryRoot, "mineru-copy-box");
    const secondaryBoxes = findElementsByClass(
      secondaryRoot,
      "mineru-copy-box",
    );
    assert.lengthOf(primaryBoxes, 3, "primary root should render three boxes");
    assert.lengthOf(
      secondaryBoxes,
      3,
      "secondary root should render three boxes",
    );
    assert.include(
      primaryBoxes[0].className,
      "mineru-copy-box-selected",
      "primary first box starts selected",
    );
    assert.include(
      secondaryBoxes[1].className,
      "mineru-copy-box-selected",
      "secondary second box starts selected",
    );

    try {
      clearReaderOverlaySelectionForReader(reader);
    } catch (error) {
      assert.fail(
        JSON.stringify({
          type: Object.prototype.toString.call(error),
          value: String(error),
          message: error instanceof Error ? error.message : null,
        }),
      );
    }
    for (const root of [primaryRoot, secondaryRoot]) {
      for (const box of findElementsByClass(root, "mineru-copy-box")) {
        assert.notInclude(
          box.className,
          "mineru-copy-box-selected",
          "clearing selection removes selected class",
        );
      }
    }
  });

  it("marks selected boxes and toggles only on modified clicks", function () {
    const doc = createDocumentStub();
    const state = {
      selectedRawIndexes: new Set<number>([1]),
    };

    const root = (
      buildReaderOverlayRoot as (
        doc: Document,
        boxes: typeof normalizedBoxes,
        mode: "all",
        options: { selectedRawIndexes: Set<number> },
      ) => FakeElement
    )(doc as unknown as Document, normalizedBoxes, "all", state);

    const boxes = findElementsByClass(root, "mineru-copy-box");
    assert.lengthOf(boxes, 3);
    assert.notInclude(boxes[0].className, "mineru-copy-box-selected");
    assert.include(boxes[1].className, "mineru-copy-box-selected");

    boxes[0].dispatch("click", createClickEvent());
    assert.deepEqual([...state.selectedRawIndexes], [1]);

    boxes[0].dispatch("click", createClickEvent({ shiftKey: true }));
    assert.deepEqual([...state.selectedRawIndexes].sort(), [0, 1]);
    assert.include(boxes[0].className, "mineru-copy-box-selected");

    boxes[1].dispatch("click", createClickEvent({ ctrlKey: true }));
    assert.deepEqual([...state.selectedRawIndexes], [0]);
    assert.notInclude(boxes[1].className, "mineru-copy-box-selected");
  });

  it("selects the rawIndex range from the last clicked box on shift click", function () {
    const doc = createDocumentStub();
    const selectionAnchor = { rawIndex: null as number | null };
    const rootRef: { current: FakeElement | null } = { current: null };
    const state = {
      selectedRawIndexes: new Set<number>(),
      getSelectionAnchorRawIndex: () => selectionAnchor.rawIndex,
      setSelectionAnchorRawIndex: (rawIndex: number | null) => {
        selectionAnchor.rawIndex = rawIndex;
      },
      onSelectionChange: () => {
        const currentRoot = rootRef.current;
        if (!currentRoot) {
          return;
        }
        for (const box of findElementsByClass(currentRoot, "mineru-copy-box")) {
          const selected = state.selectedRawIndexes.has(
            Number(box.dataset.rawIndex),
          );
          const classes = new Set(box.className.split(/\s+/).filter(Boolean));
          if (selected) {
            classes.add("mineru-copy-box-selected");
          } else {
            classes.delete("mineru-copy-box-selected");
          }
          box.className = [...classes].join(" ");
        }
      },
    };

    const root = (
      buildReaderOverlayRoot as (
        doc: Document,
        boxes: typeof normalizedBoxes,
        mode: "all",
        options: {
          selectedRawIndexes: Set<number>;
          getSelectionAnchorRawIndex: () => number | null;
          setSelectionAnchorRawIndex: (rawIndex: number | null) => void;
          onSelectionChange: () => void;
        },
      ) => FakeElement
    )(doc as unknown as Document, normalizedBoxes, "all", state);
    rootRef.current = root;

    const boxes = findElementsByClass(root, "mineru-copy-box");
    boxes[0].dispatch("click", createClickEvent({ ctrlKey: true }));
    boxes[2].dispatch("click", createClickEvent({ shiftKey: true }));

    assert.deepEqual([...state.selectedRawIndexes].sort(), [0, 1, 2]);
    assert.include(boxes[0].className, "mineru-copy-box-selected");
    assert.include(boxes[1].className, "mineru-copy-box-selected");
    assert.include(boxes[2].className, "mineru-copy-box-selected");
  });

  it("formats selected boxes by rawIndex before copying", function () {
    assert.equal(
      (
        readerOverlay as unknown as {
          formatSelectedBoxesForCopy: (
            boxes: typeof normalizedBoxes,
            selectedRawIndexes: Set<number>,
          ) => string;
        }
      ).formatSelectedBoxesForCopy(
        [normalizedBoxes[2], normalizedBoxes[1], normalizedBoxes[0]],
        new Set([2, 0]),
      ),
      "第一段\n\n公式：E=mc^2",
    );
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
  dispatch: (_type: string, _event: Event) => void;
  querySelectorAll: (_selector: string) => FakeElement[];
  remove: () => void;
}

function createFakeElement(): FakeElement {
  const listeners = new Map<string, EventListener[]>();
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
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatch(type: string, event: Event) {
      for (const listener of listeners.get(type) ?? []) {
        listener.call(this, event);
      }
    },
    querySelectorAll(selector: string) {
      if (!selector.startsWith(".")) {
        return [];
      }
      return findElementsByClass(this, selector.slice(1));
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

function createClickEvent(
  input: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
  } = {},
): MouseEvent {
  return {
    shiftKey: input.shiftKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as MouseEvent;
}
