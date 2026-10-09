import { Gunzip } from "fflate";

export interface SourceArchiveFile {
  path: string;
  bytes: Uint8Array;
}

const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 3000;
const GZIP_INPUT_CHUNK_BYTES = 64 * 1024;

/** 解码 arXiv 源码响应并拒绝越界路径和过大的归档。 */
export async function decodeSourceArchive(
  bytes: Uint8Array,
): Promise<SourceArchiveFile[]> {
  if (bytes.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error("unsafe-archive: compressed source is too large");
  }
  const expanded = isGzip(bytes) ? await decompressGzip(bytes) : bytes;
  if (expanded.byteLength > MAX_EXPANDED_BYTES) {
    throw new Error("unsafe-archive: expanded source is too large");
  }
  const text = new TextDecoder().decode(expanded.slice(0, 1024));
  if (text.startsWith("%PDF-")) {
    throw new Error("arxiv-source-not-found: response is a PDF");
  }
  if (isTar(expanded)) return decodeTar(expanded);
  if (!/\\(documentclass|begin\s*\{document\})/.test(text)) {
    throw new Error("arxiv-source-not-found: no TeX document found");
  }
  return [{ path: "main.tex", bytes: expanded }];
}

/** 分块解压 gzip 源码，并在流中限制输出大小。 */
async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const gunzip = new Gunzip((chunk) => {
    size += chunk.byteLength;
    if (size > MAX_EXPANDED_BYTES) {
      throw new Error("unsafe-archive: expanded source is too large");
    }
    chunks.push(chunk);
  });
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += GZIP_INPUT_CHUNK_BYTES
  ) {
    const end = Math.min(offset + GZIP_INPUT_CHUNK_BYTES, bytes.byteLength);
    gunzip.push(bytes.subarray(offset, end), end === bytes.byteLength);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** 按 512 字节块读取 tar 中的普通文件。 */
function decodeTar(bytes: Uint8Array): SourceArchiveFile[] {
  const files: SourceArchiveFile[] = [];
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header.subarray(0, 100));
    const prefix = tarString(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarString(header.subarray(124, 136)), 8);
    const type = header[156];
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_EXPANDED_BYTES) {
      throw new Error("unsafe-archive: invalid file size");
    }
    const start = offset + 512;
    const end = start + size;
    if (end > bytes.length) throw new Error("unsafe-archive: truncated file");
    if (type === 0 || type === 48) {
      if (!safePath(path)) throw new Error("unsafe-archive: invalid path");
      files.push({ path, bytes: bytes.slice(start, end) });
      if (files.length > MAX_FILES)
        throw new Error("unsafe-archive: too many files");
    } else if (type !== 53) {
      throw new Error(
        "unsafe-archive: links and special files are unsupported",
      );
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (!files.some((file) => file.path.toLowerCase().endsWith(".tex"))) {
    throw new Error("arxiv-source-not-found: no TeX document found");
  }
  return files;
}

/** 解码 tar 头部的 NUL 结尾文本。 */
function tarString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).split("\0", 1)[0].trim();
}

/** 校验归档相对路径，防止写出条目源码目录。 */
function safePath(path: string): boolean {
  return (
    Boolean(path) &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[a-z]:/i.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

/** 检查 gzip 文件头。 */
function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** 检查 tar 归档的 ustar 标记。 */
function isTar(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.slice(257, 262)) === "ustar";
}
