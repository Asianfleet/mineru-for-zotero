import { MinerUTaskError } from "./mineruClient";
import {
  getTaskResumeDirectory,
  removeTaskResumeDirectory,
} from "./taskResumeDirectory";
import {
  taskStore,
  TaskChunkRecord,
  TaskRecord,
  TaskResumeRecord,
} from "./taskStore";
import { ParseMode, ParseSource } from "../utils/prefs";

export { getTaskResumeDirectory };

export function createTaskResume(
  existing: TaskResumeRecord | undefined,
  source: ParseSource,
  mode: ParseMode,
  localApiBaseURL: string,
  filePath: string,
  pdfMtime: number,
  pageCount: number,
  chunkSize: number,
  chunkCount: number,
): TaskResumeRecord {
  const expectedChunks = Array.from({ length: chunkCount }, (_, index) => ({
    index,
    startPage: index * chunkSize + 1,
    endPage: Math.min((index + 1) * chunkSize, pageCount),
  }));
  const canReuse =
    existing?.source === source &&
    existing.mode === mode &&
    existing.filePath === filePath &&
    existing.pdfMtime === pdfMtime &&
    existing.pageCount === pageCount &&
    existing.chunkSize === chunkSize &&
    existing.chunks.length === expectedChunks.length &&
    expectedChunks.every((expected) => {
      const actual = existing.chunks[expected.index];
      return (
        actual?.index === expected.index &&
        actual.startPage === expected.startPage &&
        actual.endPage === expected.endPage
      );
    });

  if (canReuse) {
    return {
      ...existing,
      localApiBaseURL,
      chunks: existing.chunks.map((chunk) => ({ ...chunk })),
    };
  }

  return {
    source,
    mode,
    localApiBaseURL,
    filePath,
    pdfMtime,
    pageCount,
    chunkSize,
    chunks: expectedChunks.map(
      (chunk): TaskChunkRecord => ({
        ...chunk,
        status: "pending",
      }),
    ),
  };
}
export async function persistTaskResume(
  task: TaskRecord,
  resume: TaskResumeRecord,
): Promise<void> {
  task.resume = resume;
  const current = taskStore.getTask(task.id);
  const completed = resume.chunks.filter(
    (chunk) => chunk.status === "succeeded",
  ).length;
  // A cancelled or failed record must not be rewritten as running by a late
  // resume write, otherwise the next poll tick would overwrite the cancel.
  const status =
    current?.status === "failed" || current?.status === "cancelled"
      ? current.status
      : "running";
  await taskStore.upsertTask({
    ...task,
    ...current,
    resume,
    status,
    progress: Math.round((completed / resume.chunks.length) * 100),
    error: status === "running" ? undefined : current?.error,
  });
}
export async function updateTaskDetail(
  id: string,
  detail: string,
): Promise<void> {
  const current = taskStore.getTask(id);
  if (!current) {
    return;
  }
  await taskStore.upsertTask({ ...current, detail });
}
export async function ensureTaskResumeDirectory(path: string): Promise<void> {
  if (typeof IOUtils === "undefined") {
    throw new MinerUTaskError("IOUtils is unavailable for MinerU resume data");
  }
  await IOUtils.makeDirectory(path, { ignoreExisting: true });
}
export async function resetTaskResumeDirectory(path: string): Promise<void> {
  if (typeof IOUtils === "undefined") {
    throw new MinerUTaskError("IOUtils is unavailable for MinerU resume data");
  }
  try {
    await IOUtils.remove(path, { recursive: true });
  } catch {
    // A first parse has no resume directory yet.
  }
}
/**
 * Marker of chunk caches that keep image bytes in sidecar files instead of
 * inline JSON number arrays (which made a 20 MB chunk a ~70 MB JSON file that
 * took tens of seconds to parse on the main thread).
 */
const CHUNK_CACHE_FORMAT = 2;

/** Image entry of a chunk cache; the bytes live in `<cache>.image-<index>`. */
interface CachedChunkImage {
  path: string;
  index: number;
}

function chunkImagePath(cachePath: string, index: number): string {
  return `${cachePath}.image-${index}`;
}

export async function readChunkResult(path: string): Promise<any | null> {
  if (typeof IOUtils === "undefined") {
    return null;
  }
  try {
    if (!(await IOUtils.exists(path))) {
      return null;
    }
    const content = await IOUtils.readUTF8(path);
    // Caches written before CHUNK_CACHE_FORMAT 2 inline bytes as number arrays.
    const parsed = content.includes('"__mineruUint8Array"')
      ? JSON.parse(content, reviveChunkValue)
      : JSON.parse(content);
    if (parsed?.__mineruChunkCache !== CHUNK_CACHE_FORMAT) {
      return parsed && typeof parsed === "object" ? parsed : null;
    }

    const result = parsed.result;
    if (!result || typeof result !== "object") {
      return null;
    }
    if (Array.isArray(result.images)) {
      // A missing sidecar rejects, which turns the cache into a miss.
      result.images = await Promise.all(
        (result.images as CachedChunkImage[]).map(async (image) => ({
          path: image.path,
          bytes: await IOUtils.read(chunkImagePath(path, image.index)),
        })),
      );
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Cache one chunk result for Resume. Image bytes are written to sidecar files
 * first and the JSON last, so an existing cache file implies complete images.
 */
export async function writeChunkResult(
  path: string,
  result: unknown,
): Promise<void> {
  if (typeof IOUtils === "undefined") {
    throw new MinerUTaskError("IOUtils is unavailable for MinerU resume data");
  }
  const value = (result ?? {}) as {
    images?: Array<{ path: string; bytes: Uint8Array }>;
  };
  let images: CachedChunkImage[] | undefined;
  if (Array.isArray(value.images)) {
    images = [];
    for (const [index, image] of value.images.entries()) {
      await IOUtils.write(chunkImagePath(path, index), image.bytes);
      images.push({ path: image.path, index });
    }
  }
  const cache = {
    __mineruChunkCache: CHUNK_CACHE_FORMAT,
    result: images ? { ...value, images } : value,
  };
  await IOUtils.writeUTF8(path, JSON.stringify(cache, serializeChunkValue), {
    tmpPath: `${path}.tmp`,
  });
}
export function serializeChunkValue(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array
    ? { __mineruUint8Array: Array.from(value) }
    : value;
}
export function reviveChunkValue(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "__mineruUint8Array" in value &&
    Array.isArray(
      (value as { __mineruUint8Array?: unknown }).__mineruUint8Array,
    )
  ) {
    return new Uint8Array(
      (value as { __mineruUint8Array: number[] }).__mineruUint8Array,
    );
  }
  return value;
}
export async function cleanupTaskResume(
  taskID: string,
  resume: TaskResumeRecord,
): Promise<void> {
  if (typeof IOUtils !== "undefined") {
    for (const chunk of resume.chunks) {
      if (chunk.resultPath) {
        try {
          await IOUtils.remove(chunk.resultPath);
        } catch {
          // Cleanup is best effort after the final result is ready.
        }
      }
    }
    await removeTaskResumeDirectory(Number(taskID));
  }
  const current = taskStore.getTask(taskID);
  if (current) {
    await taskStore.upsertTask({
      ...current,
      resume: undefined,
      detail: undefined,
    });
  }
}
