export class MinerURequestError extends Error {
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

export class MinerUFileAccessError extends Error {
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

export class MinerUTaskError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MinerUTaskError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
