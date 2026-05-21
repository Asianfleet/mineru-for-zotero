/** Converts an unknown thrown value into a readable diagnostic message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Emits best-effort reader toolbar diagnostics to Zotero and browser consoles. */
export function emitReaderToolbarDiagnostic(
  reader: _ZoteroTypes.ReaderInstance | undefined,
  message: string,
  payload: Record<string, unknown>,
): void {
  const text = `[MinerU for Zotero] ${message} ${JSON.stringify(payload)}`;

  try {
    ztoolkit.log(message, payload);
  } catch {
    // Keep diagnostics best-effort; menu commands must not fail because logging fails.
  }

  try {
    Zotero.debug(text);
  } catch {
    // Zotero.debug may be unavailable in isolated test/runtime contexts.
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
    // The main window is not always available during teardown.
  }

  for (const targetConsole of consoles) {
    targetConsole.info(text);
  }
}
