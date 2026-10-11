import { assert } from "chai";
import { snapshotReaderContext } from "../src/modules/readerQuery/runtime";
import type {
  ReaderRuntimeDependencies,
  ReaderRuntimeItem,
} from "../src/modules/readerQuery/runtime";

/** 构造不依赖真实文献库的 Zotero 条目边界对象。 */
function item(
  id: number,
  key: string,
  parentItemID?: number,
): ReaderRuntimeItem {
  return {
    id,
    key,
    libraryID: 1,
    parentItemID,
    getField: () => `Title ${id}`,
    isAttachment: () => id !== 1,
    isPDFAttachment: () => id !== 1 && id !== 4,
  };
}

/** 构造两个主窗口、未加载 tab 和独立 Reader 的运行时依赖。 */
function runtime(): ReaderRuntimeDependencies {
  const windows = [
    {
      Zotero_Tabs: {
        selectedID: "library",
        _tabs: [
          { id: "library", type: "library", title: "Library" },
          {
            id: "unloaded",
            type: "reader",
            title: "Unloaded PDF",
            data: { itemID: 2 },
          },
        ],
      },
    },
    {
      Zotero_Tabs: {
        selectedID: "tab-b",
        _tabs: [
          { id: "tab-b", type: "reader", title: "B", data: { itemID: 3 } },
          { id: "epub", type: "reader", title: "EPUB", data: { itemID: 4 } },
        ],
      },
    },
  ];
  const items = new Map([
    [1, item(1, "PARENT")],
    [2, item(2, "PDF_A", 1)],
    [3, item(3, "PDF_B")],
    [4, item(4, "EPUB")],
  ]);
  const readers = [
    { _instanceID: "b", type: "pdf", tabID: "tab-b", _item: items.get(3) },
    {
      _instanceID: "window",
      type: "pdf",
      _window: { closed: false },
      _item: items.get(2),
    },
    {
      _instanceID: "closed-tab",
      type: "pdf",
      tabID: "gone",
      _item: items.get(2),
    },
    {
      _instanceID: "closed-window",
      type: "pdf",
      _window: { closed: true },
      _item: items.get(2),
    },
  ];
  return {
    getMainWindows: () => windows,
    getMainWindow: () => windows[1],
    getReaders: () => readers,
    getItem: (id) => items.get(id),
    readSelectedIndexes: () => [8, 2],
    readRunning: () => ({ preciseRunning: false, liteRunning: true }),
  };
}

describe("reader context runtime snapshot", function () {
  it("includes unloaded tabs and resolves parent items without readers", function () {
    const result = snapshotReaderContext(runtime(), "all");
    assert.deepEqual(
      result.tabs.map((tab) => tab.tabId),
      ["unloaded", "tab-b", "epub"],
    );
    assert.equal(result.tabs[0].itemKey, "PARENT");
    assert.equal(result.tabs[0].attachmentKey, "PDF_A");
    assert.equal(result.tabs[1].itemKey, "PDF_B");
    assert.isFalse(result.tabs[2].pdf);
  });

  it("active uses the most recent main window rather than standalone reader", function () {
    const result = snapshotReaderContext(runtime(), "active");
    assert.deepEqual(
      result.tabs.map((tab) => tab.tabId),
      ["tab-b"],
    );
    assert.deepEqual(
      result.readers.map((reader) => reader.readerInstanceId),
      ["b"],
    );
  });

  it("all includes standalone readers but excludes closed tabs and windows", function () {
    const result = snapshotReaderContext(runtime(), "all");
    assert.deepEqual(
      result.readers.map((reader) => reader.readerInstanceId),
      ["b", "window"],
    );
    assert.isNull(result.readers[1].tabId);
    assert.deepEqual(result.readers[1].selectedRawIndexes, [8, 2]);
  });

  it("a selected library tab does not fall back to another window", function () {
    const deps = runtime();
    deps.getMainWindow = () => deps.getMainWindows()[0];
    const result = snapshotReaderContext(deps, "active");
    assert.deepEqual(result, { tabs: [], readers: [] });
  });

  it("keeps unavailable items separate from missing tabs", function () {
    const deps = runtime();
    deps.getItem = () => undefined;
    const result = snapshotReaderContext(deps, "all");
    assert.equal(result.tabs[0].status, "item-unavailable");
    assert.equal(result.tabs[0].tabTitle, "Unloaded PDF");
  });

  it("no main window still allows standalone reader selection in all scope", function () {
    const deps = runtime();
    deps.getMainWindows = () => [];
    deps.getMainWindow = () => null;
    assert.lengthOf(snapshotReaderContext(deps, "all").readers, 1);
    assert.deepEqual(snapshotReaderContext(deps, "active"), {
      tabs: [],
      readers: [],
    });
  });

  it("reads live tab ids when persistence getState omits ids", function () {
    const deps = runtime();
    const win = deps.getMainWindows()[1];
    const manager = win.Zotero_Tabs!;
    const liveTabs = manager._tabs;
    Object.assign(manager, {
      _tabs: liveTabs,
      getState: () => liveTabs.map(({ id: _id, ...tab }) => tab),
    });
    const result = snapshotReaderContext(deps, "active");
    assert.equal(result.tabs[0]?.tabId, "tab-b");
    assert.equal(result.readers[0]?.readerInstanceId, "b");
  });
});
