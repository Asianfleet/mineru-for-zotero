import { assert } from "chai";
import {
  clearAttachmentParseRunning,
  createEmptyParseColumnStatus,
  createMinerUParseColumnRegistration,
  getAttachmentStatusKey,
  getMinerUParseColumnToken,
  markAttachmentParseReady,
  markAttachmentParseRunning,
  registerItemTreeColumn,
  renderMinerUParseCell,
  unregisterItemTreeColumn,
  type ParseColumnStatus,
} from "../src/modules/itemTreeColumn";
import type { StorageAdapter } from "../src/modules/storage";

const originalAddon = globalThis.addon;

describe("itemTreeColumn", function () {
  afterEach(function () {
    if (typeof originalAddon === "undefined") {
      Reflect.deleteProperty(globalThis, "addon");
      return;
    }
    globalThis.addon = originalAddon;
  });

  it("uses libraryID and attachment key as the parse column status key", function () {
    assert.equal(
      getAttachmentStatusKey({ libraryID: 12, key: "ABC123" }),
      "12-ABC123",
    );
  });

  it("returns an empty token for regular items and non-PDF attachments", function () {
    const statuses = new Map<string, ParseColumnStatus>();

    assert.equal(getMinerUParseColumnToken(regularItem(), statuses), "");
    assert.equal(getMinerUParseColumnToken(nonPdfAttachment(), statuses), "");
  });

  it("returns precise and lite tokens in a stable order", function () {
    const statuses = new Map<string, ParseColumnStatus>([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "ready",
        },
      ],
    ]);

    assert.equal(
      getMinerUParseColumnToken(pdfAttachment(), statuses),
      "precise|lite",
    );
  });

  it("returns running tokens for the mode currently being parsed", function () {
    const statuses = new Map<string, ParseColumnStatus>([
      [
        "12-ABC123",
        {
          precise: "ready",
          lite: "running",
        },
      ],
    ]);

    assert.equal(
      getMinerUParseColumnToken(pdfAttachment(), statuses),
      "precise|lite-running",
    );
  });

  it("creates an empty parse column status", function () {
    assert.deepEqual(createEmptyParseColumnStatus(), {
      precise: "none",
      lite: "none",
    });
  });

  it("creates a Zotero item tree column registration", function () {
    const statuses = new Map<string, ParseColumnStatus>();
    const registration = createMinerUParseColumnRegistration({
      statuses,
      getString: (id) => id,
    });

    assert.equal(registration.dataKey, "mineruParseStatus");
    assert.equal(registration.label, "item-tree-column-mineru-parse");
    assert.equal(
      registration.pluginID,
      "mineru-for-zotero@asianfleet.github.io",
    );
    assert.deepEqual(registration.enabledTreeIDs, ["main"]);
    assert.equal(registration.width, "140");
    assert.deepEqual(registration.zoteroPersist, ["width", "hidden"]);
  });

  it("renders ready and running badges from a token", function () {
    const cell = renderMinerUParseCell(
      0,
      "precise|lite-running",
      {
        className: "custom-column",
      } as Parameters<typeof renderMinerUParseCell>[2],
      false,
      document,
      (id) => {
        const values: Record<string, string> = {
          "item-tree-column-mineru-parse-precise": "精准",
          "item-tree-column-mineru-parse-lite": "轻量",
          "item-tree-column-mineru-parse-running": "解析中",
        };
        return values[id] ?? id;
      },
    );

    assert.equal(cell.className, "custom-column mineru-parse-column-cell");
    assert.equal(
      cell.firstElementChild?.className,
      "mineru-parse-column-badges",
    );
    assert.deepEqual(
      Array.from(cell.querySelectorAll(".mineru-parse-column-badge")).map(
        (badge) => badge.textContent,
      ),
      ["精准", "轻量(解析中)"],
    );
    assert.deepEqual(
      Array.from(cell.querySelectorAll(".mineru-parse-column-badge")).map(
        (badge) => Array.from(badge.classList),
      ),
      [
        ["mineru-parse-column-badge", "mineru-parse-column-badge-precise"],
        [
          "mineru-parse-column-badge",
          "mineru-parse-column-badge-lite",
          "mineru-parse-column-badge-running",
        ],
      ],
    );
  });

  it("renders badges when Zotero calls renderCell without a document argument", function () {
    const cell = renderMinerUParseCell(
      0,
      "precise",
      {
        className: "custom-column",
      } as Parameters<typeof renderMinerUParseCell>[2],
      false,
      undefined,
      (id) => {
        const values: Record<string, string> = {
          "item-tree-column-mineru-parse-precise": "精准",
        };
        return values[id] ?? id;
      },
    );

    assert.equal(cell.className, "custom-column mineru-parse-column-cell");
    assert.equal(
      cell.querySelector(".mineru-parse-column-badge-precise")?.textContent,
      "精准",
    );
  });

  it("renders an empty cell for an empty token", function () {
    const cell = renderMinerUParseCell(
      0,
      "",
      {
        className: "custom-column",
      } as Parameters<typeof renderMinerUParseCell>[2],
      false,
      document,
      () => "",
    );

    assert.equal(cell.textContent, "");
    assert.equal(cell.childElementCount, 0);
    assert.isNull(cell.querySelector(".mineru-parse-column-badges"));
  });

  it("registers the column, hydrates ready statuses, and refreshes columns", async function () {
    ensureAddonRuntime();
    let refreshCount = 0;
    let receivedRegistration:
      | ReturnType<typeof createMinerUParseColumnRegistration>
      | undefined;

    await registerItemTreeColumn({
      itemTreeManager: {
        registerColumn: (options) => {
          receivedRegistration = options;
          return "registered-key";
        },
        unregisterColumn: () => true,
        refreshColumns: () => {
          refreshCount += 1;
        },
      },
      storage: {
        ...fakeStorage(),
        listParseStatuses: async () =>
          new Map([
            [
              "12-ABC123",
              {
                preciseReady: true,
                liteReady: false,
              },
            ],
          ]),
      },
      getString: (id) => id,
      log: () => {},
    });

    assert.equal(
      getAddonData().itemTreeColumn?.registeredDataKey,
      "registered-key",
    );
    assert.deepEqual(getAddonData().itemTreeColumn?.statuses.get("12-ABC123"), {
      precise: "ready",
      lite: "none",
    });
    assert.equal(receivedRegistration?.dataKey, "mineruParseStatus");
    assert.equal(refreshCount, 1);
  });

  it("logs and keeps startup alive when column registration fails", async function () {
    ensureAddonRuntime();
    const logs: unknown[][] = [];

    await registerItemTreeColumn({
      itemTreeManager: {
        registerColumn: () => {
          throw new Error("registration failed");
        },
        unregisterColumn: () => true,
        refreshColumns: () => {},
      },
      getString: (id) => id,
      log: (...args) => {
        logs.push(args);
      },
    });

    assert.isUndefined(getAddonData().itemTreeColumn?.registeredDataKey);
    assert.equal(logs[0][0], "failed to register MinerU parse column");
  });

  it("marks a mode as running while preserving the other ready mode", async function () {
    ensureAddonRuntime();
    getAddonData().itemTreeColumn = {
      statuses: new Map([
        [
          "12-ABC123",
          {
            precise: "ready",
            lite: "none",
          },
        ],
      ]),
    };
    let refreshCount = 0;

    await markAttachmentParseRunning({ libraryID: 12, key: "ABC123" }, "lite", {
      itemTreeManager: fakeItemTreeManager(() => {
        refreshCount += 1;
      }),
    });

    assert.deepEqual(getAddonData().itemTreeColumn?.statuses.get("12-ABC123"), {
      precise: "ready",
      lite: "running",
    });
    assert.equal(refreshCount, 1);
  });

  it("marks a mode as ready after a successful parse", async function () {
    ensureAddonRuntime();
    getAddonData().itemTreeColumn = {
      statuses: new Map([
        [
          "12-ABC123",
          {
            precise: "none",
            lite: "running",
          },
        ],
      ]),
    };

    await markAttachmentParseReady({ libraryID: 12, key: "ABC123" }, "lite", {
      itemTreeManager: fakeItemTreeManager(),
    });

    assert.deepEqual(getAddonData().itemTreeColumn?.statuses.get("12-ABC123"), {
      precise: "none",
      lite: "ready",
    });
  });

  it("clears running status by re-reading disk ready status", async function () {
    ensureAddonRuntime();
    getAddonData().itemTreeColumn = {
      statuses: new Map([
        [
          "12-ABC123",
          {
            precise: "ready",
            lite: "running",
          },
        ],
      ]),
    };

    await clearAttachmentParseRunning(
      { libraryID: 12, key: "ABC123" },
      "lite",
      {
        itemTreeManager: fakeItemTreeManager(),
        storage: {
          ...fakeStorage(),
          readParseStatus: async () => ({
            preciseReady: true,
            liteReady: false,
          }),
        },
      },
    );

    assert.deepEqual(getAddonData().itemTreeColumn?.statuses.get("12-ABC123"), {
      precise: "ready",
      lite: "none",
    });
  });

  it("falls back to clearing only the current running mode when disk status refresh fails", async function () {
    ensureAddonRuntime();
    getAddonData().itemTreeColumn = {
      statuses: new Map([
        [
          "12-ABC123",
          {
            precise: "ready",
            lite: "running",
          },
        ],
      ]),
    };

    await clearAttachmentParseRunning(
      { libraryID: 12, key: "ABC123" },
      "lite",
      {
        itemTreeManager: fakeItemTreeManager(),
        storage: {
          ...fakeStorage(),
          readParseStatus: async () => {
            throw new Error("disk unavailable");
          },
        },
      },
    );

    assert.deepEqual(getAddonData().itemTreeColumn?.statuses.get("12-ABC123"), {
      precise: "ready",
      lite: "none",
    });
  });

  it("unregisters the registered MinerU parse column and clears runtime state", function () {
    ensureAddonRuntime();
    getAddonData().itemTreeColumn = {
      registeredDataKey: "registered-key",
      statuses: new Map([
        [
          "12-ABC123",
          {
            precise: "ready",
            lite: "none",
          },
        ],
      ]),
    };
    const unregisteredKeys: string[] = [];

    unregisterItemTreeColumn({
      itemTreeManager: {
        registerColumn: () => "registered-key",
        unregisterColumn: (dataKey) => {
          unregisteredKeys.push(dataKey);
          return true;
        },
        refreshColumns: () => {},
      },
      log: () => {},
    });

    assert.deepEqual(unregisteredKeys, ["registered-key"]);
    assert.isUndefined(getAddonData().itemTreeColumn);
  });
});

function pdfAttachment(): Zotero.Item {
  return {
    id: 1,
    key: "ABC123",
    libraryID: 12,
    isAttachment: () => true,
    isPDFAttachment: () => true,
  } as unknown as Zotero.Item;
}

function nonPdfAttachment(): Zotero.Item {
  return {
    key: "ABC123",
    libraryID: 12,
    isAttachment: () => true,
    isPDFAttachment: () => false,
  } as unknown as Zotero.Item;
}

function regularItem(): Zotero.Item {
  return {
    key: "ITEM123",
    libraryID: 12,
    isAttachment: () => false,
    isPDFAttachment: () => false,
  } as unknown as Zotero.Item;
}

function fakeItemTreeManager(onRefresh: () => void = () => {}) {
  return {
    registerColumn: () => "registered-key",
    unregisterColumn: () => true,
    refreshColumns: onRefresh,
  };
}

function fakeStorage(): StorageAdapter {
  return {
    getAttachmentDir: () => "",
    hasReadyResult: async () => false,
    hasLiteResult: async () => false,
    readParseStatus: async () => ({ preciseReady: false, liteReady: false }),
    listParseStatuses: async () => new Map(),
    readManifest: async () => {
      throw new Error("not needed");
    },
    readMarkdown: async () => "",
    readPreferredMarkdown: async () => "",
    readBoxes: async () => [],
    writeResult: async () => {},
    writeFailedResult: async () => {},
    writeLiteResult: async () => {},
    countReadyResults: async () => 0,
    openDataFolder: async () => {},
  };
}

function getAddonData(): typeof globalThis.addon.data {
  if (typeof globalThis.addon === "undefined") {
    throw new Error("addon runtime is not initialized");
  }
  return globalThis.addon.data;
}

function ensureAddonRuntime(): void {
  if (typeof globalThis.addon !== "undefined") {
    return;
  }

  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          itemTreeColumn?: {
            registeredDataKey?: string;
            statuses: Map<string, ParseColumnStatus>;
          };
          config: {
            addonID: string;
          };
        };
      };
    }
  ).addon = {
    data: {
      config: {
        addonID: "mineru-for-zotero@asianfleet.github.io",
      },
    },
  };
}
