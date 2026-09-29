import { config } from "../package.json";
import hooks from "./hooks";
import type { ItemTreeColumnState } from "./modules/itemTreeColumn";
import type {
  ReaderOverlayKey,
  ReaderOverlayState,
} from "./modules/readerOverlay";
import type { ReaderToolbarRegistration } from "./modules/readerToolbar";
import { createZToolkit } from "./utils/ztoolkit";
import { taskStore, openTaskManagerWindow } from "./modules/taskStore";
import {
  openResultsManagerWindow,
  createResultsManagerService,
} from "./modules/resultsManager";
import { createStorage } from "./modules/storage";
import { getMinerUStorageRoot } from "./modules/preferenceScript";
import { syncAllToAgentFolder, updateAllMinerUTags } from "./modules/agentSync";
import { parseAttachment, markTaskCancelled } from "./modules/parseManager";
import { getString } from "./utils/locale";
import type { FluentMessageId } from "../typings/i10n";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    itemTreeColumn?: ItemTreeColumnState;
    readerOverlays?: Map<ReaderOverlayKey, ReaderOverlayState>;
    readerToolbar?: ReaderToolbarRegistration;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {
      taskStore,
      openTaskManagerWindow,
      openResultsManagerWindow,
      createResultsManagerService: () =>
        createResultsManagerService(createStorage(getMinerUStorageRoot())),
      syncAllToAgentFolder,
      updateAllMinerUTags,
      retryTask: this.retryTask.bind(this),
      resumeTask: this.resumeTask.bind(this),
      cancelTask: this.cancelTask.bind(this),
      /**
       * Localized UI text for chrome dialogs (e.g. the Task Manager window)
       * that cannot resolve Fluent resources declaratively. Returns an empty
       * string when the locale bundle is unavailable; callers fall back to
       * their built-in English literals.
       */
      getString: (id: FluentMessageId, args?: Record<string, string>) => {
        try {
          return args ? getString(id, { args }) : getString(id);
        } catch {
          return "";
        }
      },
    };
  }

  /**
   * Cancel a running or queued task.
   *
   * The running pipeline owns the final state, so cancellation is signalled
   * through `markTaskCancelled` and the record is rewritten to `cancelled`
   * immediately, which the Task Manager renders as a stopped task with the
   * Resume/Retry actions instead of a failure.
   */
  public async cancelTask(taskId: string): Promise<void> {
    const existingTask = taskStore.getTask(taskId);
    if (!existingTask) {
      return;
    }
    if (
      existingTask.status !== "running" &&
      existingTask.status !== "pending"
    ) {
      return;
    }

    markTaskCancelled(taskId);
    await taskStore.upsertTask({
      ...existingTask,
      status: "cancelled",
      error: "Cancelled by user",
      detail: existingTask.resume
        ? "Resume available for the saved MinerU task."
        : undefined,
    });
  }

  public async resumeTask(taskId: string): Promise<void> {
    await taskStore.waitUntilLoaded();
    const existingTask = taskStore.getTask(taskId);
    if (!existingTask?.resume) {
      await this.retryTask(taskId);
      return;
    }

    const id = parseInt(taskId, 10);
    if (isNaN(id)) return;
    const item = await Zotero.Items.getAsync(id);
    if (item && item.isAttachment()) {
      await taskStore.upsertTask({
        ...existingTask,
        error: undefined,
        detail: "Resuming saved MinerU task...",
        status: "pending",
      });
      await parseAttachment(item, { force: true, resume: true });
    }
  }

  public async retryTask(taskId: string): Promise<void> {
    const id = parseInt(taskId, 10);
    if (isNaN(id)) return;
    const item = await Zotero.Items.getAsync(id);
    if (item && item.isAttachment()) {
      const existingTask = taskStore.getTask(taskId);
      if (existingTask) {
        await taskStore.upsertTask({
          ...existingTask,
          error: undefined,
          detail: "Retrying...",
          status: "pending",
        });
      }
      await parseAttachment(item, { force: true });
    }
  }
}

export default Addon;
