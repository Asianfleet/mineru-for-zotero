import { AttachmentRef } from "./domain";

export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export interface TaskRecord {
  id: string; // unique job id, e.g., attachment ID
  attachment: AttachmentRef;
  title: string;
  status: TaskStatus;
  progress: number; // 0 to 100
  detail?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

class TaskManagerStore {
  private tasks = new Map<string, TaskRecord>();
  private listeners = new Set<() => void>();
  private dataFile: string;

  constructor() {
    this.dataFile = Zotero.DataDirectory.dir + "/mineru_tasks.json";
    this.load();
  }

  private async load() {
    if (typeof IOUtils !== "undefined") {
      try {
        if (await IOUtils.exists(this.dataFile)) {
          const content = await IOUtils.readUTF8(this.dataFile);
          const records: TaskRecord[] = JSON.parse(content);
          records.forEach((r) => this.tasks.set(r.id, r));
          this.notify();
        }
      } catch (e) {
        ztoolkit.log("Failed to load mineru_tasks.json", e);
      }
    }
  }

  private async save() {
    if (typeof IOUtils !== "undefined") {
      try {
        const records = Array.from(this.tasks.values());
        await IOUtils.writeUTF8(this.dataFile, JSON.stringify(records), {
          tmpPath: this.dataFile + ".tmp",
        });
      } catch (e) {
        ztoolkit.log("Failed to save mineru_tasks.json", e);
      }
    }
  }


  public getTasks(): TaskRecord[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  public getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  public upsertTask(task: TaskRecord) {
    this.tasks.set(task.id, { ...task, updatedAt: Date.now() });
    this.save();
    this.notify();
  }

  public updateTaskStatus(id: string, status: TaskStatus, error?: string) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
      if (error) task.error = error;
      task.updatedAt = Date.now();
      this.save();
      this.notify();
    }
  }

  public clearHistory() {
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === "succeeded" || task.status === "failed") {
        this.tasks.delete(id);
      }
    }
    this.save();
    this.notify();
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

export const taskStore = new TaskManagerStore();

export function openTaskManagerWindow(_callerWindow?: Window) {
  try {
    // Try to find an existing Task Manager window to avoid duplicates
    const mainWin = Zotero.getMainWindow();
    if (!mainWin) {
      ztoolkit.log("Cannot open Task Manager: no main window");
      return;
    }

    // Check for existing Task Manager window via window mediator
    try {
      const wm = (Components.classes as any)["@mozilla.org/appshell/window-mediator;1"]
        ?.getService(Components.interfaces.nsIWindowMediator);
      if (wm) {
        const existing = wm.getMostRecentWindow("mineruTaskManager");
        if (existing) {
          existing.focus();
          return;
        }
      }
    } catch (_e) {
      // Window mediator not available, proceed to open
    }

    // Use openDialog from main window — this is the most reliable method
    // in Zotero 7. It passes Zotero as window.arguments[0] so the child
    // window can always find the taskStore even in Flatpak/Wayland.
    mainWin.openDialog(
      `chrome://${addon.data.config.addonRef}/content/taskManager.html`,
      "MinerUTaskManager",
      "chrome,dialog=no,centerscreen,width=600,height=500,resizable",
      { Zotero, taskStore },
    );
  } catch (e) {
    ztoolkit.log("Failed to open Task Manager window", e);
  }
}
