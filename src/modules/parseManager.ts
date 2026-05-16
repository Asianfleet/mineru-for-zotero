import type { AttachmentRef } from "./domain";
import type { FluentMessageId } from "../../typings/i10n";
import { normalizeMinerUBoxes } from "./boxNormalizer";
import {
  createMinerUClient,
  MinerUFileAccessError,
  MinerURequestError,
  MinerUTaskError,
  type MinerUClient,
} from "./mineruClient";
import { createStorage, type StorageAdapter } from "./storage";
import { getString } from "../utils/locale";
import { getApiKey, getSaveImages } from "../utils/prefs";
import { getMinerUStorageRoot } from "./preferenceScript";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 120;

export type ReparseChoice = "use-existing" | "reparse";

export interface ParseManagerDependencies {
  getApiKey: () => string;
  getSaveImages?: () => boolean;
  storage?: StorageAdapter;
  createStorage?: () => StorageAdapter;
  client?: MinerUClient;
  createClient?: (apiKey: string) => MinerUClient;
  showMessage: (id: FluentMessageId, args?: Record<string, string>) => void;
  confirmReparse: () => Promise<ReparseChoice>;
  isFileReadable: (filePath: string) => Promise<boolean>;
  delay: (ms: number) => Promise<void>;
  log: (...args: unknown[]) => void;
}

interface ParseManager {
  getItemParseContext(item: Zotero.Item): Promise<ItemParseContext>;
  parseAttachment(
    attachment: Zotero.Item,
    options?: { force?: boolean },
  ): Promise<void>;
  parseAttachments(
    attachments: Zotero.Item[],
    options?: { force?: boolean },
  ): Promise<void>;
}

type ParsePhase = "submit" | "poll" | "download" | "write";

export type ItemParseContext =
  | { kind: "attachment"; attachment: Zotero.Item }
  | { kind: "regular"; item: Zotero.Item; attachments: Zotero.Item[] }
  | { kind: "unsupported"; item: Zotero.Item };

type PromptService = {
  BUTTON_TITLE_IS_STRING: number;
  BUTTON_POS_0: number;
  BUTTON_POS_1: number;
  BUTTON_POS_1_DEFAULT?: number;
  confirmEx: (
    parent: Window,
    title: string,
    text: string,
    buttonFlags: number,
    button0Title: string,
    button1Title: string,
    button2Title: string | null,
    checkMsg: string | null,
    checkState: object,
  ) => number;
};

export async function parseSelectedAttachment(options?: {
  force?: boolean;
}): Promise<void> {
  const attachment = await getSelectedPDFAttachment();
  if (!attachment) {
    showMessage("parse-error-not-pdf");
    return;
  }

  await parseAttachment(attachment, options);
}

export async function parseAttachment(
  attachment: Zotero.Item,
  options?: { force?: boolean },
): Promise<void> {
  await createParseManager(createDefaultDependencies()).parseAttachment(
    attachment,
    options,
  );
}

export async function parseAttachments(
  attachments: Zotero.Item[],
  options?: { force?: boolean },
): Promise<void> {
  await createParseManager(createDefaultDependencies()).parseAttachments(
    attachments,
    options,
  );
}

export function createParseManager(
  dependencies: ParseManagerDependencies,
): ParseManager {
  return {
    async getItemParseContext(item) {
      return getItemParseContext(item);
    },
    async parseAttachment(attachment, options) {
      await parseAttachmentWithDependencies(attachment, options, dependencies);
    },
    async parseAttachments(attachments, options) {
      await parseAttachmentsWithDependencies(
        attachments,
        options,
        dependencies,
      );
    },
  };
}

async function parseAttachmentsWithDependencies(
  attachments: Zotero.Item[],
  options: { force?: boolean } | undefined,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  const pdfAttachments = attachments.filter((attachment) =>
    attachment.isPDFAttachment(),
  );
  if (pdfAttachments.length === 0) {
    dependencies.showMessage("parse-error-not-pdf");
    return;
  }

  const apiKey = dependencies.getApiKey().trim();
  if (!apiKey) {
    dependencies.showMessage("parse-error-missing-api-key");
    return;
  }

  if (options?.force === true) {
    await Promise.all(
      pdfAttachments.map((attachment) =>
        parseAttachmentWithDependencies(attachment, options, dependencies),
      ),
    );
    return;
  }

  const readyAttachmentIDs = await getReadyAttachmentIDs(
    pdfAttachments,
    dependencies,
  );
  let attachmentsToParse = pdfAttachments;
  if (readyAttachmentIDs.size > 0) {
    const choice = await dependencies.confirmReparse();
    if (choice === "use-existing") {
      dependencies.showMessage("parse-use-existing-result");
      attachmentsToParse = pdfAttachments.filter(
        (attachment) => !readyAttachmentIDs.has(attachment.id),
      );
    }
  }

  await Promise.all(
    attachmentsToParse.map((attachment) =>
      parseAttachmentWithDependencies(
        attachment,
        { ...options, force: true },
        dependencies,
      ),
    ),
  );
}

async function getReadyAttachmentIDs(
  attachments: Zotero.Item[],
  dependencies: ParseManagerDependencies,
): Promise<Set<number>> {
  const storage = getStorage(dependencies);
  const refs = await Promise.all(
    attachments.map(async (attachment) => {
      const filePath = await getAttachmentFilePath(attachment, dependencies);
      return filePath
        ? { attachment, ref: await toAttachmentRef(attachment, filePath) }
        : null;
    }),
  );
  const readyPairs = await Promise.all(
    refs.map(async (entry) => {
      if (!entry) {
        return null;
      }
      return (await storage.hasReadyResult(entry.ref))
        ? entry.attachment.id
        : null;
    }),
  );
  return new Set(
    readyPairs.filter((id): id is number => typeof id === "number"),
  );
}

async function parseAttachmentWithDependencies(
  attachment: Zotero.Item,
  options: { force?: boolean } | undefined,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  if (!attachment.isPDFAttachment()) {
    dependencies.showMessage("parse-error-not-pdf");
    return;
  }

  const filePath = await getAttachmentFilePath(attachment, dependencies);
  if (!filePath) {
    logFileAccessFailure(attachment, "<missing>", dependencies);
    dependencies.showMessage("parse-error-file-access");
    return;
  }

  if (!(await dependencies.isFileReadable(filePath))) {
    logFileAccessFailure(attachment, filePath, dependencies);
    dependencies.showMessage("parse-error-file-access");
    return;
  }

  const apiKey = dependencies.getApiKey().trim();
  if (!apiKey) {
    dependencies.showMessage("parse-error-missing-api-key");
    return;
  }

  const attachmentRef = await toAttachmentRef(attachment, filePath);
  const storage = getStorage(dependencies);
  const hasReady = await storage.hasReadyResult(attachmentRef);
  if (hasReady && options?.force !== true) {
    const choice = await dependencies.confirmReparse();
    if (choice === "use-existing") {
      dependencies.showMessage("parse-use-existing-result");
      return;
    }
  }

  const client = getClient(apiKey, dependencies);
  let phase: ParsePhase = "submit";
  try {
    dependencies.showMessage("parse-started");
    phase = "submit";
    const { taskID } = await client.submitPdf(filePath);
    phase = "poll";
    await waitForTask(client, taskID, dependencies.delay);
    phase = "download";
    const result = await client.downloadResult(taskID);
    const boxes = normalizeMinerUBoxes(result.rawResult);

    if (boxes.length === 0) {
      phase = "write";
      await storage.writeFailedResult({
        attachment: attachmentRef,
        mineruTaskID: taskID,
        rawResult: result.rawResult,
        markdown: result.markdown,
        error: getSafeMessageText("parse-error-empty-boxes"),
      });
      dependencies.showMessage("parse-error-empty-boxes");
      return;
    }

    phase = "write";
    await storage.writeResult({
      attachment: attachmentRef,
      mineruTaskID: taskID,
      rawResult: result.rawResult,
      markdown: result.markdown,
      boxes,
      images: dependencies.getSaveImages?.() !== false
        ? result.images
        : undefined,
    });
    dependencies.showMessage("parse-finished");
  } catch (error) {
    if (error instanceof MinerUFileAccessError) {
      logFileAccessFailure(attachment, filePath, dependencies, error);
      dependencies.showMessage("parse-error-file-access");
      return;
    }

    dependencies.log("MinerU parse failed", attachment.id, error);
    const failure = getParseFailureMessage(error, phase, hasReady);
    dependencies.showMessage(failure.id, failure.args);
  }
}

export async function selectedHasPDFAttachment(): Promise<boolean> {
  const context = await getSelectedParseContext();
  return Boolean(context && context.kind !== "unsupported");
}

async function getSelectedPDFAttachment(): Promise<Zotero.Item | null> {
  const context = await getSelectedParseContext();
  if (!context) {
    return null;
  }
  if (context.kind === "attachment") {
    return context.attachment;
  }
  if (context.kind === "regular") {
    return context.attachments[0] ?? null;
  }
  return null;
}

export async function getSelectedParseContext(): Promise<ItemParseContext | null> {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane.getSelectedItems();
  for (const item of items) {
    const context = await getItemParseContext(item);
    if (context.kind !== "unsupported") {
      return context;
    }
  }
  return null;
}

async function getItemParseContext(
  item: Zotero.Item,
): Promise<ItemParseContext> {
  if (item.isAttachment()) {
    return item.isPDFAttachment()
      ? { kind: "attachment", attachment: item }
      : { kind: "unsupported", item };
  }

  if (!item.isRegularItem()) {
    return { kind: "unsupported", item };
  }

  const attachments = await item.getBestAttachments();
  const pdfAttachments = attachments.filter((attachment) =>
    attachment.isPDFAttachment(),
  );
  return pdfAttachments.length > 0
    ? { kind: "regular", item, attachments: pdfAttachments }
    : { kind: "unsupported", item };
}

async function toAttachmentRef(
  attachment: Zotero.Item,
  filePath: string,
): Promise<AttachmentRef> {
  return {
    id: attachment.id,
    key: attachment.key,
    libraryID: attachment.libraryID,
    fileName: attachment.attachmentFilename || basename(filePath),
    filePath,
    mtime: (await attachment.attachmentModificationTime) ?? 0,
  };
}

async function waitForTask(
  client: MinerUClient,
  taskID: string,
  delay: (ms: number) => Promise<void>,
): Promise<void> {
  for (let count = 0; count < MAX_POLL_COUNT; count += 1) {
    const result = await client.pollTask(taskID);
    if (result.status === "succeeded") {
      return;
    }
    if (result.status === "failed") {
      throw new MinerUTaskError(result.error || "MinerU task failed");
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new MinerUTaskError("MinerU task timed out");
}

async function confirmReparse(): Promise<ReparseChoice> {
  const win = Zotero.getMainWindow();
  const prompt = getPromptService(win);
  if (prompt) {
    const flags = getReparsePromptButtonFlags(prompt);
    const button = prompt.confirmEx(
      win,
      getString("parse-confirm-title"),
      getString("parse-confirm-reparse"),
      flags,
      getString("parse-confirm-overwrite"),
      getString("parse-confirm-use-existing"),
      null,
      null,
      {},
    );
    return resolveReparseChoiceFromPromptButton(button);
  }

  return win.confirm(getString("parse-confirm-reparse"))
    ? "reparse"
    : "use-existing";
}

function getReparsePromptButtonFlags(prompt: PromptService): number {
  return (
    prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_0 +
    prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_1 +
    (prompt.BUTTON_POS_1_DEFAULT ?? 0)
  );
}

export function resolveReparseChoiceFromPromptButton(
  button: number,
): ReparseChoice {
  return button === 0 ? "reparse" : "use-existing";
}

function showMessage(id: FluentMessageId, args?: Record<string, string>): void {
  const text = getMessageText(id, args);
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeTime: 4000,
  })
    .createLine({
      text,
      type: "default",
      progress: 100,
    })
    .show();
}

function createDefaultDependencies(): ParseManagerDependencies {
  return {
    getApiKey,
    getSaveImages,
    createStorage: () => createStorage(getMinerUStorageRoot()),
    createClient: (apiKey) => createMinerUClient({ apiKey }),
    showMessage,
    confirmReparse,
    isFileReadable,
    delay: (ms) => Zotero.Promise.delay(ms),
    log: (...args) => ztoolkit.log(...args),
  };
}

function getStorage(dependencies: ParseManagerDependencies): StorageAdapter {
  if (dependencies.storage) {
    return dependencies.storage;
  }
  if (dependencies.createStorage) {
    return dependencies.createStorage();
  }
  throw new Error("Parse manager storage dependency is missing");
}

function getClient(
  apiKey: string,
  dependencies: ParseManagerDependencies,
): MinerUClient {
  if (dependencies.client) {
    return dependencies.client;
  }
  if (dependencies.createClient) {
    return dependencies.createClient(apiKey);
  }
  throw new Error("Parse manager client dependency is missing");
}

async function getAttachmentFilePath(
  attachment: Zotero.Item,
  dependencies: ParseManagerDependencies,
): Promise<string | null> {
  try {
    return (await attachment.getFilePathAsync()) || null;
  } catch (error) {
    logFileAccessFailure(attachment, "<unavailable>", dependencies, error);
    return null;
  }
}

function logFileAccessFailure(
  attachment: Zotero.Item,
  filePath: string,
  dependencies: ParseManagerDependencies,
  error?: unknown,
): void {
  dependencies.log("MinerU PDF file access failed", {
    attachmentID: attachment.id,
    filePath,
    error: error instanceof Error ? error.message : error,
  });
}

async function isFileReadable(filePath: string): Promise<boolean> {
  try {
    if (typeof IOUtils !== "undefined") {
      return IOUtils.exists(toNativePath(filePath));
    }
    if (typeof OS !== "undefined") {
      return Boolean(await OS.File.exists(toNativePath(filePath)));
    }
  } catch {
    return false;
  }
  return true;
}

function getParseFailureMessage(
  error: unknown,
  phase: ParsePhase,
  hasReadyResult: boolean,
): { id: FluentMessageId; args?: Record<string, string> } {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof MinerURequestError &&
    ["submit", "upload"].includes(error.stage)
  ) {
    return { id: "parse-error-upload", args: { message } };
  }
  if (phase === "download") {
    return { id: "parse-error-download", args: { message } };
  }
  if (phase === "poll" || error instanceof MinerUTaskError) {
    return { id: "parse-error-mineru", args: { message } };
  }
  if (phase === "write" && hasReadyResult) {
    return { id: "parse-error-overwrite", args: { message } };
  }
  return { id: "parse-error-generic", args: { message } };
}

function getMessageText(
  id: FluentMessageId,
  args?: Record<string, string>,
): string {
  return args ? getString(id, { args }) : getString(id);
}

function getSafeMessageText(
  id: FluentMessageId,
  args?: Record<string, string>,
): string {
  try {
    return getMessageText(id, args);
  } catch {
    return id;
  }
}

function getPromptService(win: Window): PromptService | null {
  const runtime = globalThis as typeof globalThis & {
    Services?: { prompt?: unknown };
  };
  const winWithServices = win as Window & {
    Services?: { prompt?: unknown };
  };
  const prompt = runtime.Services?.prompt ?? winWithServices.Services?.prompt;
  if (
    !prompt ||
    typeof (prompt as { confirmEx?: unknown }).confirmEx !== "function"
  ) {
    return null;
  }
  return prompt as PromptService;
}

function basename(path: string): string {
  return (
    path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "file.pdf"
  );
}

function toNativePath(path: string): string {
  if (/^[a-z]:\//i.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}
