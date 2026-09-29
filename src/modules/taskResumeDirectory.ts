import { toNativePath } from "./mineruClient/path";

/**
 * Directory holding the per-chunk resume cache of an attachment.
 *
 * It lives in the Zotero data directory (not the Mozilla profile directory) so
 * it migrates together with the library. Kept in its own module so both the
 * task store and the resume layer can use it without an import cycle.
 */
export function getTaskResumeDirectory(attachmentID: number): string {
  return toNativePath(
    `${Zotero.DataDirectory.dir}/mineru-resume/${attachmentID}`,
  );
}

/**
 * Remove every cached chunk of an attachment. Best effort: the directory may
 * not exist, and a cleanup failure must never break the caller.
 */
export async function removeTaskResumeDirectory(
  attachmentID: number,
): Promise<void> {
  if (typeof IOUtils === "undefined" || !Number.isFinite(attachmentID)) {
    return;
  }
  try {
    await IOUtils.remove(getTaskResumeDirectory(attachmentID), {
      recursive: true,
    });
  } catch {
    // The directory may be absent or already removed.
  }
}
