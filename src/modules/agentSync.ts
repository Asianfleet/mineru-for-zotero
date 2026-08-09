import { getSyncFolder } from "../utils/prefs";
import { toNativePath } from "./mineruClient/path";

const INDEX_FILE = "_index.json";

interface AgentSyncItem {
  id: number;
  key: string;
  citationKey?: string;
  title?: string;
  year?: string;
  authors?: string;
  pdfPath?: string;
  markdownPath?: string;
}

export async function syncResultToAgentFolder(
  attachment: Zotero.Item,
  sourceDir: string,
): Promise<void> {
  const syncFolder = getSyncFolder().trim();
  if (!syncFolder) {
    return;
  }

  if (!hasIOUtils()) {
    ztoolkit.log("IOUtils not available, cannot sync to agent folder");
    return;
  }

  const parent = attachment.parentItem;
  if (!parent) {
    return; // Standalone attachment, less useful for agent sync
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
  const folderName = `[${prefix}] - ${safeTitle}`;

  const targetDir = toNativePath(`${syncFolder}/${folderName}`);
  const syncRoot = toNativePath(syncFolder);

  try {
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
      await IOUtils.copy(toNativePath(sourceDir), targetDir, {
        recursive: true,
      });
    } catch (e) {
      // Fallback: manually copy files if IOUtils.copy recursive fails
      await IOUtils.makeDirectory(targetDir, {
        createAncestors: true,
        ignoreExisting: true,
      });
      const children = await IOUtils.getChildren(toNativePath(sourceDir));
      for (const child of children) {
        if (child.endsWith("images")) {
          // copy images dir
          const targetImagesDir = `${targetDir}/images`;
          await IOUtils.makeDirectory(targetImagesDir, {
            createAncestors: true,
            ignoreExisting: true,
          });
          const images = await IOUtils.getChildren(child);
          for (const img of images) {
            await IOUtils.copy(img, `${targetImagesDir}/${getBasename(img)}`);
          }
        } else {
          await IOUtils.copy(child, `${targetDir}/${getBasename(child)}`);
        }
      }
    }

    // 1.5 Export BibTeX
    try {
      const bibtex = await exportBibTeX(parent);
      if (bibtex) {
        await IOUtils.writeUTF8(`${targetDir}/metadata.bib`, bibtex);
      }
    } catch (e) {
      ztoolkit.log("Failed to export BibTeX", e);
    }

    // 2. Update global index
    await updateGlobalIndex(syncRoot, {
      id: parent.id,
      key: parent.key,
      citationKey,
      title,
      year,
      authors: getCreatorsString(parent),
      pdfPath: attachment.getFilePath() || "",
      markdownPath: `${folderName}/content.md`,
    });
  } catch (error) {
    ztoolkit.log("Failed to sync MinerU result to agent folder", error);
  }
}

async function updateGlobalIndex(
  syncRoot: string,
  newItem: AgentSyncItem,
): Promise<void> {
  const indexPath = `${syncRoot}/${INDEX_FILE}`;
  let indexData: AgentSyncItem[] = [];

  try {
    if (await IOUtils.exists(indexPath)) {
      const content = await IOUtils.readUTF8(indexPath);
      indexData = JSON.parse(content) as AgentSyncItem[];
    }
  } catch (e) {
    ztoolkit.log("Failed to read agent index", e);
  }

  // Remove existing entry for same key if exists
  indexData = indexData.filter((item) => item.key !== newItem.key);
  indexData.push(newItem);

  try {
    await IOUtils.writeUTF8(indexPath, JSON.stringify(indexData, null, 2), {
      tmpPath: `${indexPath}.tmp`,
    });
  } catch (e) {
    ztoolkit.log("Failed to write agent index", e);
  }
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
      ztoolkit.log("Exception in exportBibTeX", e);
      resolve("");
    }
  });
}

export async function syncAllToAgentFolder(
  storage: import("./storage").StorageAdapter,
  onProgress?: (synced: number, total: number) => void
): Promise<number> {
  const syncFolder = getSyncFolder().trim();
  const hasIO = hasIOUtils();
  const shouldSync = syncFolder && hasIO;

  const statuses = await storage.listParseStatuses();
  const readyKeys: { libraryID: number; key: string; preciseReady: boolean; liteReady: boolean }[] = [];

  for (const [idKey, status] of statuses.entries()) {
    if (status.preciseReady || status.liteReady) {
      const parts = idKey.split("-");
      if (parts.length === 2) {
        readyKeys.push({
          libraryID: parseInt(parts[0], 10),
          key: parts[1],
          preciseReady: status.preciseReady,
          liteReady: status.liteReady
        });
      }
    }
  }

  let processed = 0;
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
      if (shouldSync) {
        const sourceDir = storage.getAttachmentDir(ref);
        await syncResultToAgentFolder(attachment, sourceDir);
      }
      
      processed++;
      if (onProgress) {
        onProgress(processed, readyKeys.length);
      }
    }
  }

  return processed;
}
