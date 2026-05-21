import { firstExtractResult, requestOk } from "./api";
import { MinerUTaskError } from "./errors";
import { readFileBytes } from "./file";
import { errorMessage, normalizeBinary, toStandaloneArrayBuffer } from "./http";
import { safeURL } from "./path";
import type { ExtractResultsBatchResponse, ZipEntries } from "./types";
import { readZip, readZipFile, textMapToZipEntries } from "./zip";

export async function readZipOrFallback(
  zipBuffer: ArrayBuffer,
  rawResult: ExtractResultsBatchResponse,
  zipURL: string | undefined,
  markdownURL: string | undefined,
  downloadBinary: (url: string) => Promise<Response>,
  downloadFileBytes: (url: string) => Promise<Uint8Array | ZipEntries>,
): Promise<ZipEntries> {
  const diagnostics: string[] = [];
  try {
    return await readZip(zipBuffer);
  } catch (zipError) {
    diagnostics.push(
      `network ${safeURL(zipURL)} ${zipBuffer.byteLength} bytes: ${errorMessage(zipError)}`,
    );
    if (zipURL) {
      try {
        const fileResult = await downloadFileBytes(zipURL);
        if (fileResult instanceof Map) {
          diagnostics.push(`file ${safeURL(zipURL)} zip reader`);
          return fileResult;
        }
        diagnostics.push(
          `file ${safeURL(zipURL)} ${fileResult.byteLength} bytes`,
        );
        return await readZip(toStandaloneArrayBuffer(fileResult));
      } catch (fileError) {
        diagnostics.push(
          `file ${safeURL(zipURL)} failed: ${errorMessage(fileError)}`,
        );
      }
    }
    if (!markdownURL) {
      throw withDownloadDiagnostics(zipError, diagnostics);
    }
    const markdownResponse = await requestOk(
      () => downloadBinary(markdownURL),
      markdownURL,
      "download",
      { method: "GET" },
    );
    return textMapToZipEntries(
      new Map([
        ["full.md", await markdownResponse.text()],
        ["mineru-result.json", JSON.stringify(rawResult)],
      ]),
    );
  }
}

export function withDownloadDiagnostics(
  error: unknown,
  diagnostics: string[],
): MinerUTaskError {
  const message = error instanceof Error ? error.message : String(error);
  return new MinerUTaskError(
    `${message}; attempts: ${diagnostics.join("; ")}`,
    {
      cause: error,
    },
  );
}

export async function retryDownloadZip(
  refetch: () => Promise<{
    response: ExtractResultsBatchResponse;
    result: ReturnType<typeof firstExtractResult>;
  }>,
  initial: {
    response: ExtractResultsBatchResponse;
    result: ReturnType<typeof firstExtractResult>;
  },
  downloadBinary: (url: string) => Promise<Response>,
  downloadFileBytes: (url: string) => Promise<Uint8Array | ZipEntries>,
  maxAttempts: number,
  retryDelayMs: number,
): Promise<ZipEntries> {
  let current = initial;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const zipURL = current.result?.full_zip_url;
    if (!zipURL) {
      break;
    }
    try {
      const zipResponse = await requestOk(
        () => downloadBinary(zipURL),
        zipURL,
        "download",
        { method: "GET" },
      );
      return await readZipOrFallback(
        await zipResponse.arrayBuffer(),
        current.response,
        zipURL,
        current.result?.md_url,
        downloadBinary,
        downloadFileBytes,
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableDownloadError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await delay(retryDelayMs);
      current = await refetch();
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new MinerUTaskError("MinerU result download failed");
}

export function isRetryableDownloadError(error: unknown): boolean {
  return (
    error instanceof MinerUTaskError && error.message.includes("empty response")
  );
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (typeof Zotero !== "undefined" && Zotero.Promise?.delay) {
    await Zotero.Promise.delay(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function zoteroDownloadFileBytes(
  url: string,
): Promise<Uint8Array | ZipEntries> {
  const path = await createTemporaryPath("mineru-result.zip");
  try {
    const curlResult = await downloadWithCurl(url, path);
    if (!curlResult.used) {
      await Zotero.File.download(url, path);
    }
    return readZipFile(path) ?? normalizeBinary(await readFileBytes(path));
  } catch (error) {
    throw new MinerUTaskError(`file download failed: ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    await removeFileIfExists(path);
  }
}

export async function downloadWithCurl(
  url: string,
  path: string,
): Promise<{ used: boolean; reason?: string }> {
  const platform = getRuntimePlatform();
  if (platform !== "win") {
    return { used: false, reason: `platform=${platform}` };
  }
  const processResult = await downloadWithNsIProcess(url, path);
  if (processResult.used) {
    return processResult;
  }
  const process = (
    globalThis as typeof globalThis & {
      ChromeUtils?: {
        importESModule?: (uri: string) => {
          Subprocess?: {
            call: (options: {
              command: string;
              arguments: string[];
              stdout?: string;
              stderr?: string;
            }) => Promise<{ exitCode: number; stderr?: string }>;
          };
        };
      };
    }
  ).ChromeUtils?.importESModule?.(
    "chrome://zotero/content/Subprocess.sys.mjs",
  )?.Subprocess;
  if (!process) {
    return { used: false, reason: `no subprocess; ${processResult.reason}` };
  }
  const result = await process.call({
    command: "curl.exe",
    arguments: ["-L", "--fail", "--silent", "--show-error", "-o", path, url],
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `curl.exe download failed: ${result.stderr || result.exitCode}`,
    );
  }
  return { used: true };
}

export function getRuntimePlatform(): "win" | "mac" | "linux" | "unknown" {
  const runtime = globalThis as typeof globalThis & {
    AppConstants?: { platform?: string };
    Services?: { appinfo?: { OS?: string } };
    navigator?: { platform?: string };
  };
  const value = [
    runtime.AppConstants?.platform,
    runtime.Services?.appinfo?.OS,
    runtime.navigator?.platform,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (value.includes("win")) {
    return "win";
  }
  if (value.includes("mac") || value.includes("darwin")) {
    return "mac";
  }
  if (value.includes("linux")) {
    return "linux";
  }
  return "unknown";
}

export async function downloadWithNsIProcess(
  url: string,
  path: string,
): Promise<{ used: boolean; reason?: string }> {
  const xpcom = globalThis as typeof globalThis & {
    Components?: typeof Components;
  };
  const classes = xpcom.Components?.classes;
  const interfaces = xpcom.Components?.interfaces;
  if (!classes || !interfaces) {
    return { used: false, reason: "no Components classes/interfaces" };
  }

  const curlPath = await findCurlPath();
  if (!curlPath) {
    return { used: false, reason: "curl.exe not found" };
  }

  const classMap = classes as typeof classes &
    Record<string, { createInstance: (iid: unknown) => nsISupports }>;
  const file = classMap["@mozilla.org/file/local;1"].createInstance(
    interfaces.nsIFile,
  ) as nsIFile;
  file.initWithPath(curlPath);
  const process = classMap["@mozilla.org/process/util;1"].createInstance(
    interfaces.nsIProcess,
  ) as nsIProcess;
  process.init(file);
  process.startHidden = true;
  process.noShell = true;
  const args = ["-L", "--fail", "--silent", "--show-error", "-o", path, url];
  process.run(true, args, args.length);
  if (process.exitValue !== 0) {
    throw new Error(`curl.exe process exited with ${process.exitValue}`);
  }
  const size = await fileSize(path);
  if (size <= 0) {
    throw new Error("curl.exe produced an empty file");
  }
  return { used: true };
}

export async function findCurlPath(): Promise<string | null> {
  const candidates = [
    "C:\\Windows\\System32\\curl.exe",
    "C:\\Windows\\Sysnative\\curl.exe",
  ];
  for (const path of candidates) {
    if (await fileExists(path)) {
      return path;
    }
  }
  return null;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    if (typeof IOUtils !== "undefined") {
      return IOUtils.exists(path);
    }
    return OS.File.exists(path);
  } catch {
    return false;
  }
}

export async function fileSize(path: string): Promise<number> {
  try {
    if (typeof IOUtils !== "undefined") {
      const stat = await IOUtils.stat(path);
      return stat.size ?? 0;
    }
    const stat = await OS.File.stat(path);
    return stat.size ?? 0;
  } catch {
    return 0;
  }
}

export async function createTemporaryPath(fileName: string): Promise<string> {
  const baseDir =
    typeof PathUtils !== "undefined"
      ? PathUtils.tempDir
      : OS.Constants.Path.tmpDir;
  const name = `${Date.now()}-${Math.random().toString(16).slice(2)}-${fileName}`;
  return typeof PathUtils !== "undefined"
    ? PathUtils.join(baseDir, name)
    : OS.Path.join(baseDir, name);
}

export async function removeFileIfExists(path: string): Promise<void> {
  try {
    if (typeof IOUtils !== "undefined") {
      await IOUtils.remove(path, { ignoreAbsent: true });
      return;
    }
    await OS.File.remove(path, { ignoreAbsent: true });
  } catch {
    // Temporary-file cleanup failure should not hide the parse result.
  }
}
