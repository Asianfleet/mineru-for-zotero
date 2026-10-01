import { assert } from "chai";
import {
  clearTaskCancelled,
  createProgressWindowTexts,
  createParseManager,
  markTaskCancelled,
  resolveReparseChoiceFromPromptButton,
  type ParseManagerDependencies,
} from "../src/modules/parseManager";
import {
  createV1MinerUClient,
  MinerUFileAccessError,
  MinerURequestError,
} from "../src/modules/mineruClient";
import { normalizedBoxes } from "./domainFixtures";
import { createStorage } from "../src/modules/storage";
import { taskStore } from "../src/modules/taskStore";

describe("parseManager", function () {
  afterEach(async function () {
    // Cancellation state is process-wide; keep the suite order-independent.
    for (const id of ["7201", "7202", "7203", "7204", "7205", "7206"]) {
      clearTaskCancelled(id);
    }
    // The task store is a process-wide singleton; drop finished records so the
    // assertions below cannot depend on the order of the tests.
    await taskStore.waitUntilLoaded();
    await taskStore.clearHistory();
  });

  it("creates aligned progress window lines for parse task notices", function () {
    const texts = createProgressWindowTexts(
      "parse-task-submitted",
      {
        source: "online",
        mode: "precise",
      },
      resolveProgressWindowTestMessage,
    );

    assert.deepEqual(texts, [
      { text: "MinerU document parse task submitted" },
      { text: "[Online API · Precise]" },
    ]);
  });

  it("creates submitted batch detail text without a completed placeholder", function () {
    const texts = createProgressWindowTexts(
      "parse-task-submitted-total",
      {
        source: "online",
        mode: "precise",
        total: "2",
      },
      resolveProgressWindowTestMessage,
    );

    assert.deepEqual(texts, [
      { text: "MinerU document parse task submitted" },
      { text: "[Online API · Precise · 2 total]" },
    ]);
  });

  it("creates progress window detail lines with batch totals", function () {
    const texts = createProgressWindowTexts(
      "parse-task-finished-progress",
      {
        source: "local",
        mode: "lite",
        completed: "2",
        total: "3",
      },
      resolveProgressWindowTestMessage,
    );

    assert.deepEqual(texts, [
      { text: "MinerU document parse task finished" },
      {
        text: "[Local API · Lite · 2/3]",
      },
    ]);
  });

  it("treats prompt close and cancel position as use-existing", function () {
    assert.equal(resolveReparseChoiceFromPromptButton(1), "use-existing");
    assert.equal(resolveReparseChoiceFromPromptButton(0), "reparse");
  });

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

  it("does not emit submitted or finished notices on successful parse", async function () {
    const notices: Array<{
      id: string;
      args?: Record<string, string>;
    }> = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      storage: {
        ...baseStorage(),
        writeResult: async () => {},
      },
      client: successfulPreciseClient(),
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(notices, []);
  });

  it("does not emit parse notices across all source and mode combinations on success", async function () {
    const cases: Array<{
      source: "online" | "local";
      mode: "precise" | "lite";
      result:
        | {
            kind: "precise";
            rawResult: unknown;
            markdown: string;
          }
        | { kind: "lite"; markdown: string };
    }> = [
      {
        source: "online",
        mode: "precise",
        result: preciseResultFixture(),
      },
      {
        source: "online",
        mode: "lite",
        result: { kind: "lite", markdown: "# Lite" },
      },
      {
        source: "local",
        mode: "precise",
        result: preciseResultFixture(),
      },
      {
        source: "local",
        mode: "lite",
        result: { kind: "lite", markdown: "# Lite" },
      },
    ];

    for (const entry of cases) {
      const notices: Array<{ id: string; args?: Record<string, string> }> = [];
      const manager = createParseManager({
        ...baseDependencies([]),
        getParseSource: () => entry.source,
        showMessage: (id, args) => {
          notices.push({ id, args });
        },
        client: {
          submitPdf: async () => ({ taskID: "task-1" }),
          pollTask: async () => ({ status: "succeeded" }),
          downloadResult: async () => entry.result,
        },
      });

      await manager.parseAttachment(pdfAttachment());

      assert.deepEqual(notices, []);
    }
  });

  it("marks precise parsing as running and ready", async function () {
    const events: string[] = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      onParseColumnRunning: async (_attachment, mode) => {
        events.push(`${mode}:running`);
      },
      onParseColumnReady: async (_attachment, mode) => {
        events.push(`${mode}:ready`);
      },
      client: successfulPreciseClient(),
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(events, ["precise:running", "precise:ready"]);
  });

  it("marks lite parsing as running and ready", async function () {
    const events: string[] = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      onParseColumnRunning: async (_attachment, mode) => {
        events.push(`${mode}:running`);
      },
      onParseColumnReady: async (_attachment, mode) => {
        events.push(`${mode}:ready`);
      },
      client: {
        submitPdf: async () => ({ taskID: "lite-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(events, ["precise:running", "lite:ready"]);
  });

  it("registers the injected attachment title in the task store", async function () {
    const manager = createParseManager({
      ...baseDependencies([]),
      getAttachmentTitle: async () => "Injected Parent Title",
      client: successfulPreciseClient(),
    });

    await manager.parseAttachment(pdfAttachment());

    assert.equal(taskStore.getTask("1")?.title, "Injected Parent Title");
  });

  it("falls back to a placeholder task title when Zotero item lookups fail", async function () {
    const originalGetAsync = Zotero.Items.getAsync;
    (Zotero.Items as any).getAsync = async () => {
      throw new Error("Item lookup unavailable");
    };
    try {
      const manager = createParseManager({
        ...baseDependencies([]),
        client: successfulPreciseClient(),
      });

      await manager.parseAttachment(pdfAttachment());

      assert.equal(taskStore.getTask("1")?.title, "PDF Document");
    } finally {
      (Zotero.Items as any).getAsync = originalGetAsync;
    }
  });

  it("clears running parse column status after parse failure", async function () {
    const events: string[] = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      onParseColumnRunning: async (_attachment, mode) => {
        events.push(`${mode}:running`);
      },
      onParseColumnClearRunning: async (_attachment, mode) => {
        events.push(`${mode}:clear`);
      },
      client: {
        submitPdf: async () => {
          throw new MinerURequestError("upload", 403, "bad signature");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(events, ["precise:running", "precise:clear"]);
  });

  it("clears running parse column status for empty lite markdown", async function () {
    const events: string[] = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      onParseColumnRunning: async (_attachment, mode) => {
        events.push(`${mode}:running`);
      },
      onParseColumnClearRunning: async (_attachment, mode) => {
        events.push(`${mode}:clear`);
      },
      client: {
        submitPdf: async () => ({ taskID: "lite-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: " " }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(events, ["precise:running", "precise:clear"]);
  });

  it("keeps parsing when parse column running update fails", async function () {
    const messages: string[] = [];
    let submitCalled = false;
    const logs: unknown[][] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      log: (...args) => {
        logs.push(args);
      },
      onParseColumnRunning: async () => {
        throw new Error("column refresh failed");
      },
      client: {
        submitPdf: async () => {
          submitCalled = true;
          return { taskID: "task-1" };
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isTrue(submitCalled);
    assert.isEmpty(messages);
    assert.equal(logs[0][0], "failed to update MinerU parse column");
  });

  it("does not report parse failure when parse column ready update fails", async function () {
    const messages: string[] = [];
    const logs: unknown[][] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      log: (...args) => {
        logs.push(args);
      },
      onParseColumnReady: async () => {
        throw new Error("column refresh failed");
      },
      client: successfulPreciseClient(),
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isEmpty(messages);
    assert.equal(logs[0][0], "failed to update MinerU parse column");
  });

  it("preserves the original parse error when parse column clear fails", async function () {
    const messages: string[] = [];
    const logs: unknown[][] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      log: (...args) => {
        logs.push(args);
      },
      onParseColumnClearRunning: async () => {
        throw new Error("column refresh failed");
      },
      client: {
        submitPdf: async () => {
          throw new MinerURequestError("upload", 403, "bad signature");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-upload");
    assert.equal(logs[0][0], "failed to update MinerU parse column");
  });

  it("does not report submitted notice when submit upload fails", async function () {
    const notices: Array<{
      id: string;
      args?: Record<string, string>;
    }> = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      client: {
        submitPdf: async () => {
          throw new MinerURequestError("upload", 403, "bad signature");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.notInclude(
      notices.map((notice) => notice.id),
      "parse-task-submitted",
    );
    assert.deepInclude(notices, {
      id: "parse-error-upload",
      args: { message: "MinerU upload request failed: bad signature" },
    });
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
          kind: "precise",
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
    assert.sameMembers(started, ["C:\\tmp\\a.pdf", "C:\\tmp\\b.pdf"]);
  });

  it("serializes batch parsing when the concurrency cap is one", async function () {
    const messages: string[] = [];
    let started = 0;
    let running = 0;
    let maxObservedRunning = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getMaxConcurrentRequests: () => 1,
      client: {
        submitPdf: async (filePath) => {
          running += 1;
          started += 1;
          maxObservedRunning = Math.max(maxObservedRunning, running);
          return { taskID: `task-${started}-${filePath}` };
        },
        pollTask: async () => {
          maxObservedRunning = Math.max(maxObservedRunning, running);
          return { status: "succeeded" };
        },
        downloadResult: async () => {
          const result = preciseResultFixture();
          running -= 1;
          return result;
        },
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 11, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 12, filePath: "C:/tmp/b.pdf" }),
      pdfAttachment({ id: 13, filePath: "C:/tmp/c.pdf" }),
    ]);

    assert.equal(started, 3);
    assert.equal(maxObservedRunning, 1);
    assert.isEmpty(messages);
  });

  it("parses batch attachments without emitting submitted or finished notices", async function () {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    const writeOrder: number[] = [];
    const startedPolls: string[] = [];
    let releasePollStart: (() => void) | undefined;
    const bothPollsStarted = new Promise<void>((resolve) => {
      releasePollStart = resolve;
    });
    const releaseByPath = new Map<string, () => void>();
    const waitByPath = new Map<string, Promise<void>>();
    for (const path of ["C:\\tmp\\a.pdf", "C:\\tmp\\b.pdf"]) {
      waitByPath.set(
        path,
        new Promise<void>((resolve) => {
          releaseByPath.set(path, resolve);
        }),
      );
    }
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      storage: {
        ...baseStorage(),
        writeResult: async (input) => {
          writeOrder.push(input.attachment.id);
        },
      },
      client: {
        submitPdf: async (filePath) => ({ taskID: filePath }),
        pollTask: async (taskID) => {
          startedPolls.push(taskID);
          if (startedPolls.length === 2) {
            releasePollStart?.();
          }
          await waitByPath.get(taskID);
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });

    const parsing = manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    await bothPollsStarted;
    releaseByPath.get("C:\\tmp\\b.pdf")?.();
    await Promise.resolve();
    releaseByPath.get("C:\\tmp\\a.pdf")?.();
    await parsing;

    assert.deepEqual(notices, []);
    assert.deepEqual(writeOrder, [2, 1]);
  });

  it("excludes skipped existing results from batch notice totals", async function () {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      storage: {
        ...baseStorage(),
        hasReadyResult: async (attachment) => attachment.id === 1,
      },
      confirmReparse: async () => "use-existing",
      client: successfulPreciseClient(),
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.deepEqual(notices, [
      { id: "parse-use-existing-result", args: undefined },
    ]);
  });

  it("does not emit batch notices when all existing results are kept", async function () {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    let submitCalled = false;
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
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
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.isFalse(submitCalled);
    assert.deepEqual(notices, [
      { id: "parse-use-existing-result", args: undefined },
    ]);
  });

  it("excludes unreadable files from batch notice totals", async function () {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    const submitted: string[] = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      isFileReadable: async (filePath) => !filePath.endsWith("a.pdf"),
      client: {
        submitPdf: async (filePath) => {
          submitted.push(filePath);
          return { taskID: "task-readable" };
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.deepEqual(submitted, ["C:\\tmp\\b.pdf"]);
    assert.deepEqual(notices, [
      { id: "parse-error-file-access", args: undefined },
    ]);
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
          kind: "precise",
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
    assert.deepEqual(submitted, ["C:\\tmp\\b.pdf"]);
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
        downloadResult: async () => ({
          kind: "precise",
          rawResult: {},
          markdown: "",
        }),
      },
    });

    await manager.parseAttachments([pdfAttachment()]);

    assert.isFalse(confirmCalled);
    assert.isFalse(submitCalled);
    assert.include(messages, "parse-error-missing-api-key");
  });

  it("writes precise results only for precise client results", async function () {
    const messages: string[] = [];
    let wrotePrecise = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      storage: {
        ...baseStorage(),
        writeResult: async () => {
          wrotePrecise = true;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "precise-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          kind: "precise",
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

    assert.isTrue(wrotePrecise);
  });

  it("reports empty lite markdown without writing a lite result", async function () {
    const messages: string[] = [];
    let wroteLite = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      storage: {
        ...baseStorage(),
        writeLiteResult: async () => {
          wroteLite = true;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "lite-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "  \n" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isFalse(wroteLite);
    assert.include(messages, "parse-error-empty-lite-markdown");
  });

  it("does not report lite write failures as kept overwrite errors", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      storage: {
        ...baseStorage(),
        hasLiteResult: async () => true,
        writeLiteResult: async () => {
          throw new Error("disk full");
        },
      },
      confirmReparse: async () => "reparse",
      client: {
        submitPdf: async () => ({ taskID: "lite-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-generic");
    assert.notInclude(messages, "parse-error-overwrite");
  });

  it("passes parse settings to created clients", async function () {
    const messages: string[] = [];
    let receivedSettings:
      | Parameters<NonNullable<ParseManagerDependencies["createClient"]>>[0]
      | null = null;
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: undefined,
      getApiKey: () => "",
      getParseSource: () => "local",
      getLocalApiBaseURL: () => "http://127.0.0.1:9000",
      getSaveImages: () => false,
      createClient: (settings) => {
        receivedSettings = settings;
        return {
          submitPdf: async () => ({ taskID: "lite-task" }),
          pollTask: async () => ({ status: "succeeded" }),
          downloadResult: async () => ({
            kind: "lite",
            markdown: "# Lite",
          }),
        };
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(receivedSettings, {
      apiKey: "",
      source: "local",
      tier: "standard",
      localApiBaseURL: "http://127.0.0.1:9000",
      saveImages: false,
    });
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
        downloadResult: async () => ({
          kind: "precise",
          rawResult: {},
          markdown: "",
        }),
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
      filePath: "C:\\tmp\\a.pdf",
    });
  });

  it("normalizes file URLs before checking readability", async function () {
    const messages: string[] = [];
    const checkedPaths: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      isFileReadable: async (filePath) => {
        checkedPaths.push(filePath);
        return true;
      },
    });

    await manager.parseAttachment(
      pdfAttachment({
        filePath: "file:///D:/Workspace/zotero%20plugin/a.pdf",
      }),
    );

    assert.deepEqual(checkedPaths, ["D:\\Workspace\\zotero plugin\\a.pdf"]);
    assert.notInclude(messages, "parse-error-file-access");
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
        downloadResult: async () => ({
          kind: "precise",
          rawResult: {},
          markdown: "",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-file-access");
    assert.deepInclude(logs[0][1] as Record<string, unknown>, {
      attachmentID: 1,
      filePath: "C:\\tmp\\a.pdf",
    });
  });

  it("fails the task and clears the processing tag when the PDF read fails during submit", async function () {
    const messages: string[] = [];
    const tags: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => {
          throw new MinerUFileAccessError("C:/tmp/a.pdf", "EACCES");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7109, tags }));

    const task = taskStore.getTask("7109");
    assert.equal(task?.status, "failed");
    assert.notInclude(task?.error ?? "", "a.pdf");
    assert.include(tags, "-MinerU: Processing ⏳");
    assert.include(tags, "+MinerU: Failed ❌");
    assert.deepEqual(messages, ["parse-error-file-access"]);
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
        downloadResult: async () => ({
          kind: "precise",
          rawResult: {},
          markdown: "",
        }),
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
        downloadResult: async () => ({
          kind: "precise",
          rawResult: {},
          markdown: "",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isFalse(submitCalled);
    assert.include(messages, "parse-use-existing-result");
  });

  it("writes a failed result and clears running when MinerU JSON contains no boxes", async function () {
    const messages: string[] = [];
    const events: string[] = [];
    let failedRawResult: unknown;
    const manager = createParseManager({
      ...baseDependencies(messages),
      onParseColumnRunning: async (_attachment, mode) => {
        events.push(`${mode}:running`);
      },
      onParseColumnClearRunning: async (_attachment, mode) => {
        events.push(`${mode}:clear`);
      },
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
          kind: "precise",
          rawResult: { content_list: [{ type: "text" }] },
          markdown: "# No boxes",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(failedRawResult, { content_list: [{ type: "text" }] });
    assert.include(messages, "parse-error-empty-boxes");
    assert.deepEqual(events, ["precise:running", "precise:clear"]);
  });

  it("clears the processing tag and stores readable text when lite Markdown is empty", async function () {
    const messages: string[] = [];
    const tags: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => ({ taskID: "task-empty-lite" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "  " }),
      },
    });

    await withTestLocale(() =>
      manager.parseAttachment(pdfAttachment({ id: 7110, tags })),
    );

    const task = taskStore.getTask("7110");
    assert.equal(task?.status, "failed");
    assert.equal(task?.error, "Lite parse returned no Markdown");
    assert.include(tags, "-MinerU: Processing ⏳");
    assert.include(tags, "+MinerU: Failed ❌");
    assert.deepEqual(messages, ["parse-error-empty-lite-markdown"]);
  });

  it("keeps the tags of an earlier result when lite Markdown comes back empty", async function () {
    const messages: string[] = [];
    const tags: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: { ...baseStorage(), hasLiteResult: async () => true },
      client: {
        submitPdf: async () => ({ taskID: "task-empty-lite" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "" }),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7111, tags }));

    assert.deepEqual(tags, ["-MinerU: Processing ⏳"]);
    assert.deepEqual(messages, ["parse-error-overwrite"]);
    assert.equal(taskStore.getTask("7111")?.status, "failed");
  });

  it("stores readable text when MinerU JSON contains no boxes", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => ({ taskID: "task-empty" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          kind: "precise",
          rawResult: { content_list: [{ type: "text" }] },
          markdown: "# No boxes",
        }),
      },
    });

    await withTestLocale(() =>
      manager.parseAttachment(pdfAttachment({ id: 7112 })),
    );

    const task = taskStore.getTask("7112");
    assert.equal(task?.status, "failed");
    assert.equal(task?.error, "The parse result does not contain box data");
  });

  it("passes downloaded images to storage when the preference is enabled", async function () {
    const messages: string[] = [];
    let savedImages: Array<{ path: string; bytes: Uint8Array }> | undefined;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getSaveImages: () => true,
      storage: {
        ...baseStorage(),
        writeResult: async (input) => {
          savedImages = input.images;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "task-images" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          kind: "precise",
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
          images: [{ path: "a.png", bytes: new Uint8Array([1, 2, 3]) }],
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.deepEqual(savedImages, [
      { path: "a.png", bytes: new Uint8Array([1, 2, 3]) },
    ]);
  });

  it("does not pass downloaded images to storage when the preference is disabled", async function () {
    const messages: string[] = [];
    let savedImages: Array<{ path: string; bytes: Uint8Array }> | undefined;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getSaveImages: () => false,
      storage: {
        ...baseStorage(),
        writeResult: async (input) => {
          savedImages = input.images;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "task-images" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          kind: "precise",
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
          images: [{ path: "a.png", bytes: new Uint8Array([1, 2, 3]) }],
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isUndefined(savedImages);
  });

  it("keeps an existing ready result when a reparse returns no boxes", async function () {
    const messages: string[] = [];
    const tags: string[] = [];
    let failedResultWritten = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => true,
        writeFailedResult: async () => {
          failedResultWritten = true;
        },
      },
      confirmReparse: async () => "reparse",
      client: {
        submitPdf: async () => ({ taskID: "task-empty" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({
          kind: "precise",
          rawResult: { content_list: [{ type: "text" }] },
          markdown: "# No boxes",
        }),
      },
    });

    await manager.parseAttachment(pdfAttachment({ tags }));

    assert.isFalse(failedResultWritten);
    assert.deepEqual(messages, ["parse-error-overwrite"]);
    assert.include(tags, "-MinerU: Processing ⏳");
    assert.notInclude(tags, "-MinerU: Precise ✅");
    assert.notInclude(tags, "+MinerU: Failed ❌");
  });

  it("leaves the stored result readable when a reparse returns no boxes", async function () {
    const messages: string[] = [];
    const root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-reparse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    const storage = createStorage(root);
    let returnEmptyResult = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage,
      client: {
        submitPdf: async () => ({ taskID: "task-reparse" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () =>
          returnEmptyResult
            ? { kind: "precise", rawResult: { content_list: [] }, markdown: "" }
            : preciseResultFixture(),
      },
    });
    const attachment = pdfAttachment({ id: 7108 });
    const ref = { libraryID: 12, key: "ABC7108" };

    try {
      await manager.parseAttachment(attachment, { force: true });
      returnEmptyResult = true;
      await manager.parseAttachment(attachment, { force: true });

      assert.isTrue(await storage.hasReadyResult(ref));
      assert.equal(await storage.readPreferredMarkdown(ref), "A");
      assert.deepEqual(messages, ["parse-error-overwrite"]);
    } finally {
      await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
    }
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
          kind: "precise",
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
          kind: "precise",
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
          downloadResult: async () => ({
            kind: "precise",
            rawResult: {},
            markdown: "",
          }),
        },
        expected: "parse-error-upload",
      },
      {
        client: {
          submitPdf: async () => {
            throw new MinerURequestError("submit", 422, "invalid page range");
          },
          pollTask: async () => ({ status: "succeeded" }),
          downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
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
          downloadResult: async () => ({
            kind: "precise",
            rawResult: {},
            markdown: "",
          }),
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

  it("reports failure notice when a batch task fails", async function () {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    const manager = createParseManager({
      ...baseDependencies([]),
      showMessage: (id, args) => {
        notices.push({ id, args });
      },
      client: {
        submitPdf: async (filePath) => ({ taskID: filePath }),
        pollTask: async (taskID) => {
          if (taskID.includes("b.pdf")) {
            return { status: "failed", error: "parse failed" };
          }
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.deepEqual(notices, [
      {
        id: "parse-error-mineru",
        args: { message: "parse failed" },
      },
    ]);
  });

  it("maps local API request failures to local unavailable messages", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      client: {
        submitPdf: async () => {
          throw new MinerURequestError("submit", 0, "connection refused");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-local-api-unavailable");
  });

  it("retries transient local polling failures without resubmitting", async function () {
    const messages: string[] = [];
    let submitCount = 0;
    let pollCount = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getLocalApiTimeoutMinutes: () => 1,
      delay: async () => {},
      client: {
        submitPdf: async () => {
          submitCount += 1;
          return { taskID: "local-retry-task" };
        },
        pollTask: async () => {
          pollCount += 1;
          if (pollCount === 1) {
            throw new MinerURequestError("poll", 0, "offline");
          }
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7101 }));

    assert.equal(submitCount, 1);
    assert.equal(pollCount, 2);
    assert.isEmpty(messages);
  });

  it("retries dropped local polls through the real V1 client", async function () {
    const messages: string[] = [];
    const server = createLocalV1Server();
    server.failJobPolls(
      () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
      () => jsonResponse({ error: { message: "busy" } }, 503),
    );
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getLocalApiTimeoutMinutes: () => 1,
      client: server.client,
    });

    await manager.parseAttachment(pdfAttachment({ id: 7105 }));

    assert.isEmpty(messages);
    assert.deepEqual(server.submittedJobs, ["job-1"]);
    assert.equal(taskStore.getTask("7105")?.status, "succeeded");
  });

  it("resubmits a task the local V1 server lost", async function () {
    const messages: string[] = [];
    const server = createLocalV1Server();
    server.loseJob("job-1");
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getLocalApiTimeoutMinutes: () => 1,
      client: server.client,
    });

    await manager.parseAttachment(pdfAttachment({ id: 7106 }));

    assert.isEmpty(messages);
    assert.deepEqual(server.submittedJobs, ["job-1", "job-2"]);
    assert.equal(taskStore.getTask("7106")?.status, "succeeded");
  });

  it("reports a local task as lost when the V1 server keeps forgetting it", async function () {
    const messages: string[] = [];
    const server = createLocalV1Server();
    server.loseJob("job-1");
    server.loseJob("job-2");
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getLocalApiTimeoutMinutes: () => 1,
      client: server.client,
    });

    await manager.parseAttachment(pdfAttachment({ id: 7107 }));

    assert.deepEqual(messages, ["parse-error-local-task-lost"]);
    assert.equal(taskStore.getTask("7107")?.status, "failed");
  });

  it("retries transient online polling failures without resubmitting", async function () {
    const messages: string[] = [];
    let submitCount = 0;
    let pollCount = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => {
          submitCount += 1;
          return { taskID: "online-retry-task" };
        },
        pollTask: async () => {
          pollCount += 1;
          if (pollCount <= 2) {
            throw new MinerURequestError("poll", 503, "service unavailable");
          }
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });

    // The base delay stub is a no-op, so reconnect retries advance without
    // wall-clock waits.

    await manager.parseAttachment(pdfAttachment({ id: 7103 }));

    assert.equal(submitCount, 1);
    assert.equal(pollCount, 3);
    assert.isEmpty(messages);
  });

  it("does not retry online upload failures", async function () {
    const messages: string[] = [];
    let submitCalls = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => {
          submitCalls += 1;
          throw new MinerURequestError("upload", 0, "offline");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7104 }));

    assert.equal(submitCalls, 1);
    assert.include(messages, "parse-error-upload");
  });

  it("resumes a failed parse chunk from the first incomplete chunk", async function () {
    const messages: string[] = [];
    const submitted: string[] = [];
    const pageRanges: string[] = [];
    let shouldFailSecondChunk = true;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getPdfPageCount: async () => 401,
      getLocalApiTimeoutMinutes: () => 1,
      delay: async () => {},
      client: {
        submitPdf: async (filePath, options) => {
          const taskID = `split-task-${submitted.length}`;
          submitted.push(filePath);
          pageRanges.push(options?.pageRange ?? "");
          return { taskID };
        },
        pollTask: async (taskID) => {
          if (taskID === "split-task-1" && shouldFailSecondChunk) {
            throw new MinerURequestError("poll", 400, "temporary test failure");
          }
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });
    const attachment = pdfAttachment({
      id: 7102,
      filePath: "C:/tmp/large.pdf",
    });

    await manager.parseAttachment(attachment);
    assert.include(messages, "parse-error-local-api-unavailable");
    assert.lengthOf(submitted, 2);

    shouldFailSecondChunk = false;
    await manager.parseAttachment(attachment, { force: true, resume: true });

    // 401 pages -> three chunks submitted with page ranges. Run 1 submitted
    // chunks 0 and 1; the resume run skips chunk 0 via its result cache,
    // reconnects chunk 1 through the saved task ID, and submits chunk 2.
    assert.lengthOf(submitted, 3);
    assert.deepEqual(pageRanges, ["1-200", "201-400", "401-401"]);
    assert.deepEqual(messages, ["parse-error-local-api-unavailable"]);
  });

  it("uses the configured local API timeout for long-running local tasks", async function () {
    const messages: string[] = [];
    const delays: number[] = [];
    let pollCount = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getLocalApiTimeoutMinutes: () => 7,
      delay: async (ms) => {
        delays.push(ms);
      },
      client: {
        submitPdf: async () => ({ taskID: "local-task" }),
        pollTask: async () => {
          pollCount += 1;
          return pollCount > 120
            ? { status: "succeeded" }
            : { status: "running" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.equal(pollCount, 121);
    assert.lengthOf(delays, 120);
    assert.isEmpty(messages);
  });

  it("marks a task cancelled without reporting a failure when stopped while polling", async function () {
    const messages: string[] = [];
    const tags: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => ({ taskID: "cancel-poll-task" }),
        pollTask: async () => {
          // The Task Manager "Stop" button marks the task while it is polling.
          markTaskCancelled("7201");
          return { status: "running" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7201, tags }));

    assert.isEmpty(messages, "cancellation must not raise a failure notice");
    assert.notInclude(tags, "+MinerU: Failed ❌");
    assert.include(tags, "-MinerU: Processing ⏳");
    assert.equal(taskStore.getTask("7201")?.status, "cancelled");
    assert.equal(taskStore.getTask("7201")?.error, "Cancelled by user");
  });

  it("does not publish a result when stopped during the download phase", async function () {
    const messages: string[] = [];
    let writeResultCalls = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      storage: {
        ...baseStorage(),
        writeResult: async () => {
          writeResultCalls += 1;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "cancel-download-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => {
          markTaskCancelled("7202");
          return preciseResultFixture();
        },
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7202 }));

    assert.equal(writeResultCalls, 0);
    assert.isEmpty(messages);
    assert.equal(taskStore.getTask("7202")?.status, "cancelled");
  });

  it("lets a retry run after a cancellation", async function () {
    const messages: string[] = [];
    let cancelNextPoll = true;
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => ({ taskID: "cancel-retry-task" }),
        pollTask: async () => {
          if (cancelNextPoll) {
            cancelNextPoll = false;
            markTaskCancelled("7203");
            return { status: "running" };
          }
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });
    const attachment = pdfAttachment({ id: 7203 });

    await manager.parseAttachment(attachment);
    assert.equal(taskStore.getTask("7203")?.status, "cancelled");

    await manager.parseAttachment(attachment, { force: true });

    assert.equal(taskStore.getTask("7203")?.status, "succeeded");
    assert.isEmpty(messages);
  });

  it("ignores a second parse while the same attachment is already running", async function () {
    const messages: string[] = [];
    let submitCount = 0;
    let releasePoll: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => {
      releasePoll = resolve;
    });
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => {
          submitCount += 1;
          return { taskID: "overlap-task" };
        },
        pollTask: async () => {
          await pollGate;
          return { status: "succeeded" };
        },
        downloadResult: async () => preciseResultFixture(),
      },
    });
    const attachment = pdfAttachment({ id: 7204 });

    const first = manager.parseAttachment(attachment);
    const second = manager.parseAttachment(attachment);
    await second;
    releasePoll?.();
    await first;

    assert.equal(
      submitCount,
      1,
      "only one pipeline may submit for an attachment",
    );
    assert.isEmpty(messages);
  });

  it("rejects an oversized PDF on the single attachment path with a dedicated message", async function () {
    const messages: string[] = [];
    const tags: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      getFileSize: async () => 201 * 1024 * 1024,
      client: {
        submitPdf: async () => {
          throw new Error("must not submit an oversized PDF");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7205, tags }));

    assert.deepEqual(messages, ["parse-error-file-too-large"]);
    assert.include(tags, "+MinerU: Failed ❌");
    assert.include(tags, "-MinerU: Precise ✅");
  });

  it("resolves a pending task when the retry target is rejected before submission", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      getFileSize: async () => 201 * 1024 * 1024,
    });
    // Retry/Resume mark the record pending before the pipeline starts.
    await taskStore.upsertTask({
      id: "7207",
      attachment: {
        id: 7207,
        key: "ABC7207",
        libraryID: 12,
        fileName: "a.pdf",
        filePath: "C:/tmp/a.pdf",
        mtime: 1,
      },
      title: "a.pdf",
      status: "pending",
      progress: 0,
      detail: "Retrying...",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await manager.parseAttachment(pdfAttachment({ id: 7207 }));

    const task = taskStore.getTask("7207");
    assert.equal(task?.status, "failed");
    // Without a locale bundle getSafeMessageText falls back to the message id.
    assert.oneOf(task?.error, [
      "The PDF is larger than the 200 MB MinerU upload limit",
      "parse-error-file-too-large",
    ]);
    assert.deepEqual(messages, ["parse-error-file-too-large"]);
  });

  it("stores the user-facing failure message on the task record", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      client: {
        submitPdf: async () => {
          throw new MinerURequestError("upload", 0, "offline");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => preciseResultFixture(),
      },
    });

    await manager.parseAttachment(pdfAttachment({ id: 7206 }));

    assert.deepEqual(messages, ["parse-error-upload"]);
    assert.equal(
      taskStore.getTask("7206")?.error,
      "MinerU upload request failed: offline",
    );
  });
});

function successfulPreciseClient(): NonNullable<
  ParseManagerDependencies["client"]
> {
  return {
    submitPdf: async () => ({ taskID: "task-1" }),
    pollTask: async () => ({ status: "succeeded" }),
    downloadResult: async () => preciseResultFixture(),
  };
}

function preciseResultFixture(): {
  kind: "precise";
  rawResult: unknown;
  markdown: string;
} {
  return {
    kind: "precise",
    rawResult: {
      pages: [
        {
          pageNo: 1,
          width: 1000,
          height: 1000,
          blocks: [{ type: "text", bbox: [0, 0, 100, 100], markdown: "A" }],
        },
      ],
    },
    markdown: "A",
  };
}

/**
 * In-memory MinerU V1 server behind the real local client, so the tests see
 * the request stages the client actually reports ("poll", "download", ...).
 */
function createLocalV1Server() {
  const submittedJobs: string[] = [];
  const lostJobs = new Set<string>();
  const pollFailures: Array<() => Response> = [];
  const middleJson = preciseResultFixture().rawResult;
  const client = createV1MinerUClient({
    apiKey: "",
    baseURL: "http://127.0.0.1:8000",
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v1/health")) {
        return jsonResponse({
          status: "ok",
          features: {
            sources: ["local"],
            output_formats: ["markdown", "middle_json"],
          },
        });
      }
      if (method === "POST" && url.endsWith("/v1/parse/jobs")) {
        const jobID = `job-${submittedJobs.length + 1}`;
        submittedJobs.push(jobID);
        return jsonResponse({ job_id: jobID }, 202);
      }
      const jobID = /\/v1\/parse\/jobs\/([^/]+)$/.exec(url)?.[1];
      if (jobID) {
        if (lostJobs.has(jobID)) {
          return jsonResponse(
            { error: { code: "job_not_found", message: "job not found" } },
            404,
          );
        }
        const failure = pollFailures.shift();
        if (failure) {
          return failure();
        }
        return jsonResponse({
          job_id: jobID,
          status: "completed",
          files: [
            {
              status: "completed",
              output_files: {
                markdown: { file_id: "md" },
                middle_json: { file_id: "mj" },
              },
            },
          ],
        });
      }
      if (url.endsWith("/v1/files/md/content")) {
        return new Response("A", { status: 200 });
      }
      if (url.endsWith("/v1/files/mj/content")) {
        return new Response(JSON.stringify(middleJson), { status: 200 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  });
  return {
    client,
    submittedJobs,
    /** Answer the next job status requests with these failures, in order. */
    failJobPolls(...failures: Array<() => Response>) {
      pollFailures.push(...failures);
    },
    /** Make the server answer 404 for this job, as after a restart. */
    loseJob(jobID: string) {
      lostJobs.add(jobID);
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseDependencies(messages: string[]): ParseManagerDependencies {
  return {
    getApiKey: () => "secret-token",
    getParseSource: () => "online",
    getParseTier: () => "standard",
    getLocalApiBaseURL: () => "http://127.0.0.1:8000",
    getPdfPageCount: async () => 10,
    openTaskManager: () => {},
    storage: baseStorage(),
    client: {
      submitPdf: async () => ({ taskID: "task-1" }),
      pollTask: async () => ({ status: "succeeded" }),
      downloadResult: async () => ({
        kind: "precise",
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
    hasLiteResult: async () => false,
    readParseStatus: async () => ({
      preciseReady: false,
      liteReady: false,
    }),
    listParseStatuses: async () => new Map(),
    readManifest: async () => {
      throw new Error("not needed");
    },
    readMarkdown: async () => "",
    readPreferredMarkdown: async () => "",
    readBoxes: async () => normalizedBoxes,
    writeResult: async () => {},
    writeFailedResult: async () => {},
    writeLiteResult: async () => {},
    countReadyResults: async () => 0,
    openDataFolder: async () => {},
  };
}

function pdfAttachment(options?: {
  id?: number;
  fileName?: string;
  filePath?: string;
  tags?: string[];
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
    addTag: (tag: string) => {
      options?.tags?.push(`+${tag}`);
    },
    removeTag: (tag: string) => {
      options?.tags?.push(`-${tag}`);
    },
    saveTx: async () => {},
  } as unknown as Zotero.Item;
}

function regularItem(attachments: Zotero.Item[]): Zotero.Item {
  return {
    isAttachment: () => false,
    isRegularItem: () => true,
    getBestAttachments: async () => attachments,
  } as unknown as Zotero.Item;
}

/**
 * Run with a minimal Fluent stand-in so getString() returns English text for
 * the parse failure messages instead of falling back to the message id.
 */
async function withTestLocale<T>(run: () => Promise<T>): Promise<T> {
  const texts: Record<string, string> = {
    "mineruForZotero-parse-error-empty-boxes":
      "The parse result does not contain box data",
    "mineruForZotero-parse-error-empty-lite-markdown":
      "Lite parse returned no Markdown",
  };
  const globals = globalThis as typeof globalThis & { addon?: unknown };
  const hadAddon = "addon" in globals;
  const originalAddon = globals.addon;
  globals.addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages: Array<{ id: string }>) {
            return messages.map(({ id }) => ({
              value: texts[id] ?? null,
              attributes: null,
            }));
          },
        },
      },
    },
  };
  try {
    return await run();
  } finally {
    if (hadAddon) {
      globals.addon = originalAddon;
    } else {
      Reflect.deleteProperty(globals, "addon");
    }
  }
}

function resolveProgressWindowTestMessage(
  id: string,
  args?: Record<string, string>,
): string {
  const values: Record<string, string> = {
    "parse-notice-mode-lite": "Lite",
    "parse-notice-mode-precise": "Precise",
    "parse-notice-source-local": "Local API",
    "parse-notice-source-online": "Online API",
    "parse-task-finished-progress": "MinerU document parse task finished",
    "parse-task-submitted": "MinerU document parse task submitted",
    "parse-task-submitted-total": "MinerU document parse task submitted",
  };

  if (id === "parse-task-detail") {
    return `[${args?.sourceLabel} · ${args?.modeLabel}]`;
  }
  if (id === "parse-task-detail-total") {
    return `[${args?.sourceLabel} · ${args?.modeLabel} · ${args?.total} total]`;
  }
  if (id === "parse-task-detail-progress") {
    return `[${args?.sourceLabel} · ${args?.modeLabel} · ${args?.completed}/${args?.total}]`;
  }
  return values[id] ?? id;
}
