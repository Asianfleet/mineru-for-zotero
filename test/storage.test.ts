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

  it("writes failed results without marking the attachment ready", async function () {
    const storage = createStorage(rootDir);
    const attachment = {
      id: 1,
      key: "FAILED",
      libraryID: 12,
      fileName: "a.pdf",
      filePath: "a.pdf",
      mtime: 1,
    };

    await storage.writeFailedResult({
      attachment,
      mineruTaskID: "task-empty",
      rawResult: { content_list: [{ type: "text" }] },
      markdown: "# No boxes",
      error: "解析结果缺少 box 信息",
    });

    const manifest = await storage.readManifest(attachment);

    assert.isFalse(await storage.hasReadyResult(attachment));
    assert.equal(manifest.status, "failed");
    assert.equal(manifest.error, "解析结果缺少 box 信息");
    await assertRejects(
      () => storage.readBoxes(attachment),
      "MinerU result is not ready: failed",
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

  it("keeps the old result files readable when replacement fails", async function () {
    let stage = "setup";
    const storage = createStorage(rootDir);
    const attachment = {
      id: 1,
      key: "RESTORE",
      libraryID: 12,
      fileName: "a.pdf",
      filePath: "a.pdf",
      mtime: 1,
    };

    try {
      stage = "write old result";
      await writeResultOrFail(storage, {
        attachment,
        mineruTaskID: "task-old",
        rawResult: { ok: true, version: "old" },
        markdown: "# Old",
        boxes: normalizedBoxes,
      });

      stage = "write replacement";
      await withSecondMoveFailure(async () => {
        let failed = false;
        try {
          await storage.writeResult({
            attachment: { ...attachment, mtime: 2 },
            mineruTaskID: "task-new",
            rawResult: { ok: true, version: "new" },
            markdown: "# New",
            boxes: [normalizedBoxes[1]],
          });
        } catch {
          failed = true;
        }
        assert.isTrue(failed, "replacement write should fail");
      });

      stage = "read manifest";
      const manifest = await storage.readManifest(attachment);
      const dir = resolveTmpPath(storage.getAttachmentDir(attachment));

      stage = "assert restored manifest";
      assert.equal(manifest.mineruTaskID, "task-old");
      stage = "assert restored boxes";
      assert.deepEqual(await storage.readBoxes(attachment), normalizedBoxes);
      stage = "assert restored raw result";
      assert.deepEqual(await readJson(joinPath(dir, "mineru-result.json")), {
        ok: true,
        version: "old",
      });
      stage = "assert restored markdown";
      assert.equal(await readText(joinPath(dir, "content.md")), "# Old");
    } catch (error) {
      assert.fail(`${stage}: ${describeError(error)}`);
    }
  });

  it("does not count leaked temporary or backup result directories", async function () {
    const storage = createStorage("TmpD/mineru-copy-count");
    const attachment = {
      id: 1,
      key: "COUNT",
      libraryID: 12,
      fileName: "a.pdf",
      filePath: "a.pdf",
      mtime: 1,
    };

    await writeResultOrFail(storage, {
      attachment,
      mineruTaskID: "task-ready",
      rawResult: { ok: true },
      markdown: "# Ready",
      boxes: normalizedBoxes,
    });
    await writeResultDir(
      `${storage.getAttachmentDir(attachment)}.tmp-leak`,
      attachment,
      "task-tmp",
    );
    await writeResultDir(
      `${storage.getAttachmentDir(attachment)}.bak-leak`,
      attachment,
      "task-bak",
    );

    assert.equal(await storage.countReadyResults(), 1);
  });

  it("refreshes stale normalized boxes from the raw MinerU result", async function () {
    const storage = createStorage(rootDir);
    const attachment = {
      id: 1,
      key: "STALE",
      libraryID: 12,
      fileName: "a.pdf",
      filePath: "a.pdf",
      mtime: 1,
    };

    await writeResultOrFail(storage, {
      attachment,
      mineruTaskID: "task-1",
      rawResult: {
        pdf_info: [
          {
            page_idx: 0,
            page_size: [1000, 2000],
            para_blocks: [
              { type: "text", bbox: [100, 100, 500, 200], text: "Body" },
              {
                type: "image",
                bbox: [100, 300, 500, 600],
                blocks: [
                  {
                    type: "image_caption",
                    bbox: [100, 620, 500, 700],
                    lines: [{ spans: [{ content: "Figure 1: caption" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      markdown: "Body",
      boxes: [normalizedBoxes[0]],
    });

    const boxes = await storage.readBoxes(attachment);

    assert.isAbove(boxes.length, 1);
    assert.isTrue(boxes.some((box) => box.markdown === "Figure 1: caption"));
  });

  it("refreshes stale normalized boxes when the raw MinerU types become more detailed", async function () {
    const storage = createStorage(rootDir);
    const attachment = {
      id: 1,
      key: "DETAIL",
      libraryID: 12,
      fileName: "a.pdf",
      filePath: "a.pdf",
      mtime: 1,
    };

    await writeResultOrFail(storage, {
      attachment,
      mineruTaskID: "task-1",
      rawResult: {
        pdf_info: [
          {
            page_idx: 0,
            page_size: [1000, 2000],
            para_blocks: [
              { type: "text", bbox: [100, 100, 500, 200], text: "Body" },
              {
                type: "image_caption",
                bbox: [100, 300, 500, 360],
                lines: [{ spans: [{ content: "Figure 1: caption" }] }],
              },
            ],
          },
        ],
      },
      markdown: "Body",
      boxes: [
        {
          rawIndex: 0,
          page: 1,
          type: "text",
          bbox: { x: 0.1, y: 0.05, width: 0.4, height: 0.05 },
          markdown: "Body",
          formula: null,
        },
        {
          rawIndex: 1,
          page: 1,
          type: "text",
          bbox: { x: 0.1, y: 0.15, width: 0.4, height: 0.03 },
          markdown: "Figure 1: caption",
          formula: null,
        },
      ],
    });

    const boxes = await storage.readBoxes(attachment);

    assert.deepEqual(
      boxes.map((box) => box.type),
      ["text", "image_caption"],
    );
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

async function assertRejects(
  callback: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await callback();
    assert.fail("Expected promise to reject");
  } catch (error) {
    assert.include(describeError(error), expectedMessage);
  }
}

async function withSecondMoveFailure(
  callback: () => Promise<void>,
): Promise<void> {
  const originalIOUtilsMove =
    typeof IOUtils !== "undefined" ? IOUtils.move : null;
  const runtime = globalThis as typeof globalThis & {
    OS?: typeof OS;
  };
  const originalOSFileMove = runtime.OS?.File?.move ?? null;
  let moveCount = 0;
  const failOnSecondMove = (): void => {
    moveCount += 1;
    if (moveCount === 2) {
      throw new Error("simulated replacement move failure");
    }
  };

  if (originalIOUtilsMove) {
    (IOUtils as typeof IOUtils & { move: typeof IOUtils.move }).move = async (
      from,
      to,
    ) => {
      failOnSecondMove();
      return originalIOUtilsMove.call(IOUtils, from, to);
    };
  } else if (originalOSFileMove && runtime.OS?.File) {
    runtime.OS.File.move = async (from, to, options) => {
      failOnSecondMove();
      return originalOSFileMove.call(runtime.OS?.File, from, to, options);
    };
  }

  try {
    await callback();
  } finally {
    if (originalIOUtilsMove) {
      (IOUtils as typeof IOUtils & { move: typeof IOUtils.move }).move =
        originalIOUtilsMove;
    }
    if (!originalIOUtilsMove && originalOSFileMove && runtime.OS?.File) {
      runtime.OS.File.move = originalOSFileMove;
    }
  }
}

async function writeResultDir(
  dir: string,
  attachment: {
    id: number;
    key: string;
    libraryID: number;
    fileName: string;
    mtime: number;
  },
  taskID: string,
): Promise<void> {
  const path = resolveTmpPath(dir);
  await writeText(
    joinPath(path, "manifest.json"),
    `${JSON.stringify(
      {
        attachmentID: attachment.id,
        attachmentKey: attachment.key,
        libraryID: attachment.libraryID,
        fileName: attachment.fileName,
        pdfMtime: attachment.mtime,
        parsedAt: new Date().toISOString(),
        mineruTaskID: taskID,
        resultVersion: 1,
        status: "ready",
      },
      null,
      2,
    )}\n`,
  );
  await writeText(joinPath(path, "mineru-result.json"), "{}\n");
  await writeText(joinPath(path, "content.md"), "# Leak");
  await writeText(joinPath(path, "boxes.normalized.json"), "[]\n");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readText(path));
}

async function readText(path: string): Promise<string> {
  if (typeof IOUtils !== "undefined") {
    return IOUtils.readUTF8(path);
  }
  const runtime = globalThis as typeof globalThis & { OS?: typeof OS };
  if (!runtime.OS) {
    throw new Error("No text file reader is available");
  }
  const value = await runtime.OS.File.read(path, { encoding: "utf-8" });
  return typeof value === "string"
    ? value
    : new TextDecoder().decode(value as BufferSource);
}

async function writeText(path: string, value: string): Promise<void> {
  const dir = dirname(path);
  if (typeof IOUtils !== "undefined") {
    await IOUtils.makeDirectory(dir, {
      createAncestors: true,
      ignoreExisting: true,
    });
    await IOUtils.writeUTF8(path, value, { tmpPath: `${path}.tmp` });
    return;
  }
  const runtime = globalThis as typeof globalThis & { OS?: typeof OS };
  if (!runtime.OS) {
    throw new Error("No text file writer is available");
  }
  await runtime.OS.File.makeDir(dir, { ignoreExisting: true });
  await runtime.OS.File.writeAtomic(path, value, {
    encoding: "utf-8",
    tmpPath: `${path}.tmp`,
  });
}

function resolveTmpPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.startsWith("TmpD/")) {
    return toNativePath(normalized);
  }

  const rest = normalized.slice("TmpD/".length).split("/");
  if (typeof PathUtils !== "undefined") {
    return PathUtils.join(PathUtils.tempDir, ...rest);
  }
  const runtime = globalThis as typeof globalThis & { OS?: typeof OS };
  if (!runtime.OS) {
    throw new Error("No temporary directory service is available");
  }
  return runtime.OS.Path.join(runtime.OS.Constants.Path.tmpDir, ...rest);
}

function joinPath(...parts: string[]): string {
  return toNativePath(
    parts.filter(Boolean).join("/").replace(/\\/g, "/").replace(/\/+/g, "/"),
  );
}

function toNativePath(path: string): string {
  if (/^[a-z]:\//i.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return toNativePath(index === -1 ? "." : normalized.slice(0, index));
}
