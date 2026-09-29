import { MinerUTaskError } from "./errors";
import { isSafeRelativePath, summarizeBytes } from "./path";
import type { ZipEntries } from "./types";

// Guard against decompression bombs. MinerU only returns Markdown, JSON and
// page images for a PDF that is itself limited to 200 MB, so these caps are far
// above any legitimate result while still bounding memory use.
const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;

/**
 * Read entries to retain from a local ZIP file using Zotero nsIZipReader.
 */
export function readZipFile(path: string): ZipEntries | null {
  const xpcom = globalThis as typeof globalThis & {
    Components?: typeof Components;
  };
  const classes = xpcom.Components?.classes;
  const interfaces = xpcom.Components?.interfaces;
  if (!classes || !interfaces) {
    return null;
  }

  const classMap = classes as typeof classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const file = classMap["@mozilla.org/file/local;1"].createInstance(
    interfaces.nsIFile,
  ) as nsIFile;
  file.initWithPath(path);
  const reader = classMap["@mozilla.org/libjar/zip-reader;1"].createInstance(
    interfaces.nsIZipReader,
  ) as nsIZipReader;
  const entries: ZipEntries = new Map();
  try {
    reader.open(file);
    const names = reader.findEntries("*");
    while (names.hasMore()) {
      const name = names.getNext();
      if (reader.getEntry(name).isDirectory) {
        continue;
      }
      if (shouldReadZipEntry(name)) {
        entries.set(name, {
          name,
          bytes: readZipEntryBytes(reader, name, classes, interfaces),
        });
      }
    }
  } finally {
    reader.close();
  }
  return entries.size > 0 ? entries : null;
}

/**
 * Read the full bytes of a single ZIP entry from nsIZipReader.
 */
export function readZipEntryBytes(
  reader: nsIZipReader,
  name: string,
  classes: typeof Components.classes = Components.classes,
  interfaces: typeof Components.interfaces = Components.interfaces,
): Uint8Array {
  const input = reader.getInputStream(name);
  const classMap = classes as typeof Components.classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const binary = classMap["@mozilla.org/binaryinputstream;1"].createInstance(
    interfaces.nsIBinaryInputStream,
  ) as nsIBinaryInputStream;
  try {
    binary.setInputStream(input);
    const entry = reader.getEntry(name);
    return new Uint8Array(binary.readByteArray(entry.realSize));
  } finally {
    input.close();
  }
}

/**
 * Parse a ZIP ArrayBuffer and return the set of entries needed for MinerU results.
 */
export async function readZip(buffer: ArrayBuffer): Promise<ZipEntries> {
  const bytes = new Uint8Array(buffer);
  const entries: ZipEntries = new Map();
  const centralOffset = findCentralDirectoryOffset(bytes);
  const decoder = new TextDecoder();
  let offset = centralOffset;
  let totalBytes = 0;

  while (readUint32(bytes, offset) === 0x02014b50) {
    const method = readUint16(bytes, offset + 10);
    const compressedSize = readUint32(bytes, offset + 20);
    const uncompressedSize = readUint32(bytes, offset + 24);
    const nameLength = readUint16(bytes, offset + 28);
    const extraLength = readUint16(bytes, offset + 30);
    const commentLength = readUint16(bytes, offset + 32);
    const localOffset = readUint32(bytes, offset + 42);
    const name = decoder.decode(
      bytes.slice(offset + 46, offset + 46 + nameLength),
    );
    // Skip entries that are not part of a MinerU result before inflating them,
    // and reject entries whose declared size exceeds the safety caps.
    if (shouldReadZipEntry(name)) {
      assertZipEntryWithinLimits(name, uncompressedSize, totalBytes);
      const content = await readZipEntry(
        bytes,
        localOffset,
        method,
        compressedSize,
        uncompressedSize,
      );
      totalBytes += content.length;
      entries.set(name, { name, bytes: content });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Reject ZIP entries that would exceed the per-entry or total size caps.
 */
function assertZipEntryWithinLimits(
  name: string,
  uncompressedSize: number,
  totalBytes: number,
): void {
  if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
    throw new MinerUTaskError(
      `MinerU result zip entry is too large: ${name} (${uncompressedSize} bytes)`,
    );
  }
  if (totalBytes + uncompressedSize > MAX_ZIP_TOTAL_BYTES) {
    throw new MinerUTaskError(
      `MinerU result zip expands beyond the supported size (${totalBytes + uncompressedSize} bytes)`,
    );
  }
}

/**
 * Parse ZIP directly first; on failure, write to a temporary file and fall back to nsIZipReader parsing.
 */
export async function readZipWithFileFallback(
  buffer: ArrayBuffer,
  fileName = "mineru-result.zip",
): Promise<ZipEntries> {
  try {
    return await readZip(buffer);
  } catch (zipError) {
    const path = await createTemporaryPath(fileName);
    try {
      await writeTemporaryZip(path, new Uint8Array(buffer));
      const entries = readZipFile(path);
      if (entries) {
        return entries;
      }
      throw new MinerUTaskError(
        `${errorText(zipError)}; nsIZipReader fallback returned no readable entries`,
        { cause: zipError },
      );
    } catch (fallbackError) {
      throw new MinerUTaskError(
        `${errorText(zipError)}; nsIZipReader fallback failed: ${errorText(
          fallbackError,
        )}`,
        { cause: zipError },
      );
    } finally {
      await removeTemporaryZip(path);
    }
  }
}

/**
 * Reads a ZIP entry by local header offset and decodes it according to its compression method.
 */
export async function readZipEntry(
  bytes: Uint8Array,
  localOffset: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
): Promise<Uint8Array> {
  if (readUint32(bytes, localOffset) !== 0x04034b50) {
    throw new MinerUTaskError("MinerU result zip has an invalid local header");
  }

  const nameLength = readUint16(bytes, localOffset + 26);
  const extraLength = readUint16(bytes, localOffset + 28);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

  if (method === 0) {
    return compressed;
  }
  if (method === 8) {
    return inflateRaw(compressed, uncompressedSize);
  }
  throw new MinerUTaskError(`Unsupported MinerU result zip method ${method}`);
}

/**
 * Decompresses deflate-raw data using runtime DecompressionStream.
 */
export async function inflateRaw(
  compressed: Uint8Array,
  expectedSize: number,
): Promise<Uint8Array> {
  const streamCtor = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (format: string) => DecompressionStream;
    }
  ).DecompressionStream;
  if (!streamCtor) {
    throw new MinerUTaskError(
      "Cannot decompress MinerU result zip in this runtime",
    );
  }

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new streamCtor("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  const result = new Uint8Array(buffer);
  if (expectedSize > 0 && result.length !== expectedSize) {
    throw new MinerUTaskError("MinerU result zip entry size mismatch");
  }
  if (result.length > MAX_ZIP_ENTRY_BYTES) {
    throw new MinerUTaskError(
      `MinerU result zip entry is too large (${result.length} bytes)`,
    );
  }
  return result;
}

/**
 * Decodes ZIP entry bytes using UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Creates a temporary file path under the system temp directory for ZIP fallback reading.
 */
async function createTemporaryPath(fileName: string): Promise<string> {
  const baseDir = PathUtils.tempDir;
  const name = `${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`;
  return PathUtils.join(baseDir, name);
}

/**
 * Writes temporary ZIP bytes for nsIZipReader to read.
 */
async function writeTemporaryZip(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await IOUtils.write(path, bytes, { tmpPath: `${path}.tmp` });
}

/**
 * Removes temporary files created during ZIP fallback reading.
 */
async function removeTemporaryZip(path: string): Promise<void> {
  try {
    await IOUtils.remove(path, { ignoreAbsent: true });
  } catch {
    // Temporary file cleanup failures should not mask ZIP parse results or original errors.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Determines whether a ZIP entry needs to be read into memory.
 */
function shouldReadZipEntry(name: string): boolean {
  return (
    name.endsWith(".md") ||
    name.endsWith(".json") ||
    name.endsWith(".pdf") ||
    isReadableZipImageEntry(name)
  );
}

/**
 * Determines whether a ZIP image entry is located under a safe relative path within images/.
 */
function isReadableZipImageEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)images\/(.+)$/);
  if (!match) {
    return false;
  }
  return isSafeRelativePath(match[1]);
}

/**
 * Locates the starting offset of the ZIP central directory.
 */
export function findCentralDirectoryOffset(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (readUint32(bytes, offset) === 0x06054b50) {
      return readUint32(bytes, offset + 16);
    }
  }
  throw new MinerUTaskError(
    `MinerU result zip is missing central directory: ${summarizeBytes(bytes)}`,
  );
}

/**
 * Reads a little-endian uint16 from the byte array at the specified offset.
 */
export function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(
    0,
    true,
  );
}

/**
 * Reads a little-endian uint32 from the byte array at the specified offset.
 */
export function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
    0,
    true,
  );
}
