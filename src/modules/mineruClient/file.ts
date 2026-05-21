import { MinerUFileAccessError } from "./errors";
import { errorMessage } from "./http";
import { toNativePath } from "./path";

/**
 * 读取 PDF 字节，并把底层文件访问失败转换为面向 MinerU 的错误。
 */
export async function readPdfBytes(
  readBinary: (filePath: string) => Promise<Uint8Array>,
  filePath: string,
): Promise<Uint8Array> {
  try {
    return await readBinary(filePath);
  } catch (error) {
    throw new MinerUFileAccessError(filePath, errorMessage(error));
  }
}

/**
 * 使用 Zotero 运行时可用的文件 API 读取本地文件字节。
 */
export async function readFileBytes(filePath: string): Promise<Uint8Array> {
  if (typeof IOUtils !== "undefined") {
    return IOUtils.read(toNativePath(filePath));
  }
  return OS.File.read(toNativePath(filePath)) as Promise<Uint8Array>;
}
