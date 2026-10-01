import {
  MinerURequestError,
  MinerUTaskError,
  MinerUClient,
} from "./mineruClient";
import { ParseSource } from "../utils/prefs";

export const POLL_INTERVAL_MS = 3000;

/**
 * Error raised when the user cancels a MinerU task.
 *
 * Cancellation is a normal outcome rather than a failure, so callers must not
 * report it as an error (no failure notice, no Failed tag).
 */
export class MinerUTaskCancelledError extends MinerUTaskError {
  constructor(message = "MinerU task cancelled by user") {
    super(message);
    this.name = "MinerUTaskCancelledError";
  }
}

export async function downloadTaskResultWithRetry(
  client: MinerUClient,
  taskID: string,
  delay: (ms: number) => Promise<void>,
  timeoutMs: number,
  source: ParseSource,
  log: (...args: unknown[]) => void,
  onRetry?: (attempt: number, waitMs: number) => Promise<void>,
  checkAbort?: () => boolean,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / POLL_INTERVAL_MS));
  let attempt = 0;
  while (true) {
    if (checkAbort?.()) {
      throw new MinerUTaskCancelledError();
    }
    try {
      return await client.downloadResult(taskID);
    } catch (error) {
      if (
        !isRetryableNetworkError(error, source) ||
        Date.now() >= deadline ||
        attempt >= maxAttempts
      ) {
        throw error;
      }
      attempt += 1;
      const waitMs = getReconnectDelayMs(attempt);
      log("MinerU result download interrupted; retrying", {
        taskID,
        attempt,
        waitMs,
        error,
      });
      await onRetry?.(attempt, waitMs);
      await delay(Math.min(waitMs, Math.max(0, deadline - Date.now())));
    }
  }
}
export async function waitForTask(
  client: MinerUClient,
  taskID: string,
  delay: (ms: number) => Promise<void>,
  timeoutMs: number,
  checkAbort?: () => boolean,
  source: ParseSource = "online",
  log: (...args: unknown[]) => void = () => {},
  onRetry?: (attempt: number, waitMs: number) => Promise<void>,
): Promise<void> {
  const maxPollCount = Math.ceil(timeoutMs / POLL_INTERVAL_MS);
  let retryAttempt = 0;
  for (let count = 0; count < maxPollCount; count += 1) {
    if (checkAbort?.()) {
      throw new MinerUTaskError("MinerU task cancelled by user");
    }
    try {
      const result = await client.pollTask(taskID);
      retryAttempt = 0;
      if (result.status === "succeeded") {
        return;
      }
      if (result.status === "failed") {
        throw new MinerUTaskError(result.error || "MinerU task failed");
      }
      await delay(POLL_INTERVAL_MS);
    } catch (error) {
      if (!isRetryableNetworkError(error, source)) {
        throw error;
      }
      retryAttempt += 1;
      const waitMs = getReconnectDelayMs(retryAttempt);
      log("MinerU task polling interrupted; retrying", {
        taskID,
        attempt: retryAttempt,
        waitMs,
        error,
      });
      await onRetry?.(retryAttempt, waitMs);
      await delay(waitMs);
    }
  }
  throw new MinerUTaskError("MinerU task timed out");
}
/**
 * Request stages that only read remote state, as named by both the V1 (local)
 * and V4 (online) clients, so repeating them cannot start a duplicate job.
 */
const IDEMPOTENT_REQUEST_STAGES = ["poll", "download"];

/**
 * Report whether a local MinerU server lost the task (HTTP 404 while polling or
 * downloading), usually because it restarted. Only the affected chunk needs to
 * be resubmitted.
 */
export function isTaskNotFoundError(
  error: unknown,
  source: ParseSource,
): boolean {
  return (
    source === "local" &&
    error instanceof MinerURequestError &&
    IDEMPOTENT_REQUEST_STAGES.includes(error.stage) &&
    error.status === 404
  );
}

/**
 * Report whether a failed request may be retried after a reconnect delay.
 *
 * Both sources share one rule: only transient failures (no response or HTTP
 * 5xx) of idempotent polling and download requests are retried. Re-submitting
 * or re-uploading could consume the daily quota twice or start a duplicate job.
 */
export function isRetryableNetworkError(
  error: unknown,
  _source: ParseSource,
): boolean {
  if (!(error instanceof MinerURequestError)) {
    return false;
  }
  const transient = error.status === 0 || error.status >= 500;
  return transient && IDEMPOTENT_REQUEST_STAGES.includes(error.stage);
}
export function getReconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 3_000 * 2 ** Math.min(attempt - 1, 3));
}
