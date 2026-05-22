import type { FluentMessageId } from "../../../typings/i10n";
import { getString } from "../../utils/locale";
import { getReaderOverlayStateForReader } from "../readerOverlay";
import { emitReaderToolbarDiagnostic, errorMessage } from "./diagnostics";
import type { ReaderMessageId } from "./types";

/** 运行 toolbar 命令，并记录前后 overlay 状态诊断。 */
export function runReaderToolbarCommand(
  reader: _ZoteroTypes.ReaderInstance,
  command: string,
  action: () => void | Promise<unknown>,
): Promise<void> {
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
    return Promise.resolve();
  }

  return Promise.resolve(result)
    .then(
      /** 在异步或同步命令完成后记录 overlay 状态。 */
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
      /** 记录异步 toolbar 命令执行失败。 */
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

/** 解析带可选参数的 reader-toolbar Fluent 字符串。 */
export function readerString(
  id: ReaderMessageId,
  args?: Record<string, string | number>,
): string {
  if (args) {
    return getString(id as FluentMessageId, { args });
  }
  return getString(id as FluentMessageId);
}
