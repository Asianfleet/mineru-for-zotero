/** 将未知的抛出值转换为可读的诊断消息。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 尽力向 Zotero 和 browser console 输出 reader toolbar 诊断信息。 */
export function emitReaderToolbarDiagnostic(
  reader: _ZoteroTypes.ReaderInstance | undefined,
  message: string,
  payload: Record<string, unknown>,
): void {
  const text = `[MinerU for Zotero] ${message} ${JSON.stringify(payload)}`;

  try {
    ztoolkit.log(message, payload);
  } catch {
    // 保持诊断为尽力而为；不能因为日志失败而让菜单命令失败。
  }

  try {
    Zotero.debug(text);
  } catch {
    // 在隔离的测试/运行时环境中，Zotero.debug 可能不可用。
  }

  const consoles = new Set<Console>();
  if (typeof console !== "undefined") {
    consoles.add(console);
  }
  const readerConsole = reader?._iframeWindow?.console;
  if (readerConsole) {
    consoles.add(readerConsole);
  }

  try {
    const mainWindowConsole = Zotero.getMainWindow?.().console;
    if (mainWindowConsole) {
      consoles.add(mainWindowConsole);
    }
  } catch {
    // 在清理阶段，main window 不一定总是可用。
  }

  for (const targetConsole of consoles) {
    targetConsole.info(text);
  }
}
