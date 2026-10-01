import { config } from "../../package.json";
import { createStorage, type StorageAdapter, toNativePath } from "./storage";
import { syncResultToAgentFolder } from "./agentSync";
import { refreshAttachmentParseStatus } from "./itemTreeColumn";
import { getMinerUStorageRoot } from "./storageLocation";
import { getSyncFolder } from "../utils/prefs";
import { taskStore } from "./taskStore";

export interface ParsedResultEntry {
  libraryID: number;
  key: string;
  attachmentKey?: string;
  attachmentID?: number;
  title?: string;
  parentTitle?: string;
  fileName?: string;
  attachmentName?: string;
  pdfMtime?: number;
  parsedAt?: string;
  parsedAtMs?: number;
  preciseReady: boolean;
  hasPrecise?: boolean;
  liteReady: boolean;
  hasLite?: boolean;
  sizeBytes: number;
  totalSizeBytes?: number;
  isOrphan: boolean;
  attachmentDir?: string;
  hasImages?: boolean;
  hasBoxes?: boolean;
}

export interface ResultsManagerDependencies {
  storage: StorageAdapter;
  getItemByLibraryAndKey(
    libraryID: number,
    key: string,
  ): Promise<any | undefined>;
  getItemAsync(id: number): Promise<any | undefined>;
  selectItemInLibrary(id: number): Promise<void>;
  removeItemTag(id: number, tag: string): Promise<void>;
  eraseItem(id: number): Promise<void>;
  revealFolder(path: string): Promise<void>;
  /** Called after a stored result was deleted, to refresh dependent UI. */
  onResultDeleted?(ref: { libraryID: number; key: string }): Promise<void>;
}

export interface ResultsManagerService {
  scanAllResults(): Promise<ParsedResultEntry[]>;
  scan(): Promise<ParsedResultEntry[]>;
  deleteResultEntry(
    entry: ParsedResultEntry,
    options: { removeTags?: boolean; removeLayoutAttachment?: boolean },
  ): Promise<void>;
  deleteResult(
    entry: ParsedResultEntry,
    options: { removeTags?: boolean; removeLayoutAttachment?: boolean },
  ): Promise<{ freedBytes: number }>;
  cleanOrphans(
    entries: ParsedResultEntry[],
  ): Promise<{ count: number; freedBytes: number }>;
  selectItem(id: number): Promise<void>;
  locateItem(id: number): Promise<void>;
  openDataFolder(libraryID: number, key: string): Promise<void>;
  revealFolder(path: string): Promise<void>;
  readMarkdown(ref: { libraryID: number; key: string }): Promise<string>;
  syncResult?(entry: ParsedResultEntry): Promise<boolean>;
  syncSelected?(entries: ParsedResultEntry[]): Promise<number>;
}

const MINERU_TAGS = [
  "MinerU: Precise ✅",
  "MinerU: Lite ✅",
  "MinerU: Layout",
  "MinerU: Processing ⏳",
  "MinerU: Failed ❌",
];

export async function scanAllResults(
  deps: ResultsManagerDependencies,
): Promise<ParsedResultEntry[]> {
  const statuses = await deps.storage.listParseStatuses();
  const entries: ParsedResultEntry[] = [];

  for (const [dirName, status] of statuses.entries()) {
    const parts = dirName.split("-");
    if (parts.length !== 2) continue;

    const libraryID = parseInt(parts[0], 10);
    const key = parts[1];

    if (isNaN(libraryID) || !key) continue;

    const ref = { libraryID, key };
    const item = await deps.getItemByLibraryAndKey(libraryID, key);
    const isOrphan = !item;

    const preciseManifest = await deps.storage.readManifestSafe(ref);
    const liteManifest = await deps.storage.readLiteManifestSafe(ref);

    const sizeBytes = await deps.storage.getAttachmentDirSize(ref);

    const parsedAt =
      preciseManifest?.parsedAt || liteManifest?.parsedAt || undefined;
    const parsedAtMs = parsedAt ? new Date(parsedAt).getTime() : 0;
    const attachmentID =
      preciseManifest?.attachmentID || liteManifest?.attachmentID || item?.id;
    const fileName =
      preciseManifest?.fileName ||
      liteManifest?.fileName ||
      item?.getFilename?.() ||
      item?.attachmentFilename ||
      "document.pdf";
    const pdfMtime = preciseManifest?.pdfMtime || liteManifest?.pdfMtime;

    let title = fileName;
    const parentID = item?.parentItemID || item?.parentID;
    if (parentID) {
      let parent: any;
      try {
        parent = await deps.getItemAsync(parentID);
      } catch {
        // Ignore load error
      }
      if (parent) {
        title = parent.getField?.("title") || fileName;
      }
    } else if (item) {
      title = item.getField?.("title") || fileName;
    }

    const attachmentDir = deps.storage.getAttachmentDir?.(ref) || "";

    const contentFlags = status.preciseReady
      ? await deps.storage.readResultContentFlags(ref)
      : { hasImages: false, hasBoxes: false };

    entries.push({
      libraryID,
      key,
      attachmentKey: key,
      attachmentID,
      title,
      parentTitle: title,
      fileName,
      attachmentName: fileName,
      pdfMtime,
      parsedAt,
      parsedAtMs,
      preciseReady: status.preciseReady,
      hasPrecise: status.preciseReady,
      liteReady: status.liteReady,
      hasLite: status.liteReady,
      sizeBytes,
      totalSizeBytes: sizeBytes,
      isOrphan,
      attachmentDir,
      hasImages: contentFlags.hasImages,
      hasBoxes: contentFlags.hasBoxes,
    });
  }

  return entries.sort((a, b) => {
    const timeA = a.parsedAt ? new Date(a.parsedAt).getTime() : 0;
    const timeB = b.parsedAt ? new Date(b.parsedAt).getTime() : 0;
    return timeB - timeA;
  });
}

function isMinerULayoutAttachment(item: any): boolean {
  if (!item) return false;
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

export async function deleteResultEntry(
  entry: ParsedResultEntry,
  options: { removeTags?: boolean; removeLayoutAttachment?: boolean },
  deps: ResultsManagerDependencies,
): Promise<void> {
  const ref = {
    libraryID: entry.libraryID,
    key: entry.key || entry.attachmentKey!,
  };
  await deps.storage.deleteResult(ref);
  try {
    // Keep the item tree's parse column in step with what is now on disk.
    await deps.onResultDeleted?.(ref);
  } catch {
    // A UI refresh failure must not turn a completed deletion into an error.
  }

  if (!entry.isOrphan && entry.attachmentID) {
    if (options.removeTags) {
      for (const tag of MINERU_TAGS) {
        await deps.removeItemTag(entry.attachmentID, tag);
      }
    }
    if (options.removeLayoutAttachment && deps.eraseItem) {
      try {
        const item = await deps.getItemAsync(entry.attachmentID);
        const parentID = item?.parentItemID || item?.parentID;
        if (parentID) {
          let parent: any;
          try {
            parent = await deps.getItemAsync(parentID);
          } catch {
            // Ignore load error
          }
          const attIDs = (
            typeof parent?.getAttachments === "function"
              ? await parent.getAttachments()
              : []
          ) as number[];
          for (const attID of attIDs) {
            const att = await deps.getItemAsync(attID);
            if (att && isMinerULayoutAttachment(att)) {
              await deps.eraseItem(attID);
            }
          }
        }
      } catch {
        // Ignore errors when erasing layout attachment
      }
    }
  }
}

export async function cleanOrphans(
  entries: ParsedResultEntry[],
  deps: ResultsManagerDependencies,
): Promise<number> {
  let count = 0;
  for (const entry of entries) {
    if (entry.isOrphan) {
      await deleteResultEntry(entry, { removeTags: false }, deps);
      count++;
    }
  }
  return count;
}

export function createResultsManagerService(
  storage: StorageAdapter,
): ResultsManagerService {
  const deps: ResultsManagerDependencies = {
    storage,
    async getItemByLibraryAndKey(libraryID, key) {
      const Zotero = (globalThis as any).Zotero;
      if (!Zotero?.Items) return undefined;
      const item = Zotero.Items.getByLibraryAndKeyAsync
        ? await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key)
        : Zotero.Items.getByLibraryAndKey(libraryID, key);
      return item || undefined;
    },
    async getItemAsync(id) {
      const Zotero = (globalThis as any).Zotero;
      if (!Zotero?.Items) return undefined;
      return (
        (await Zotero.Items.getAsync?.(id)) ??
        Zotero.Items.get?.(id) ??
        undefined
      );
    },
    async selectItemInLibrary(id) {
      const Zotero = (globalThis as any).Zotero;
      const zp = Zotero?.getActiveZoteroPane?.();
      if (zp) {
        zp.selectItem(id, true);
        zp.window?.focus?.();
      }
    },
    async removeItemTag(id, tag) {
      const item = await (globalThis as any).Zotero?.Items?.getAsync(id);
      if (item && item.hasTag?.(tag)) {
        item.removeTag(tag);
        await item.saveTx();
      }
    },
    async eraseItem(id) {
      const item = await (globalThis as any).Zotero?.Items?.getAsync(id);
      if (item) {
        await item.eraseTx();
      }
    },
    async revealFolder(path) {
      const Zotero = (globalThis as any).Zotero;
      const nativePath = toNativePath(path);
      if (Zotero?.File?.reveal) {
        await Zotero.File.reveal(nativePath);
      } else if (Zotero?.launchFile) {
        await Zotero.launchFile(nativePath);
      }
    },
    async onResultDeleted(ref) {
      await refreshAttachmentParseStatus(ref, { storage });
    },
  };

  return {
    scanAllResults: async () => scanAllResults(deps),
    scan: async () => scanAllResults(deps),
    deleteResultEntry: async (entry, options) =>
      deleteResultEntry(entry, options, deps),
    deleteResult: async (entry, options) => {
      await deleteResultEntry(entry, options, deps);
      return { freedBytes: entry.totalSizeBytes || entry.sizeBytes || 0 };
    },
    cleanOrphans: async (entries) => {
      let count = 0;
      let freedBytes = 0;
      for (const entry of entries) {
        if (entry.isOrphan) {
          freedBytes += entry.totalSizeBytes || entry.sizeBytes || 0;
          await deleteResultEntry(entry, { removeTags: false }, deps);
          count++;
        }
      }
      return { count, freedBytes };
    },
    selectItem: async (id) => deps.selectItemInLibrary(id),
    locateItem: async (id) => deps.selectItemInLibrary(id),
    openDataFolder: async (libraryID, key) => {
      const path = storage.getAttachmentDir({ libraryID, key });
      await deps.revealFolder(path);
    },
    revealFolder: async (path) => deps.revealFolder(path),
    readMarkdown: async (ref) => {
      return storage.readPreferredMarkdown(ref);
    },
    syncResult: async (entry) => {
      const syncFolder = getSyncFolder().trim();
      if (!syncFolder) return false;
      const item = await deps.getItemAsync(entry.attachmentID ?? 0);
      if (!item) return false;
      const sourceDir = storage.getAttachmentDir({
        libraryID: entry.libraryID,
        key: entry.key || entry.attachmentKey!,
      });
      return syncResultToAgentFolder(item, sourceDir);
    },
    syncSelected: async (entries) => {
      const syncFolder = getSyncFolder().trim();
      if (!syncFolder) {
        throw new Error("No agent sync folder configured in preferences.");
      }
      let count = 0;
      for (const entry of entries) {
        if (!entry.isOrphan && entry.attachmentID) {
          const item = await deps.getItemAsync(entry.attachmentID);
          if (item) {
            const sourceDir = storage.getAttachmentDir({
              libraryID: entry.libraryID,
              key: entry.key || entry.attachmentKey!,
            });
            if (await syncResultToAgentFolder(item, sourceDir)) {
              count++;
            }
          }
        }
      }
      return count;
    },
  };
}

export interface ResultsManagerWindowDependencies {
  getMainWindow?: () => any;
  getMostRecentWindow?: (windowType: string) => any;
}

export function openResultsManagerWindow(
  service?: ResultsManagerService,
  windowDependencies: ResultsManagerWindowDependencies = {},
): void {
  try {
    const Zotero = (globalThis as any).Zotero;
    const mainWin = (
      windowDependencies.getMainWindow ?? (() => Zotero?.getMainWindow?.())
    )();
    if (!mainWin) {
      return;
    }

    try {
      const getMostRecentWindow =
        windowDependencies.getMostRecentWindow ??
        getMostRecentResultsManagerWindow;
      const existing =
        getMostRecentWindow("mineruTaskManager") ||
        getMostRecentWindow("mineruResultsManager");
      if (existing) {
        existing.focus();
        if (typeof existing.switchTab === "function") {
          existing.switchTab("results");
        }
        return;
      }
    } catch (_e) {
      // Ignore
    }

    if (!service) {
      const storage = createStorage(getMinerUStorageRoot());
      service = createResultsManagerService(storage);
    }

    mainWin.openDialog(
      `chrome://${config.addonRef}/content/taskManager.html`,
      "MinerUTaskManager",
      "chrome,dialog=no,centerscreen,dependent=yes,alwaysRaised=yes,width=920,height=650,resizable",
      { Zotero, taskStore, service, initialTab: "results" },
    );
  } catch (e) {
    (globalThis as any).Zotero?.debug?.(
      `Failed to open Results Manager window: ${e}`,
    );
  }
}

function getMostRecentResultsManagerWindow(windowType: string): any {
  const wm = (globalThis as any).Components?.classes?.[
    "@mozilla.org/appshell/window-mediator;1"
  ]?.getService((globalThis as any).Components?.interfaces?.nsIWindowMediator);
  return wm?.getMostRecentWindow?.(windowType) ?? null;
}
