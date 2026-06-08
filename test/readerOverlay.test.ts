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

  it("renders hover labels and copy controls", function () {
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
    assert.lengthOf(findElementsByClass(root, "mineru-copy-box-toolbar"), 8);
    assert.lengthOf(findElementsByDataAction(root, "copy"), 8);
    assert.lengthOf(findElementsByDataAction(root, "select-copy"), 8);
    assert.lengthOf(
      findElementsByClass(root, "mineru-copy-toolbar-divider"),
      8,
    );
    assert.lengthOf(findElementsByClass(root, "mineru-copy-formula-menu"), 1);
    assert.lengthOf(findElementsByClass(root, "mineru-copy-select-panel"), 8);
  });

  it("uses Fluent messages for hover labels and copy controls", function () {
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
                "mineruForZotero-reader-select-copy-box":
                  "Select copy localized",
                "mineruForZotero-reader-copy-formula-menu":
                  "Formula copy options localized",
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
      assert.lengthOf(findElementsByClass(root, "mineru-copy-box-toolbar"), 4);
      assert.lengthOf(findElementsByDataAction(root, "copy"), 4);
      assert.lengthOf(findElementsByDataAction(root, "select-copy"), 4);
      assert.deepEqual(
        findElementsByDataAction(root, "select-copy").map(
          (element) => element.title,
        ),
        [
          "Select copy localized",
          "Select copy localized",
          "Select copy localized",
          "Select copy localized",
        ],
      );
      assert.lengthOf(
        findElementsByClass(root, "mineru-copy-toolbar-divider"),
        4,
      );
      assert.lengthOf(findElementsByClass(root, "mineru-copy-formula-menu"), 1);
      assert.deepEqual(
        findElementsByClass(root, "mineru-copy-formula-menu").map(
          (element) => element.title,
        ),
        ["Formula copy options localized"],
      );
      assert.lengthOf(findElementsByClass(root, "mineru-copy-select-panel"), 4);
    } finally {
      globals.addon = originalAddon;
    }
  });

  it("renders labels and copy controls in all mode", function () {
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
    assert.lengthOf(findElementsByClass(root, "mineru-copy-box-toolbar"), 6);
    assert.lengthOf(findElementsByDataAction(root, "copy"), 6);
    assert.lengthOf(findElementsByDataAction(root, "select-copy"), 6);
    assert.lengthOf(
      findElementsByClass(root, "mineru-copy-toolbar-divider"),
      6,
    );
    assert.lengthOf(findElementsByClass(root, "mineru-copy-formula-menu"), 1);
    assert.lengthOf(findElementsByClass(root, "mineru-copy-select-panel"), 6);
  });

  it("renders selectable copy panels from raw markdown and keeps formula dollars", function () {
    const doc = createDocumentStub();

    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [
        createBox(0, "text", "**Raw** markdown"),
        createBox(1, "interline_equation", "E=mc^2", "E=mc^2"),
        createBox(2, "inline_equation", "$a+b$", "a+b"),
        createBox(3, "interline_equation", "$$x+y$$", "x+y"),
      ],
      "hover",
    );

    const panels = findElementsByClass(root, "mineru-copy-select-panel");
    const textareas = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    );
    assert.lengthOf(textareas, 4);
    assert.deepEqual(
      textareas.map((element) => element.value),
      ["**Raw** markdown", "$E=mc^2$", "$a+b$", "$$x+y$$"],
    );
    assert.isTrue(textareas.every((element) => element.readOnly));
    assert.isTrue(
      textareas.every((element) => element.dataset.ariaLabel === "Select copy"),
    );
    assert.isTrue(
      panels.every(
        (element) =>
          findElementsByClass(element, "mineru-copy-select-panel-textarea")
            .length === 1,
      ),
      "each floating panel wraps one textarea",
    );
  });

  it("keeps textarea keyboard behavior inside selectable copy panels", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Selectable text")],
      "hover",
    );
    const panel = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    )[0];
    let prevented = false;
    let stopped = false;

    panel.dispatch("keydown", {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    } as unknown as Event);

    assert.isFalse(prevented);
    assert.isTrue(stopped);
  });

  it("keeps textarea pointer defaults for text selection and resize", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Selectable text")],
      "hover",
    );
    const textarea = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    )[0];
    let prevented = false;
    let stopped = false;

    textarea.dispatch("mousedown", {
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    } as unknown as Event);

    assert.isFalse(prevented);
    assert.isTrue(stopped);
  });

  it("focuses selectable copy textarea on pointer down without preventing native selection", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Selectable text")],
      "hover",
    );
    const textarea = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    )[0];
    let focused = false;
    let prevented = false;
    (textarea as unknown as { focus: () => void }).focus = () => {
      focused = true;
    };

    textarea.dispatch("pointerdown", {
      type: "pointerdown",
      target: textarea,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      stopImmediatePropagation() {},
    } as unknown as Event);

    assert.isTrue(focused);
    assert.isFalse(prevented);
  });

  it("copies selected textarea text on Ctrl+C without entering reader copy handling", function () {
    const globals = globalThis as typeof globalThis & { ztoolkit?: unknown };
    const originalZtoolkit = globals.ztoolkit;
    let copiedText = "";
    globals.ztoolkit = {
      Clipboard: class {
        addText(text: string, type: string) {
          if (type === "text/unicode") {
            copiedText = text;
          }
          return this;
        }
        copy() {}
      },
    };

    try {
      const doc = createDocumentStub();
      const root = buildReaderOverlayRoot(
        doc as unknown as Document,
        [createBox(0, "text", "Selectable text")],
        "hover",
      );
      const textarea = findElementsByClass(
        root,
        "mineru-copy-select-panel-textarea",
      )[0];
      let prevented = false;
      let stopped = false;
      let stoppedImmediate = false;
      Object.assign(textarea, {
        selectionStart: 0,
        selectionEnd: 10,
      });

      textarea.dispatch("keydown", {
        type: "keydown",
        target: textarea,
        key: "c",
        ctrlKey: true,
        metaKey: false,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stoppedImmediate = true;
        },
      } as unknown as Event);

      assert.equal(copiedText, "Selectable");
      assert.isTrue(prevented);
      assert.isTrue(stopped);
      assert.isTrue(stoppedImmediate);
    } finally {
      globals.ztoolkit = originalZtoolkit;
    }
  });

  it("isolates selectable copy textarea pointer and context menu events", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Selectable text")],
      "hover",
    );
    const textarea = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    )[0];

    for (const type of ["pointerdown", "contextmenu"]) {
      let prevented = false;
      let stopped = false;
      let stoppedImmediate = false;

      textarea.dispatch(type, {
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stoppedImmediate = true;
        },
      } as unknown as Event);

      assert.isFalse(prevented, `${type} should keep native textarea defaults`);
      assert.isTrue(stopped, `${type} should not bubble into Zotero reader`);
      assert.isTrue(
        stoppedImmediate,
        `${type} should not reach sibling reader handlers`,
      );
    }
  });

  it("sizes selectable copy textarea rows from content length", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [
        createBox(0, "text", "Short text"),
        createBox(
          1,
          "text",
          [
            "First paragraph with enough text to wrap across multiple rows in the selectable copy panel.",
            "Second paragraph with more selectable Markdown content.",
            "Third paragraph.",
          ].join("\n"),
        ),
      ],
      "hover",
    );
    const textareas = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    );

    assert.isAbove(textareas[1].rows, textareas[0].rows);
  });

  it("opens one selectable panel and closes it on Escape or outside click", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "First"), createBox(1, "text", "Second")],
      "hover",
    );
    doc.body.append(root);

    const selectButtons = findElementsByDataAction(root, "select-copy");
    const actions = findElementsByClass(root, "mineru-copy-box-actions");
    const boxes = findElementsByClass(root, "mineru-copy-box");

    selectButtons[0].dispatch("click", createClickEvent());
    assert.include(
      actions[0].className,
      "mineru-copy-select-panel-open",
      "first click opens first panel",
    );
    assert.include(
      boxes[0].className,
      "mineru-copy-box-actions-active",
      "open panel keeps its box above later boxes",
    );

    selectButtons[1].dispatch("click", createClickEvent());
    assert.notInclude(
      actions[0].className,
      "mineru-copy-select-panel-open",
      "opening second panel closes first panel",
    );
    assert.notInclude(
      boxes[0].className,
      "mineru-copy-box-actions-active",
      "closing first panel clears its elevated box state",
    );
    assert.include(
      actions[1].className,
      "mineru-copy-select-panel-open",
      "second click opens second panel",
    );
    assert.include(
      boxes[1].className,
      "mineru-copy-box-actions-active",
      "second open panel elevates the second box",
    );

    doc.dispatch("keydown", createKeyEvent("Escape"));
    assert.notInclude(
      actions[1].className,
      "mineru-copy-select-panel-open",
      "Escape closes open panel",
    );
    assert.notInclude(
      boxes[1].className,
      "mineru-copy-box-actions-active",
      "Escape clears elevated box state",
    );

    selectButtons[0].dispatch("click", createClickEvent());
    doc.dispatch("mousedown", createMouseEvent({ target: doc.body }));
    assert.notInclude(
      actions[0].className,
      "mineru-copy-select-panel-open",
      "outside mousedown closes open panel",
    );
    assert.notInclude(
      boxes[0].className,
      "mineru-copy-box-actions-active",
      "outside mousedown clears elevated box state",
    );
  });

  it("locks selectable panel interactions to the owning box", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "First"), createBox(1, "text", "Second")],
      "hover",
    );
    doc.body.append(root);

    const selectButtons = findElementsByDataAction(root, "select-copy");
    const actions = findElementsByClass(root, "mineru-copy-box-actions");
    const boxes = findElementsByClass(root, "mineru-copy-box");

    boxes[1].classList.add("mineru-copy-box-actions-active");
    selectButtons[0].dispatch("click", createClickEvent());
    assert.include(root.className, "mineru-copy-select-panel-active");
    assert.notInclude(
      boxes[1].className,
      "mineru-copy-box-actions-active",
      "opening a select panel clears stale active state from other boxes",
    );

    actions[1].dispatch("mouseenter", createMouseEvent({ target: actions[1] }));
    assert.notInclude(
      boxes[1].className,
      "mineru-copy-box-actions-active",
      "other box actions must not become active while a select panel is open",
    );

    doc.dispatch("mousedown", createMouseEvent({ target: doc.body }));
    assert.notInclude(root.className, "mineru-copy-select-panel-active");
  });

  it("uses overlay state to suppress native hover controls while selecting panel text", function () {
    const doc = createDocumentStub();

    ensureReaderOverlayStyles(doc as unknown as Document);

    const style = doc.headChildren[0];
    assert.include(style.textContent, "mineru-copy-select-panel-active");
    assert.include(style.textContent, "mineru-copy-formula-menu-active");
    assert.match(
      style.textContent,
      /\.mineru-copy-overlay-root:not\(\.mineru-copy-select-panel-active\):not\(\.mineru-copy-formula-menu-active\) \.mineru-copy-box:hover/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-select-panel-active \.mineru-copy-box:not\(\.mineru-copy-box-actions-active\) \.mineru-copy-box-actions\s*\{[^}]*display:\s*none[^}]*pointer-events:\s*none/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-actions-active \.mineru-copy-box-actions\s*\{[^}]*z-index:\s*2147483003/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-page-layer-actions-active\s*\{[^}]*z-index:\s*2147483002/s,
    );
  });

  it("keeps selectable panels and actions inside viewport edges", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Left edge"), createBox(1, "text", "Right edge")],
      "hover",
    );
    doc.body.append(root);

    const selectButtons = findElementsByDataAction(root, "select-copy");
    const actions = findElementsByClass(root, "mineru-copy-box-actions");
    actions[0].getBoundingClientRect = () =>
      createRect({ top: 40, bottom: 2200, left: -12, right: 88 });
    actions[1].getBoundingClientRect = () =>
      createRect({ top: 120, bottom: 160, left: 950, right: 1012 });

    selectButtons[0].dispatch("click", createClickEvent());
    assert.include(actions[0].className, "mineru-copy-toolbar-above");
    assert.notInclude(actions[0].className, "mineru-copy-toolbar-below");
    assert.include(actions[0].className, "mineru-copy-select-panel-below");
    assert.include(actions[0].className, "mineru-copy-toolbar-shift-right");
    assert.include(actions[0].className, "mineru-copy-select-panel-right");

    selectButtons[1].dispatch("click", createClickEvent());
    assert.include(actions[1].className, "mineru-copy-toolbar-below");
    assert.notInclude(actions[1].className, "mineru-copy-toolbar-above");
    assert.notInclude(actions[1].className, "mineru-copy-select-panel-below");
    assert.include(actions[1].className, "mineru-copy-toolbar-shift-left");
    assert.include(actions[1].className, "mineru-copy-select-panel-left");
  });

  it("refreshes horizontal placement from a neutral rect", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Movable edge")],
      "hover",
    );
    doc.body.append(root);

    const selectButton = findElementsByDataAction(root, "select-copy")[0];
    const actions = findElementsByClass(root, "mineru-copy-box-actions")[0];
    let middlePosition = false;
    actions.getBoundingClientRect = () => {
      if (
        middlePosition &&
        !actions.className.includes("mineru-copy-toolbar-shift-right") &&
        !actions.className.includes("mineru-copy-toolbar-shift-left")
      ) {
        return createRect({ top: 120, bottom: 160, left: 400, right: 470 });
      }
      return createRect({ top: 120, bottom: 160, left: -12, right: 58 });
    };

    selectButton.dispatch("click", createClickEvent());
    assert.include(actions.className, "mineru-copy-toolbar-shift-right");

    middlePosition = true;
    actions.dispatch("mouseenter", createMouseEvent({ target: actions }));

    assert.notInclude(actions.className, "mineru-copy-toolbar-shift-right");
    assert.notInclude(actions.className, "mineru-copy-toolbar-shift-left");
    assert.notInclude(actions.className, "mineru-copy-select-panel-right");
    assert.notInclude(actions.className, "mineru-copy-select-panel-left");
  });

  it("keeps selectable panel open for internal document mousedown targets", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "text", "Internal target")],
      "hover",
    );
    doc.body.append(root);

    const selectButton = findElementsByDataAction(root, "select-copy")[0];
    const actions = findElementsByClass(root, "mineru-copy-box-actions")[0];
    const toolbar = findElementsByClass(root, "mineru-copy-box-toolbar")[0];
    const panel = findElementsByClass(root, "mineru-copy-select-panel")[0];
    const textarea = findElementsByClass(
      root,
      "mineru-copy-select-panel-textarea",
    )[0];

    selectButton.dispatch("click", createClickEvent());
    doc.dispatch("mousedown", createMouseEvent({ target: textarea }));
    assert.include(actions.className, "mineru-copy-select-panel-open");

    doc.dispatch("mousedown", createMouseEvent({ target: toolbar }));
    assert.include(actions.className, "mineru-copy-select-panel-open");

    doc.dispatch("mousedown", createMouseEvent({ target: doc.body }));
    assert.notInclude(actions.className, "mineru-copy-select-panel-open");
  });

  it("keeps toolbar buttons icon-only while formula menu items stay readable", function () {
    const doc = createDocumentStub();
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      [createBox(0, "formula", "E=mc^2", "E=mc^2")],
      "hover",
    );

    for (const button of findElementsByDataAction(root, "copy")) {
      assert.equal(button.textContent, "");
      assert.isNotEmpty(button.title);
      assert.isNotEmpty(button.dataset.ariaLabel);
    }
    for (const button of findElementsByDataAction(root, "select-copy")) {
      assert.equal(button.textContent, "");
      assert.isNotEmpty(button.title);
      assert.isNotEmpty(button.dataset.ariaLabel);
    }

    assert.deepEqual(
      findElementsByClass(root, "mineru-copy-formula-menu-item").map(
        (element) => element.textContent,
      ),
      ["Copy with $", "Copy without $"],
    );
    assert.isTrue(
      findElementsByClass(root, "mineru-copy-formula-menu-item").every(
        (element) => !element.className.includes("mineru-copy-toolbar-button"),
      ),
      "formula menu items should not inherit toolbar icon button styles",
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
    assert.match(
      style.textContent,
      /\.mineru-copy-box-label\s*\{[^}]*display:\s*none/s,
    );
    assert.include(
      style.textContent,
      ".mineru-copy-overlay-modifier-active .mineru-copy-page-layer",
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
      /\.mineru-copy-box:hover,\n\.mineru-copy-box-hovered\s*\{[^}]*z-index:\s*2147483001/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-actions-active\s*\{[^}]*z-index:\s*2147483002/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-actions\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-actions\s*\{[^}]*display:\s*none[^}]*pointer-events:\s*none/s,
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
      /\.mineru-copy-box-selected\s+\.mineru-copy-box-label\s*\{[^}]*background:\s*rgba\(217,\s*119,\s*6,\s*0\.95\)/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-box-toolbar\s*\{[^}]*background:\s*var\(--material-toolbar,\s*ButtonFace\)/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-toolbar-divider\s*\{[^}]*border-left:\s*1px solid/s,
    );
    assert.notInclude(
      style.textContent,
      "chrome://mineruForZotero/content/box-toolbar-copy.svg",
    );
    assert.notInclude(
      style.textContent,
      "chrome://mineruForZotero/content/box-toolbar-select-copy.svg",
    );
    assert.include(style.textContent, "data:image/svg+xml");
    assert.match(
      style.textContent,
      /\.mineru-copy-select-panel-textarea\s*\{[^}]*resize:\s*both[^}]*user-select:\s*text/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-select-panel-textarea::selection\s*\{[^}]*background:\s*rgba\(37,\s*99,\s*235,\s*0\.35\)/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-select-panel-textarea::-moz-selection\s*\{[^}]*background:\s*rgba\(37,\s*99,\s*235,\s*0\.35\)/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-formula-copy-group:hover\s+\.mineru-copy-formula-menu,\s*\.mineru-copy-formula-menu-open\s+\.mineru-copy-formula-menu\s*\{[^}]*display:\s*flex/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-formula-copy-group::after\s*\{[^}]*height:\s*6px[^}]*pointer-events:\s*auto/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-formula-menu\s*\{[^}]*top:\s*calc\(100%\s*\+\s*6px\)/s,
    );
    assert.match(
      style.textContent,
      /\.mineru-copy-formula-menu-item\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/s,
    );
  });

  it("updates stale injected overlay styles after reader hot reload", function () {
    const doc = createDocumentStub();
    const staleStyle = createFakeElement();
    staleStyle.textContent = ".mineru-copy-box { pointer-events: none; }";
    doc.getElementById = (id: string) =>
      id === "mineru-copy-overlay-styles"
        ? (staleStyle as unknown as HTMLElement)
        : null;

    ensureReaderOverlayStyles(doc as unknown as Document);

    assert.include(
      staleStyle.textContent,
      ".mineru-copy-overlay-modifier-active .mineru-copy-box",
    );
    assert.lengthOf(doc.headChildren, 0);
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
            const values: Record<string, string> = {
              "--material-toolbar": "rgb(252, 252, 252)",
              "--fill-primary": "rgb(32, 32, 32)",
            };
            return values[name] ?? "";
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
      "  --material-toolbar: rgb(252, 252, 252);",
    );
    assert.include(style.textContent, "  --fill-primary: rgb(32, 32, 32);");
  });

  it("refreshes bridged theme variables when Zotero color mode changes", function () {
    const doc = createDocumentStub();
    const parentDoc = createDocumentStub();
    let toolbarColor = "rgb(252, 252, 252)";
    let textColor = "rgb(32, 32, 32)";
    const parentWindow = {
      document: parentDoc,
      parent: null,
      getComputedStyle() {
        return {
          getPropertyValue(name: string) {
            const values: Record<string, string> = {
              "--material-toolbar": toolbarColor,
              "--fill-primary": textColor,
            };
            return values[name] ?? "";
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
    toolbarColor = "rgb(43, 43, 43)";
    textColor = "rgb(238, 238, 238)";
    ensureReaderOverlayStyles(doc as unknown as Document);

    assert.lengthOf(doc.headChildren, 1);
    assert.include(
      doc.headChildren[0].textContent,
      "  --material-toolbar: rgb(43, 43, 43);",
    );
    assert.include(
      doc.headChildren[0].textContent,
      "  --fill-primary: rgb(238, 238, 238);",
    );
    assert.notInclude(doc.headChildren[0].textContent, "rgb(252, 252, 252)");
    assert.notInclude(doc.headChildren[0].textContent, "rgb(32, 32, 32)");
  });

  it("does not reuse stale variables injected by the overlay style", function () {
    const doc = createDocumentStub();
    const parentDoc = createDocumentStub();
    let toolbarColor = "rgb(252, 252, 252)";
    let textColor = "rgb(32, 32, 32)";
    const parentWindow = {
      document: parentDoc,
      parent: null,
      getComputedStyle() {
        return {
          getPropertyValue(name: string) {
            const values: Record<string, string> = {
              "--material-toolbar": toolbarColor,
              "--fill-primary": textColor,
            };
            return values[name] ?? "";
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
          getPropertyValue(name: string) {
            return readInjectedCssVariable(doc, name);
          },
        };
      },
    };
    Object.assign(doc, { defaultView: childWindow });
    Object.assign(parentDoc, { defaultView: parentWindow });

    ensureReaderOverlayStyles(doc as unknown as Document);
    toolbarColor = "rgb(43, 43, 43)";
    textColor = "rgb(238, 238, 238)";
    ensureReaderOverlayStyles(doc as unknown as Document);

    assert.include(
      doc.headChildren[0].textContent,
      "  --material-toolbar: rgb(43, 43, 43);",
    );
    assert.include(
      doc.headChildren[0].textContent,
      "  --fill-primary: rgb(238, 238, 238);",
    );
    assert.notInclude(doc.headChildren[0].textContent, "rgb(252, 252, 252)");
    assert.notInclude(doc.headChildren[0].textContent, "rgb(32, 32, 32)");
  });

  it("refreshes overlay theme styles during positioning ticks", function () {
    const doc = createDocumentStub();
    const parentDoc = createDocumentStub();
    let intervalCallback: (() => void) | null = null;
    let toolbarColor = "rgb(252, 252, 252)";
    const parentWindow = {
      document: parentDoc,
      parent: null,
      addEventListener() {},
      removeEventListener() {},
      getComputedStyle() {
        return {
          getPropertyValue(name: string) {
            return name === "--material-toolbar" ? toolbarColor : "";
          },
        };
      },
    };
    parentWindow.parent = parentWindow;
    const win = {
      document: doc,
      parent: parentWindow,
      getComputedStyle() {
        return {
          getPropertyValue() {
            return "";
          },
        };
      },
      addEventListener() {},
      removeEventListener() {},
      requestAnimationFrame(callback: FrameRequestCallback) {
        callback(0);
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout() {
        return 1;
      },
      clearTimeout() {},
      setInterval(callback: () => void) {
        intervalCallback = callback;
        return 1;
      },
      clearInterval() {},
    };
    Object.assign(doc, { defaultView: win });
    Object.assign(parentDoc, { defaultView: parentWindow });
    ensureReaderOverlayStyles(doc as unknown as Document);
    toolbarColor = "rgb(43, 43, 43)";

    createReaderOverlayPositioningController({
      doc: doc as unknown as Document,
      win: win as unknown as Window,
      root: createFakeElement() as unknown as HTMLDivElement,
      reposition() {},
    });
    intervalCallback?.();

    assert.include(
      doc.headChildren[0].textContent,
      "  --material-toolbar: rgb(43, 43, 43);",
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

  it("mounts overlay roots on the document body even when a PDF scroll container exists", async function () {
    const doc = createDocumentStub();
    const scrollContainer = createFakeElement();
    doc.querySelector = (selector: string) =>
      selector === "#viewerContainer" ? scrollContainer : null;
    const reader = createReader({
      instanceID: "reader-body-mount",
      attachmentKey: "BODYMOUNT",
      views: [createView("primary")],
    });
    Object.assign(reader._iframeWindow.document, doc);
    await createStorage(getMinerUStorageRoot()).writeResult({
      attachment: {
        id: 1,
        key: "BODYMOUNT",
        libraryID: 1,
        fileName: "a.pdf",
        filePath: "a.pdf",
        mtime: 1,
      },
      mineruTaskID: "task-body-mount",
      rawResult: { content_list: [] },
      markdown: "",
      boxes: normalizedBoxes,
    });

    const state = await applyReaderOverlayMode(reader, "all");

    assert.isNotNull(state?.root);
    assert.include(doc.bodyChildren, state?.root as unknown as FakeElement);
    assert.notInclude(
      scrollContainer.children,
      state?.root as unknown as FakeElement,
    );
  });

  it("updates reader overlay state when the rendered selectable panel opens", async function () {
    const doc = createDocumentStub();
    const reader = createReader({
      instanceID: "reader-select-panel-state",
      attachmentKey: "PANELSTATE",
      views: [createView("primary")],
    });
    Object.assign(reader._iframeWindow.document, doc);
    await createStorage(getMinerUStorageRoot()).writeResult({
      attachment: {
        id: 1,
        key: "PANELSTATE",
        libraryID: 1,
        fileName: "a.pdf",
        filePath: "a.pdf",
        mtime: 1,
      },
      mineruTaskID: "task-panel-state",
      rawResult: { content_list: [] },
      markdown: "",
      boxes: normalizedBoxes,
    });

    const state = await applyReaderOverlayMode(reader, "all");
    const root = state?.root as unknown as FakeElement | null;
    if (!root) {
      assert.fail("Expected rendered overlay root");
    }
    const selectButton = findElementsByDataAction(root, "select-copy")[0];

    selectButton.dispatch("click", createClickEvent());

    assert.isTrue(state?.selectPanelActive);
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

  it("keeps overlay pointer events active across transient blur while a modifier is held", function () {
    const listeners = new Map<string, EventListener[]>();
    let blurTimeout: TimerHandler | null = null;
    const root = createFakeElement() as unknown as HTMLDivElement;
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((item) => item !== listener),
        );
      },
      requestAnimationFrame() {
        return 1;
      },
      cancelAnimationFrame() {},
      setTimeout(handler: TimerHandler) {
        blurTimeout = handler;
        return 1;
      },
      clearTimeout() {},
      setInterval() {
        return 1;
      },
      clearInterval() {},
    } as unknown as Window;

    const controller = createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    dispatchWindowEvent(listeners, "keydown", {
      shiftKey: true,
      ctrlKey: false,
    });
    assert.include(root.className, "mineru-copy-overlay-modifier-active");

    dispatchWindowEvent(listeners, "keyup", {
      shiftKey: false,
      ctrlKey: true,
    });
    assert.include(root.className, "mineru-copy-overlay-modifier-active");

    dispatchWindowEvent(listeners, "keyup", {
      shiftKey: false,
      ctrlKey: false,
    });
    assert.notInclude(root.className, "mineru-copy-overlay-modifier-active");

    dispatchWindowEvent(listeners, "keydown", {
      shiftKey: false,
      ctrlKey: true,
    });
    dispatchWindowEvent(listeners, "blur", {});
    assert.include(root.className, "mineru-copy-overlay-modifier-active");
    assert.isFunction(blurTimeout);
    if (typeof blurTimeout === "function") {
      blurTimeout();
    }
    assert.notInclude(root.className, "mineru-copy-overlay-modifier-active");

    controller.cleanup();
    assert.isEmpty(listeners.get("keydown") ?? []);
    assert.isEmpty(listeners.get("keyup") ?? []);
    assert.isEmpty(listeners.get("blur") ?? []);
  });

  it("selects a box from reader window capture when modifier keydown is missed", function () {
    const winListeners = new Map<string, EventListener[]>();
    const docListeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const box = createFakeElement();
    box.className = "mineru-copy-box";
    box.dataset.rawIndex = "7";
    box.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    root.append(box);
    const selectedRawIndexes = new Set<number>();
    const selectionAnchor = { rawIndex: null as number | null };
    const doc = {
      addEventListener(type: string, listener: EventListener) {
        docListeners.set(type, [...(docListeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: EventListener) {
        docListeners.set(
          type,
          (docListeners.get(type) ?? []).filter((item) => item !== listener),
        );
      },
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(winListeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      selectionOptions: {
        selectedRawIndexes,
        selectableRawIndexes: [7],
        getSelectionAnchorRawIndex: () => selectionAnchor.rawIndex,
        setSelectionAnchorRawIndex: (rawIndex) => {
          selectionAnchor.rawIndex = rawIndex;
        },
      },
      reposition() {},
    });

    let prevented = false;
    let stopped = false;
    let stoppedImmediate = false;
    dispatchWindowEvent(winListeners, "pointerdown", {
      shiftKey: true,
      ctrlKey: false,
      clientX: 40,
      clientY: 40,
      button: 0,
      buttons: 1,
      target: {},
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      stopImmediatePropagation() {
        stoppedImmediate = true;
      },
    });

    assert.isTrue(prevented);
    assert.isTrue(stopped);
    assert.isTrue(stoppedImmediate);
    assert.deepEqual([...selectedRawIndexes], [7]);
    assert.include(box.className, "mineru-copy-box-selected");
    assert.equal(selectionAnchor.rawIndex, 7);

    prevented = false;
    stopped = false;
    stoppedImmediate = false;
    dispatchWindowEvent(docListeners, "mousedown", {
      shiftKey: true,
      ctrlKey: false,
      clientX: 40,
      clientY: 40,
      button: 0,
      buttons: 1,
      target: {},
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      stopImmediatePropagation() {
        stoppedImmediate = true;
      },
    });

    assert.isTrue(prevented);
    assert.isTrue(stopped);
    assert.isTrue(stoppedImmediate);
  });

  it("selects rawIndex ranges from reader window capture on shift pointerdown", function () {
    const winListeners = new Map<string, EventListener[]>();
    const doc = createDocumentStub();
    const selectedRawIndexes = new Set<number>();
    const selectionAnchor = { rawIndex: null as number | null };
    const root = buildReaderOverlayRoot(
      doc as unknown as Document,
      normalizedBoxes,
      "all",
      {
        selectedRawIndexes,
        getSelectionAnchorRawIndex: () => selectionAnchor.rawIndex,
        setSelectionAnchorRawIndex: (rawIndex) => {
          selectionAnchor.rawIndex = rawIndex;
        },
      },
    );
    const boxes = findElementsByClass(
      root as unknown as FakeElement,
      "mineru-copy-box",
    );
    boxes[0].getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    boxes[1].getBoundingClientRect = () =>
      ({ left: 120, top: 20, right: 220, bottom: 80 }) as DOMRect;
    boxes[2].getBoundingClientRect = () =>
      ({ left: 230, top: 20, right: 330, bottom: 80 }) as DOMRect;
    const win = createEventWindow(winListeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      selectionOptions: {
        selectedRawIndexes,
        selectableRawIndexes:
          root.dataset.selectableRawIndexes
            ?.split(",")
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value)) ?? [],
        getSelectionAnchorRawIndex: () => selectionAnchor.rawIndex,
        setSelectionAnchorRawIndex: (rawIndex) => {
          selectionAnchor.rawIndex = rawIndex;
        },
      },
      reposition() {},
    });

    dispatchWindowEvent(winListeners, "pointerdown", {
      ctrlKey: true,
      clientX: 40,
      clientY: 40,
      button: 0,
      buttons: 1,
      target: {},
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
    dispatchWindowEvent(winListeners, "pointerdown", {
      shiftKey: true,
      clientX: 260,
      clientY: 40,
      button: 0,
      buttons: 1,
      target: {},
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });

    assert.deepEqual([...selectedRawIndexes].sort(), [0, 1, 2]);
  });

  it("enables overlay box pointer events from the parent reader window before pointerdown", function () {
    const childListeners = new Map<string, EventListener[]>();
    const parentListeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const parentWindow = createEventWindow(parentListeners, null, "parent");
    const childWindow = createEventWindow(
      childListeners,
      parentWindow,
      "child",
    );

    createReaderOverlayPositioningController({
      doc,
      win: childWindow,
      root,
      reposition() {},
    });

    dispatchWindowEvent(parentListeners, "keydown", {
      shiftKey: true,
      ctrlKey: false,
      currentTarget: parentWindow,
      key: "Shift",
    });
    assert.include(root.className, "mineru-copy-overlay-modifier-active");

    dispatchWindowEvent(parentListeners, "keyup", {
      shiftKey: false,
      ctrlKey: false,
      currentTarget: parentWindow,
      key: "Shift",
    });
    assert.notInclude(root.className, "mineru-copy-overlay-modifier-active");
  });

  it("tracks hovered boxes from pointer position while boxes pass through mouse events", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const firstBox = createFakeElement();
    firstBox.className = "mineru-copy-box";
    firstBox.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const secondBox = createFakeElement();
    secondBox.className = "mineru-copy-box";
    secondBox.getBoundingClientRect = () =>
      ({ left: 120, top: 20, right: 220, bottom: 80 }) as DOMRect;
    root.append(firstBox, secondBox);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = {
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: EventListener) {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((item) => item !== listener),
        );
      },
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

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 40 });
    assert.include(
      firstBox.className,
      "mineru-copy-box-hovered",
      "first point hovers first box",
    );
    assert.notInclude(
      secondBox.className,
      "mineru-copy-box-hovered",
      "first point does not hover second box",
    );

    dispatchWindowEvent(listeners, "mousemove", { clientX: 140, clientY: 40 });
    assert.notInclude(
      firstBox.className,
      "mineru-copy-box-hovered",
      "second point clears first box hover",
    );
    assert.include(
      secondBox.className,
      "mineru-copy-box-hovered",
      "second point hovers second box",
    );

    dispatchWindowEvent(listeners, "mousemove", { clientX: 400, clientY: 40 });
    assert.notInclude(
      secondBox.className,
      "mineru-copy-box-hovered",
      "outside point clears second box hover",
    );

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 40 });
    dispatchWindowEvent(listeners, "blur", {});
    assert.notInclude(
      firstBox.className,
      "mineru-copy-box-hovered",
      "blur clears first box hover",
    );
  });

  it("keeps a box hovered while moving through the action gap", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const box = createFakeElement();
    box.className = "mineru-copy-box";
    box.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const actions = createFakeElement();
    actions.className = "mineru-copy-box-actions";
    actions.getBoundingClientRect = () =>
      ({ left: 20, top: 83, right: 100, bottom: 110 }) as DOMRect;
    box.append(actions);
    root.append(box);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 40 });
    assert.include(box.className, "mineru-copy-box-hovered");

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 83 });
    assert.include(box.className, "mineru-copy-box-hovered");

    dispatchWindowEvent(listeners, "mousemove", { clientX: 105, clientY: 83 });
    assert.notInclude(box.className, "mineru-copy-box-hovered");
  });

  it("keeps the current box hovered when its actions overlap a later box", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const firstBox = createFakeElement();
    firstBox.className = "mineru-copy-box";
    firstBox.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const actions = createFakeElement();
    actions.className = "mineru-copy-box-actions";
    actions.getBoundingClientRect = () =>
      ({ left: 20, top: 83, right: 100, bottom: 110 }) as DOMRect;
    firstBox.append(actions);
    const secondBox = createFakeElement();
    secondBox.className = "mineru-copy-box";
    secondBox.getBoundingClientRect = () =>
      ({ left: 10, top: 80, right: 110, bottom: 140 }) as DOMRect;
    root.append(firstBox, secondBox);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 40 });
    assert.include(firstBox.className, "mineru-copy-box-hovered");

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 90 });
    assert.include(firstBox.className, "mineru-copy-box-hovered");
    assert.notInclude(secondBox.className, "mineru-copy-box-hovered");
  });

  it("keeps the formula box hovered while moving through its dropdown menu", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const firstBox = createFakeElement();
    firstBox.className = "mineru-copy-box";
    firstBox.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const actions = createFakeElement();
    actions.className = "mineru-copy-box-actions";
    actions.getBoundingClientRect = () =>
      ({ left: 20, top: 83, right: 100, bottom: 110 }) as DOMRect;
    const menu = createFakeElement();
    menu.className = "mineru-copy-formula-menu";
    menu.getBoundingClientRect = () =>
      ({ left: 20, top: 110, right: 170, bottom: 170 }) as DOMRect;
    actions.append(menu);
    firstBox.append(actions);
    const secondBox = createFakeElement();
    secondBox.className = "mineru-copy-box";
    secondBox.getBoundingClientRect = () =>
      ({ left: 10, top: 100, right: 180, bottom: 190 }) as DOMRect;
    root.append(firstBox, secondBox);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 40 });
    assert.include(firstBox.className, "mineru-copy-box-hovered");

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 130 });
    assert.include(firstBox.className, "mineru-copy-box-hovered");
    assert.notInclude(secondBox.className, "mineru-copy-box-hovered");
  });

  it("prioritizes an active formula dropdown over a later hovered box", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const firstBox = createFakeElement();
    firstBox.className = "mineru-copy-box mineru-copy-box-actions-active";
    firstBox.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const actions = createFakeElement();
    actions.className = "mineru-copy-box-actions";
    actions.getBoundingClientRect = () =>
      ({ left: 20, top: 83, right: 100, bottom: 110 }) as DOMRect;
    const menu = createFakeElement();
    menu.className = "mineru-copy-formula-menu";
    menu.getBoundingClientRect = () =>
      ({ left: 20, top: 110, right: 170, bottom: 170 }) as DOMRect;
    actions.append(menu);
    firstBox.append(actions);
    const secondBox = createFakeElement();
    secondBox.className = "mineru-copy-box mineru-copy-box-hovered";
    secondBox.getBoundingClientRect = () =>
      ({ left: 10, top: 100, right: 180, bottom: 190 }) as DOMRect;
    root.append(firstBox, secondBox);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 130 });

    assert.include(firstBox.className, "mineru-copy-box-hovered");
    assert.notInclude(secondBox.className, "mineru-copy-box-hovered");
  });

  it("does not hover lower boxes while a formula dropdown is open", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const firstBox = createFakeElement();
    firstBox.className = "mineru-copy-box";
    firstBox.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const actions = createFakeElement();
    actions.className = "mineru-copy-box-actions mineru-copy-formula-menu-open";
    actions.getBoundingClientRect = () =>
      ({ left: 20, top: 83, right: 100, bottom: 110 }) as DOMRect;
    const menu = createFakeElement();
    menu.className = "mineru-copy-formula-menu";
    menu.getBoundingClientRect = () =>
      ({ left: 20, top: 110, right: 170, bottom: 170 }) as DOMRect;
    actions.append(menu);
    firstBox.append(actions);
    const secondBox = createFakeElement();
    secondBox.className = "mineru-copy-box";
    secondBox.getBoundingClientRect = () =>
      ({ left: 10, top: 100, right: 180, bottom: 190 }) as DOMRect;
    root.append(firstBox, secondBox);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 185 });

    assert.notInclude(firstBox.className, "mineru-copy-box-hovered");
    assert.notInclude(
      secondBox.className,
      "mineru-copy-box-hovered",
      "a lower box must not activate below an open formula menu",
    );
  });

  it("does not hover other boxes while a selectable copy panel is open", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const firstBox = createFakeElement();
    firstBox.className = "mineru-copy-box mineru-copy-box-actions-active";
    firstBox.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 110, bottom: 80 }) as DOMRect;
    const actions = createFakeElement();
    actions.className = "mineru-copy-box-actions mineru-copy-select-panel-open";
    actions.getBoundingClientRect = () =>
      ({ left: 20, top: 83, right: 100, bottom: 110 }) as DOMRect;
    const panel = createFakeElement();
    panel.className = "mineru-copy-select-panel";
    panel.getBoundingClientRect = () =>
      ({ left: 20, top: 110, right: 170, bottom: 180 }) as DOMRect;
    actions.append(panel);
    firstBox.append(actions);
    const secondBox = createFakeElement();
    secondBox.className = "mineru-copy-box";
    secondBox.getBoundingClientRect = () =>
      ({ left: 10, top: 100, right: 180, bottom: 190 }) as DOMRect;
    root.append(firstBox, secondBox);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
      selectionOptions: {
        isSelectPanelActive: () => true,
      },
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 130 });
    assert.notInclude(
      firstBox.className,
      "mineru-copy-box-hovered",
      "select panel interaction should not keep the owner box hovered",
    );
    assert.notInclude(secondBox.className, "mineru-copy-box-hovered");

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 185 });
    assert.notInclude(
      firstBox.className,
      "mineru-copy-box-hovered",
      "select panel interaction should leave the owner box inactive",
    );
    assert.notInclude(
      secondBox.className,
      "mineru-copy-box-hovered",
      "other boxes stay inactive while the select panel remains open",
    );
  });

  it("suppresses hover in roots without an open panel while any selectable copy panel is active", function () {
    const listeners = new Map<string, EventListener[]>();
    const root = createFakeElement() as unknown as HTMLDivElement;
    const box = createFakeElement();
    box.className = "mineru-copy-box";
    box.getBoundingClientRect = () =>
      ({ left: 10, top: 100, right: 180, bottom: 190 }) as DOMRect;
    root.append(box);
    const doc = {
      querySelector() {
        return null;
      },
      documentElement: null,
      body: null,
    } as unknown as Document;
    const win = createEventWindow(listeners, null, "");

    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
      selectionOptions: {
        isSelectPanelActive: () => true,
      },
    });

    dispatchWindowEvent(listeners, "mousemove", { clientX: 40, clientY: 130 });

    assert.notInclude(
      box.className,
      "mineru-copy-box-hovered",
      "a sibling root must not activate boxes behind another root's panel",
    );
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

  it("leaves wheel events inside selectable copy panels to the textarea", function () {
    let wheelListener: ((event: WheelEvent) => void) | null = null;
    const panel = createFakeElement() as unknown as Node;
    const root = {
      contains(node: Node) {
        return node === panel;
      },
    } as unknown as HTMLDivElement;
    const scrollContainer = {
      addEventListener() {},
      removeEventListener() {},
      scrollBy() {
        assert.fail("Panel wheel should not scroll the reader container");
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
    let prevented = false;
    let stopped = false;

    (panel as unknown as FakeElement).className = "mineru-copy-select-panel";
    createReaderOverlayPositioningController({
      doc,
      win,
      root,
      reposition() {},
    });
    wheelListener?.({
      target: panel,
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
    } as unknown as WheelEvent);

    assert.isFalse(prevented);
    assert.isFalse(stopped);
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

  it("includes same-origin nested iframe windows from reader panes", function () {
    const primary = createView("primary");
    const nestedWindow = {
      name: "nested-pdf",
      document: createDocumentStub(),
    } as unknown as Window;
    const iframe = {
      contentWindow: nestedWindow,
    };
    Object.assign(primary._iframeWindow.document, {
      querySelectorAll(selector: string) {
        return selector === "iframe, frame" ? [iframe] : [];
      },
    });
    const reader = createReader({
      instanceID: "reader-nested",
      attachmentKey: "ABC123",
      views: [primary],
    });

    assert.deepEqual(getReaderOverlayWindows(reader), [
      primary._iframeWindow,
      nestedWindow,
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

  it("does not copy when the formula copy trigger itself is clicked", function () {
    const copied: string[] = [];
    const globals = globalThis as typeof globalThis & { ztoolkit?: unknown };
    const originalZtoolkit = globals.ztoolkit;
    globals.ztoolkit = {
      Clipboard: class {
        addText(text: string) {
          copied.push(text);
          return this;
        }

        copy() {}
      },
    };

    try {
      const doc = createDocumentStub();
      const root = buildReaderOverlayRoot(
        doc as unknown as Document,
        [createBox(0, "formula", "E=mc^2", "E=mc^2")],
        "hover",
      );

      const formulaGroups = findElementsByClass(
        root,
        "mineru-copy-formula-copy-group",
      );
      assert.lengthOf(formulaGroups, 1);
      const copyButton = findElementsByDataAction(formulaGroups[0], "copy")[0];
      copyButton.dispatch("click", createClickEvent());

      assert.deepEqual(copied, []);
    } finally {
      globals.ztoolkit = originalZtoolkit;
    }
  });

  it("copies full markdown when no boxes are selected", async function () {
    const copied: string[] = [];
    const globals = globalThis as typeof globalThis & {
      ztoolkit?: unknown;
    };
    const originalZtoolkit = globals.ztoolkit;
    globals.ztoolkit = {
      Clipboard: class {
        private text = "";

        addText(text: string) {
          this.text = text;
          return this;
        }

        copy() {
          copied.push(this.text);
        }
      },
    };
    const reader = createReader({
      instanceID: "reader-copy-full-markdown",
      attachmentKey: "COPYFULL",
      views: [createView("primary")],
    });
    setReaderOverlayModeForReader(reader, "all");
    await createStorage(getMinerUStorageRoot()).writeResult({
      attachment: {
        id: 1,
        key: "COPYFULL",
        libraryID: 1,
        fileName: "a.pdf",
        filePath: "a.pdf",
        mtime: 1,
      },
      mineruTaskID: "task-copy-full",
      rawResult: { content_list: [] },
      markdown: "# Full\n\nBody",
      boxes: normalizedBoxes,
    });

    try {
      const text = await readerOverlay.copySelectedBoxesForReader(reader);

      assert.equal(text, "# Full\n\nBody");
      assert.deepEqual(copied, ["# Full\n\nBody"]);
    } finally {
      globals.ztoolkit = originalZtoolkit;
    }
  });

  it("copies lite markdown when precise markdown is missing", async function () {
    const copied: string[] = [];
    const globals = globalThis as typeof globalThis & {
      ztoolkit?: unknown;
    };
    const originalZtoolkit = globals.ztoolkit;
    globals.ztoolkit = {
      Clipboard: class {
        private text = "";

        addText(text: string) {
          this.text = text;
          return this;
        }

        copy() {
          copied.push(this.text);
        }
      },
    };
    const reader = createReader({
      instanceID: "reader-copy-lite-markdown",
      attachmentKey: "LITECOPY",
      views: [createView("primary")],
    });
    setReaderOverlayModeForReader(reader, "hover");
    await createStorage(getMinerUStorageRoot()).writeLiteResult({
      attachment: {
        id: 1,
        key: "LITECOPY",
        libraryID: 1,
        fileName: "a.pdf",
        filePath: "a.pdf",
        mtime: 1,
      },
      mineruTaskID: "lite-task",
      source: "online",
      markdown: "# Lite Full",
    });

    try {
      const text = await readerOverlay.copySelectedBoxesForReader(reader);

      assert.equal(text, "# Lite Full");
      assert.deepEqual(copied, ["# Lite Full"]);
    } finally {
      globals.ztoolkit = originalZtoolkit;
    }
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

function createEventWindow(
  listeners: Map<string, EventListener[]>,
  parent: Window | null,
  name: string,
): Window {
  return {
    name,
    parent,
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((item) => item !== listener),
      );
    },
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
  dispatch: (type: string, event: Event) => void;
} {
  const rootChildren: FakeElement[] = [];
  const bodyChildren: FakeElement[] = [];
  const listeners = new Map<string, EventListener[]>();

  const doc = {
    head: {
      append(child: FakeElement) {
        child.parentElement = this as unknown as FakeElement;
        rootChildren.push(child);
      },
      children: rootChildren,
      className: "",
    },
    body: {
      append(child: FakeElement) {
        child.parentElement = this as unknown as FakeElement;
        bodyChildren.push(child);
      },
      clientWidth: 1000,
      clientHeight: 2000,
      children: bodyChildren,
      className: "",
    },
    documentElement: {
      clientWidth: 1000,
      clientHeight: 2000,
    },
    createElement(_tagName: string) {
      return createFakeElement();
    },
    getElementById(id: string) {
      return (
        [...rootChildren, ...bodyChildren].find(
          (element) => element.id === id,
        ) ?? null
      );
    },
    querySelector() {
      return null;
    },
    querySelectorAll(selector: string) {
      if (!selector.startsWith(".")) {
        return [];
      }
      const className = selector.slice(1);
      return [
        ...rootChildren.flatMap((child) =>
          findElementsByClass(child, className),
        ),
        ...bodyChildren.flatMap((child) =>
          findElementsByClass(child, className),
        ),
      ];
    },
    addEventListener(type: string, listener: EventListener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    dispatch(type: string, event: Event) {
      for (const listener of listeners.get(type) ?? []) {
        listener.call(this, event);
      }
    },
  };

  return Object.assign(doc, {
    headChildren: rootChildren,
    bodyChildren,
  }) as unknown as Document & {
    headChildren: FakeElement[];
    bodyChildren: FakeElement[];
    dispatch: (type: string, event: Event) => void;
  };
}

interface FakeElement {
  id: string;
  className: string;
  classList: {
    add: (...classNames: string[]) => void;
    remove: (...classNames: string[]) => void;
    toggle: (className: string, force?: boolean) => boolean;
    contains: (className: string) => boolean;
  };
  dataset: Record<string, string>;
  style: Record<string, string>;
  textContent: string;
  type: string;
  title: string;
  value: string;
  readOnly: boolean;
  rows: number;
  hidden: boolean;
  children: FakeElement[];
  parentElement: FakeElement | null;
  getBoundingClientRect?: () => DOMRect;
  append: (...children: FakeElement[]) => void;
  addEventListener: (_type: string, _listener: EventListener) => void;
  dispatch: (_type: string, _event: Event) => void;
  querySelectorAll: (_selector: string) => FakeElement[];
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
}

function createFakeElement(): FakeElement {
  const listeners = new Map<string, EventListener[]>();
  const element = {
    id: "",
    className: "",
    classList: {
      add(...classNames: string[]) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        for (const className of classNames) {
          classes.add(className);
        }
        element.className = [...classes].join(" ");
      },
      remove(...classNames: string[]) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        for (const className of classNames) {
          classes.delete(className);
        }
        element.className = [...classes].join(" ");
      },
      toggle(className: string, force?: boolean) {
        const classes = new Set(element.className.split(/\s+/).filter(Boolean));
        const shouldAdd = force ?? !classes.has(className);
        if (shouldAdd) {
          classes.add(className);
        } else {
          classes.delete(className);
        }
        element.className = [...classes].join(" ");
        return shouldAdd;
      },
      contains(className: string) {
        return element.className.split(/\s+/).includes(className);
      },
    },
    dataset: {},
    style: {},
    textContent: "",
    type: "",
    title: "",
    value: "",
    readOnly: false,
    rows: 0,
    hidden: false,
    children: [],
    parentElement: null,
    getBoundingClientRect() {
      return createRect({ top: 0, bottom: 0, left: 0, right: 0 });
    },
    append(...children: FakeElement[]) {
      for (const child of children) {
        child.parentElement = this;
      }
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
    setAttribute(name: string, value: string) {
      if (name === "id") {
        this.id = value;
        return;
      }
      if (name === "class") {
        this.className = value;
        return;
      }
      if (name === "title") {
        this.title = value;
        return;
      }
      if (name.startsWith("data-")) {
        this.dataset[toDatasetKey(name.slice("data-".length))] = value;
        return;
      }
      this.dataset[toDatasetKey(name)] = value;
    },
    remove() {},
  };
  return element;
}

function toDatasetKey(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
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

function findElementsByDataAction(
  root: FakeElement,
  action: string,
): FakeElement[] {
  const matches: FakeElement[] = [];
  const visit = (element: FakeElement) => {
    if (element.dataset.mineruAction === action) {
      matches.push(element);
    }
    for (const child of element.children) {
      visit(child);
    }
  };
  visit(root);
  return matches;
}

function readInjectedCssVariable(
  doc: { headChildren: FakeElement[] },
  name: string,
): string {
  const cssText = doc.headChildren[0]?.textContent ?? "";
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedName}:\\s*([^;]+);`).exec(cssText);
  return match?.[1]?.trim() ?? "";
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

function createKeyEvent(key: string): KeyboardEvent {
  return {
    key,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent;
}

function createMouseEvent(input: { target?: unknown } = {}): MouseEvent {
  return {
    target: input.target ?? null,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as MouseEvent;
}

function createRect(input: {
  top: number;
  bottom: number;
  left: number;
  right: number;
}): DOMRect {
  return {
    ...input,
    x: input.left,
    y: input.top,
    width: input.right - input.left,
    height: input.bottom - input.top,
    toJSON() {
      return input;
    },
  } as DOMRect;
}

function dispatchWindowEvent(
  listeners: Map<string, EventListener[]>,
  type: string,
  input: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    clientX?: number;
    clientY?: number;
    currentTarget?: unknown;
    key?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
    stopImmediatePropagation?: () => void;
  },
): void {
  for (const listener of listeners.get(type) ?? []) {
    try {
      listener.call(input.currentTarget ?? null, input as Event);
    } catch (error) {
      throw new Error(
        `dispatch ${type} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
