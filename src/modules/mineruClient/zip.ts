import { MinerUTaskError } from "./errors";
import { isSafeRelativePath, summarizeBytes } from "./path";
import type { ZipEntries } from "./types";

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
          bytes: readZipEntryBytes(reader, name),
        });
      }
    }
  } finally {
    reader.close();
  }
  return entries.size > 0 ? entries : null;
}

export function readZipEntryBytes(reader: nsIZipReader, name: string): Uint8Array {
  const input = reader.getInputStream(name);
  const classMap = Components.classes as typeof Components.classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const binary = classMap["@mozilla.org/binaryinputstream;1"].createInstance(
    Components.interfaces.nsIBinaryInputStream,
  ) as nsIBinaryInputStream;
  try {
    binary.setInputStream(input);
    const entry = reader.getEntry(name);
    return new Uint8Array(binary.readByteArray(entry.realSize));
  } finally {
    input.close();
  }
}

export async function readZip(buffer: ArrayBuffer): Promise<ZipEntries> {
  const bytes = new Uint8Array(buffer);
  const entries: ZipEntries = new Map();
  const centralOffset = findCentralDirectoryOffset(bytes);
  const decoder = new TextDecoder();
  let offset = centralOffset;

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
    const content = await readZipEntry(
      bytes,
      localOffset,
      method,
      compressedSize,
      uncompressedSize,
    );
    if (shouldReadZipEntry(name)) {
      entries.set(name, { name, bytes: content });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

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
  return result;
}

export function textMapToZipEntries(entries: Map<string, string>): ZipEntries {
  const encoder = new TextEncoder();
  return new Map(
    [...entries].map(([name, value]) => [
      name,
      { name, bytes: encoder.encode(value) },
    ]),
  );
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function shouldReadZipEntry(name: string): boolean {
  return (
    name === "full.md" ||
    name.endsWith(".json") ||
    isReadableZipImageEntry(name)
  );
}

function isReadableZipImageEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized.startsWith("images/")) {
    return false;
  }
  return isSafeRelativePath(normalized.slice("images/".length));
}

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

export function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(
    0,
    true,
  );
}

export function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
    0,
    true,
  );
}
