import { AttachmentRef } from "./domain";
import { joinNativePath } from "./mineruClient/path";
import { removeTaskResumeDirectory } from "./taskResumeDirectory";

export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type TaskChunkStatus = "pending" | "submitted" | "succeeded";

export interface TaskChunkRecord {
  index: number;
  startPage: number;
  endPage: number;
  status: TaskChunkStatus;
  taskID?: string;
  resultPath?: string;
}

export interface TaskResumeRecord {
  source: "online" | "local";
  mode: "precise" | "lite";
  localApiBaseURL?: string;
  filePath: string;
  pdfMtime: number;
  pageCount: number;
  chunkSize: number;
  chunks: TaskChunkRecord[];
}

export interface TaskRecord {
  id: string; // unique job id, e.g., attachment ID
  attachment: AttachmentRef;
  title: string;
  status: TaskStatus;
  progress: number; // 0 to 100
  detail?: string;
  error?: string;
  resume?: TaskResumeRecord;
  createdAt: number;
  updatedAt: number;
}

class TaskManagerStore {
  private tasks = new Map<string, TaskRecord>();
  private listeners = new Set<() => void>();
  private dataFile: string;
  private saveQueue: Promise<void> = Promise.resolve();
  private loadPromise: Promise<void>;

  constructor() {
    this.dataFile = getTaskStoreFilePath();
    this.loadPromise = this.load();
  }

  private async load() {
    if (typeof IOUtils !== "undefined") {
      try {
        if (await IOUtils.exists(this.dataFile)) {
          const content = await IOUtils.readUTF8(this.dataFile);
          const records: TaskRecord[] = JSON.parse(content);
          let hasStaleRunningTask = false;
          records.forEach((record) => {
            const task = { ...record };
            if (task.status === "running") {
              task.status = "failed";
              task.error = task.resume
                ? "The previous Zotero session ended; resume this task to continue."
                : "The previous Zotero session ended; retry this task to continue.";
              task.detail = task.resume
                ? "Resume available for the saved MinerU task."
                : "Retry available for the saved MinerU task.";
              hasStaleRunningTask = true;
            }
            this.tasks.set(task.id, task);
          });
          if (hasStaleRunningTask) {
            await this.save();
          }
          this.notify();
        }
      } catch (e) {
        ztoolkit.log("Failed to load mineru_tasks.json", e);
      }
    }
  }

  private save(): Promise<void> {
    if (typeof IOUtils === "undefined") {
      return Promise.resolve();
    }

    const records = Array.from(this.tasks.values());
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await IOUtils.writeUTF8(this.dataFile, JSON.stringify(records), {
          tmpPath: this.dataFile + ".tmp",
        });
      } catch (e) {
        ztoolkit.log("Failed to save mineru_tasks.json", e);
      }
    });
    return this.saveQueue;
  }

  public waitUntilLoaded(): Promise<void> {
    return this.loadPromise;
  }

  public getTasks(): TaskRecord[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  public getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  public upsertTask(task: TaskRecord): Promise<void> {
    this.tasks.set(task.id, { ...task, updatedAt: Date.now() });
    this.notify();
    return this.save();
  }

  public updateTaskStatus(
    id: string,
    status: TaskStatus,
    error?: string,
  ): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      return Promise.resolve();
    }
    task.status = status;
    if (error) task.error = error;
    task.updatedAt = Date.now();
    this.notify();
    return this.save();
  }

  /**
   * Wait until all task mutations queued so far have reached disk.
   * Critical resume metadata uses upsertTask's returned promise directly;
   * this method is useful for lifecycle and UI actions.
   */
  public waitForPersistence(): Promise<void> {
    return this.saveQueue;
  }

  /**
   * Drop every finished task and the resume cache that belongs to it.
   *
   * Resume chunks live outside the task record, so they have to be removed
   * here; a cleared record would otherwise strand its chunk files forever.
   */
  public async clearHistory(): Promise<void> {
    const removed: TaskRecord[] = [];
    for (const [id, task] of this.tasks.entries()) {
      if (isFinishedTaskStatus(task.status)) {
        removed.push(task);
        this.tasks.delete(id);
      }
    }
    this.notify();
    await this.save();

    for (const task of removed) {
      if (!task.resume) {
        continue;
      }
      await removeTaskResumeDirectory(Number(task.id));
    }
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Call every listener. A failing listener (for example one left behind by a
   * closed window) is logged and skipped: notify() runs before every save, so
   * letting it throw would also drop the write to disk.
   */
  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        if (typeof ztoolkit !== "undefined") {
          ztoolkit.log("MinerU task store listener failed", error);
        }
      }
    }
  }
}

/**
 * Native path of the persisted task list inside the Zotero data directory.
 */
export function getTaskStoreFilePath(
  dataDirectory: string = Zotero.DataDirectory.dir,
): string {
  return joinNativePath(dataDirectory, "mineru_tasks.json");
}

export const taskStore = new TaskManagerStore();

/** Report whether a task status is terminal and can be cleared from history. */
export function isFinishedTaskStatus(status: TaskStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}

export interface TaskManagerWindowOptions {
  initialTab?: "tasks" | "results";
}

export function openTaskManagerWindow(
  _callerWindow?: Window,
  options?: TaskManagerWindowOptions,
) {
  try {
    // Try to find an existing Task Manager window to avoid duplicates
    const mainWin = Zotero.getMainWindow();
    if (!mainWin) {
      ztoolkit.log("Cannot open Task Manager: no main window");
      return;
    }

    // Check for existing Task Manager window via window mediator
    try {
      const wm = (Components.classes as any)[
        "@mozilla.org/appshell/window-mediator;1"
      ]?.getService(Components.interfaces.nsIWindowMediator);
      if (wm) {
        const existing = wm.getMostRecentWindow("mineruTaskManager");
        if (existing) {
          existing.focus();
          if (
            options?.initialTab &&
            typeof (existing as any).switchTab === "function"
          ) {
            (existing as any).switchTab(options.initialTab);
          }
          return;
        }
      }
    } catch (_e) {
      // Window mediator not available, proceed to open
    }

    const addonInstance = (Zotero as any)?.MinerUForZotero;
    const service = addonInstance?.api?.createResultsManagerService?.();

    // Use openDialog from main window — this is the most reliable method
    // in Zotero 7. It passes Zotero as window.arguments[0] so the child
    // window can always find the taskStore even in Flatpak/Wayland.
    mainWin.openDialog(
      `chrome://${addon.data.config.addonRef}/content/taskManager.html`,
      "MinerUTaskManager",
      "chrome,dialog=no,centerscreen,dependent=yes,alwaysRaised=yes,width=920,height=650,resizable",
      {
        Zotero,
        taskStore,
        service,
        initialTab: options?.initialTab ?? "tasks",
      },
    );
  } catch (e) {
    ztoolkit.log("Failed to open Task Manager window", e);
  }
}
