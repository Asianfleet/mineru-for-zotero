import type { AttachmentRef } from "./domain";
import type { FluentMessageId } from "../../typings/i10n";
import { config } from "../../package.json";
import { normalizeMinerUBoxes } from "./boxNormalizer";
import { mergeChunkResults } from "./parseMerge";
import {
  createMinerUClientForSettings,
  MinerUFileAccessError,
  MinerURequestError,
  MinerUTaskError,
  type MinerUClient,
} from "./mineruClient";
import { joinNativePath, toNativePath } from "./mineruClient/path";
import {
  clearAttachmentParseRunning,
  markAttachmentParseReady,
  markAttachmentParseRunning,
} from "./itemTreeColumn";
import {
  taskStore,
  openTaskManagerWindow,
  type TaskChunkRecord,
  type TaskRecord,
  type TaskResumeRecord,
} from "./taskStore";
import { getPdfPageCount } from "./pdfPageCount";
import { createStorage, type StorageAdapter } from "./storage";
import { getString } from "../utils/locale";
import {
  getApiKey,
  getLocalApiTimeoutMinutes,
  getLocalApiBaseURL,
  getParseTier,
  getParseSource,
  getSaveImages,
  getStatusTagsEnabled,
  type ParseMode,
  type ParseSource,
  type ParseTier,
} from "../utils/prefs";
import { getMinerUStorageRoot } from "./preferenceScript";
import { createProgressWindowTexts } from "./parseProgress";
import {
  createTaskResume,
  persistTaskResume,
  updateTaskDetail,
  getTaskResumeDirectory,
  ensureTaskResumeDirectory,
  resetTaskResumeDirectory,
  readChunkResult,
  writeChunkResult,
  serializeChunkValue,
  reviveChunkValue,
  cleanupTaskResume,
} from "./parseResume";
import {
  POLL_INTERVAL_MS,
  downloadTaskResultWithRetry,
  waitForTask,
  isTaskNotFoundError,
  isRetryableNetworkError,
  getReconnectDelayMs,
  MinerUTaskCancelledError,
} from "./parseNetwork";
import { createConcurrencyLimiter } from "../utils/concurrency";

const CHUNK_PAGE_LIMIT = 200;
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const DEFAULT_ONLINE_POLL_TIMEOUT_MS = 6 * 60 * 1000;
const MAX_CONCURRENT_REQUESTS_DEFAULT = 3;
const MAX_CONCURRENT_REQUESTS_CEILING = 10;
export type ReparseChoice = "use-existing" | "reparse";

/**
 * Attachment ids with a parse pipeline currently running in this session.
 *
 * Guards against a second pipeline (double-click, repeated API call, or Retry
 * while running) resetting the resume directory of the first one.
 */
const activeParseIDs = new Set<string>();

/**
 * Attachment ids the user asked to cancel.
 *
 * The parse pipeline checks this set before every phase and inside the poll and
 * download retry loops, so a cancel is honored even when the task record was
 * already rewritten by the UI.
 */
const cancelledTaskIDs = new Set<string>();

/**
 * Shared cap on parse pipelines running at the same time.
 *
 * Every entry point goes through it (context menu batches, Retry and Resume,
 * auto-parse of new items, and the HTTP API), so
 * MINERU_API_MAX_CONCURRENT_REQUESTS bounds all MinerU traffic, not only the
 * attachments of one batch.
 */
const parseSlots = createConcurrencyLimiter();

/** Mark a task as cancelled by the user. */
export function markTaskCancelled(taskID: string): void {
  cancelledTaskIDs.add(taskID);
}

/** Report whether the user cancelled the task. */
export function isTaskCancelled(taskID: string): boolean {
  return cancelledTaskIDs.has(taskID);
}

/** Forget a cancellation so a later retry or resume can run normally. */
export function clearTaskCancelled(taskID: string): void {
  cancelledTaskIDs.delete(taskID);
}

/**
 * Throw when the task was cancelled, so the pipeline stops at the next phase
 * boundary instead of finishing and overwriting the cancelled state.
 */
function throwIfCancelled(taskID: string): void {
  if (isTaskCancelled(taskID)) {
    throw new MinerUTaskCancelledError();
  }
}

/**
 * Abort predicate for the poll and download loops: true once the user
 * cancelled the task, either through this session or through the task record.
 */
function isTaskAborted(attachment: Zotero.Item): boolean {
  const id = String(attachment.id);
  return isTaskCancelled(id) || taskStore.getTask(id)?.status === "cancelled";
}

export interface ParseManagerDependencies {
  getApiKey: () => string;
  getParseSource?: () => ParseSource;
  getParseTier?: () => ParseTier;
  getLocalApiBaseURL?: () => string;
  getLocalApiTimeoutMinutes?: () => number;
  getSaveImages?: () => boolean;
  /** Whether MinerU status tags are written; defaults to true. */
  getStatusTagsEnabled?: () => boolean;
  getMaxConcurrentRequests?: () => number;
  getPdfPageCount?: (filePath: string) => Promise<number>;
  /** Read the on-disk size of a PDF; used to enforce the upload limit. */
  getFileSize?: (filePath: string) => Promise<number | undefined>;
  storage?: StorageAdapter;
  createStorage?: () => StorageAdapter;
  client?: MinerUClient;
  createClient?: (settings: {
    apiKey: string;
    source: ParseSource;
    tier: ParseTier;
    localApiBaseURL: string;
    saveImages: boolean;
  }) => MinerUClient;
  showMessage: (id: FluentMessageId, args?: Record<string, string>) => void;
  getAttachmentTitle?: (attachment: Zotero.Item) => Promise<string>;
  openTaskManager?: () => void;
  confirmReparse: () => Promise<ReparseChoice>;
  isFileReadable: (filePath: string) => Promise<boolean>;
  delay: (ms: number) => Promise<void>;
  log: (...args: unknown[]) => void;
  onParseColumnRunning?: (
    attachment: AttachmentRef,
    mode: ParseMode,
  ) => Promise<void>;
  onParseColumnReady?: (
    attachment: AttachmentRef,
    mode: ParseMode,
  ) => Promise<void>;
  onParseColumnClearRunning?: (
    attachment: AttachmentRef,
    mode: ParseMode,
  ) => Promise<void>;
}

export interface ParseAttachmentOptions {
  force?: boolean;
  resume?: boolean;
}

interface ParseManager {
  getItemParseContext(item: Zotero.Item): Promise<ItemParseContext>;
  parseAttachment(
    attachment: Zotero.Item,
    options?: ParseAttachmentOptions,
  ): Promise<void>;
  parseAttachments(
    attachments: Zotero.Item[],
    options?: ParseAttachmentOptions,
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

export async function parseAttachment(
  attachment: Zotero.Item,
  options?: ParseAttachmentOptions,
): Promise<void> {
  await createParseManager(createDefaultDependencies()).parseAttachment(
    attachment,
    options,
  );
}

export async function parseAttachments(
  attachments: Zotero.Item[],
  options?: ParseAttachmentOptions,
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
  options: ParseAttachmentOptions | undefined,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  const pdfAttachments = attachments.filter((attachment) =>
    attachment.isPDFAttachment(),
  );
  if (pdfAttachments.length === 0) {
    dependencies.showMessage("parse-error-not-pdf");
    return;
  }

  const source = getCurrentParseSource(dependencies);
  const mode: ParseMode = "precise";
  const apiKey = dependencies.getApiKey().trim();
  if (requiresApiKey(source) && !apiKey) {
    dependencies.showMessage("parse-error-missing-api-key");
    return;
  }

  // Collect the failure notices of the whole batch: each is a modal alert, so
  // a batch with a bad API key or a dozen missing files used to need one
  // click per PDF. The Task Manager still shows every failure as it happens.
  const notices = createBatchNoticeCollector(dependencies);
  try {
    await parseBatch(pdfAttachments, options, mode, notices.dependencies);
  } finally {
    notices.flush(pdfAttachments.length);
  }
}

async function parseBatch(
  pdfAttachments: Zotero.Item[],
  options: ParseAttachmentOptions | undefined,
  mode: ParseMode,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  let attachmentsToParse = pdfAttachments;
  if (options?.force !== true) {
    const readyAttachmentIDs = await getReadyAttachmentIDs(
      pdfAttachments,
      mode,
      dependencies,
    );
    if (readyAttachmentIDs.size > 0) {
      const choice = await dependencies.confirmReparse();
      if (choice === "use-existing") {
        dependencies.showMessage("parse-use-existing-result");
        attachmentsToParse = pdfAttachments.filter(
          (attachment) => !readyAttachmentIDs.has(attachment.id),
        );
      }
    }
  }

  attachmentsToParse = await getSubmittableAttachments(
    attachmentsToParse,
    dependencies,
  );
  if (attachmentsToParse.length === 0) {
    return;
  }

  // Open the global Task Manager UI to view progress
  try {
    (dependencies.openTaskManager ?? openTaskManagerWindow)();
  } catch (e) {
    ztoolkit.log("Failed to open Task Manager window", e);
  }

  await runParseQueue(
    attachmentsToParse,
    { ...options, force: true },
    dependencies,
  );
}

/**
 * Hold back the failure notices of a batch and show them as one notice.
 *
 * Informational notices (such as "using the existing result") pass through
 * right away. A single failure keeps its own message; several are summarized
 * with the count and the first error.
 */
function createBatchNoticeCollector(dependencies: ParseManagerDependencies): {
  dependencies: ParseManagerDependencies;
  flush: (total: number) => void;
} {
  const failures: Array<{
    id: FluentMessageId;
    args?: Record<string, string>;
  }> = [];
  return {
    dependencies: {
      ...dependencies,
      showMessage: (id, args) => {
        if (id.startsWith("parse-error-")) {
          failures.push({ id, args });
        } else {
          dependencies.showMessage(id, args);
        }
      },
    },
    flush(total) {
      if (failures.length === 0) {
        return;
      }
      if (failures.length === 1) {
        dependencies.showMessage(failures[0].id, failures[0].args);
        return;
      }
      dependencies.showMessage("parse-error-batch", {
        count: String(failures.length),
        total: String(total),
        message: getSafeMessageText(failures[0].id, failures[0].args),
      });
    },
  };
}

/**
 * Start the per-attachment parse pipelines of a batch.
 *
 * Every pipeline is registered right away (so the in-flight guard also covers
 * attachments still waiting) and then waits for a slot of the shared parse
 * limiter, which starts them in order. Failures raised before a pipeline
 * installs its own error handling (for example a task-store write failure) are
 * logged instead of surfacing as unhandled rejections.
 */
async function runParseQueue(
  attachments: Zotero.Item[],
  options: ParseAttachmentOptions | undefined,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  await Promise.all(
    attachments.map(async (attachment) => {
      try {
        await parseAttachmentWithDependencies(
          attachment,
          options,
          dependencies,
        );
      } catch (error) {
        dependencies.log(
          "MinerU parse failed before task setup",
          attachment.id,
          error,
        );
      }
    }),
  );
}

async function getSubmittableAttachments(
  attachments: Zotero.Item[],
  dependencies: ParseManagerDependencies,
): Promise<Zotero.Item[]> {
  const checkedAttachments = await Promise.all(
    attachments.map(async (attachment) => {
      const rawFilePath = await getAttachmentFilePath(attachment, dependencies);
      if (!rawFilePath) {
        logFileAccessFailure(attachment, "<missing>", dependencies);
        dependencies.showMessage("parse-error-file-access");
        return null;
      }

      const filePath = toNativePath(rawFilePath);
      if (!(await dependencies.isFileReadable(filePath))) {
        logFileAccessFailure(attachment, filePath, dependencies);
        dependencies.showMessage("parse-error-file-access");
        return null;
      }

      // Check the MinerU upload size limit on every path that submits a PDF.
      if (await isAttachmentTooLarge(filePath, dependencies)) {
        await markAttachmentFailed(attachment, dependencies);
        dependencies.showMessage("parse-error-file-too-large");
        return null;
      }

      return attachment;
    }),
  );

  return checkedAttachments.filter(
    (attachment): attachment is Zotero.Item => attachment !== null,
  );
}

/**
 * Report whether the PDF exceeds the MinerU upload size limit.
 *
 * The check is best effort: when the file size is unavailable the parse
 * proceeds and the remote service reports the limit instead. A failed size
 * read stays quiet because the readability check already reports missing or
 * unreadable files with their path, and an extra log line would only add noise.
 */
async function isAttachmentTooLarge(
  filePath: string,
  dependencies: ParseManagerDependencies,
): Promise<boolean> {
  const readFileSize = dependencies.getFileSize ?? defaultGetFileSize;
  let size: number | undefined;
  try {
    size = await readFileSize(filePath);
  } catch {
    return false;
  }

  if (size !== undefined && size > MAX_FILE_SIZE_BYTES) {
    dependencies.log("File exceeds 200MB limit", filePath);
    return true;
  }
  return false;
}

/** Default file size reader backed by IOUtils. */
async function defaultGetFileSize(
  filePath: string,
): Promise<number | undefined> {
  if (typeof IOUtils === "undefined") {
    return undefined;
  }
  const stat = await IOUtils.stat(filePath);
  return stat.size ?? 0;
}

/** MinerU status tags written to parsed attachments. */
const STATUS_TAGS = {
  processing: "MinerU: Processing ⏳",
  precise: "MinerU: Precise ✅",
  lite: "MinerU: Lite ✅",
  failed: "MinerU: Failed ❌",
} as const;

type StatusTag = keyof typeof STATUS_TAGS;

/**
 * Change the MinerU status tags of an attachment.
 *
 * Tags sync to zotero.org and into shared group libraries, so nothing is
 * written when the user turned status tags off. Tag errors (for example in a
 * read-only group library) never fail a parse.
 */
async function updateStatusTags(
  attachment: Zotero.Item,
  change: { remove: StatusTag[]; add?: StatusTag },
  dependencies: Pick<ParseManagerDependencies, "getStatusTagsEnabled">,
): Promise<void> {
  if (dependencies.getStatusTagsEnabled?.() === false) {
    return;
  }
  try {
    for (const tag of change.remove) {
      attachment.removeTag(STATUS_TAGS[tag]);
    }
    if (change.add) {
      attachment.addTag(STATUS_TAGS[change.add], 1);
    }
    await attachment.saveTx();
  } catch (e) {
    // Ignore tag update errors
  }
}

/** Tag an attachment as failed and clear any in-progress or stale ready marker. */
async function markAttachmentFailed(
  attachment: Zotero.Item,
  dependencies: Pick<ParseManagerDependencies, "getStatusTagsEnabled">,
): Promise<void> {
  await updateStatusTags(
    attachment,
    { remove: ["processing", "precise", "lite"], add: "failed" },
    dependencies,
  );
}

/**
 * Resolve a parse that finished without a usable result.
 *
 * When an earlier result is still stored it stays in place: only the
 * in-progress tag is removed so the tags keep describing what is on disk, and
 * the notice says the old result was kept. Otherwise the attachment is tagged
 * as failed. The task is failed with readable text before the (modal) notice.
 */
async function failEmptyParse(
  attachment: Zotero.Item,
  messageID: FluentMessageId,
  keepsExistingResult: boolean,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  if (keepsExistingResult) {
    await updateStatusTags(
      attachment,
      { remove: ["processing"] },
      dependencies,
    );
  } else {
    await markAttachmentFailed(attachment, dependencies);
  }

  const message = getSafeMessageText(messageID);
  await taskStore.updateTaskStatus(String(attachment.id), "failed", message);
  if (keepsExistingResult) {
    dependencies.showMessage("parse-error-overwrite", { message });
  } else {
    dependencies.showMessage(messageID);
  }
}

/**
 * Fail a task record that an early return would otherwise leave pending.
 *
 * Retry and Resume mark the record `pending`/`running` before the pipeline
 * starts, so a rejected PDF (not an attachment, unreadable, oversized, missing
 * API key) must resolve that record instead of leaving a stuck task in the Task
 * Manager. Records in any other state are left untouched.
 */
async function failPendingTask(
  taskID: string,
  message: FluentMessageId,
): Promise<void> {
  const current = taskStore.getTask(taskID);
  if (!current) {
    return;
  }
  if (current.status !== "pending" && current.status !== "running") {
    return;
  }
  await taskStore.updateTaskStatus(
    taskID,
    "failed",
    getSafeMessageText(message),
  );
}

async function getReadyAttachmentIDs(
  attachments: Zotero.Item[],
  mode: ParseMode,
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
      return (await hasExistingResultForMode(entry.ref, mode, storage))
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
  options: ParseAttachmentOptions | undefined,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  const taskID = String(attachment.id);
  if (activeParseIDs.has(taskID)) {
    dependencies.log("MinerU parse already running for attachment", taskID);
    return;
  }

  activeParseIDs.add(taskID);
  // A new attempt (retry or resume) supersedes an earlier cancellation.
  clearTaskCancelled(taskID);
  try {
    await parseSlots.run(async () => {
      // A Stop pressed while this parse waited for a slot wins.
      if (isTaskCancelled(taskID)) {
        dependencies.log("MinerU parse cancelled before it started", taskID);
        return;
      }
      await runParseAttachment(attachment, options, dependencies);
    }, getMaxConcurrentRequests(dependencies));
  } finally {
    activeParseIDs.delete(taskID);
  }
}

async function runParseAttachment(
  attachment: Zotero.Item,
  options: ParseAttachmentOptions | undefined,
  dependencies: ParseManagerDependencies,
): Promise<void> {
  // Attachment id used for cancellation and resume bookkeeping. The MinerU
  // remote task ids are tracked separately as `taskIDs`.
  const attachmentTaskID = String(attachment.id);
  if (!attachment.isPDFAttachment()) {
    await failPendingTask(attachmentTaskID, "parse-error-not-pdf");
    dependencies.showMessage("parse-error-not-pdf");
    return;
  }

  const rawFilePath = await getAttachmentFilePath(attachment, dependencies);
  if (!rawFilePath) {
    logFileAccessFailure(attachment, "<missing>", dependencies);
    await failPendingTask(attachmentTaskID, "parse-error-file-access");
    dependencies.showMessage("parse-error-file-access");
    return;
  }
  const filePath = toNativePath(rawFilePath);

  if (!(await dependencies.isFileReadable(filePath))) {
    logFileAccessFailure(attachment, filePath, dependencies);
    await failPendingTask(attachmentTaskID, "parse-error-file-access");
    dependencies.showMessage("parse-error-file-access");
    return;
  }

  if (await isAttachmentTooLarge(filePath, dependencies)) {
    await markAttachmentFailed(attachment, dependencies);
    await failPendingTask(attachmentTaskID, "parse-error-file-too-large");
    dependencies.showMessage("parse-error-file-too-large");
    return;
  }

  const source = getCurrentParseSource(dependencies);
  const mode: ParseMode = "precise";
  const apiKey = dependencies.getApiKey().trim();
  const localApiBaseURL = dependencies.getLocalApiBaseURL?.() ?? "";
  if (requiresApiKey(source) && !apiKey) {
    await failPendingTask(attachmentTaskID, "parse-error-missing-api-key");
    dependencies.showMessage("parse-error-missing-api-key");
    return;
  }

  const attachmentRef = await toAttachmentRef(attachment, filePath);
  const storage = getStorage(dependencies);
  const hasExistingResult = await hasExistingResultForMode(
    attachmentRef,
    mode,
    storage,
  );
  if (hasExistingResult && options?.force !== true) {
    const choice = await dependencies.confirmReparse();
    if (choice === "use-existing") {
      dependencies.showMessage("parse-use-existing-result");
      return;
    }
  }

  const client = getClient(
    {
      apiKey,
      source,
      tier: getCurrentParseTier(dependencies, source),
      localApiBaseURL,
      saveImages: dependencies.getSaveImages?.() !== false,
    },
    dependencies,
  );
  let parseColumnRunning = false;
  let phase: ParsePhase = "submit";
  const attachmentTitle =
    (await resolveAttachmentTitle(attachment, dependencies)) || "PDF Document";
  await taskStore.waitUntilLoaded();
  const existingTask = taskStore.getTask(String(attachment.id));
  const canResume =
    options?.resume === true &&
    existingTask?.resume &&
    existingTask.resume.source === source &&
    existingTask.resume.mode === mode &&
    existingTask.resume.filePath === filePath &&
    existingTask.resume.pdfMtime === attachmentRef.mtime &&
    (source !== "local" ||
      existingTask.resume.localApiBaseURL === localApiBaseURL);
  const task: TaskRecord = canResume
    ? {
        ...existingTask!,
        status: "running",
        error: undefined,
        detail: "Resuming saved MinerU task...",
      }
    : {
        id: String(attachment.id),
        attachment: attachmentRef,
        title: attachmentTitle as string,
        status: "running",
        progress: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

  // Register in TaskStore before any remote request. Resume metadata is added
  // after page counting and then persisted before the first chunk submission.
  await taskStore.upsertTask(task);

  try {
    await updateStatusTags(
      attachment,
      { remove: ["failed"], add: "processing" },
      dependencies,
    );
    await updateParseColumnStatus(dependencies, "running", attachmentRef, mode);
    parseColumnRunning = true;
    phase = "submit";

    const pageCount = dependencies.getPdfPageCount
      ? await dependencies.getPdfPageCount(filePath)
      : await getPdfPageCount(filePath);
    const CHUNK_SIZE = CHUNK_PAGE_LIMIT;
    const chunks = Math.max(1, Math.ceil(pageCount / CHUNK_SIZE));
    const resume = createTaskResume(
      task.resume,
      source,
      mode,
      localApiBaseURL,
      filePath,
      attachmentRef.mtime,
      pageCount,
      CHUNK_SIZE,
      chunks,
    );
    task.resume = resume;
    await taskStore.upsertTask({
      ...task,
      progress: 0,
      error: undefined,
      detail:
        chunks > 1
          ? `[Auto-Split] Prepared ${chunks} parts (maximum ${CHUNK_SIZE} pages each)`
          : `Uploading full document (${pageCount} pages)...`,
    });
    const results: any[] = new Array(chunks);
    const taskIDs: string[] = new Array(chunks);
    const resumeDirectory = getTaskResumeDirectory(attachment.id);
    if (!canResume) {
      await resetTaskResumeDirectory(resumeDirectory);
    }
    await ensureTaskResumeDirectory(resumeDirectory);

    // One pipeline for every chunk. A PDF within the page limit is a single
    // chunk submitted without a page range.
    const split = chunks > 1;
    const processChunk = async (i: number): Promise<void> => {
      throwIfCancelled(attachmentTaskID);
      const chunk = resume.chunks[i];
      const { startPage, endPage } = chunk;
      const cachePath = chunk.resultPath
        ? toNativePath(chunk.resultPath)
        : joinNativePath(
            resumeDirectory,
            `mineru-part-${attachment.id}-${i}-result.json`,
          );
      chunk.resultPath = cachePath;

      const cached = await readChunkResult(cachePath);
      if (cached) {
        results[i] = cached;
        taskIDs[i] = chunk.taskID ?? "";
        chunk.status = "succeeded";
        await persistTaskResume(task, resume);
        return;
      }

      await updateTaskDetail(
        String(attachment.id),
        split
          ? `[Auto-Split] Processing part ${i + 1}/${chunks} (Pages ${startPage}-${endPage})`
          : `Uploading full document (${pageCount} pages)...`,
      );

      const submit = async (): Promise<void> => {
        throwIfCancelled(attachmentTaskID);
        const submitResult = split
          ? await client.submitPdf(filePath, {
              pageRange: `${startPage}-${endPage}`,
            })
          : await client.submitPdf(filePath);
        chunk.taskID = submitResult.taskID;
        chunk.status = "submitted";
        taskIDs[i] = chunk.taskID;
        await persistTaskResume(task, resume);
      };

      const requireTaskID = (): string => {
        if (!chunk.taskID) {
          throw new MinerUTaskError("Missing MinerU task ID for chunk");
        }
        return chunk.taskID;
      };

      const poll = async (): Promise<void> => {
        const taskID = requireTaskID();
        phase = "poll";
        await waitForTask(
          client,
          taskID,
          dependencies.delay,
          getPollTimeoutMs(source, dependencies),
          () => isTaskAborted(attachment),
          source,
          dependencies.log,
          async (attempt, waitMs) =>
            updateTaskDetail(
              String(attachment.id),
              getSafeMessageText("parse-task-reconnect", {
                attempt: String(attempt),
                seconds: String(Math.ceil(waitMs / 1000)),
              }),
            ),
        );
      };

      const download = async (): Promise<any> => {
        const taskID = requireTaskID();
        phase = "download";
        return downloadTaskResultWithRetry(
          client,
          taskID,
          dependencies.delay,
          getPollTimeoutMs(source, dependencies),
          source,
          dependencies.log,
          async (attempt, waitMs) =>
            updateTaskDetail(
              String(attachment.id),
              getSafeMessageText("parse-task-download-reconnect", {
                attempt: String(attempt),
                seconds: String(Math.ceil(waitMs / 1000)),
              }),
            ),
          () => isTaskAborted(attachment),
        );
      };

      // The remote service lost this task (usually after a restart). Only
      // this unfinished chunk is resubmitted; completed chunks stay cached.
      const resubmitLostTask = async (error: unknown): Promise<void> => {
        if (!isTaskNotFoundError(error, source)) {
          throw error;
        }
        chunk.taskID = undefined;
        chunk.status = "pending";
        await persistTaskResume(task, resume);
        await submit();
        await poll();
      };

      // If the previous Zotero run already submitted this chunk, keep the
      // original task ID and reconnect instead of uploading it again.
      if (!chunk.taskID) {
        await submit();
      } else {
        taskIDs[i] = chunk.taskID;
      }

      try {
        await poll();
      } catch (error) {
        await resubmitLostTask(error);
      }

      if (!split) {
        await updateTaskDetail(String(attachment.id), "Downloading result...");
      }
      let res: any;
      try {
        res = await download();
      } catch (error) {
        await resubmitLostTask(error);
        res = await download();
      }
      res._chunkPageCount = split ? endPage - startPage + 1 : pageCount;

      // The cache is written before the chunk is marked succeeded. If the
      // process fails later, this chunk can be skipped safely on resume.
      await writeChunkResult(cachePath, res);
      results[i] = res;
      chunk.status = "succeeded";
      await persistTaskResume(task, resume);
    };

    for (let i = 0; i < chunks; i++) {
      await processChunk(i);
    }

    if (split) {
      // Keep chunk result caches until the final merged result has been
      // written. A later Resume can therefore skip every completed chunk.
      await updateTaskDetail(
        String(attachment.id),
        `[Auto-Split] Finished processing ${chunks} parts. Merging...`,
      );
    }

    await taskStore.upsertTask({
      ...taskStore.getTask(String(attachment.id))!,
      detail: undefined,
    });
    const mergeMode: ParseMode = results.every(
      (entry) => entry && entry.rawResult != null,
    )
      ? "precise"
      : "lite";
    const result = mergeChunkResults(results, mergeMode);
    const taskID = taskIDs.join(",");

    // A cancel during the download phase must not publish a result.
    throwIfCancelled(attachmentTaskID);

    if (result.kind === "lite") {
      phase = "write";
      throwIfCancelled(attachmentTaskID);
      if (!result.markdown.trim()) {
        if (parseColumnRunning) {
          await updateParseColumnStatus(
            dependencies,
            "clear-running",
            attachmentRef,
            mode,
          );
          parseColumnRunning = false;
        }
        // Nothing is written, so any earlier precise or lite result survives.
        const keepsExistingResult =
          (await storage.hasReadyResult(attachmentRef)) ||
          (await storage.hasLiteResult(attachmentRef));
        await failEmptyParse(
          attachment,
          "parse-error-empty-lite-markdown",
          keepsExistingResult,
          dependencies,
        );
        return;
      }
      await storage.writeLiteResult({
        attachment: attachmentRef,
        mineruTaskID: taskID,
        source,
        markdown: result.markdown,
      });
      await cleanupTaskResume(String(attachment.id), resume);
      await updateParseColumnStatus(
        dependencies,
        "ready",
        attachmentRef,
        "lite",
      );
      parseColumnRunning = false;

      await updateStatusTags(
        attachment,
        { remove: ["processing", "failed", "precise"], add: "lite" },
        dependencies,
      );

      await taskStore.updateTaskStatus(String(attachment.id), "succeeded");

      return;
    }
    const boxes = result._mergedBoxes || normalizeMinerUBoxes(result.rawResult);

    if (boxes.length === 0) {
      phase = "write";
      throwIfCancelled(attachmentTaskID);
      // Writing the failed manifest swaps out the whole result folder, so a
      // reparse that comes back without boxes must not replace a usable result.
      const keepExistingResult = await hasExistingResultForMode(
        attachmentRef,
        mode,
        storage,
      );
      if (!keepExistingResult) {
        await storage.writeFailedResult({
          attachment: attachmentRef,
          mineruTaskID: taskID,
          rawResult: result.rawResult,
          markdown: result.markdown,
          error: getSafeMessageText("parse-error-empty-boxes"),
        });
      }
      if (parseColumnRunning) {
        await updateParseColumnStatus(
          dependencies,
          "clear-running",
          attachmentRef,
          mode,
        );
        parseColumnRunning = false;
      }
      await failEmptyParse(
        attachment,
        "parse-error-empty-boxes",
        keepExistingResult,
        dependencies,
      );
      return;
    }

    phase = "write";
    throwIfCancelled(attachmentTaskID);
    await storage.writeResult({
      attachment: attachmentRef,
      mineruTaskID: taskID,
      rawResult: result.rawResult,
      markdown: result.markdown,
      boxes,
      images:
        dependencies.getSaveImages?.() !== false ? result.images : undefined,
    });
    await cleanupTaskResume(String(attachment.id), resume);

    await updateParseColumnStatus(
      dependencies,
      "ready",
      attachmentRef,
      "precise",
    );
    parseColumnRunning = false;

    await updateStatusTags(
      attachment,
      { remove: ["processing", "failed", "lite"], add: "precise" },
      dependencies,
    );

    await taskStore.updateTaskStatus(String(attachment.id), "succeeded");
  } catch (error) {
    if (parseColumnRunning) {
      await updateParseColumnStatus(
        dependencies,
        "clear-running",
        attachmentRef,
        mode,
      );
      parseColumnRunning = false;
    }

    // Cancellation is a user action, not a failure: keep the resume data, drop
    // the in-progress tag, and skip both the failure notice and the Failed tag.
    if (
      error instanceof MinerUTaskCancelledError ||
      isTaskCancelled(attachmentTaskID)
    ) {
      dependencies.log("MinerU parse cancelled by user", attachment.id);
      await updateStatusTags(
        attachment,
        { remove: ["processing", "failed"] },
        dependencies,
      );
      await taskStore.updateTaskStatus(
        String(attachment.id),
        "cancelled",
        "Cancelled by user",
      );
      return;
    }

    if (error instanceof MinerUFileAccessError) {
      logFileAccessFailure(attachment, filePath, dependencies, error);
      await markAttachmentFailed(attachment, dependencies);
      // Store the localized message, not error.message: it contains the
      // absolute PDF path, which the task API must not disclose.
      await taskStore.updateTaskStatus(
        String(attachment.id),
        "failed",
        getSafeMessageText("parse-error-file-access"),
      );
      dependencies.showMessage("parse-error-file-access");
      return;
    }

    dependencies.log("MinerU parse failed", attachment.id, error);
    await markAttachmentFailed(attachment, dependencies);

    const failure = getParseFailureMessage(
      error,
      phase,
      mode === "precise" && hasExistingResult,
      source,
    );

    // Persist the failure before alerting, so the failed state does not depend
    // on the user dismissing the notice (parallel failures queue their alerts).
    await taskStore.updateTaskStatus(
      String(attachment.id),
      "failed",
      failure.args?.message || String(error),
    );
    dependencies.showMessage(failure.id, failure.args);
  }
}

/**
 * Best-effort resolution of the display title for an attachment.
 *
 * Prefers the dependency-injected implementation (for unit test convenience),
 * then falls back to the Zotero parent item title, and finally tries the attachment's
 * own title field. Failures at any step must not interrupt the parsing pipeline.
 */
async function resolveAttachmentTitle(
  attachment: Zotero.Item,
  dependencies: ParseManagerDependencies,
): Promise<string> {
  const injected = await dependencies.getAttachmentTitle?.(attachment);
  if (injected) {
    return injected;
  }

  try {
    const parentTitle = attachment.parentItem?.getField?.("title");
    if (parentTitle) {
      return String(parentTitle);
    }
  } catch {
    // Fall back to the attachment's own title.
  }

  try {
    const title = attachment.getField?.("title");
    if (title) {
      return String(title);
    }
  } catch {
    // Use placeholder when attachment lacks title information.
  }

  return "";
}

/**
 * Best-effort synchronization of the item tree parse column status,
 * ensuring auxiliary UI failures do not affect the core parse flow.
 */
async function updateParseColumnStatus(
  dependencies: ParseManagerDependencies,
  action: "running" | "ready" | "clear-running",
  attachment: AttachmentRef,
  mode: ParseMode,
): Promise<void> {
  try {
    if (action === "running") {
      await dependencies.onParseColumnRunning?.(attachment, mode);
      return;
    }
    if (action === "ready") {
      await dependencies.onParseColumnReady?.(attachment, mode);
      return;
    }
    await dependencies.onParseColumnClearRunning?.(attachment, mode);
  } catch (error) {
    dependencies.log("failed to update MinerU parse column", {
      action,
      attachmentID: attachment.id,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      mode,
      error,
    });
  }
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

/**
 * Resolve the MinerU request concurrency cap from
 * MINERU_API_MAX_CONCURRENT_REQUESTS, falling back to the given default.
 */
function resolveEnvConcurrentRequestLimit(defaultLimit: number): number {
  try {
    const env = (
      globalThis as { Services?: { env?: { get(name: string): string } } }
    ).Services?.env;
    const raw = env?.get("MINERU_API_MAX_CONCURRENT_REQUESTS");
    if (!raw) {
      return defaultLimit;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return defaultLimit;
    }
    return Math.min(MAX_CONCURRENT_REQUESTS_CEILING, Math.max(1, parsed));
  } catch {
    return defaultLimit;
  }
}

function getMaxConcurrentRequests(
  dependencies: ParseManagerDependencies,
): number {
  if (dependencies.getMaxConcurrentRequests) {
    return dependencies.getMaxConcurrentRequests();
  }
  return resolveEnvConcurrentRequestLimit(MAX_CONCURRENT_REQUESTS_DEFAULT);
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
  const lines = createProgressWindowTexts(id, args, getMessageText);
  const text = lines.map((l) => l.text).join("\n");
  try {
    const mainWin = Zotero.getMainWindow();
    if (mainWin) {
      mainWin.alert(text);
    }
  } catch (e) {
    ztoolkit.log("Failed to show alert", e);
  }
}

export function isMinerUGeneratedAttachment(item: Zotero.Item): boolean {
  if (!item) {
    return false;
  }
  if (typeof item.isAttachment === "function" && !item.isAttachment()) {
    return false;
  }
  try {
    const title = (item.getField?.("title") as string) || "";
    if (title.includes("(MinerU Layout)") || title.includes("(MinerU Span)")) {
      return true;
    }
    const filename = item.attachmentFilename || "";
    if (
      filename.toLowerCase() === "layout.pdf" ||
      filename.toLowerCase().endsWith("_layout.pdf")
    ) {
      return true;
    }
    const tags = item.getTags?.() || [];
    if (
      tags.some(
        (t: any) =>
          t.tag === "MinerU: Layout" ||
          t.tag === "MinerU: Span" ||
          t.tag === "MinerU",
      )
    ) {
      return true;
    }
  } catch {
    // Ignore error
  }
  return false;
}

function createDefaultDependencies(): ParseManagerDependencies {
  return {
    getApiKey,
    getParseSource,
    getParseTier,
    getLocalApiBaseURL,
    getLocalApiTimeoutMinutes,
    getSaveImages,
    getStatusTagsEnabled,
    getMaxConcurrentRequests: () =>
      resolveEnvConcurrentRequestLimit(MAX_CONCURRENT_REQUESTS_DEFAULT),
    createStorage: () => createStorage(getMinerUStorageRoot()),
    createClient: (settings) => createMinerUClientForSettings(settings),
    showMessage,
    confirmReparse,
    isFileReadable,
    delay: (ms) => Zotero.Promise.delay(ms),
    log: (...args) => ztoolkit.log(...args),
    onParseColumnRunning: markAttachmentParseRunning,
    onParseColumnReady: markAttachmentParseReady,
    onParseColumnClearRunning: clearAttachmentParseRunning,
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
  settings: {
    apiKey: string;
    source: ParseSource;
    tier: ParseTier;
    localApiBaseURL: string;
    saveImages: boolean;
  },
  dependencies: ParseManagerDependencies,
): MinerUClient {
  if (dependencies.client) {
    return dependencies.client;
  }
  if (dependencies.createClient) {
    return dependencies.createClient(settings);
  }
  throw new Error("Parse manager client dependency is missing");
}

function getCurrentParseSource(
  dependencies: ParseManagerDependencies,
): ParseSource {
  return dependencies.getParseSource?.() ?? "online";
}

function getCurrentParseTier(
  dependencies: ParseManagerDependencies,
  source: ParseSource,
): ParseTier {
  // The official cloud API only exposes the `standard` tier.
  if (source === "online") {
    return "standard";
  }
  return dependencies.getParseTier?.() ?? "standard";
}

function getPollTimeoutMs(
  source: ParseSource,
  dependencies: ParseManagerDependencies,
): number {
  if (source !== "local") {
    return DEFAULT_ONLINE_POLL_TIMEOUT_MS;
  }
  return (dependencies.getLocalApiTimeoutMinutes?.() ?? 30) * 60 * 1000;
}

function requiresApiKey(source: ParseSource): boolean {
  return source === "online";
}

async function hasExistingResultForMode(
  attachment: AttachmentRef,
  mode: ParseMode,
  storage: StorageAdapter,
): Promise<boolean> {
  return mode === "lite"
    ? await storage.hasLiteResult(attachment)
    : await storage.hasReadyResult(attachment);
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

/**
 * Default readability check: the PDF exists. A path IOUtils cannot parse
 * counts as unreadable instead of rejecting.
 * Exported for tests.
 */
export async function isFileReadable(filePath: string): Promise<boolean> {
  try {
    if (typeof IOUtils !== "undefined") {
      // Await inside the try: a returned promise would reject past the catch.
      return await IOUtils.exists(toNativePath(filePath));
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
  source: ParseSource,
): { id: FluentMessageId; args?: Record<string, string> } {
  const message = error instanceof Error ? error.message : String(error);
  // The local (V1) client names its request stages like the online one
  // ("submit", "poll", ...), so local failures are recognized by the source.
  if (source === "local" && error instanceof MinerURequestError) {
    return isTaskNotFoundError(error, source)
      ? { id: "parse-error-local-task-lost", args: { message } }
      : { id: "parse-error-local-api-unavailable", args: { message } };
  }
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

export { createProgressWindowTexts } from "./parseProgress";
export {
  createTaskResume,
  persistTaskResume,
  updateTaskDetail,
  getTaskResumeDirectory,
  ensureTaskResumeDirectory,
  resetTaskResumeDirectory,
  readChunkResult,
  writeChunkResult,
  serializeChunkValue,
  reviveChunkValue,
  cleanupTaskResume,
} from "./parseResume";
export {
  POLL_INTERVAL_MS,
  downloadTaskResultWithRetry,
  waitForTask,
  isTaskNotFoundError,
  isRetryableNetworkError,
  getReconnectDelayMs,
} from "./parseNetwork";
