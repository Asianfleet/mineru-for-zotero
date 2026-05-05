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
import { getApiKey } from "../utils/prefs";
import { getMinerUStorageRoot } from "./preferenceScript";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 120;

export type ReparseChoice = "use-existing" | "reparse";

export interface ParseManagerDependencies {
  getApiKey: () => string;
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
  parseAttachment(
    attachment: Zotero.Item,
    options?: { force?: boolean },
  ): Promise<void>;
}

type ParsePhase = "submit" | "poll" | "download" | "write";

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

export function createParseManager(
  dependencies: ParseManagerDependencies,
): ParseManager {
  return {
    async parseAttachment(attachment, options) {
      await parseAttachmentWithDependencies(attachment, options, dependencies);
    },
  };
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
  return Boolean(await getSelectedPDFAttachment());
}

async function getSelectedPDFAttachment(): Promise<Zotero.Item | null> {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane.getSelectedItems();
  for (const item of items) {
    const attachment = await resolvePDFAttachment(item);
    if (attachment) {
      return attachment;
    }
  }
  return null;
}

async function resolvePDFAttachment(
  item: Zotero.Item,
): Promise<Zotero.Item | null> {
  if (item.isAttachment()) {
    return item.isPDFAttachment() ? item : null;
  }

  if (!item.isRegularItem()) {
    return null;
  }

  const attachments = await item.getBestAttachments();
  return attachments.find((attachment) => attachment.isPDFAttachment()) ?? null;
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
    const flags =
      prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_0 +
      prompt.BUTTON_TITLE_IS_STRING * prompt.BUTTON_POS_1;
    const button = prompt.confirmEx(
      win,
      getString("parse-confirm-title"),
      getString("parse-confirm-reparse"),
      flags,
      getString("parse-confirm-use-existing"),
      getString("parse-confirm-overwrite"),
      null,
      null,
      {},
    );
    return button === 1 ? "reparse" : "use-existing";
  }

  return win.confirm(getString("parse-confirm-reparse"))
    ? "reparse"
    : "use-existing";
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

function getPromptService(win: Window): {
  BUTTON_TITLE_IS_STRING: number;
  BUTTON_POS_0: number;
  BUTTON_POS_1: number;
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
} | null {
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
  return prompt as ReturnType<typeof getPromptService>;
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
