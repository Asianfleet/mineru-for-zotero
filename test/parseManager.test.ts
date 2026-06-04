import { assert } from "chai";
import {
  createProgressWindowDisplayText,
  createProgressWindowDetailLines,
  createProgressWindowLineOptions,
  createProgressWindowTexts,
  createParseManager,
  applyProgressWindowDescriptionLineLayout,
  applyProgressWindowItemIcon,
  normalizeProgressWindowText,
  resolveReparseChoiceFromPromptButton,
  type ParseManagerDependencies,
} from "../src/modules/parseManager";
import {
  MinerUFileAccessError,
  MinerURequestError,
} from "../src/modules/mineruClient";
import { normalizedBoxes } from "./domainFixtures";

describe("parseManager", function () {
  it("normalizes multiline progress window text into one visible line", function () {
    assert.equal(
      normalizeProgressWindowText(
        "已提交 MinerU 文档解析任务\n    [在线 API · 精准]",
      ),
      "已提交 MinerU 文档解析任务 [在线 API · 精准]",
    );
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
      { text: "已提交 MinerU 文档解析任务" },
      { text: "[在线 API · 精准]" },
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
      { text: "已提交 MinerU 文档解析任务" },
      { text: "[在线 API · 精准 · 共 2 个]" },
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
      { text: "MinerU 文档解析任务完成" },
      {
        text: "[本地 API · 轻量 · 2/3]",
      },
    ]);
  });

  it("creates one progress window item so the detail text shares the main icon", function () {
    const options = createProgressWindowLineOptions([
      { text: "已提交 MinerU 文档解析任务" },
      { text: "[在线 API · 精准]" },
    ]);

    assert.deepEqual(options, [
      {
        text: "已提交 MinerU 文档解析任务",
        icon: "chrome://mineruForZotero/content/icons/favicon.png",
        progress: 100,
      },
    ]);
  });

  it("preserves progress window detail text as a label newline", function () {
    assert.equal(
      createProgressWindowDisplayText([
        { text: "已提交 MinerU 文档解析任务" },
        { text: "[在线 API · 精准]" },
      ]),
      "已提交 MinerU 文档解析任务\n[在线 API · 精准]",
    );
  });

  it("creates progress window description lines from detail text", function () {
    assert.deepEqual(
      createProgressWindowDetailLines([
        { text: "已提交 MinerU 文档解析任务" },
        { text: "[在线 API · 精准]" },
      ]),
      ["[在线 API · 精准]"],
    );
  });

  it("creates one progress window line for generic notices", function () {
    assert.deepEqual(
      createProgressWindowLineOptions([{ text: "已提交 MinerU 文档解析任务" }]),
      [
        {
          text: "已提交 MinerU 文档解析任务",
          icon: "chrome://mineruForZotero/content/icons/favicon.png",
          progress: 100,
        },
      ],
    );
  });

  it("keeps progress window text normalization for Fluent values", function () {
    assert.equal(
      createProgressWindowDisplayText([
        {
          text: normalizeProgressWindowText(
            "已提交 MinerU 文档解析任务\n    [在线 API · 精准]",
          ),
        },
      ]),
      "已提交 MinerU 文档解析任务 [在线 API · 精准]",
    );
  });

  it("creates one progress window line for parse task detail text", function () {
    const options = createProgressWindowLineOptions([
      { text: "已提交 MinerU 文档解析任务" },
      { text: "[在线 API · 精准]" },
    ]);

    assert.lengthOf(options, 1);
  });

  it("applies the explicit progress window item icon to the image node", function () {
    const image = document.createElement("hbox");
    const progressWindow = {
      lines: [{ _image: image }],
    };

    applyProgressWindowItemIcon(
      progressWindow,
      "chrome://mineruForZotero/content/icons/favicon.png",
    );

    assert.equal(
      image.dataset.itemType,
      "chrome://mineruForZotero/content/icons/favicon.png",
    );
    assert.include(
      image.style.backgroundImage,
      "chrome://mineruForZotero/content/icons/favicon.png",
    );
    assert.equal(image.style.backgroundRepeat, "no-repeat");
    assert.equal(image.style.backgroundSize, "16px 16px");
  });

  it("reports whether the progress window item icon was applied", function () {
    const progressWindow: { lines: Array<{ _image?: HTMLElement }> } = {
      lines: [{}],
    };

    assert.isFalse(
      applyProgressWindowItemIcon(
        progressWindow,
        "chrome://mineruForZotero/content/icons/favicon.png",
      ),
    );

    progressWindow.lines[0]._image = document.createElement("hbox");

    assert.isTrue(
      applyProgressWindowItemIcon(
        progressWindow,
        "chrome://mineruForZotero/content/icons/favicon.png",
      ),
    );
  });

  it("styles progress description rows as aligned detail lines", function () {
    const container = document.createElement("vbox");
    const mainRow = document.createElement("hbox");
    const detailRow = document.createElement("hbox");
    const detail = document.createElement("description");
    detail.textContent = "[在线 API · 精准]";
    detailRow.append(detail);
    container.append(mainRow, detailRow);
    const progressWindow = {
      lines: [{ _hbox: mainRow }],
    };

    applyProgressWindowDescriptionLineLayout(progressWindow, [
      "[在线 API · 精准]",
    ]);

    assert.equal(
      detailRow.getAttribute("data-mineru-progress-detail-row"),
      "true",
    );
    assert.equal(detailRow.style.marginLeft, "22px");
    assert.equal(detail.style.lineHeight, "18px");
  });

  it("reports whether progress description rows were aligned", function () {
    const container = document.createElement("vbox");
    const mainRow = document.createElement("hbox");
    container.append(mainRow);
    const progressWindow = {
      lines: [{ _hbox: mainRow }],
    };

    assert.isFalse(
      applyProgressWindowDescriptionLineLayout(progressWindow, [
        "[在线 API · 精准]",
      ]),
    );

    const detailRow = document.createElement("hbox");
    const detail = document.createElement("description");
    detail.textContent = "[在线 API · 精准]";
    detailRow.append(detail);
    container.append(detailRow);

    assert.isTrue(
      applyProgressWindowDescriptionLineLayout(progressWindow, [
        "[在线 API · 精准]",
      ]),
    );
  });

  it("does not require the global Node constructor for detail row layout", function () {
    const container = document.createElement("vbox");
    const mainRow = document.createElement("hbox");
    const detailRow = document.createElement("hbox");
    const detail = document.createElement("description");
    detail.textContent = "[在线 API · 精准]";
    detailRow.append(detail);
    container.append(mainRow, detailRow);
    const progressWindow = {
      lines: [{ _hbox: mainRow }],
    };
    const globalWithNode = globalThis as typeof globalThis & {
      Node?: typeof Node;
    };
    const originalNode = globalWithNode.Node;

    try {
      Reflect.deleteProperty(globalWithNode, "Node");

      assert.doesNotThrow(() => {
        applyProgressWindowDescriptionLineLayout(progressWindow, [
          "[在线 API · 精准]",
        ]);
      });
    } finally {
      globalWithNode.Node = originalNode;
    }
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

  it("reports online precise parse notices with source and mode context", async function () {
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

    assert.deepEqual(notices, [
      {
        id: "parse-task-submitted",
        args: {
          source: "online",
          mode: "precise",
        },
      },
      {
        id: "parse-task-finished",
        args: {
          source: "online",
          mode: "precise",
        },
      },
    ]);
  });

  it("reports all source and mode combinations in parse notices", async function () {
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
        getParseMode: () => entry.mode,
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

      assert.deepEqual(
        notices.map((notice) => notice.args),
        [
          {
            source: entry.source,
            mode: entry.mode,
          },
          {
            source: entry.source,
            mode: entry.mode,
          },
        ],
      );
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
      getParseMode: () => "lite",
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

    assert.deepEqual(events, ["lite:running", "lite:ready"]);
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
      getParseMode: () => "lite",
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

    assert.deepEqual(events, ["lite:running", "lite:clear"]);
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
    assert.include(messages, "parse-task-finished");
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

    assert.include(messages, "parse-task-finished");
    assert.notInclude(messages, "parse-error-generic");
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

  it("reports batch parse notices with total and completion progress", async function () {
    const notices: Array<{ id: string; args?: Record<string, string> }> = [];
    const writeOrder: number[] = [];
    const completionEvents: Array<{
      attachmentID: number;
      completed: string;
    }> = [];
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
        if (id === "parse-task-finished-progress" && args) {
          const attachmentID = writeOrder[completionEvents.length];
          completionEvents.push({
            attachmentID,
            completed: args.completed,
          });
        }
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

    assert.deepEqual(
      notices.filter((notice) => notice.id === "parse-task-submitted-total"),
      [
        {
          id: "parse-task-submitted-total",
          args: {
            source: "online",
            mode: "precise",
            total: "2",
          },
        },
      ],
    );
    assert.deepEqual(
      notices.filter((notice) => notice.id === "parse-task-finished-progress"),
      [
        {
          id: "parse-task-finished-progress",
          args: {
            source: "online",
            mode: "precise",
            total: "2",
            completed: "1",
          },
        },
        {
          id: "parse-task-finished-progress",
          args: {
            source: "online",
            mode: "precise",
            total: "2",
            completed: "2",
          },
        },
      ],
    );
    assert.deepEqual(completionEvents, [
      { attachmentID: 2, completed: "1" },
      { attachmentID: 1, completed: "2" },
    ]);
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
      {
        id: "parse-task-submitted",
        args: {
          source: "online",
          mode: "precise",
        },
      },
      {
        id: "parse-task-finished",
        args: {
          source: "online",
          mode: "precise",
        },
      },
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
    assert.notInclude(
      notices.map((notice) => notice.id),
      "parse-task-submitted-total",
    );
    assert.notInclude(
      notices.map((notice) => notice.id),
      "parse-task-finished-progress",
    );
    assert.deepEqual(notices, [
      { id: "parse-error-file-access", args: undefined },
      {
        id: "parse-task-submitted",
        args: {
          source: "online",
          mode: "precise",
        },
      },
      {
        id: "parse-task-finished",
        args: {
          source: "online",
          mode: "precise",
        },
      },
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

  it("does not require an API key for lite results", async function () {
    const messages: string[] = [];
    let wroteLite = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getApiKey: () => "",
      getParseSource: () => "online",
      getParseMode: () => "lite",
      storage: {
        ...baseStorage(),
        hasLiteResult: async () => false,
        writeLiteResult: async () => {
          wroteLite = true;
        },
      },
      client: {
        submitPdf: async () => ({ taskID: "lite-task" }),
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isTrue(wroteLite);
    assert.notInclude(messages, "parse-error-missing-api-key");
  });

  it("writes precise results only for precise client results", async function () {
    const messages: string[] = [];
    let wrotePrecise = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      getParseMode: () => "precise",
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

  it("uses an existing lite result when the user chooses not to reparse", async function () {
    const messages: string[] = [];
    let submitCalled = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      getParseMode: () => "lite",
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => false,
        hasLiteResult: async () => true,
      },
      confirmReparse: async () => "use-existing",
      client: {
        submitPdf: async () => {
          submitCalled = true;
          throw new Error("submitPdf should not be called");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.isFalse(submitCalled);
    assert.include(messages, "parse-use-existing-result");
  });

  it("skips existing lite results once in bulk parsing", async function () {
    const messages: string[] = [];
    const submitted: string[] = [];
    let confirmCount = 0;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      getParseMode: () => "lite",
      storage: {
        ...baseStorage(),
        hasReadyResult: async () => {
          throw new Error("hasReadyResult should not be used for lite mode");
        },
        hasLiteResult: async (attachment) => attachment.id === 1,
      },
      confirmReparse: async () => {
        confirmCount += 1;
        return "use-existing";
      },
      client: {
        submitPdf: async (filePath) => {
          submitted.push(filePath);
          return { taskID: "lite-task" };
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachments([
      pdfAttachment({ id: 1, filePath: "C:/tmp/a.pdf" }),
      pdfAttachment({ id: 2, filePath: "C:/tmp/b.pdf" }),
    ]);

    assert.equal(confirmCount, 1);
    assert.deepEqual(submitted, ["C:\\tmp\\b.pdf"]);
  });

  it("reports empty lite markdown without writing a lite result", async function () {
    const messages: string[] = [];
    let wroteLite = false;
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "online",
      getParseMode: () => "lite",
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
      getParseMode: () => "lite",
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
      getParseMode: () => "lite",
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
      mode: "lite",
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
          kind: "precise",
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
            throw new MinerURequestError("agent-upload", 403, "bad signature");
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

  it("counts only successful completions in batch progress notices", async function () {
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

    assert.deepEqual(
      notices.filter((notice) => notice.id === "parse-task-finished-progress"),
      [
        {
          id: "parse-task-finished-progress",
          args: {
            source: "online",
            mode: "precise",
            total: "2",
            completed: "1",
          },
        },
      ],
    );
  });

  it("maps local API request failures to local unavailable messages", async function () {
    const messages: string[] = [];
    const manager = createParseManager({
      ...baseDependencies(messages),
      getParseSource: () => "local",
      getParseMode: () => "lite",
      client: {
        submitPdf: async () => {
          throw new MinerURequestError("local-health", 503, "offline");
        },
        pollTask: async () => ({ status: "succeeded" }),
        downloadResult: async () => ({ kind: "lite", markdown: "# Lite" }),
      },
    });

    await manager.parseAttachment(pdfAttachment());

    assert.include(messages, "parse-error-local-api-unavailable");
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
    assert.include(messages, "parse-task-finished");
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

function baseDependencies(messages: string[]): ParseManagerDependencies {
  return {
    getApiKey: () => "secret-token",
    getParseSource: () => "online",
    getParseMode: () => "precise",
    getLocalApiBaseURL: () => "http://127.0.0.1:8000",
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

function resolveProgressWindowTestMessage(
  id: string,
  args?: Record<string, string>,
): string {
  const values: Record<string, string> = {
    "parse-notice-mode-lite": "轻量",
    "parse-notice-mode-precise": "精准",
    "parse-notice-source-local": "本地 API",
    "parse-notice-source-online": "在线 API",
    "parse-task-finished-progress": "MinerU 文档解析任务完成",
    "parse-task-submitted": "已提交 MinerU 文档解析任务",
    "parse-task-submitted-total": "已提交 MinerU 文档解析任务",
  };

  if (id === "parse-task-detail") {
    return `[${args?.sourceLabel} · ${args?.modeLabel}]`;
  }
  if (id === "parse-task-detail-total") {
    return `[${args?.sourceLabel} · ${args?.modeLabel} · 共 ${args?.total} 个]`;
  }
  if (id === "parse-task-detail-progress") {
    return `[${args?.sourceLabel} · ${args?.modeLabel} · ${args?.completed}/${args?.total}]`;
  }
  return values[id] ?? id;
}
