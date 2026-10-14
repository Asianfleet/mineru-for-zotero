import { assert } from "chai";
import {
  ensureButtonBinding,
  destroyButtonBinding,
} from "../src/modules/readerToolbar/binding";
import { createReaderToolbarPanelStore } from "../src/modules/readerToolbar/store";
import {
  getReaderOverlayStateForReader,
  destroyReaderOverlaysForReader,
  setReaderOverlayModeForReader,
} from "../src/modules/readerOverlay";
import {
  getOverlayCycleShortcut,
  setOverlayCycleShortcut,
} from "../src/utils/prefs";
import {
  createReaderShortcutController,
  formatReaderShortcut,
  getNextReaderOverlayMode,
  getReaderShortcutFromEvent,
  matchesReaderShortcut,
} from "../src/modules/readerToolbar/shortcut";

describe("reader mode shortcut", function () {
  it("cycles from off to all, hover, and off", function () {
    assert.equal(getNextReaderOverlayMode("off"), "all");
    assert.equal(getNextReaderOverlayMode("all"), "hover");
    assert.equal(getNextReaderOverlayMode("hover"), "off");
  });

  it("matches physical keys and exact modifiers", function () {
    const event = shortcutEvent();
    assert.equal(getReaderShortcutFromEvent(event), "Alt+Shift+KeyB");
    assert.equal(formatReaderShortcut("Alt+Shift+KeyB"), "Alt+Shift+B");
    assert.isTrue(matchesReaderShortcut(event, "Alt+Shift+KeyB"));
    assert.isFalse(matchesReaderShortcut(event, ""));
    assert.isFalse(
      matchesReaderShortcut(shortcutEvent({ ctrlKey: true }), "Alt+Shift+KeyB"),
    );
    assert.equal(
      getReaderShortcutFromEvent(shortcutEvent({ code: "ShiftLeft" })),
      "",
    );
    assert.equal(
      getReaderShortcutFromEvent(
        shortcutEvent({ altKey: false, shiftKey: false }),
      ),
      "",
    );
  });

  it("ignores typing, composition, repeat and handled events", function () {
    for (const change of [
      { repeat: true },
      { isComposing: true },
      { keyCode: 229 },
      { defaultPrevented: true },
      { target: { closest: () => ({}) } },
    ]) {
      assert.isFalse(
        matchesReaderShortcut(shortcutEvent(change), "Alt+Shift+KeyB"),
      );
    }
  });

  it("reads changed preferences and removes old window listeners", async function () {
    const first = new EventTarget();
    const second = new EventTarget();
    let shortcut = "Alt+Shift+KeyB";
    let calls = 0;
    const controller = createReaderShortcutController(
      () => shortcut,
      async () => {
        calls++;
      },
    );
    controller.sync([first as Window, second as Window]);
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        altKey: true,
        shiftKey: true,
        cancelable: true,
      }),
    );
    await Promise.resolve();
    assert.equal(calls, 1);
    shortcut = "Ctrl+KeyB";
    second.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        altKey: true,
        shiftKey: true,
      }),
    );
    assert.equal(calls, 1);
    second.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyB", ctrlKey: true }),
    );
    await Promise.resolve();
    assert.equal(calls, 2);
    controller.sync([second as Window]);
    first.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyB", ctrlKey: true }),
    );
    assert.equal(calls, 2);
    controller.cleanup();
    second.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyB", ctrlKey: true }),
    );
    assert.equal(calls, 2);
  });

  it("keeps the menu held across windows until every key is released and resets on blur", async function () {
    const first = new EventTarget();
    const second = new EventTarget();
    let releases = 0;
    const controller = createReaderShortcutController(
      () => "Alt+Shift+KeyB",
      async () => {},
      () => {
        releases++;
      },
    );
    controller.sync([first as Window, second as Window]);
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        altKey: true,
        shiftKey: true,
      }),
    );
    second.dispatchEvent(
      new KeyboardEvent("keyup", {
        code: "KeyB",
        altKey: true,
        shiftKey: true,
      }),
    );
    assert.isTrue(controller.isHeld());
    second.dispatchEvent(
      new KeyboardEvent("keyup", { code: "ShiftLeft", altKey: true }),
    );
    assert.equal(releases, 0);
    second.dispatchEvent(new KeyboardEvent("keyup", { code: "AltLeft" }));
    assert.isFalse(controller.isHeld());
    assert.equal(releases, 1);
    await Promise.resolve();
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        altKey: true,
        shiftKey: true,
      }),
    );
    first.dispatchEvent(new Event("blur"));
    assert.isFalse(controller.isHeld());
    assert.equal(releases, 2);
    controller.cleanup();
    second.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyB" }));
    assert.equal(releases, 2);
  });

  it("opens the bound menu and refreshes the actual mode after a shortcut", async function () {
    const globals = globalThis as typeof globalThis & { addon?: unknown };
    const previousAddon = globals.addon;
    globals.addon = Zotero.MinerUForZotero;
    const document =
      Zotero.getMainWindow().document.implementation.createHTMLDocument();
    const next = document.createElement("button");
    next.id = "next";
    document.body.append(next);
    const readerWindow = Object.assign(new EventTarget(), { document });
    const host = Object.assign(new EventTarget(), { document });
    const reader = {
      _instanceID: "shortcut-menu-reader",
      _iframeWindow: readerWindow,
      _item: {
        key: "SHORTCUT",
        libraryID: 1,
        isAttachment: () => true,
        isPDFAttachment: () => true,
      },
    } as unknown as _ZoteroTypes.ReaderInstance;
    const previous = getOverlayCycleShortcut();
    const store = createReaderToolbarPanelStore();
    try {
      setOverlayCycleShortcut("Alt+Shift+KeyB");
      setReaderOverlayModeForReader(reader, "hover");
      const binding = ensureButtonBinding(
        host as unknown as Window,
        reader,
        store,
      );
      assert.isNotNull(binding);
      assert.isTrue(binding!.menu.hidden);
      readerWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyB",
          altKey: true,
          shiftKey: true,
          cancelable: true,
        }),
      );
      assert.isFalse(binding!.menu.hidden);
      assert.isTrue(store.isOpen(reader._instanceID));
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
      assert.equal(getReaderOverlayStateForReader(reader)?.mode, "off");
      const modes = binding!.menu.querySelectorAll(".split-toggle button");
      assert.lengthOf(modes, 3);
      assert.equal(modes[2].getAttribute("aria-pressed"), "true");
      assert.equal(modes[0].getAttribute("aria-pressed"), "false");
      assert.isFalse(binding!.menu.hidden);
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      assert.isFalse(binding!.menu.hidden);
      readerWindow.dispatchEvent(
        new KeyboardEvent("keyup", {
          code: "AltLeft",
          shiftKey: true,
        }),
      );
      readerWindow.dispatchEvent(
        new KeyboardEvent("keyup", { code: "ShiftLeft" }),
      );
      assert.isFalse(binding!.menu.hidden);
      readerWindow.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyB" }));
      assert.isTrue(binding!.menu.hidden);
      assert.isFalse(store.isOpen(reader._instanceID));
      setReaderOverlayModeForReader(reader, "hover");
      readerWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyB",
          altKey: true,
          shiftKey: true,
        }),
      );
      readerWindow.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyB" }));
      assert.isTrue(binding!.menu.hidden);
      for (let i = 0; i < 6; i++) {
        await Promise.resolve();
      }
      assert.isTrue(binding!.menu.hidden);
      destroyButtonBinding(reader._instanceID);
      readerWindow.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyB",
          altKey: true,
          shiftKey: true,
        }),
      );
      assert.equal(getReaderOverlayStateForReader(reader)?.mode, "off");
    } finally {
      destroyButtonBinding(reader._instanceID);
      destroyReaderOverlaysForReader(reader);
      setOverlayCycleShortcut(previous);
      globals.addon = previousAddon;
    }
  });
});

/** 构造可覆盖字段的按键事件，验证输入保护与匹配规则。 */
function shortcutEvent(overrides: object = {}): KeyboardEvent {
  return {
    code: "KeyB",
    altKey: true,
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  } as KeyboardEvent;
}
