import { assert } from "chai";
import {
  createParseManager,
  type ParseManagerDependencies,
} from "../src/modules/parseManager";
import {
  MinerUFileAccessError,
  MinerURequestError,
} from "../src/modules/mineruClient";
import { normalizedBoxes } from "./domainFixtures";

describe("parseManager", function () {
  it("resolves a selected regular item to all of its PDF attachments", async function () {
    const pdfA = pdfAttachment({ id: 1, fileName: "a.pdf" });
    const textAttachment = {
      isAttachment: () => true,
      isPDFAttachment: () => false,
    } as unknown as Zotero.Item;
    const pdfB = pdfAttachment({ id: 2, fileName: "b.pdf" });
    const manager = createParseManager(baseDependencies([]));

    const context = await manager.getItemParseContext(
      regularItem([pdfA, textAttachment, pdfB]),
    );

    assert.equal(context.kind, "regular");
    assert.deepEqual(
      context.kind === "regular"
        ? context.attachments.map((attachment) => attachment.id)
        : [],
      [1, 2],
    );
  });

  it("parses multiple attachments in parallel and confirms existing results once", async function () {
    const messages: string[] = [];
    const started: string[] = [];
    let confirmCount = 0;
    let releaseSubmissions: (() => void) | undefined;
    const bothSubmissionsStarted = new Promise<void>((resolve) => {
      releaseSubmissions = resolve;
    });
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async (attachment) => attachment.id === 1,
      },
      confirmReparse: async () => {
        confirmCount += 1;
        return "reparse";
      },
      client: {
        submitPdf: async (filePath) => {
          started.push(filePath);
          if (started.length === 2) {
            releaseSubmissions?.();
          }
          await bothSubmissionsStarted;
          return { taskID: `task-${started.length}` };
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          rawResult: {
            pages: [
              {
                pageNo: 1,
                width: 1000,
                height: 1000,
                blocks: [
                  { type: "text", bbox: [0, 0, 100, 100], markdown: "A" },
                ],
              },
            ],
          },
          markdown: "A",
        }),
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.equal(confirmCount, 1);
    assert.sameMembers(started, ["C:/tmp/a.pdf", "C:/tmp/b.pdf"]);
  });

  it("skips existing results after a single bulk use-existing choice", async function () {
    const messages: string[] = [];
    const submitted: string[] = [];
    let confirmCount = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async (attachment) => attachment.id === 1,
      },
      confirmReparse: async () => {
        confirmCount += 1;
        return "use-existing";
      },
      client: {
        submitPdf: async (filePath) => {
          submitted.push(filePath);
          return { taskID: "task-new" };
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          rawResult: {
            pages: [
              {
                pageNo: 1,
                width: 1000,
                height: 1000,
                blocks: [
                  { type: "text", bbox: [0, 0, 100, 100], markdown: "A" },
                ],
              },
            ],
          },
          markdown: "A",
        }),
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.equal(confirmCount, 1);
    assert.deepEqual(submitted, ["C:/tmp/b.pdf"]);
  });

  it("stops bulk parsing before confirmation when the API Key is missing", async function () {
    const messages: string[] = [];
    let confirmCalled = false;
    let submitCalled = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getApiKey: () => "",
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => true,
      },
      confirmReparse: async () => {
        confirmCalled = true;
        return "reparse";
      },
      client: {
        submitPdf: async () => {
          submitCalled = true;
          throw new Error("submitPdf should not be called");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ rawResult: {}, markdown: "" }),
      },
    });

    await manager.parseAttachments([pdfAttachment()]);

    assert.isFalse(confirmCalled);
    assert.isFalse(submitCalled);
    assert.include(messages, "parse-error-missing-api-key");
  });

  it("stops before network calls when the API Key is missing", async function () {
    const messages: string[] = [];
    let submitCalled = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getApiKey: () => "",
      client: {
        submitPdf: async () => {
          submitCalled = true;
          throw new Error("submitPdf should not be called");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ rawResult: {}, markdown: "" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isFalse(submitCalled);
    assert.include(messages, "parse-error-missing-api-key");
  });

  it("reports unreadable files and logs attachment id with file path", async function () {
    const messages: string[] = [];
    const logs: unknown[][] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      isFileReadable: async () => false,
      log: (...args) => {
        logs.push(args);
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-file-access");
    assert.deepInclude(logs[0][1] as Record<string, unknown>, {
      attachmentID: 1,
      filePath: "C:/tmp/a.pdf",
    });
  });

  it("reports file access failure when the PDF read fails during submit", async function () {
    const messages: string[] = [];
    const logs: unknown[][] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      log: (...args) => {
        logs.push(args);
      },
      client: {
        submitPdf: async () => {
          throw new MinerUFileAccessError("C:/tmp/a.pdf", "EACCES");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ rawResult: {}, markdown: "" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-file-access");
    assert.deepInclude(logs[0][1] as Record<string, unknown>, {
      attachmentID: 1,
      filePath: "C:/tmp/a.pdf",
    });
  });

  it("does not report unexpected submit errors as file access failures", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => {
          throw new TypeError("unexpected client bug");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ rawResult: {}, markdown: "" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-generic");
    assert.notInclude(messages, "parse-error-file-access");
  });

  it("uses an existing ready result when the user chooses not to reparse", async function () {
    const messages: string[] = [];
    let submitCalled = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => true,
      },
      confirmReparse: async () => "use-existing",
      client: {
        submitPdf: async () => {
          submitCalled = true;
          throw new Error("submitPdf should not be called");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ rawResult: {}, markdown: "" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isFalse(submitCalled);
    assert.include(messages, "parse-use-existing-result");
  });

  it("writes a failed result when MinerU JSON contains no boxes", async function () {
    const messages: string[] = [];
    let failedRawResult: unknown;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        writeFailedResult: async (input) => {
          failedRawResult = input.rawResult;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "task-empty" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          rawResult: { content_list: [{ type: "text" }] },
          markdown: "# No boxes",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(failedRawResult, { content_list: [{ type: "text" }] });
    assert.include(messages, "parse-error-empty-boxes");
  });

  it("replaces an existing ready result with a failed result when reparse has no boxes", async function () {
    const messages: string[] = [];
    let failedRawResult: unknown;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => true,
        writeFailedResult: async (input) => {
          failedRawResult = input.rawResult;
        },
      },
      confirmReparse: async () => "reparse",
      client: {
        submitPdf: async () => ({ taskID: "task-empty" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          rawResult: { content_list: [{ type: "text" }] },
          markdown: "# No boxes",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(failedRawResult, { content_list: [{ type: "text" }] });
    assert.include(messages, "parse-error-empty-boxes");
  });

  it("keeps the existing result when overwrite storage fails", async function () {
    const messages: string[] = [];
    let attemptedOverwrite = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => true,
        writeResult: async () => {
          attemptedOverwrite = true;
          throw new Error("disk full");
        },
      },
      confirmReparse: async () => "reparse",
      client: {
        submitPdf: async () => ({ taskID: "task-new" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          rawResult: {
            pages: [
              {
                pageNo: 1,
                width: 1000,
                height: 1000,
                blocks: [
                  { type: "text", bbox: [0, 0, 100, 100], markdown: "A" },
                ],
              },
            ],
          },
          markdown: "A",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isTrue(attemptedOverwrite);
    assert.include(messages, "parse-error-overwrite");
  });

  it("does not claim an old result was kept when the first write fails", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => false,
        writeResult: async () => {
          throw new Error("disk full");
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "task-new" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          rawResult: {
            pages: [
              {
                pageNo: 1,
                width: 1000,
                height: 1000,
                blocks: [
                  { type: "text", bbox: [0, 0, 100, 100], markdown: "A" },
                ],
              },
            ],
          },
          markdown: "A",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-generic");
    assert.notInclude(messages, "parse-error-overwrite");
  });

  it("maps upload, parse, and download failures to specific messages", async function () {
    const cases: Array<{
      client: ParseManagerDependencies["client"];
      expected: string;
    }> = [
      {
        client: {
          submitPdf: async () => {
            throw new MinerURequestError("upload", 403, "bad signature");
          },
          pollTask: async () => ({ status: "succeeded" }),
          downloadResult: async () => ({ rawResult: {}, markdown: "" }),
        },
        expected: "parse-error-upload",
      },
      {
        client: {
          submitPdf: async () => ({ taskID: "task-failed" }),
          pollTask: async () => ({
            status: "failed",
            error: "quota exceeded",
          }),
          downloadResult: async () => ({ rawResult: {}, markdown: "" }),
        },
        expected: "parse-error-mineru",
      },
      {
        client: {
          submitPdf: async () => ({ taskID: "task-download" }),
          pollTask: async () => ({ status: "succeeded" }),
          downloadResult: async () => {
            throw new MinerURequestError("download", 500, "cdn empty");
          },
        },
        expected: "parse-error-download",
      },
    ];

    for (const testCase of cases) {
      const messages: string[] = [];
      const manager = createParseManager({
        ...baseDependencies(messages),
        client: testCase.client,
      });

      await manager.parseAttachment(pdfAttachment());

      assert.include(messages, testCase.expected);
    }
  });
});

function baseDependencies(messages: string[]): ParseManagerDependencies {
  return {
    getApiKey: () => "secret-token",
    storage: baseStorage(),
    client: {
      submitPdf: async () => ({ taskID: "task-1" }),
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => ({
        rawResult: { pages: [{ pageNo: 1 }] },
        markdown: "",
      }),
    },
    showMessage: (id) => {
      messages.push(id);
    },
    confirmReparse: async () => "reparse",
    isFileReadable: async () => true,
    delay: async () => {},
    log: () => {},
  };
}

function baseStorage(): ParseManagerDependencies["storage"] {
  return {
    getAttachmentDir: () => "TmpD/mineru-copy/attachments/12-ABC123",
    hasReadyResult: async () => false,
    readManifest: async () => {
      throw new Error("not needed");
    },
    readBoxes: async () => normalizedBoxes,
    writeResult: async () => {},
    writeFailedResult: async () => {},
    countReadyResults: async () => 0,
    openDataFolder: async () => {},
  };
}

function pdfAttachment(options?: {
  id?: number;
  fileName?: string;
  filePath?: string;
}): Zotero.Item {
  return {
    id: options?.id ?? 1,
    key: `ABC${options?.id ?? 123}`,
    libraryID: 12,
    attachmentFilename: options?.fileName ?? "a.pdf",
    attachmentModificationTime: Promise.resolve(1),
    isAttachment: () => true,
    isPDFAttachment: () => true,
    getFilePathAsync: async () => options?.filePath ?? "C:/tmp/a.pdf",
  } as unknown as Zotero.Item;
}

function regularItem(attachments: Zotero.Item[]): Zotero.Item {
  return {
    isAttachment: () => false,
    isRegularItem: () => true,
    getBestAttachments: async () => attachments,
  } as unknown as Zotero.Item;
}
