import { MinerUFileAccessError } from "./errors";
import { errorMessage } from "./http";
import { toNativePath } from "./path";

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

export async function readFileBytes(filePath: string): Promise<Uint8Array> {
  if (typeof IOUtils !== "undefined") {
    return IOUtils.read(toNativePath(filePath));
  }
  return OS.File.read(toNativePath(filePath)) as Promise<Uint8Array>;
}
