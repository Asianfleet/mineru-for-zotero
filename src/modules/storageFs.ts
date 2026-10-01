/**
 * Low-level filesystem helpers shared by the MinerU storage adapter.
 *
 * These wrappers prefer the Zotero runtime `IOUtils` API and transparently
 * fall back to the legacy `OS.File` API so the adapter keeps working across
 * Zotero/Firefox versions. They contain no MinerU domain knowledge, which
 * keeps `storage.ts` focused on result layout and manifest handling.
 */

import { toNativePath } from "./mineruClient/path";

export { toNativePath };

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "." : normalized.slice(0, index);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export async function readText(path: string): Promise<string> {
  if (hasIOUtils()) {
    return IOUtils.readUTF8(toNativePath(path));
  }
  const value = await OS.File.read(toNativePath(path), { encoding: "utf-8" });
  return typeof value === "string"
    ? value
    : new TextDecoder().decode(value as BufferSource);
}

export async function writeText(path: string, value: string): Promise<void> {
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

export async function writeBytes(
  path: string,
  value: Uint8Array,
): Promise<void> {
  await makeDir(dirname(path));
  if (hasIOUtils()) {
    await IOUtils.write(toNativePath(path), value, {
      tmpPath: toNativePath(`${path}.tmp`),
    });
    return;
  }
  await OS.File.writeAtomic(toNativePath(path), value, {
    tmpPath: toNativePath(`${path}.tmp`),
  });
}

export async function readBytes(path: string): Promise<Uint8Array> {
  if (hasIOUtils()) {
    return IOUtils.read(toNativePath(path));
  }
  const value = await OS.File.read(toNativePath(path));
  return typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value as ArrayBuffer | ArrayLike<number>);
}

export async function makeDir(path: string): Promise<void> {
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

export async function exists(path: string): Promise<boolean> {
  if (hasIOUtils()) {
    return IOUtils.exists(toNativePath(path));
  }
  return Boolean(await OS.File.exists(toNativePath(path)));
}

export async function movePath(from: string, to: string): Promise<void> {
  await makeDir(dirname(to));
  if (hasIOUtils()) {
    await IOUtils.move(toNativePath(from), toNativePath(to));
    return;
  }
  await OS.File.move(toNativePath(from), toNativePath(to));
}

export async function removePath(path: string): Promise<void> {
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

export async function readDir(path: string): Promise<string[]> {
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

export async function openFolder(path: string): Promise<void> {
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

export function hasIOUtils(): boolean {
  return typeof IOUtils !== "undefined";
}

export function resolveFsRoot(path: string): string {
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

  const dirServicePath = readDirectoryServicePath(services, key, nsIFile);
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

/**
 * Safely read a directory service path. Unknown keys throw NS_ERROR_FAILURE rather
 * than returning null, so exceptions must be caught and treated as a cache miss.
 */
function readDirectoryServicePath(
  services:
    | {
        dirsvc?: {
          get?: (key: string, iface: unknown) => { path?: string };
        };
      }
    | undefined,
  key: string,
  nsIFile: unknown,
): string | null {
  try {
    return services?.dirsvc?.get?.(key, nsIFile)?.path ?? null;
  } catch {
    return null;
  }
}

export function makeStamp(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function computeDirSize(path: string): Promise<number> {
  if (!(await exists(path))) {
    return 0;
  }
  if (hasIOUtils()) {
    try {
      const children = await IOUtils.getChildren(toNativePath(path));
      let total = 0;
      for (const child of children) {
        const stat = await IOUtils.stat(child);
        if (stat.type === "directory") {
          total += await computeDirSize(child);
        } else {
          total += stat.size ?? 0;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  let total = 0;
  const iterator = new OS.File.DirectoryIterator(toNativePath(path));
  try {
    await iterator.forEach(async (entry: OS.File.Entry) => {
      if (entry.isDir) {
        total += await computeDirSize(entry.path);
      } else {
        const stat = await OS.File.stat(entry.path);
        total += stat.size ?? 0;
      }
    });
  } catch {
    // Ignore errors
  } finally {
    iterator.close();
  }
  return total;
}
