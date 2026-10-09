/**
 * Error representing a failure during a MinerU HTTP request stage.
 */
export class MinerURequestError extends Error {
  /**
   * Construct a request error with stage, HTTP status code, and error details.
   */
  constructor(
    public readonly stage: string,
    public readonly status: number,
    detail?: string,
  ) {
    super(
      detail
        ? `MinerU ${stage} request failed: ${detail}`
        : `MinerU ${stage} request failed with status ${status}`,
    );
    this.name = "MinerURequestError";
  }
}

/**
 * Error representing a failure to read a local PDF file.
 */
export class MinerUFileAccessError extends Error {
  /**
   * Construct a file access error with file path and underlying failure details.
   */
  constructor(
    public readonly filePath: string,
    detail?: string,
  ) {
    super(
      detail
        ? `Cannot read PDF file ${filePath}: ${detail}`
        : `Cannot read PDF file ${filePath}`,
    );
    this.name = "MinerUFileAccessError";
  }
}

/**
 * Error representing a failure during MinerU task submission, polling, download, or parsing.
 */
export class MinerUTaskError extends Error {
  /**
   * Construct a MinerU task error with an optional cause.
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MinerUTaskError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Error raised when MinerU itself reports a task as failed.
 *
 * This is a terminal remote state, not a request that could not be completed:
 * asking for the same task again only repeats the failure, so its task ID must
 * not be reused when the parse is resumed.
 */
export class MinerUTaskFailedError extends MinerUTaskError {
  constructor(message: string) {
    super(message);
    this.name = "MinerUTaskFailedError";
  }
}

/**
 * Convert an error code reported by MinerU to display text.
 *
 * The official cloud reports numbers such as `-60010` and strings such as
 * `A0202`; a self-hosted server reports strings such as `parse_failed`. Empty
 * values and `0` (the cloud's success code) mean that no code was reported.
 */
export function errorCodeText(code: unknown): string {
  if (typeof code === "number") {
    return Number.isFinite(code) && code !== 0 ? String(code) : "";
  }
  if (typeof code === "string") {
    const text = code.trim();
    return text === "0" ? "" : text;
  }
  return "";
}

/**
 * Describe a MinerU failure as `message (code X)`.
 *
 * A failure without a code says so and names the remote task or request
 * instead, which is the identifier MinerU needs to look the failure up.
 */
export function describeMinerUFailure(
  message: string,
  code: unknown,
  identifier?: string,
): string {
  const text = errorCodeText(code);
  if (text) {
    return `${message} (code ${text})`;
  }
  const details = ["no error code returned by MinerU", identifier].filter(
    Boolean,
  );
  return `${message} (${details.join("; ")})`;
}
