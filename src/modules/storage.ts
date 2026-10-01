import type {
  AttachmentRef,
  LiteParseManifest,
  MinerUImageFile,
  NormalizedBox,
  ParseManifest,
} from "./domain";
import { BOX_NORMALIZER_VERSION, normalizeMinerUBoxes } from "./boxNormalizer";
import {
  computeDirSize,
  exists,
  joinPath,
  makeDir,
  makeStamp,
  movePath,
  normalizePath,
  openFolder,
  readBytes,
  readDir,
  readText,
  removePath,
  resolveFsRoot,
  writeBytes,
  writeText,
} from "./storageFs";

export { toNativePath } from "./storageFs";

type AttachmentKeyRef = Pick<AttachmentRef, "libraryID" | "key">;

export interface StorageAdapter {
  getAttachmentDir(ref: AttachmentKeyRef): string;
  hasReadyResult(ref: AttachmentKeyRef): Promise<boolean>;
  hasLiteResult(ref: AttachmentKeyRef): Promise<boolean>;
  readParseStatus(ref: AttachmentKeyRef): Promise<{
    preciseReady: boolean;
    liteReady: boolean;
  }>;
  listParseStatuses(): Promise<
    Map<string, { preciseReady: boolean; liteReady: boolean }>
  >;
  readManifest(ref: AttachmentKeyRef): Promise<ParseManifest>;
  readMarkdown(ref: AttachmentKeyRef): Promise<string>;
  readPreferredMarkdown(ref: AttachmentKeyRef): Promise<string>;
  readBoxes(ref: AttachmentKeyRef): Promise<NormalizedBox[]>;
  readImageDataURL(
    ref: AttachmentKeyRef,
    imageMarkdownPath: string,
  ): Promise<string | null>;
  readResultContentFlags(ref: AttachmentKeyRef): Promise<{
    hasImages: boolean;
    hasBoxes: boolean;
  }>;
  writeResult(input: {
    attachment: AttachmentRef;
    mineruTaskID: string;
    rawResult: unknown;
    markdown: string;
    boxes: NormalizedBox[];
    images?: MinerUImageFile[];
  }): Promise<void>;
  writeFailedResult(input: {
    attachment: AttachmentRef;
    mineruTaskID: string;
    rawResult: unknown;
    markdown: string;
    error: string;
  }): Promise<void>;
  writeLiteResult(input: {
    attachment: AttachmentRef;
    mineruTaskID: string;
    source: "online" | "local";
    markdown: string;
  }): Promise<void>;
  deleteResult(
    ref: AttachmentKeyRef,
    options?: { preciseOnly?: boolean; liteOnly?: boolean },
  ): Promise<void>;
  getAttachmentDirSize(ref: AttachmentKeyRef): Promise<number>;
  readManifestSafe(ref: AttachmentKeyRef): Promise<ParseManifest | null>;
  readLiteManifestSafe(
    ref: AttachmentKeyRef,
  ): Promise<LiteParseManifest | null>;
  countReadyResults(): Promise<number>;
  openDataFolder(): Promise<void>;
}

const ATTACHMENTS_DIR = "attachments";
const MANIFEST_FILE = "manifest.json";
const RAW_RESULT_FILE = "mineru-result.json";
const CONTENT_FILE = "content.md";
const LITE_CONTENT_FILE = "lite-content.md";
const LITE_MANIFEST_FILE = "lite-manifest.json";
const BOXES_FILE = "boxes.normalized.json";
const IMAGES_DIR = "images";

export function createStorage(rootDir: string): StorageAdapter {
  const root = normalizePath(rootDir);
  const fsRoot = resolveFsRoot(root);

  return {
    getAttachmentDir(ref) {
      return getAttachmentDir(fsRoot, ref);
    },

    async hasReadyResult(ref) {
      return hasReadyPreciseResult(fsRoot, ref);
    },

    async hasLiteResult(ref) {
      return hasReadyLiteResult(fsRoot, ref);
    },

    async readParseStatus(ref) {
      return readParseStatusFromDir(fsRoot, ref);
    },

    async listParseStatuses() {
      const attachmentsDir = joinPath(fsRoot, ATTACHMENTS_DIR);
      const statuses = new Map<
        string,
        { preciseReady: boolean; liteReady: boolean }
      >();
      if (!(await exists(attachmentsDir))) {
        return statuses;
      }

      const children = await readDir(attachmentsDir);
      for (const child of children) {
        if (isTransientResultDir(child)) {
          continue;
        }
        if (!isAttachmentResultDirName(child)) {
          continue;
        }
        const status = await readParseStatusFromAttachmentDir(
          joinPath(attachmentsDir, child),
        );
        if (status.preciseReady || status.liteReady) {
          statuses.set(child, status);
        }
      }
      // readdir order varies by filesystem; sort by directory name for stable output.
      return new Map(
        [...statuses.entries()].sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    },

    async readManifest(ref) {
      return readManifestFile(getAttachmentDir(fsRoot, ref));
    },

    async readMarkdown(ref) {
      return readReadyMarkdown(fsRoot, ref);
    },

    async readPreferredMarkdown(ref) {
      if (await hasReadyPreciseResult(fsRoot, ref)) {
        return await readReadyMarkdown(fsRoot, ref);
      }
      return await readReadyLiteMarkdown(fsRoot, ref);
    },

    async readBoxes(ref) {
      const dir = getAttachmentDir(fsRoot, ref);
      const manifest = await readManifestFile(dir);
      if (manifest.status !== "ready") {
        throw new Error(`MinerU result is not ready: ${manifest.status}`);
      }
      const boxes = await readJson(joinPath(dir, BOXES_FILE));
      if (!Array.isArray(boxes)) {
        throw new Error("boxes.normalized.json is not an array");
      }
      if (manifest.boxesVersion === BOX_NORMALIZER_VERSION) {
        return boxes as NormalizedBox[];
      }

      // Boxes from an older normalizer: refresh them from the raw result once
      // and stamp the manifest, instead of re-reading and re-normalizing the
      // (possibly tens of MB) raw result on every read.
      const refreshed = await repairDuplicateRawIndexes(
        dir,
        await refreshStaleBoxes(dir, boxes as NormalizedBox[]),
      );
      try {
        await writeJson(joinPath(dir, MANIFEST_FILE), {
          ...manifest,
          boxesVersion: BOX_NORMALIZER_VERSION,
        });
      } catch {
        // A read-only result folder is refreshed again on the next read.
      }
      return refreshed;
    },

    async readImageDataURL(ref, imageMarkdownPath) {
      return readImageDataURLFromDir(
        getAttachmentDir(fsRoot, ref),
        imageMarkdownPath,
      );
    },

    async readResultContentFlags(ref) {
      return readResultContentFlagsFromDir(getAttachmentDir(fsRoot, ref));
    },

    async writeResult(input) {
      const manifest: ParseManifest = {
        attachmentID: input.attachment.id,
        attachmentKey: input.attachment.key,
        libraryID: input.attachment.libraryID,
        fileName: input.attachment.fileName,
        pdfMtime: input.attachment.mtime,
        parsedAt: new Date().toISOString(),
        mineruTaskID: input.mineruTaskID,
        resultVersion: 1,
        status: "ready",
        boxesVersion: BOX_NORMALIZER_VERSION,
      };

      await writeAttachmentResultDir(fsRoot, input.attachment, {
        manifest,
        rawResult: input.rawResult,
        markdown: input.markdown,
        boxes: input.boxes,
        images: input.images,
        validate: validateReadyDir,
      });
    },

    async writeFailedResult(input) {
      const manifest: ParseManifest = {
        attachmentID: input.attachment.id,
        attachmentKey: input.attachment.key,
        libraryID: input.attachment.libraryID,
        fileName: input.attachment.fileName,
        pdfMtime: input.attachment.mtime,
        parsedAt: new Date().toISOString(),
        mineruTaskID: input.mineruTaskID,
        resultVersion: 1,
        status: "failed",
        error: input.error,
      };

      await writeAttachmentResultDir(fsRoot, input.attachment, {
        manifest,
        rawResult: input.rawResult,
        markdown: input.markdown,
        boxes: [],
      });
    },

    async writeLiteResult(input) {
      if (!input.markdown.trim()) {
        throw new Error("MinerU lite markdown is empty");
      }
      const dir = getAttachmentDir(fsRoot, input.attachment);
      const manifest: LiteParseManifest = {
        attachmentID: input.attachment.id,
        attachmentKey: input.attachment.key,
        libraryID: input.attachment.libraryID,
        fileName: input.attachment.fileName,
        pdfMtime: input.attachment.mtime,
        parsedAt: new Date().toISOString(),
        mineruTaskID: input.mineruTaskID,
        resultVersion: 1,
        source: input.source,
        mode: "lite",
        status: "ready",
      };
      await writeText(joinPath(dir, LITE_CONTENT_FILE), input.markdown);
      await writeJson(joinPath(dir, LITE_MANIFEST_FILE), manifest);
    },

    async countReadyResults() {
      const attachmentsDir = joinPath(fsRoot, ATTACHMENTS_DIR);
      if (!(await exists(attachmentsDir))) {
        return 0;
      }

      const children = await readDir(attachmentsDir);
      let count = 0;
      for (const child of children) {
        if (isTransientResultDir(child)) {
          continue;
        }
        try {
          const manifest = await readManifestFile(
            joinPath(attachmentsDir, child),
          );
          if (manifest.status === "ready") {
            count += 1;
          }
        } catch {
          // Ignore corrupted or non-result directories.
        }
      }
      return count;
    },

    async deleteResult(ref, options) {
      const dir = getAttachmentDir(fsRoot, ref);
      if (!(await exists(dir))) {
        return;
      }
      if (options?.preciseOnly) {
        await removePath(joinPath(dir, MANIFEST_FILE));
        await removePath(joinPath(dir, RAW_RESULT_FILE));
        await removePath(joinPath(dir, CONTENT_FILE));
        await removePath(joinPath(dir, BOXES_FILE));
        await removePath(joinPath(dir, IMAGES_DIR));
      } else if (options?.liteOnly) {
        await removePath(joinPath(dir, LITE_MANIFEST_FILE));
        await removePath(joinPath(dir, LITE_CONTENT_FILE));
      } else {
        await removePath(dir);
      }
    },

    async getAttachmentDirSize(ref) {
      const dir = getAttachmentDir(fsRoot, ref);
      return computeDirSize(dir);
    },

    async readManifestSafe(ref) {
      try {
        return await readManifestFile(getAttachmentDir(fsRoot, ref));
      } catch {
        return null;
      }
    },

    async readLiteManifestSafe(ref) {
      try {
        return (await readJson(
          joinPath(getAttachmentDir(fsRoot, ref), LITE_MANIFEST_FILE),
        )) as LiteParseManifest;
      } catch {
        return null;
      }
    },

    async openDataFolder() {
      await makeDir(fsRoot);
      await openFolder(fsRoot);
    },
  };
}

async function writeAttachmentResultDir(
  root: string,
  attachment: AttachmentRef,
  input: {
    manifest: ParseManifest;
    rawResult: unknown;
    markdown: string;
    boxes: NormalizedBox[];
    images?: MinerUImageFile[];
    validate?: (dir: string) => Promise<void>;
  },
): Promise<void> {
  const targetDir = getAttachmentDir(root, attachment);
  const stamp = makeStamp();
  const tempDir = `${targetDir}.tmp-${stamp}`;
  const backupDir = `${targetDir}.bak-${stamp}`;

  try {
    await removePath(tempDir);
    await makeDir(tempDir);
    await writeJson(joinPath(tempDir, MANIFEST_FILE), input.manifest);
    await writeJson(joinPath(tempDir, RAW_RESULT_FILE), input.rawResult);
    await writeText(joinPath(tempDir, CONTENT_FILE), input.markdown);
    await writeJson(joinPath(tempDir, BOXES_FILE), input.boxes);
    await writeImages(joinPath(tempDir, IMAGES_DIR), input.images ?? []);
    await input.validate?.(tempDir);
    await preserveLiteFiles(targetDir, tempDir);
  } catch (error) {
    await removePath(tempDir);
    throw error;
  }

  const targetExists = await exists(targetDir);
  if (targetExists) {
    await removePath(backupDir);
    await movePath(targetDir, backupDir);
  }

  try {
    await movePath(tempDir, targetDir);
  } catch (error) {
    if (targetExists && (await exists(backupDir))) {
      await movePath(backupDir, targetDir);
    }
    await removePath(tempDir);
    throw error;
  }

  await removeBackupDir(backupDir);
}

function isTransientResultDir(name: string): boolean {
  return name.includes(".tmp-") || name.includes(".bak-");
}

async function readReadyMarkdown(
  root: string,
  ref: AttachmentKeyRef,
): Promise<string> {
  const dir = getAttachmentDir(root, ref);
  const manifest = await readManifestFile(dir);
  if (manifest.status !== "ready") {
    throw new Error(`MinerU result is not ready: ${manifest.status}`);
  }
  return readText(joinPath(dir, CONTENT_FILE));
}

async function hasReadyPreciseResult(
  root: string,
  ref: AttachmentKeyRef,
): Promise<boolean> {
  return hasReadyPreciseResultInDir(getAttachmentDir(root, ref));
}

async function hasReadyLiteResult(
  root: string,
  ref: AttachmentKeyRef,
): Promise<boolean> {
  try {
    await readReadyLiteMarkdown(root, ref);
    return true;
  } catch {
    return false;
  }
}

async function readParseStatusFromDir(
  root: string,
  ref: AttachmentKeyRef,
): Promise<{ preciseReady: boolean; liteReady: boolean }> {
  return readParseStatusFromAttachmentDir(getAttachmentDir(root, ref));
}

async function readParseStatusFromAttachmentDir(
  dir: string,
): Promise<{ preciseReady: boolean; liteReady: boolean }> {
  return {
    preciseReady: await hasReadyPreciseResultInDir(dir),
    liteReady: await hasReadyLiteResultInDir(dir),
  };
}

async function hasReadyPreciseResultInDir(dir: string): Promise<boolean> {
  try {
    const manifest = await readManifestFile(dir);
    return manifest.status === "ready";
  } catch {
    return false;
  }
}

async function hasReadyLiteResultInDir(dir: string): Promise<boolean> {
  try {
    const manifest = (await readJson(
      joinPath(dir, LITE_MANIFEST_FILE),
    )) as Partial<LiteParseManifest>;
    if (manifest.status !== "ready" || manifest.mode !== "lite") {
      return false;
    }
    const markdown = await readText(joinPath(dir, LITE_CONTENT_FILE));
    return Boolean(markdown.trim());
  } catch {
    return false;
  }
}

async function readReadyLiteMarkdown(
  root: string,
  ref: AttachmentKeyRef,
): Promise<string> {
  const dir = getAttachmentDir(root, ref);
  if (!(await hasReadyLiteResultInDir(dir))) {
    throw new Error("MinerU lite result is not ready");
  }
  return readText(joinPath(dir, LITE_CONTENT_FILE));
}

async function readImageDataURLFromDir(
  dir: string,
  imageMarkdownPath: string,
): Promise<string | null> {
  const relativePath = normalizeMinerUImageMarkdownPath(imageMarkdownPath);
  if (!relativePath) {
    return null;
  }
  const imagePath = joinPath(dir, IMAGES_DIR, relativePath);
  if (!(await exists(imagePath))) {
    return null;
  }
  const bytes = await readBytes(imagePath);
  return `data:${getImageMimeType(relativePath)};base64,${bytesToBase64(bytes)}`;
}

function getAttachmentDir(root: string, ref: AttachmentKeyRef): string {
  return joinPath(root, ATTACHMENTS_DIR, `${ref.libraryID}-${ref.key}`);
}

/**
 * Report which content a stored result actually contains.
 *
 * A precise result is "ready" even when it was saved without images or with an
 * empty box array, so callers must inspect the directory instead of inferring
 * content from the ready flag.
 */
async function readResultContentFlagsFromDir(
  dir: string,
): Promise<{ hasImages: boolean; hasBoxes: boolean }> {
  let hasBoxes = false;
  try {
    const boxes = await readJson(joinPath(dir, BOXES_FILE));
    hasBoxes = Array.isArray(boxes) && boxes.length > 0;
  } catch {
    hasBoxes = false;
  }

  let hasImages = false;
  try {
    const imagesDir = joinPath(dir, IMAGES_DIR);
    if (await exists(imagesDir)) {
      hasImages = (await readDir(imagesDir)).length > 0;
    }
  } catch {
    hasImages = false;
  }

  return { hasImages, hasBoxes };
}

function isAttachmentResultDirName(name: string): boolean {
  return /^\d+-[A-Z0-9]+$/.test(name);
}

async function preserveLiteFiles(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  const contentPath = joinPath(sourceDir, LITE_CONTENT_FILE);
  const manifestPath = joinPath(sourceDir, LITE_MANIFEST_FILE);
  if (!(await exists(contentPath)) || !(await exists(manifestPath))) {
    return;
  }
  JSON.parse(await readText(manifestPath));
  for (const fileName of [LITE_CONTENT_FILE, LITE_MANIFEST_FILE]) {
    await writeText(
      joinPath(targetDir, fileName),
      await readText(joinPath(sourceDir, fileName)),
    );
  }
}

async function validateReadyDir(dir: string): Promise<void> {
  const manifest = await readManifestFile(dir);
  const boxes = await readJson(joinPath(dir, BOXES_FILE));

  if (manifest.status !== "ready") {
    throw new Error("manifest status is not ready");
  }
  if (!Array.isArray(boxes)) {
    throw new Error("boxes.normalized.json is not an array");
  }
}

async function refreshStaleBoxes(
  dir: string,
  boxes: NormalizedBox[],
): Promise<NormalizedBox[]> {
  let rawResult: unknown;
  try {
    rawResult = await readJson(joinPath(dir, RAW_RESULT_FILE));
  } catch {
    return boxes;
  }

  const refreshed = normalizeMinerUBoxes(rawResult);
  if (refreshed.length === 0) {
    return boxes;
  }

  if (JSON.stringify(boxes) === JSON.stringify(refreshed)) {
    return boxes;
  }

  await writeJson(joinPath(dir, BOXES_FILE), refreshed);
  return refreshed;
}

/**
 * Give every stored box a unique `rawIndex`.
 *
 * Older versions restarted `rawIndex` at 0 in every chunk of a merged (more
 * than 200 page) result, so selecting or copying one box also picked up the
 * boxes sharing its index in other chunks. Boxes are stored in document order,
 * so renumbering by position matches what a fresh merge now produces. The fix
 * is written back on a best-effort basis; the repaired boxes are returned
 * either way.
 */
async function repairDuplicateRawIndexes(
  dir: string,
  boxes: NormalizedBox[],
): Promise<NormalizedBox[]> {
  const seen = new Set<number>();
  const hasDuplicates = boxes.some((box) => {
    if (seen.has(box.rawIndex)) {
      return true;
    }
    seen.add(box.rawIndex);
    return false;
  });
  if (!hasDuplicates) {
    return boxes;
  }

  const repaired = boxes.map((box, index) => ({ ...box, rawIndex: index }));
  try {
    await writeJson(joinPath(dir, BOXES_FILE), repaired);
  } catch {
    // Keep serving the repaired boxes even if the result folder is read-only.
  }
  return repaired;
}

async function removeBackupDir(path: string): Promise<void> {
  try {
    await removePath(path);
  } catch (error) {
    ztoolkit.log("failed to clean storage backup", path, error);
  }
}

async function readManifestFile(dir: string): Promise<ParseManifest> {
  return (await readJson(joinPath(dir, MANIFEST_FILE))) as ParseManifest;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readText(path));
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeImages(
  imagesDir: string,
  images: MinerUImageFile[],
): Promise<void> {
  for (const image of images) {
    const safePath = normalizeSafeRelativePath(image.path);
    if (!safePath) {
      continue;
    }
    await writeBytes(joinPath(imagesDir, safePath), image.bytes);
  }
}

function normalizeSafeRelativePath(path: string): string | null {
  const normalized = normalizePath(path);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized)
  ) {
    return null;
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return parts.join("/");
}

function normalizeMinerUImageMarkdownPath(path: string): string | null {
  const safePath = normalizeSafeRelativePath(decodeMarkdownPath(path));
  if (!safePath?.startsWith(`${IMAGES_DIR}/`)) {
    return null;
  }
  return safePath.slice(IMAGES_DIR.length + 1);
}

function decodeMarkdownPath(path: string): string {
  const withoutAnchor = path.split("#", 1)[0] ?? "";
  const withoutQuery = withoutAnchor.split("?", 1)[0] ?? "";
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

function getImageMimeType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") {
    return "image/jpeg";
  }
  if (extension === "webp") {
    return "image/webp";
  }
  if (extension === "gif") {
    return "image/gif";
  }
  return "image/png";
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return output;
}
