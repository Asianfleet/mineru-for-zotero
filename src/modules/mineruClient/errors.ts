/**
 * 表示 MinerU HTTP 请求阶段失败的错误。
 */
export class MinerURequestError extends Error {
  /**
   * 构造包含请求阶段、HTTP 状态码和错误详情的请求错误。
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
 * 表示读取本地 PDF 文件失败的错误。
 */
export class MinerUFileAccessError extends Error {
  /**
   * 构造包含文件路径和底层失败详情的文件访问错误。
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
 * 表示 MinerU 任务提交、轮询、下载或解析阶段失败的错误。
 */
export class MinerUTaskError extends Error {
  /**
   * 构造可携带 cause 的 MinerU 任务错误。
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MinerUTaskError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}
