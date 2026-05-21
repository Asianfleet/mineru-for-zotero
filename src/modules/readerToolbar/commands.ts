import type { FluentMessageId } from "../../../typings/i10n";
import { getString } from "../../utils/locale";
import { getReaderOverlayStateForReader } from "../readerOverlay";
import { emitReaderToolbarDiagnostic, errorMessage } from "./diagnostics";
import type { ReaderMessageId } from "./types";

/** Runs a toolbar command and logs before/after overlay state diagnostics. */
export function runReaderToolbarCommand(
  reader: _ZoteroTypes.ReaderInstance,
  command: string,
  action: () => void | Promise<unknown>,
): void {
  const beforeState = getReaderOverlayStateForReader(reader);
  emitReaderToolbarDiagnostic(reader, "MinerU reader toolbar command", {
    command,
    readerInstanceID: reader._instanceID,
    attachmentKey: reader._item?.key ?? null,
    beforeMode: beforeState?.mode ?? null,
    beforeSelectedCount: beforeState?.selectedRawIndexes.size ?? 0,
  });

  let result: void | Promise<unknown>;
  try {
    result = action();
  } catch (error) {
    emitReaderToolbarDiagnostic(
      reader,
      "MinerU reader toolbar command failed",
      {
        command,
        readerInstanceID: reader._instanceID,
        attachmentKey: reader._item?.key ?? null,
        error: errorMessage(error),
      },
    );
    return;
  }

  void Promise.resolve(result)
    .then(
      /** Logs overlay state after an async or sync command completes. */
      () => {
        const afterState = getReaderOverlayStateForReader(reader);
        emitReaderToolbarDiagnostic(reader, "MinerU reader toolbar state", {
          command,
          readerInstanceID: reader._instanceID,
          attachmentKey: reader._item?.key ?? null,
          afterMode: afterState?.mode ?? null,
          afterSelectedCount: afterState?.selectedRawIndexes.size ?? 0,
        });
      },
    )
    .catch(
      /** Logs failures from async toolbar command execution. */
      (error) => {
        emitReaderToolbarDiagnostic(
          reader,
          "MinerU reader toolbar command failed",
          {
            command,
            readerInstanceID: reader._instanceID,
            attachmentKey: reader._item?.key ?? null,
            error: errorMessage(error),
          },
        );
      },
    );
}

/** Resolves a reader-toolbar Fluent string with optional arguments. */
export function readerString(
  id: ReaderMessageId,
  args?: Record<string, string | number>,
): string {
  if (args) {
    return getString(id as FluentMessageId, { args });
  }
  return getString(id as FluentMessageId);
}
