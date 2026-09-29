import { assert } from "chai";
import {
  scanAllResults,
  deleteResultEntry,
  cleanOrphans,
  ParsedResultEntry,
  ResultsManagerDependencies,
} from "../src/modules/resultsManager";
import { StorageAdapter } from "../src/modules/storage";

describe("Results Manager", function () {
  let mockStorage: Partial<StorageAdapter>;
  let deps: ResultsManagerDependencies;

  beforeEach(function () {
    mockStorage = {
      listParseStatuses: async () => new Map(),
      readManifestSafe: async () => null,
      readLiteManifestSafe: async () => null,
      getAttachmentDirSize: async () => 1024,
      readResultContentFlags: async () => ({
        hasImages: false,
        hasBoxes: false,
      }),
      deleteResult: async () => {},
    };

    deps = {
      storage: mockStorage as StorageAdapter,
      getItemByLibraryAndKey: async () => undefined,
      getItemAsync: async () => undefined,
      selectItemInLibrary: async () => {},
      removeItemTag: async () => {},
      eraseItem: async () => {},
      revealFolder: async () => {},
    };
  });

  describe("scanAllResults", function () {
    it("scanAllResults with empty storage returns empty array", async function () {
      const results = await scanAllResults(deps);
      assert.strictEqual(results.length, 0);
    });

    it("scanAllResults with valid entries returns correct data", async function () {
      mockStorage.listParseStatuses = async () =>
        new Map([
          ["1-ABC", { preciseReady: true, liteReady: false }],
          ["1-DEF", { preciseReady: false, liteReady: true }],
        ]);

      deps.getItemByLibraryAndKey = async (libraryID, key) => {
        if (key === "ABC")
          return {
            id: 101,
            getField: () => "Test ABC",
            getFilename: () => "abc.pdf",
          };
        if (key === "DEF")
          return {
            id: 102,
            getField: () => "Test DEF",
            getFilename: () => "def.pdf",
          };
        return undefined;
      };

      const results = await scanAllResults(deps);
      assert.strictEqual(results.length, 2);

      const abc = results.find((r) => r.key === "ABC");
      assert.ok(abc);
      assert.strictEqual(abc.libraryID, 1);
      assert.strictEqual(abc.attachmentID, 101);
      assert.strictEqual(abc.title, "Test ABC");
      assert.strictEqual(abc.isOrphan, false);
      assert.strictEqual(abc.preciseReady, true);
    });

    it("scanAllResults detects orphans (getItemByLibraryAndKey returns false)", async function () {
      mockStorage.listParseStatuses = async () =>
        new Map([["1-ORPHAN", { preciseReady: true, liteReady: false }]]);

      const results = await scanAllResults(deps);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.isOrphan, true);
    });

    it("scanAllResults sorts by parsedAt descending", async function () {
      mockStorage.listParseStatuses = async () =>
        new Map([
          ["1-OLD", { preciseReady: true, liteReady: false }],
          ["1-NEW", { preciseReady: true, liteReady: false }],
        ]);

      mockStorage.readManifestSafe = async (ref) => {
        if (ref.key === "OLD")
          return { parsedAt: "2023-01-01T00:00:00Z" } as any;
        if (ref.key === "NEW")
          return { parsedAt: "2024-01-01T00:00:00Z" } as any;
        return null;
      };

      const results = await scanAllResults(deps);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0]?.key, "NEW");
      assert.strictEqual(results[1]?.key, "OLD");
    });

    it("derives hasImages and hasBoxes from the stored result content", async function () {
      mockStorage.listParseStatuses = async () =>
        new Map([
          ["1-WITHIMG", { preciseReady: true, liteReady: false }],
          ["1-LITEONLY", { preciseReady: false, liteReady: true }],
        ]);
      mockStorage.readResultContentFlags = async (ref) =>
        ref.key === "WITHIMG"
          ? { hasImages: true, hasBoxes: false }
          : { hasImages: true, hasBoxes: true };

      const results = await scanAllResults(deps);
      const withImages = results.find((entry) => entry.key === "WITHIMG");
      const liteOnly = results.find((entry) => entry.key === "LITEONLY");

      assert.isTrue(withImages?.hasImages);
      assert.isFalse(withImages?.hasBoxes);
      // A lite result has no stored boxes or images, whatever storage reports.
      assert.isFalse(liteOnly?.hasImages);
      assert.isFalse(liteOnly?.hasBoxes);
    });
  });

  describe("deleteResultEntry", function () {
    it("deleteResultEntry with removeTags calls removeItemTag", async function () {
      const removedTags: string[] = [];
      deps.removeItemTag = async (id, tag) => {
        removedTags.push(tag);
      };
      let deletedStorage = false;
      mockStorage.deleteResult = async () => {
        deletedStorage = true;
      };

      const entry: ParsedResultEntry = {
        libraryID: 1,
        key: "KEY",
        attachmentID: 101,
        isOrphan: false,
        preciseReady: true,
        liteReady: false,
        sizeBytes: 10,
      };

      await deleteResultEntry(entry, { removeTags: true }, deps);
      assert.ok(deletedStorage);
      assert.strictEqual(removedTags.length, 5); // 5 MINERU_TAGS
    });

    it("deleteResultEntry without removeTags skips tag operations", async function () {
      const removedTags: string[] = [];
      deps.removeItemTag = async (id, tag) => {
        removedTags.push(tag);
      };

      const entry: ParsedResultEntry = {
        libraryID: 1,
        key: "KEY",
        attachmentID: 101,
        isOrphan: false,
        preciseReady: true,
        liteReady: false,
        sizeBytes: 10,
      };

      await deleteResultEntry(entry, { removeTags: false }, deps);
      assert.strictEqual(removedTags.length, 0);
    });

    it("deleteResultEntry for orphan (no attachmentID) only deletes storage", async function () {
      const removedTags: string[] = [];
      deps.removeItemTag = async (id, tag) => {
        removedTags.push(tag);
      };
      let deletedStorage = false;
      mockStorage.deleteResult = async () => {
        deletedStorage = true;
      };

      const entry: ParsedResultEntry = {
        libraryID: 1,
        key: "ORPHAN",
        isOrphan: true,
        preciseReady: true,
        liteReady: false,
        sizeBytes: 10,
      };

      await deleteResultEntry(entry, { removeTags: true }, deps);
      assert.ok(deletedStorage);
      assert.strictEqual(removedTags.length, 0);
    });
  });

  describe("cleanOrphans", function () {
    it("cleanOrphans deletes only orphaned entries", async function () {
      const deletedRefs: string[] = [];
      mockStorage.deleteResult = async (ref) => {
        deletedRefs.push(ref.key);
      };

      const entries: ParsedResultEntry[] = [
        {
          libraryID: 1,
          key: "VALID",
          isOrphan: false,
          preciseReady: true,
          liteReady: false,
          sizeBytes: 0,
        },
        {
          libraryID: 1,
          key: "ORPHAN1",
          isOrphan: true,
          preciseReady: true,
          liteReady: false,
          sizeBytes: 0,
        },
        {
          libraryID: 1,
          key: "ORPHAN2",
          isOrphan: true,
          preciseReady: true,
          liteReady: false,
          sizeBytes: 0,
        },
      ];

      const count = await cleanOrphans(entries, deps);
      assert.strictEqual(count, 2);
      assert.deepStrictEqual(deletedRefs, ["ORPHAN1", "ORPHAN2"]);
    });

    it("cleanOrphans with no orphans returns count 0", async function () {
      const deletedRefs: string[] = [];
      mockStorage.deleteResult = async (ref) => {
        deletedRefs.push(ref.key);
      };

      const entries: ParsedResultEntry[] = [
        {
          libraryID: 1,
          key: "VALID",
          isOrphan: false,
          preciseReady: true,
          liteReady: false,
          sizeBytes: 0,
        },
      ];

      const count = await cleanOrphans(entries, deps);
      assert.strictEqual(count, 0);
      assert.strictEqual(deletedRefs.length, 0);
    });
  });

  describe("createResultsManagerService", function () {
    it("provides scan, deleteResult, and cleanOrphans with freedBytes", async function () {
      const deletedRefs: string[] = [];
      mockStorage.listParseStatuses = async () =>
        new Map([["1-ORPHAN", { preciseReady: true, liteReady: false }]]);
      mockStorage.getAttachmentDirSize = async () => 2048;
      mockStorage.deleteResult = async (ref) => {
        deletedRefs.push(ref.key);
      };
      mockStorage.getAttachmentDir = () => "/fake/path/1-ORPHAN";
      mockStorage.readPreferredMarkdown = async () => "# Hello Markdown";

      const { createResultsManagerService } =
        await import("../src/modules/resultsManager");
      const service = createResultsManagerService(
        mockStorage as StorageAdapter,
      );

      const scanned = await service.scan();
      assert.strictEqual(scanned.length, 1);
      assert.strictEqual(scanned[0]?.isOrphan, true);
      assert.strictEqual(scanned[0]?.attachmentKey, "ORPHAN");
      assert.strictEqual(scanned[0]?.totalSizeBytes, 2048);

      const delRes = await service.deleteResult(scanned[0]!, {
        removeTags: false,
      });
      assert.strictEqual(delRes.freedBytes, 2048);

      const orphanRes = await service.cleanOrphans(scanned);
      assert.strictEqual(orphanRes.count, 1);
      assert.strictEqual(orphanRes.freedBytes, 2048);

      const md = await service.readMarkdown({ libraryID: 1, key: "ORPHAN" });
      assert.strictEqual(md, "# Hello Markdown");
    });
  });

  describe("openResultsManagerWindow", function () {
    it("focuses existing window if already open", async function () {
      let focused = false;
      let opened = false;
      const { openResultsManagerWindow } =
        await import("../src/modules/resultsManager");

      openResultsManagerWindow(undefined, {
        getMainWindow: () => ({
          openDialog: () => {
            opened = true;
          },
        }),
        getMostRecentWindow: (type: string) => {
          if (type === "mineruResultsManager" || type === "mineruTaskManager") {
            return {
              focus: () => {
                focused = true;
              },
            };
          }
          return null;
        },
      });

      assert.strictEqual(focused, true);
      assert.strictEqual(opened, false);
    });

    it("opens dialog with correct chrome URL if not already open", async function () {
      let openedUrl = "";
      let openedArgs: any = null;
      const { openResultsManagerWindow } =
        await import("../src/modules/resultsManager");

      openResultsManagerWindow(undefined, {
        getMainWindow: () => ({
          openDialog: (
            url: string,
            name: string,
            features: string,
            args: any,
          ) => {
            openedUrl = url;
            openedArgs = args;
          },
        }),
        getMostRecentWindow: () => null,
      });

      assert.strictEqual(
        openedUrl,
        "chrome://mineruForZotero/content/taskManager.html",
      );
      assert.ok(openedArgs);
      assert.ok(openedArgs.service);
      assert.strictEqual(openedArgs.initialTab, "results");
    });
  });
});
