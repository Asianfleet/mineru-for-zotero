import type { AttachmentRef, NormalizedBox, ParseManifest } from "./domain";
import { normalizeMinerUBoxes } from "./boxNormalizer";

type AttachmentKeyRef = Pick<AttachmentRef, "libraryID" | "key">;

export interface StorageAdapter {
  getAttachmentDir(ref: AttachmentKeyRef): string;
  hasReadyResult(ref: AttachmentKeyRef): Promise<boolean>;
  readManifest(ref: AttachmentKeyRef): Promise<ParseManifest>;
  readBoxes(ref: AttachmentKeyRef): Promise<NormalizedBox[]>;
  writeResult(input: {
    attachment: AttachmentRef;
    mineruTaskID: string;
    rawResult: unknown;
    markdown: string;
    boxes: NormalizedBox[];
  }): Promise<void>;
  writeFailedResult(input: {
    attachment: AttachmentRef;
    mineruTaskID: string;
    rawResult: unknown;
    markdown: string;
    error: string;
  }): Promise<void>;
  countReadyResults(): Promise<number>;
  openDataFolder(): Promise<void>;
}

const ATTACHMENTS_DIR = "attachments";
const MANIFEST_FILE = "manifest.json";
const RAW_RESULT_FILE = "mineru-result.json";
const CONTENT_FILE = "content.md";
const BOXES_FILE = "boxes.normalized.json";

export function createStorage(rootDir: string): StorageAdapter {
  const root = normalizePath(rootDir);
  const fsRoot = resolveFsRoot(root);

  return {
    getAttachmentDir(ref) {
      return getAttachmentDir(root, ref);
    },

    async hasReadyResult(ref) {
      try {
        const manifest = await readManifestFile(getAttachmentDir(fsRoot, ref));
        return manifest.status === "ready";
      } catch {
        return false;
      }
    },

    async readManifest(ref) {
      return readManifestFile(getAttachmentDir(fsRoot, ref));
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
      return refreshStaleBoxes(dir, boxes as NormalizedBox[]);
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
      };

      await writeAttachmentResultDir(fsRoot, input.attachment, {
        manifest,
        rawResult: input.rawResult,
        markdown: input.markdown,
        boxes: input.boxes,
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
          // 忽略损坏或非结果目录。
        }
      }
      return count;
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
    await input.validate?.(tempDir);
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

function getAttachmentDir(root: string, ref: AttachmentKeyRef): string {
  return joinPath(root, ATTACHMENTS_DIR, `${ref.libraryID}-${ref.key}`);
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

async function readText(path: string): Promise<string> {
  if (hasIOUtils()) {
    return IOUtils.readUTF8(toNativePath(path));
  }
  const value = await OS.File.read(toNativePath(path), { encoding: "utf-8" });
  return typeof value === "string"
    ? value
    : new TextDecoder().decode(value as BufferSource);
}

async function writeText(path: string, value: string): Promise<void> {
  await makeDir(dirname(path));
  if (hasIOUtils()) {
    await IOUtils.writeUTF8(toNativePath(path), value, {
      tmpPath: toNativePath(`${path}.tmp`),
    });
    return;
  }
  await OS.File.writeAtomic(toNativePath(path), value, {
    encoding: "utf-8",
    tmpPath: toNativePath(`${path}.tmp`),
  });
}

async function makeDir(path: string): Promise<void> {
  if (hasIOUtils()) {
    await IOUtils.makeDirectory(toNativePath(path), {
      createAncestors: true,
      ignoreExisting: true,
    });
    return;
  }

  let current = "";
  for (const part of normalizePath(path).split("/").filter(Boolean)) {
    current = current ? joinPath(current, part) : part;
    if (/^[a-z]:$/i.test(current)) {
      current = `${current}/`;
      continue;
    }
    await OS.File.makeDir(toNativePath(current), { ignoreExisting: true });
  }
}

async function exists(path: string): Promise<boolean> {
  if (hasIOUtils()) {
    return IOUtils.exists(toNativePath(path));
  }
  return Boolean(await OS.File.exists(toNativePath(path)));
}

async function movePath(from: string, to: string): Promise<void> {
  await makeDir(dirname(to));
  if (hasIOUtils()) {
    await IOUtils.move(toNativePath(from), toNativePath(to));
    return;
  }
  await OS.File.move(toNativePath(from), toNativePath(to));
}

async function removePath(path: string): Promise<void> {
  if (hasIOUtils()) {
    await IOUtils.remove(toNativePath(path), {
      ignoreAbsent: true,
      recursive: true,
    });
    return;
  }
  if (!(await exists(path))) {
    return;
  }
  const info = await OS.File.stat(toNativePath(path));
  if (info.isDir) {
    await OS.File.removeDir(toNativePath(path), {
      ignoreAbsent: true,
      ignorePermissions: true,
    });
    return;
  }
  await OS.File.remove(toNativePath(path), { ignoreAbsent: true });
}

async function readDir(path: string): Promise<string[]> {
  if (hasIOUtils()) {
    const children = await IOUtils.getChildren(toNativePath(path));
    return children.map((child) => basename(child));
  }

  const names: string[] = [];
  const iterator = new OS.File.DirectoryIterator(toNativePath(path));
  try {
    await iterator.forEach((entry: OS.File.Entry) => {
      if (entry.isDir) {
        names.push(entry.name);
      }
    });
  } finally {
    iterator.close();
  }
  return names;
}

async function openFolder(path: string): Promise<void> {
  const maybeZotero = globalThis as typeof globalThis & {
    Zotero?: {
      File?: {
        reveal?: (path: string) => Promise<void> | void;
      };
      launchFile?: (path: string) => Promise<void> | void;
    };
  };

  if (maybeZotero.Zotero?.File?.reveal) {
    await maybeZotero.Zotero.File.reveal(toNativePath(path));
    return;
  }
  if (maybeZotero.Zotero?.launchFile) {
    await maybeZotero.Zotero.launchFile(toNativePath(path));
  }
}

function hasIOUtils(): boolean {
  return typeof IOUtils !== "undefined";
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function toNativePath(path: string): string {
  if (/^[a-z]:\//i.test(path)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "." : normalized.slice(0, index);
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function resolveFsRoot(path: string): string {
  const parts = normalizePath(path).split("/");
  const [key, ...rest] = parts;
  const base = getDirectoryServicePath(key);

  if (!base) {
    return path;
  }
  return joinPath(base, ...rest);
}

function getDirectoryServicePath(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  const services = (
    globalThis as typeof globalThis & {
      Services?: {
        dirsvc?: {
          get?: (key: string, iface: unknown) => { path?: string };
        };
      };
      Ci?: {
        nsIFile?: unknown;
      };
      Components?: {
        interfaces?: {
          nsIFile?: unknown;
        };
      };
    }
  ).Services;
  const nsIFile =
    (
      globalThis as typeof globalThis & {
        Ci?: { nsIFile?: unknown };
        Components?: { interfaces?: { nsIFile?: unknown } };
      }
    ).Ci?.nsIFile ??
    (
      globalThis as typeof globalThis & {
        Components?: { interfaces?: { nsIFile?: unknown } };
      }
    ).Components?.interfaces?.nsIFile;

  const dirServicePath = services?.dirsvc?.get?.(key, nsIFile)?.path;
  if (dirServicePath) {
    return dirServicePath;
  }

  if (typeof PathUtils !== "undefined") {
    if (key === "TmpD") return PathUtils.tempDir;
    if (key === "ProfD") return PathUtils.profileDir;
  }

  if (typeof OS !== "undefined") {
    if (key === "TmpD") return OS.Constants.Path.tmpDir;
    if (key === "ProfD") return OS.Constants.Path.profileDir;
    if (key === "Home") return OS.Constants.Path.homeDir;
  }

  return null;
}

function makeStamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
