import { assert } from "chai";
import { createReaderQueryService } from "../src/modules/readerQuery/queryService";
import type { ReaderContextSnapshot } from "../src/modules/readerQuery/types";
import { normalizedBoxes } from "./domainFixtures";

/** 构造包含附件实际标识的同步阅读上下文快照。 */
function context(): ReaderContextSnapshot {
  const tab = {
    tabId: "tab-a",
    active: true,
    tabTitle: "PDF A",
    libraryId: 1,
    itemId: 10,
    itemKey: "PARENT",
    title: "Paper A",
    attachmentId: 20,
    attachmentKey: "PDF_A",
    status: "ok" as const,
    pdf: true,
    preciseRunning: true,
    liteRunning: false,
  };
  return {
    tabs: [tab],
    readers: [
      { ...tab, readerInstanceId: "reader-a", selectedRawIndexes: [1, 0] },
    ],
  };
}

/** 注入真实格式化所需的固定存储内容。 */
function storage() {
  return {
    async readParseStatus() {
      return { preciseReady: true, liteReady: false };
    },
    async readBoxes() {
      return normalizedBoxes;
    },
  };
}

describe("reader context query service", function () {
  it("reports ready results while a replacement is running", async function () {
    const service = createReaderQueryService({
      snapshot: context,
      storage: storage(),
    });
    const result = await service.listTabs("all");
    assert.equal(result.tabs[0].itemKey, "PARENT");
    assert.equal(result.tabs[0].attachmentKey, "PDF_A");
    assert.deepEqual(result.tabs[0].parseStatus, {
      preciseReady: true,
      liteReady: false,
      preciseRunning: true,
      liteRunning: false,
      preferredMode: "precise",
    });
    assert.notProperty(result.tabs[0], "pdf");
  });

  it("keeps failed parse status separate from an unparsed attachment", async function () {
    const deps = storage();
    deps.readParseStatus = async () => {
      throw new Error("private profile path");
    };
    const result = await createReaderQueryService({
      snapshot: context,
      storage: deps,
    }).listTabs();
    assert.equal(result.tabs[0].status, "parse-status-unavailable");
    assert.isNull(result.tabs[0].parseStatus);
    assert.notInclude(JSON.stringify(result), "private profile path");
  });

  it("returns all selected pages in original rawIndex order", async function () {
    const result = await createReaderQueryService({
      snapshot: context,
      storage: storage(),
    }).selectedBoxes();
    assert.deepEqual(
      result.readers[0].boxes.map((box) => box.rawIndex),
      [0, 1],
    );
    assert.equal(result.readers[0].markdown, "第一段\n\n第二段");
    assert.notProperty(result.readers[0], "selectedRawIndexes");
  });

  it("does not read storage or fall back to full text for empty selection", async function () {
    const snapshot = context();
    snapshot.readers[0].selectedRawIndexes = [];
    const deps = storage();
    deps.readBoxes = async () => {
      throw new Error("must not read storage");
    };
    const result = await createReaderQueryService({
      snapshot: () => snapshot,
      storage: deps,
    }).selectedBoxes();
    assert.equal(result.readers[0].status, "empty-selection");
    assert.equal(result.readers[0].markdown, "");
  });

  it("preserves other readers and content when selected indexes are stale", async function () {
    const snapshot = context();
    snapshot.readers.push({
      ...snapshot.readers[0],
      readerInstanceId: "reader-b",
      selectedRawIndexes: [9, 0],
    });
    const result = await createReaderQueryService({
      snapshot: () => snapshot,
      storage: storage(),
    }).selectedBoxes("all");
    assert.equal(result.readers[0].status, "ok");
    assert.equal(result.readers[1].status, "stale-selection");
    assert.equal(result.readers[1].selectedCount, 2);
    assert.deepEqual(result.readers[1].missingRawIndexes, [9]);
    assert.equal(result.readers[1].markdown, "第一段");
  });

  it("isolates unavailable box results to their reader", async function () {
    const snapshot = context();
    snapshot.readers.push({
      ...snapshot.readers[0],
      attachmentKey: "MISSING",
      readerInstanceId: "reader-b",
    });
    const deps = {
      ...storage(),
      async readBoxes(ref: { key: string }) {
        if (ref.key === "MISSING") throw new Error("private path");
        return normalizedBoxes;
      },
    };
    const result = await createReaderQueryService({
      snapshot: () => snapshot,
      storage: deps,
    }).selectedBoxes("all");
    assert.equal(result.readers[0].status, "ok");
    assert.equal(result.readers[1].status, "parse-result-unavailable");
    assert.notInclude(JSON.stringify(result), "private path");
  });

  it("copies selection before awaiting storage", async function () {
    const snapshot = context();
    const deps = {
      ...storage(),
      async readBoxes() {
        snapshot.readers[0].selectedRawIndexes.splice(0);
        return normalizedBoxes;
      },
    };
    const result = await createReaderQueryService({
      snapshot: () => snapshot,
      storage: deps,
    }).selectedBoxes();
    assert.equal(result.readers[0].selectedCount, 2);
    assert.lengthOf(result.readers[0].boxes, 2);
  });
});
