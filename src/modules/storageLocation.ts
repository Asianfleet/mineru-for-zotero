import { joinNativePath, toNativePath } from "./mineruClient/path";
import { resolveFsRoot } from "./storageFs";

/** Result folder in the Mozilla profile used by earlier versions. */
export const LEGACY_STORAGE_ROOT = "ProfD/mineru-copy";

const STORAGE_FOLDER = "mineru-copy";
const ATTACHMENTS_FOLDER = "attachments";

/**
 * Root folder of stored parse results: `mineru-copy` in the Zotero data
 * directory, so results move together with the library (the Mozilla profile
 * folder used before is not part of a data directory copy).
 */
export function getMinerUStorageRoot(
  dataDirectory: string = Zotero.DataDirectory.dir,
): string {
  return joinNativePath(dataDirectory, STORAGE_FOLDER);
}

export interface ResultStorageMigrationOptions {
  legacyRoot?: string;
  targetRoot?: string;
  log?: (...args: unknown[]) => void;
}

/**
 * Move results stored by earlier versions from the profile folder into the
 * data directory. Runs at startup before anything reads results.
 *
 * Each attachment folder is moved on its own (a rename on the same volume). A
 * folder that already exists in the data directory wins and the legacy copy is
 * left in place, so nothing is overwritten; a failed move is logged and
 * retried at the next startup. The legacy folder is removed once empty.
 * Resolves to the number of attachment folders moved.
 */
export async function migrateResultStorage(
  options: ResultStorageMigrationOptions = {},
): Promise<number> {
  if (typeof IOUtils === "undefined") {
    return 0;
  }
  const log = options.log ?? (() => {});
  const legacyRoot =
    options.legacyRoot ?? toNativePath(resolveFsRoot(LEGACY_STORAGE_ROOT));
  const targetRoot = options.targetRoot ?? getMinerUStorageRoot();
  const legacyAttachments = joinNativePath(legacyRoot, ATTACHMENTS_FOLDER);
  const targetAttachments = joinNativePath(targetRoot, ATTACHMENTS_FOLDER);

  let entries: string[];
  try {
    if (!(await IOUtils.exists(legacyAttachments))) {
      await removeIfEmpty(legacyRoot);
      return 0;
    }
    entries = await IOUtils.getChildren(legacyAttachments);
  } catch (error) {
    // No resolvable legacy folder (for example an unknown profile path).
    log("MinerU result migration skipped", error);
    return 0;
  }

  let moved = 0;
  if (entries.length > 0) {
    await IOUtils.makeDirectory(targetAttachments, {
      createAncestors: true,
      ignoreExisting: true,
    });
  }
  for (const entry of entries) {
    const name = entry.replace(/\\/g, "/").split("/").pop() ?? "";
    const destination = joinNativePath(targetAttachments, name);
    try {
      if (!name || (await IOUtils.exists(destination))) {
        continue;
      }
      await IOUtils.move(entry, destination);
      moved += 1;
    } catch (error) {
      log("Failed to move MinerU result", entry, error);
    }
  }

  await removeIfEmpty(legacyAttachments);
  await removeIfEmpty(legacyRoot);
  return moved;
}

/** Remove a folder only when it is empty (a non-recursive remove). */
async function removeIfEmpty(path: string): Promise<void> {
  try {
    await IOUtils.remove(path, { ignoreAbsent: true });
  } catch {
    // Not empty (or not removable): keep it.
  }
}
