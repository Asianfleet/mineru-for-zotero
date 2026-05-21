/** 输出 overlay 诊断信息，但不能让诊断干扰 reader 交互。 */
export function logReaderOverlayDiagnostic(
  message: string,
  payload: Record<string, unknown>,
): void {
  try {
    ztoolkit.log(`MinerU reader overlay ${message}`, payload);
  } catch {
    // 诊断不能影响 reader 交互。
  }

  try {
    Zotero.debug(
      `[MinerU for Zotero] reader overlay ${message} ${JSON.stringify(payload)}`,
    );
  } catch {
    // 测试或 teardown 阶段可能没有 Zotero.debug。
  }
}

/** 在 cleanup 过程中吞掉 dead object 异常，避免 split view teardown 中断。 */
export function safeReaderOverlayCleanup(cleanup: () => void): void {
  try {
    cleanup();
  } catch (error) {
    if (!isDeadObjectError(error)) {
      throw error;
    }
  }
}

/** 判断当前异常是否来自 Firefox/Zotero 的 dead object 访问。 */
export function isDeadObjectError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    String(error.message).includes("can't access dead object")
  );
}
