import { getSyncFolder } from "../utils/prefs";
import { joinNativePath, toNativePath } from "./mineruClient/path";
import { taskStore } from "./taskStore";

const INDEX_FILE = "_index.json";
const MANIFEST_FILE = "manifest.json";
const LITE_MANIFEST_FILE = "lite-manifest.json";
const CONTENT_FILE = "content.md";
const LITE_CONTENT_FILE = "lite-content.md";

interface AgentSyncItem {
  /** Parent item ID and key. */
  id: number;
  key: string;
  /** Synced PDF attachment; absent in entries written by older versions. */
  attachmentKey?: string;
  libraryID?: number;
  citationKey?: string;
  title?: string;
  year?: string;
  authors?: string;
  pdfPath?: string;
  markdownPath?: string;
}

export interface AgentSyncOptions {
  /** Sync folder to use instead of the preference. */
  syncFolder?: string;
  /** BibTeX exporter to use instead of Zotero's translator. */
  exportBibTeX?: (item: Zotero.Item) => Promise<string>;
}

/**
 * Copy one stored result into the agent sync folder and record it in
 * `_index.json`.
 *
 * Resolves to true only when the result was copied and indexed; false when
 * syncing is not configured, the attachment has no parent item, or the copy
 * failed.
 */
export async function syncResultToAgentFolder(
  attachment: Zotero.Item,
  sourceDir: string,
  options: AgentSyncOptions = {},
): Promise<boolean> {
  const syncFolder = (options.syncFolder ?? getSyncFolder()).trim();
  if (!syncFolder) {
    return false;
  }

  if (!hasIOUtils()) {
    log("IOUtils not available, cannot sync to agent folder");
    return false;
  }

  const parent = attachment.parentItem;
  if (!parent) {
    return false; // Standalone attachment, less useful for agent sync
  }

  const title = (parent.getField("title") as string) || "Untitled";
  const date = (parent.getField("date") as string) || "";
  const yearMatch = date.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : "";
  const citationKey =
    parent.getField("extra")?.match(/Citation Key:\s*([^\s]+)/)?.[1] || "";

  // Format: [CitationKey or Year] - [Title]
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").substring(0, 100);
  const prefix = citationKey ? citationKey : year ? year : "Item";
  const baseFolderName = `[${prefix}] - ${safeTitle}`;

  const syncRoot = joinNativePath(syncFolder);
  const nativeSourceDir = toNativePath(sourceDir);

  try {
    // Two PDFs of one item, or two papers sharing a year and title, map to
    // the same name. Only replace a folder this attachment synced before;
    // otherwise keep the attachment key in the name so neither is deleted.
    // Once an attachment uses the keyed name it keeps it.
    const keyedFolderName = `${baseFolderName} [${attachment.key}]`;
    const folderName =
      !(await IOUtils.exists(joinNativePath(syncRoot, keyedFolderName))) &&
      (await canSyncInto(joinNativePath(syncRoot, baseFolderName), attachment))
        ? baseFolderName
        : keyedFolderName;
    const targetDir = joinNativePath(syncRoot, folderName);

    // 1. Copy directory
    await IOUtils.makeDirectory(syncRoot, {
      createAncestors: true,
      ignoreExisting: true,
    });

    if (await IOUtils.exists(targetDir)) {
      await IOUtils.remove(targetDir, { recursive: true, ignoreAbsent: true });
    }

    // Zotero IOUtils might not have a direct copy directory, but let's try copy or manual copy
    try {
      await IOUtils.copy(nativeSourceDir, targetDir, {
        recursive: true,
      });
    } catch (e) {
      // Fallback: manually copy files if IOUtils.copy recursive fails
      await IOUtils.makeDirectory(targetDir, {
        createAncestors: true,
        ignoreExisting: true,
      });
      const children = await IOUtils.getChildren(nativeSourceDir);
      for (const child of children) {
        if (child.endsWith("images")) {
          // copy images dir
          const targetImagesDir = joinNativePath(targetDir, "images");
          await IOUtils.makeDirectory(targetImagesDir, {
            createAncestors: true,
            ignoreExisting: true,
          });
          const images = await IOUtils.getChildren(child);
          for (const img of images) {
            await IOUtils.copy(
              img,
              joinNativePath(targetImagesDir, getBasename(img)),
            );
          }
        } else {
          await IOUtils.copy(
            child,
            joinNativePath(targetDir, getBasename(child)),
          );
        }
      }
    }

    // 1.5 Export BibTeX
    try {
      const bibtex = await (options.exportBibTeX ?? exportBibTeX)(parent);
      if (bibtex) {
        await IOUtils.writeUTF8(
          joinNativePath(targetDir, "metadata.bib"),
          bibtex,
        );
      }
    } catch (e) {
      log("Failed to export BibTeX", e);
    }

    // 2. Update global index
    await updateGlobalIndex(syncRoot, {
      id: parent.id,
      key: parent.key,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      citationKey,
      title,
      year,
      authors: getCreatorsString(parent),
      pdfPath: attachment.getFilePath() || "",
      markdownPath: `${folderName}/${await getSyncedMarkdownFile(nativeSourceDir)}`,
    });
    return true;
  } catch (error) {
    log("Failed to sync MinerU result to agent folder", error);
    return false;
  }
}

/**
 * Report whether a sync folder may be (re)written for this attachment: it does
 * not exist yet, or it holds a copy of this attachment's own result.
 */
async function canSyncInto(
  dir: string,
  attachment: Zotero.Item,
): Promise<boolean> {
  if (!(await IOUtils.exists(dir))) {
    return true;
  }
  for (const manifestFile of [MANIFEST_FILE, LITE_MANIFEST_FILE]) {
    try {
      const manifest = JSON.parse(
        await IOUtils.readUTF8(joinNativePath(dir, manifestFile)),
      ) as { attachmentKey?: unknown; libraryID?: unknown };
      return (
        manifest.attachmentKey === attachment.key &&
        manifest.libraryID === attachment.libraryID
      );
    } catch {
      // Missing or unreadable manifest: try the next one.
    }
  }
  // A folder without a result manifest was not created by the sync.
  return false;
}

/**
 * Markdown file that agents should read: the precise result when it is
 * ready, otherwise the lite result.
 */
async function getSyncedMarkdownFile(sourceDir: string): Promise<string> {
  try {
    const manifest = JSON.parse(
      await IOUtils.readUTF8(joinNativePath(sourceDir, MANIFEST_FILE)),
    ) as { status?: unknown };
    if (manifest.status === "ready") {
      return CONTENT_FILE;
    }
  } catch {
    // No precise manifest: fall through to the lite result.
  }
  return (await IOUtils.exists(joinNativePath(sourceDir, LITE_CONTENT_FILE)))
    ? LITE_CONTENT_FILE
    : CONTENT_FILE;
}

async function updateGlobalIndex(
  syncRoot: string,
  newItem: AgentSyncItem,
): Promise<void> {
  const indexPath = joinNativePath(syncRoot, INDEX_FILE);
  let indexData: AgentSyncItem[] = [];

  try {
    if (await IOUtils.exists(indexPath)) {
      const content = await IOUtils.readUTF8(indexPath);
      indexData = JSON.parse(content) as AgentSyncItem[];
    }
  } catch (e) {
    log("Failed to read agent index", e);
  }

  // One entry per synced attachment. Entries written by older versions have
  // no attachmentKey and were keyed by the parent item, so replace those by
  // the parent key once.
  indexData = indexData.filter((item) =>
    item.attachmentKey
      ? item.attachmentKey !== newItem.attachmentKey ||
        item.libraryID !== newItem.libraryID
      : item.key !== newItem.key,
  );
  indexData.push(newItem);

  await IOUtils.writeUTF8(indexPath, JSON.stringify(indexData, null, 2), {
    tmpPath: `${indexPath}.tmp`,
  });
}

function getCreatorsString(item: Zotero.Item): string {
  const creators = item.getCreators() || [];
  return creators
    .map((c: any) => c.lastName || c.name || "")
    .filter(Boolean)
    .join(", ");
}

function getBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || "";
}

function hasIOUtils(): boolean {
  return typeof IOUtils !== "undefined";
}

/** Log through the plugin toolkit; it is not defined in isolated test runs. */
function log(...args: unknown[]): void {
  if (typeof ztoolkit !== "undefined") {
    ztoolkit.log(...args);
  }
}

export function exportBibTeX(item: Zotero.Item): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const translation = new Zotero.Translate.Export();
      translation.setItems([item]);
      // Use standard BibTeX translator ID
      translation.setTranslator("9cb70025-a888-4a29-a210-93ec52da40d4");
      translation.setHandler("done", (obj: any, worked: boolean) => {
        if (worked && obj && obj.string) {
          resolve(obj.string);
        } else {
          resolve(""); // Just resolve empty if it fails
        }
      });
      translation.translate();
    } catch (e) {
      log("Exception in exportBibTeX", e);
      resolve("");
    }
  });
}

/**
 * Refresh the MinerU tags of every attachment with a stored result and copy
 * the results into the agent sync folder when one is configured.
 *
 * Resolves to the number of results actually synced; `onProgress` reports how
 * many attachments were processed so far.
 */
export async function syncAllToAgentFolder(
  storage: import("./storage").StorageAdapter,
  onProgress?: (processed: number, total: number) => void,
): Promise<number> {
  const syncFolder = getSyncFolder().trim();
  const hasIO = hasIOUtils();
  const shouldSync = syncFolder && hasIO;

  const statuses = await storage.listParseStatuses();
  const readyKeys: {
    libraryID: number;
    key: string;
    preciseReady: boolean;
    liteReady: boolean;
  }[] = [];

  for (const [idKey, status] of statuses.entries()) {
    if (status.preciseReady || status.liteReady) {
      const parts = idKey.split("-");
      if (parts.length === 2) {
        readyKeys.push({
          libraryID: parseInt(parts[0], 10),
          key: parts[1],
          preciseReady: status.preciseReady,
          liteReady: status.liteReady,
        });
      }
    }
  }

  let processed = 0;
  let synced = 0;
  for (const ref of readyKeys) {
    const attachment = Zotero.Items.getByLibraryAndKey(ref.libraryID, ref.key);
    if (attachment && attachment.isAttachment()) {
      // 1. Update Tags
      try {
        attachment.removeTag("MinerU: Processing ⏳");
        attachment.removeTag("MinerU: Failed ❌");
        if (ref.preciseReady) {
          attachment.removeTag("MinerU: Lite ✅");
          attachment.addTag("MinerU: Precise ✅", 1);
        } else if (ref.liteReady) {
          attachment.removeTag("MinerU: Precise ✅");
          attachment.addTag("MinerU: Lite ✅", 1);
        }
        await attachment.saveTx();
      } catch (e) {
        // ignore tag errors
      }

      // 2. Sync to agent folder
      if (
        shouldSync &&
        (await syncResultToAgentFolder(
          attachment,
          storage.getAttachmentDir(ref),
        ))
      ) {
        synced++;
      }

      processed++;
      if (onProgress) {
        onProgress(processed, readyKeys.length);
      }
    }
  }

  return synced;
}

export async function updateAllMinerUTags(
  storage: import("./storage").StorageAdapter,
  onProgress?: (processed: number, total: number) => void,
): Promise<number> {
  const statuses = await storage.listParseStatuses();

  // Find all items with MinerU tags
  const search = new Zotero.Search();
  search.addCondition("tag", "contains", "MinerU:");
  const itemIDs = await search.search();

  let processed = 0;
  for (const id of itemIDs) {
    const item = await Zotero.Items.getAsync(id);
    if (!item) continue;

    let changed = false;
    const ref = { libraryID: item.libraryID, key: item.key };
    const idKey = `${ref.libraryID}-${ref.key}`;
    const status = statuses.get(idKey);

    const task = taskStore.getTask(String(id));
    const isRunning = task?.status === "running" || task?.status === "pending";
    const isFailed = task?.status === "failed";

    // Remove existing MinerU tags
    const tags = item
      .getTags()
      .filter(
        (t: any) => typeof t.tag === "string" && t.tag.startsWith("MinerU:"),
      );
    for (const t of tags) {
      item.removeTag(t.tag);
      changed = true;
    }

    // Add correct tag based on state
    if (isRunning) {
      item.addTag("MinerU: Processing ⏳", 1);
      changed = true;
    } else if (status?.preciseReady) {
      item.addTag("MinerU: Precise ✅", 1);
      changed = true;
    } else if (status?.liteReady) {
      item.addTag("MinerU: Lite ✅", 1);
      changed = true;
    } else if (isFailed) {
      item.addTag("MinerU: Failed ❌", 1);
      changed = true;
    }

    if (changed) {
      await item.saveTx();
    }

    processed++;
    if (onProgress) {
      onProgress(processed, itemIDs.length);
    }
  }
  return processed;
}
