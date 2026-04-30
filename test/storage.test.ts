import { assert } from "chai";
import { createStorage } from "../src/modules/storage";
import { normalizedBoxes } from "./domainFixtures";

const rootDir = "TmpD/mineru-copy";

describe("storage", function () {
  it("uses libraryID and attachmentKey as stable directory name", function () {
    const storage = createStorage(rootDir);

    assert.equal(
      storage.getAttachmentDir({ libraryID: 12, key: "ABC123" }),
      "TmpD/mineru-copy/attachments/12-ABC123",
    );
  });

  it("writes and reads ready result", async function () {
    const storage = createStorage(rootDir);

    await writeResultOrFail(storage, {
      attachment: {
        id: 1,
        key: "ABC123",
        libraryID: 12,
        fileName: "a.pdf",
        filePath: "a.pdf",
        mtime: 1,
      },
      mineruTaskID: "task-1",
      rawResult: { ok: true },
      markdown: "# A",
      boxes: normalizedBoxes,
    });

    const manifest = await storage.readManifest({
      libraryID: 12,
      key: "ABC123",
    });

    assert.isTrue(
      await storage.hasReadyResult({ libraryID: 12, key: "ABC123" }),
    );
    assert.equal(manifest.status, "ready");
    assert.equal(manifest.attachmentID, 1);
    assert.equal(manifest.attachmentKey, "ABC123");
    assert.equal(manifest.libraryID, 12);
    assert.equal(manifest.fileName, "a.pdf");
    assert.equal(manifest.pdfMtime, 1);
    assert.equal(manifest.mineruTaskID, "task-1");
    assert.equal(manifest.resultVersion, 1);
    assert.deepEqual(
      await storage.readBoxes({ libraryID: 12, key: "ABC123" }),
      normalizedBoxes,
    );
  });

  it("reports missing or non-ready results as not ready", async function () {
    const storage = createStorage(rootDir);

    assert.isFalse(
      await storage.hasReadyResult({ libraryID: 12, key: "MISSING" }),
    );
  });

  it("replaces old results when writing the same attachment again", async function () {
    const storage = createStorage(rootDir);
    const attachment = {
      id: 1,
      key: "ABC123",
      libraryID: 12,
      fileName: "a.pdf",
      filePath: "a.pdf",
      mtime: 1,
    };

    await writeResultOrFail(storage, {
      attachment,
      mineruTaskID: "task-1",
      rawResult: { ok: true },
      markdown: "# Old",
      boxes: normalizedBoxes,
    });
    await writeResultOrFail(storage, {
      attachment: { ...attachment, mtime: 2 },
      mineruTaskID: "task-2",
      rawResult: { ok: true, version: 2 },
      markdown: "# New",
      boxes: [normalizedBoxes[1]],
    });

    const manifest = await storage.readManifest({
      libraryID: 12,
      key: "ABC123",
    });

    assert.equal(manifest.pdfMtime, 2);
    assert.equal(manifest.mineruTaskID, "task-2");
    assert.deepEqual(await storage.readBoxes(attachment), [normalizedBoxes[1]]);
  });
});

async function writeResultOrFail(
  storage: ReturnType<typeof createStorage>,
  input: Parameters<ReturnType<typeof createStorage>["writeResult"]>[0],
): Promise<void> {
  try {
    await storage.writeResult(input);
  } catch (error) {
    assert.fail(`writeResult failed: ${describeError(error)}`);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return JSON.stringify(error);
}
