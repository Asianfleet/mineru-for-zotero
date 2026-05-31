# Box Copy Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reader overlay box copy buttons with a Zotero-like floating capsule toolbar, formula dropdown copy, and a read-only selectable text panel.

**Architecture:** Keep the existing per-box `createBoxActions()` boundary and do not introduce a global floating toolbar controller. The toolbar, formula menu, and selectable panel are rendered inside each box actions node, with small helper functions for text generation, placement classes, and document-level close handling.

**Tech Stack:** TypeScript ES modules, Zotero/Firefox DOM APIs, Fluent locale files, `zotero-plugin-scaffold` Mocha/Chai tests, Prettier/ESLint via `pnpm lint:check`.

---

## File Structure

- Modify: `addon/content/box-toolbar-select-copy.svg`
  - Convert hard-coded black strokes to `currentColor` so the icon follows Zotero dark/light theme.
- Modify: `addon/locale/en-US/mainWindow.ftl`
  - Add labels for the select-copy toolbar button and formula dropdown.
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
  - Add matching Chinese labels.
- Modify: `typings/i10n.d.ts`
  - Add new Fluent message ids.
- Modify: `src/modules/readerOverlay/render.ts`
  - Replace text buttons with capsule toolbar DOM.
  - Add formula hover dropdown.
  - Add read-only selectable panel and text-generation helper.
  - Add document-level close handling for outside click and Esc.
- Modify: `src/modules/readerOverlay/styles.ts`
  - Replace old button styles with capsule toolbar, divider, icon, dropdown, selectable panel, hover, and placement styles.
  - Keep existing box label and box border styles.
- Modify: `test/readerOverlay.test.ts`
  - Update expected DOM from text buttons to toolbar structure.
  - Add tests for formula dropdown, selectable panel text, close behavior, and CSS presence.

## Task 1: Locale Keys and Theme-Safe SVG

**Files:**

- Modify: `addon/content/box-toolbar-select-copy.svg`
- Modify: `addon/locale/en-US/mainWindow.ftl`
- Modify: `addon/locale/zh-CN/mainWindow.ftl`
- Modify: `typings/i10n.d.ts`

- [ ] **Step 1: Update select-copy SVG color**

Change both `stroke="rgba(0, 0, 0, 1.00)"` attributes in `addon/content/box-toolbar-select-copy.svg` to `stroke="currentColor"`.

Expected final SVG pattern:

```xml
<path ... stroke="currentColor" stroke-width="1.5" ...></path>
<path stroke="currentColor" stroke-width="1.5" ...></path>
```

- [ ] **Step 2: Add English locale keys**

Append these keys near the existing reader copy keys in `addon/locale/en-US/mainWindow.ftl`:

```ftl
reader-select-copy-box = Select copy
reader-copy-formula-menu = Formula copy options
```

- [ ] **Step 3: Add Chinese locale keys**

Append these keys near the existing reader copy keys in `addon/locale/zh-CN/mainWindow.ftl`:

```ftl
reader-select-copy-box = 选择复制
reader-copy-formula-menu = 公式复制选项
```

- [ ] **Step 4: Update generated i10n type union**

Add the two ids to `typings/i10n.d.ts` in the reader copy section:

```ts
| 'reader-copy-formula-menu'
| 'reader-select-copy-box'
```

- [ ] **Step 5: Verify formatting**

Run:

```powershell
pnpm exec prettier --write addon/content/box-toolbar-select-copy.svg addon/locale/en-US/mainWindow.ftl addon/locale/zh-CN/mainWindow.ftl typings/i10n.d.ts
```

Expected: Prettier reports all four files written or unchanged without errors.

- [ ] **Step 6: Commit**

```powershell
git add addon/content/box-toolbar-select-copy.svg addon/locale/en-US/mainWindow.ftl addon/locale/zh-CN/mainWindow.ftl typings/i10n.d.ts
git commit -m "feat(reader): add box toolbar labels"
```

## Task 2: Write Failing Reader Overlay DOM Tests

**Files:**

- Modify: `test/readerOverlay.test.ts`

- [ ] **Step 1: Replace old copy button expectations**

In the tests currently named `renders hover labels and copy buttons`, `uses Fluent messages for hover labels and copy buttons`, and `renders labels and copy buttons in all mode`, change button-text assertions to toolbar-structure assertions.

Use this helper near the existing `findElementsByClass()` helper:

```ts
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
```

Add assertions like this to the hover/all rendering tests:

```ts
assert.lengthOf(findElementsByClass(root, "mineru-copy-box-toolbar"), 8);
assert.lengthOf(findElementsByDataAction(root, "copy"), 8);
assert.lengthOf(findElementsByDataAction(root, "select-copy"), 8);
assert.lengthOf(findElementsByClass(root, "mineru-copy-toolbar-divider"), 8);
assert.lengthOf(findElementsByClass(root, "mineru-copy-formula-menu"), 1);
assert.lengthOf(findElementsByClass(root, "mineru-copy-select-panel"), 8);
```

- [ ] **Step 2: Add selectable text tests**

Add this test after the render tests:

```ts
it("renders selectable copy panels from raw markdown and keeps formula dollars", function () {
  const doc = createDocumentStub();

  const root = buildReaderOverlayRoot(
    doc as unknown as Document,
    [
      createBox(0, "text", "**Raw** markdown"),
      createBox(1, "interline_equation", "E=mc^2", "E=mc^2"),
      createBox(2, "inline_equation", "$a+b$", "a+b"),
    ],
    "hover",
  );

  const panels = findElementsByClass(root, "mineru-copy-select-panel");
  assert.deepEqual(
    panels.map((element) => element.value),
    ["**Raw** markdown", "$E=mc^2$", "$a+b$"],
  );
  assert.isTrue(panels.every((element) => element.readOnly));
});
```

- [ ] **Step 3: Add formula main-button no-op test**

Add this test near existing copy tests:

```ts
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

    const copyButton = findElementsByDataAction(root, "copy")[0];
    copyButton.dispatch("click", createClickEvent());

    assert.deepEqual(copied, []);
  } finally {
    globals.ztoolkit = originalZtoolkit;
  }
});
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because `mineru-copy-box-toolbar`, `mineru-copy-select-panel`, `dataset.mineruAction`, and formula dropdown elements do not exist yet.

- [ ] **Step 5: Commit failing tests**

```powershell
git add test/readerOverlay.test.ts
git commit -m "test(reader): cover box copy toolbar structure"
```

## Task 3: Implement Toolbar DOM and Selectable Text

**Files:**

- Modify: `src/modules/readerOverlay/render.ts`
- Modify: `test/readerOverlay.test.ts`

- [ ] **Step 1: Extend the fake element for new DOM properties**

Update the `FakeElement` interface in `test/readerOverlay.test.ts`:

```ts
interface FakeElement {
  id: string;
  className: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  textContent: string;
  value: string;
  readOnly: boolean;
  type: string;
  title: string;
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
```

Update `createFakeElement()`:

```ts
function createFakeElement(): FakeElement {
  const listeners = new Map<string, EventListener[]>();
  return {
    id: "",
    className: "",
    dataset: {},
    style: {},
    textContent: "",
    value: "",
    readOnly: false,
    type: "",
    title: "",
    hidden: false,
    children: [],
    parentElement: null,
    append(...children: FakeElement[]) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
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
      this.dataset[name] = value;
    },
    remove() {},
  };
}
```

- [ ] **Step 2: Replace `createBoxActions()` implementation**

In `src/modules/readerOverlay/render.ts`, replace the existing `createBoxActions()` body with:

```ts
export function createBoxActions(
  doc: Document,
  box: NormalizedBox,
): HTMLDivElement {
  const actions = doc.createElement("div");
  actions.className =
    "mineru-copy-box-actions mineru-copy-toolbar-below mineru-copy-select-panel-above";
  actions.dataset.rawIndex = String(box.rawIndex);

  const toolbar = doc.createElement("div");
  toolbar.className = "mineru-copy-box-toolbar";
  toolbar.addEventListener("mousedown", stopOverlayActionEvent);
  toolbar.addEventListener("click", stopOverlayActionEvent);
  toolbar.append(
    createToolbarCopyControl(doc, box),
    createToolbarDivider(doc),
    createToolbarButton(doc, {
      action: "select-copy",
      className: "mineru-copy-toolbar-button-select",
      label: readerOverlayString("reader-select-copy-box", "Select copy"),
      onClick: () => {
        closeOpenSelectPanels(doc);
        actions.classList.add("mineru-copy-select-panel-open");
        updateBoxActionPlacement(doc, actions);
      },
    }),
  );

  const panel = createSelectCopyPanel(doc, box);
  actions.append(toolbar, panel);
  actions.addEventListener("mouseenter", () => {
    updateBoxActionPlacement(doc, actions);
  });
  ensureSelectPanelCloseHandlers(doc);
  return actions;
}
```

- [ ] **Step 3: Add toolbar helper functions**

Add these helpers below `createBoxActions()`:

```ts
interface ToolbarButtonOptions {
  action: string;
  className: string;
  label: string;
  onClick: () => void;
}

function createToolbarCopyControl(
  doc: Document,
  box: NormalizedBox,
): HTMLElement {
  if (!isFormulaBox(box) || !box.formula) {
    return createToolbarButton(doc, {
      action: "copy",
      className: "mineru-copy-toolbar-button-copy",
      label: readerOverlayString("reader-copy-box", "Copy"),
      onClick: () => {
        copyText(formatBoxesForCopy([box]));
      },
    });
  }

  const group = doc.createElement("div");
  group.className = "mineru-copy-formula-copy-group";
  const trigger = createToolbarButton(doc, {
    action: "copy",
    className: "mineru-copy-toolbar-button-copy",
    label: readerOverlayString(
      "reader-copy-formula-menu",
      "Formula copy options",
    ),
    onClick: () => undefined,
  });
  const menu = doc.createElement("div");
  menu.className = "mineru-copy-formula-menu";
  menu.append(
    createFormulaMenuItem(
      doc,
      readerOverlayString("reader-copy-formula-with-dollar", "Copy with $"),
      () => copyText(formatFormulaForCopy(box.formula ?? "", "with-dollar")),
    ),
    createFormulaMenuItem(
      doc,
      readerOverlayString(
        "reader-copy-formula-without-dollar",
        "Copy without $",
      ),
      () => copyText(formatFormulaForCopy(box.formula ?? "", "without-dollar")),
    ),
  );
  group.append(trigger, menu);
  return group;
}

function createToolbarButton(
  doc: Document,
  options: ToolbarButtonOptions,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = `mineru-copy-toolbar-button ${options.className}`;
  button.dataset.mineruAction = options.action;
  button.title = options.label;
  button.setAttribute("aria-label", options.label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onClick();
  });
  return button;
}

function createToolbarDivider(doc: Document): HTMLSpanElement {
  const divider = doc.createElement("span");
  divider.className = "mineru-copy-toolbar-divider";
  return divider;
}

function createFormulaMenuItem(
  doc: Document,
  label: string,
  onCopy: () => void,
): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "mineru-copy-formula-menu-item";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCopy();
    closeOpenSelectPanels(doc);
  });
  return button;
}
```

- [ ] **Step 4: Add selectable panel text helpers**

Add these helpers below the toolbar helpers:

```ts
function createSelectCopyPanel(
  doc: Document,
  box: NormalizedBox,
): HTMLTextAreaElement {
  const panel = doc.createElement("textarea");
  panel.className = "mineru-copy-select-panel";
  panel.readOnly = true;
  panel.value = getSelectableBoxText(box);
  panel.setAttribute(
    "aria-label",
    readerOverlayString("reader-select-copy-box", "Select copy"),
  );
  panel.addEventListener("mousedown", stopOverlayActionEvent);
  panel.addEventListener("click", stopOverlayActionEvent);
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  return panel;
}

export function getSelectableBoxText(box: NormalizedBox): string {
  const markdown = box.markdown ?? "";
  if (!isFormulaBox(box)) {
    return markdown || formatBoxesForCopy([box]);
  }

  if (hasDollarWrappedFormula(markdown)) {
    return markdown;
  }

  const formula = box.formula ?? markdown;
  return formula ? `$${stripOuterDollars(formula)}$` : "";
}

function hasDollarWrappedFormula(value: string): boolean {
  const trimmed = value.trim();
  return /^\${1,2}[\s\S]+\${1,2}$/.test(trimmed);
}

function stripOuterDollars(value: string): string {
  return value
    .trim()
    .replace(/^\${1,2}/, "")
    .replace(/\${1,2}$/, "");
}

function stopOverlayActionEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: DOM/text tests from Task 2 pass. Style and close-behavior tests may still fail until later tasks.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/readerOverlay/render.ts test/readerOverlay.test.ts
git commit -m "feat(reader): render box copy toolbar"
```

## Task 4: Add Capsule Toolbar and Panel Styles

**Files:**

- Modify: `src/modules/readerOverlay/styles.ts`
- Modify: `test/readerOverlay.test.ts`

- [ ] **Step 1: Add failing CSS assertions**

In the existing `hides controls until a box is hovered` test, replace old `.mineru-copy-button` assertions with:

```ts
assert.match(
  style.textContent,
  /\.mineru-copy-box-toolbar\s*\{[^}]*border-radius:\s*999px[^}]*background:\s*var\(--material-toolbar,\s*ButtonFace\)/s,
);
assert.match(
  style.textContent,
  /\.mineru-copy-toolbar-divider\s*\{[^}]*border-left:\s*1px solid/s,
);
assert.include(
  style.textContent,
  "chrome://mineruForZotero/content/box-toolbar-copy.svg",
);
assert.include(
  style.textContent,
  "chrome://mineruForZotero/content/box-toolbar-select-copy.svg",
);
assert.match(
  style.textContent,
  /\.mineru-copy-select-panel\s*\{[^}]*resize:\s*both[^}]*user-select:\s*text/s,
);
assert.match(
  style.textContent,
  /\.mineru-copy-formula-copy-group:hover\s+\.mineru-copy-formula-menu\s*\{[^}]*display:\s*flex/s,
);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: FAIL because new CSS selectors do not exist yet.

- [ ] **Step 3: Replace old button CSS**

In `src/modules/readerOverlay/styles.ts`, replace `.mineru-copy-button` styles and old action gap rules with:

```css
.mineru-copy-box-actions {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  display: none;
  pointer-events: none;
}

.mineru-copy-box:hover .mineru-copy-box-actions,
.mineru-copy-box-hovered .mineru-copy-box-actions,
.mineru-copy-select-panel-open {
  display: block;
}

.mineru-copy-toolbar-above {
  top: auto;
  bottom: 100%;
}

.mineru-copy-box-toolbar {
  display: flex;
  align-items: center;
  overflow: visible;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 999px;
  background: var(--material-toolbar, ButtonFace);
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.2),
    0 4px 12px rgba(0, 0, 0, 0.18);
  color: var(--fill-primary, ButtonText);
  pointer-events: auto;
}

.mineru-copy-toolbar-button {
  width: 32px;
  height: 28px;
  border: 0;
  margin: 0;
  padding: 0;
  border-radius: 0;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 16px 16px;
  color: inherit;
  -moz-context-properties: fill, fill-opacity, stroke, stroke-opacity;
}

.mineru-copy-toolbar-button:hover,
.mineru-copy-formula-copy-group:hover > .mineru-copy-toolbar-button {
  background-color: rgba(0, 0, 0, 0.08);
}

.mineru-copy-toolbar-button-copy {
  border-radius: 999px 0 0 999px;
  background-image: url("chrome://mineruForZotero/content/box-toolbar-copy.svg");
}

.mineru-copy-toolbar-button-select {
  border-radius: 0 999px 999px 0;
  background-image: url("chrome://mineruForZotero/content/box-toolbar-select-copy.svg");
}

.mineru-copy-toolbar-divider {
  width: 0;
  height: 18px;
  border-left: 1px solid rgba(0, 0, 0, 0.18);
}

.mineru-copy-formula-copy-group {
  position: relative;
  display: flex;
}

.mineru-copy-formula-menu {
  position: absolute;
  left: 0;
  top: 100%;
  display: none;
  min-width: 150px;
  flex-direction: column;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 6px;
  background: var(--material-toolbar, ButtonFace);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
}

.mineru-copy-formula-copy-group:hover .mineru-copy-formula-menu {
  display: flex;
}

.mineru-copy-formula-menu-item {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--fill-primary, ButtonText);
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  padding: 6px 8px;
  text-align: left;
  white-space: nowrap;
}

.mineru-copy-formula-menu-item:hover {
  background-color: rgba(0, 0, 0, 0.08);
}

.mineru-copy-select-panel {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  width: min(360px, 70vw);
  min-width: 180px;
  min-height: 48px;
  max-height: 220px;
  transform: translateX(-50%);
  display: none;
  resize: both;
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 7px;
  background: var(--material-toolbar, Field);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  color: var(--fill-primary, FieldText);
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  padding: 8px 10px;
  user-select: text;
  pointer-events: auto;
}

.mineru-copy-select-panel-open .mineru-copy-select-panel {
  display: block;
}

.mineru-copy-select-panel-below .mineru-copy-select-panel {
  top: calc(100% + 6px);
  bottom: auto;
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: CSS tests pass. Close-behavior tests are not added yet.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/readerOverlay/styles.ts test/readerOverlay.test.ts
git commit -m "style(reader): match Zotero box toolbar controls"
```

## Task 5: Add Placement and Close Behavior

**Files:**

- Modify: `src/modules/readerOverlay/render.ts`
- Modify: `test/readerOverlay.test.ts`

- [ ] **Step 1: Add document event support to tests**

Extend `createDocumentStub()` with event listeners:

```ts
function createDocumentStub(): Document & {
  headChildren: FakeElement[];
  bodyChildren: FakeElement[];
  dispatch: (_type: string, _event: Event) => void;
} {
  const rootChildren: FakeElement[] = [];
  const bodyChildren: FakeElement[] = [];
  const listeners = new Map<string, EventListener[]>();

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
      const roots = [...rootChildren, ...bodyChildren];
      if (!selector.startsWith(".")) {
        return [];
      }
      return roots.flatMap((root) =>
        findElementsByClass(root, selector.slice(1)),
      );
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
    dispatch: (_type: string, _event: Event) => void;
  };
}
```

- [ ] **Step 2: Add close behavior test**

Add:

```ts
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

  selectButtons[0].dispatch("click", createClickEvent());
  assert.include(actions[0].className, "mineru-copy-select-panel-open");

  selectButtons[1].dispatch("click", createClickEvent());
  assert.notInclude(actions[0].className, "mineru-copy-select-panel-open");
  assert.include(actions[1].className, "mineru-copy-select-panel-open");

  doc.dispatch("keydown", createKeyEvent("Escape"));
  assert.notInclude(actions[1].className, "mineru-copy-select-panel-open");

  selectButtons[0].dispatch("click", createClickEvent());
  doc.dispatch("mousedown", createMouseEvent({ target: doc.body }));
  assert.notInclude(actions[0].className, "mineru-copy-select-panel-open");
});
```

Add helper functions:

```ts
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
```

- [ ] **Step 3: Add close and placement helpers**

In `src/modules/readerOverlay/render.ts`, add:

```ts
const selectPanelCloseHandlerDocs = new WeakSet<Document>();

function ensureSelectPanelCloseHandlers(doc: Document): void {
  if (selectPanelCloseHandlerDocs.has(doc)) {
    return;
  }
  selectPanelCloseHandlerDocs.add(doc);

  doc.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Escape") {
      closeOpenSelectPanels(doc);
    }
  });

  doc.addEventListener(
    "mousedown",
    (event) => {
      if (isInsideActions(event.target)) {
        return;
      }
      closeOpenSelectPanels(doc);
    },
    true,
  );
}

function closeOpenSelectPanels(doc: Document): void {
  for (const element of Array.from(
    doc.querySelectorAll(".mineru-copy-select-panel-open"),
  )) {
    element.classList.remove("mineru-copy-select-panel-open");
  }
}

function isInsideActions(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(".mineru-copy-box-actions"));
}

function updateBoxActionPlacement(doc: Document, actions: HTMLElement): void {
  const win = doc.defaultView;
  if (!win) {
    return;
  }

  const rect = actions.getBoundingClientRect();
  const viewportHeight =
    doc.documentElement?.clientHeight || win.innerHeight || 0;
  actions.classList.toggle(
    "mineru-copy-toolbar-above",
    rect.bottom > viewportHeight,
  );
  actions.classList.toggle(
    "mineru-copy-toolbar-below",
    rect.bottom <= viewportHeight,
  );
  actions.classList.toggle("mineru-copy-select-panel-below", rect.top < 80);
}
```

- [ ] **Step 4: Make helper test stubs support classList**

Add `classList` to `FakeElement` only if tests fail because string-only `className` cannot satisfy implementation:

```ts
classList: {
  add: (...names: string[]) => void;
  remove: (...names: string[]) => void;
  toggle: (name: string, force?: boolean) => void;
}
```

Implementation inside `createFakeElement()`:

```ts
classList: {
  add: (...names: string[]) => {
    const classes = new Set(element.className.split(/\s+/).filter(Boolean));
    for (const name of names) {
      classes.add(name);
    }
    element.className = [...classes].join(" ");
  },
  remove: (...names: string[]) => {
    const classes = new Set(element.className.split(/\s+/).filter(Boolean));
    for (const name of names) {
      classes.delete(name);
    }
    element.className = [...classes].join(" ");
  },
  toggle: (name: string, force?: boolean) => {
    const classes = new Set(element.className.split(/\s+/).filter(Boolean));
    const shouldAdd = force ?? !classes.has(name);
    if (shouldAdd) {
      classes.add(name);
    } else {
      classes.delete(name);
    }
    element.className = [...classes].join(" ");
  },
},
```

Use a local `const element = { ... }` shape before returning so the closures can update `element.className`.

- [ ] **Step 5: Run tests**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS for reader overlay tests and no regressions in existing test files.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/readerOverlay/render.ts test/readerOverlay.test.ts
git commit -m "feat(reader): support selectable box copy panel"
```

## Task 6: Final Verification and Diff Cleanup

**Files:**

- Inspect: `git status --short`
- Inspect: `git diff --stat`
- Verify: all touched source, locale, typing, and test files

- [ ] **Step 1: Run Prettier on touched docs and code**

Run:

```powershell
pnpm exec prettier --write addon/content/box-toolbar-select-copy.svg addon/locale/en-US/mainWindow.ftl addon/locale/zh-CN/mainWindow.ftl typings/i10n.d.ts src/modules/readerOverlay/render.ts src/modules/readerOverlay/styles.ts test/readerOverlay.test.ts
```

Expected: Prettier completes without errors.

- [ ] **Step 2: Run lint gate**

Run:

```powershell
pnpm lint:check
```

Expected: PASS with `All matched files use Prettier code style!` and no ESLint errors.

- [ ] **Step 3: Run scaffold test suite**

Run:

```powershell
.\node_modules\.bin\zotero-plugin.CMD test --exit-on-finish --abort-on-fail
```

Expected: PASS; Zotero scaffold test process exits automatically.

- [ ] **Step 4: Inspect final diff**

Run:

```powershell
git status --short
git diff --stat
```

Expected changed files are limited to:

```text
addon/content/box-toolbar-copy.svg
addon/content/box-toolbar-select-copy.svg
addon/locale/en-US/mainWindow.ftl
addon/locale/zh-CN/mainWindow.ftl
typings/i10n.d.ts
src/modules/readerOverlay/render.ts
src/modules/readerOverlay/styles.ts
test/readerOverlay.test.ts
```

The earlier design commit already contains `.gitignore` and the design spec. `.superpowers/` remains ignored.

- [ ] **Step 5: Commit final implementation**

```powershell
git add addon/content/box-toolbar-copy.svg addon/content/box-toolbar-select-copy.svg addon/locale/en-US/mainWindow.ftl addon/locale/zh-CN/mainWindow.ftl typings/i10n.d.ts src/modules/readerOverlay/render.ts src/modules/readerOverlay/styles.ts test/readerOverlay.test.ts
git commit -m "feat(reader): add box copy toolbar"
```
