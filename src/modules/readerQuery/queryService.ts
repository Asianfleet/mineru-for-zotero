import { formatBoxForCopy, formatBoxesForCopy } from "../copyFormatter";
import { MarkdownQueryError } from "../markdownQuery/types";
import type {
  ReaderQueryDependencies,
  ReaderQueryScope,
  ReaderQueryService,
  ReaderSelectionResult,
  ReaderSelectionSnapshot,
  ReaderTabResult,
  ReaderTabSnapshot,
} from "./types";

/** 校验范围并提供各适配层一致的默认值。 */
export function parseReaderQueryScope(value?: unknown): ReaderQueryScope {
  if (value === undefined) return "active";
  if (value === "all" || value === "active") return value;
  throw new MarkdownQueryError(
    "invalid-request",
    400,
    "scope must be all or active",
  );
}

/** 将同步阅读上下文快照与保存的解析结果组合成只读查询服务。 */
export function createReaderQueryService(
  deps: ReaderQueryDependencies,
): ReaderQueryService {
  return {
    /** 返回目标 tab 及实际附件的解析状态。 */
    async listTabs(requestedScope) {
      const scope = parseReaderQueryScope(requestedScope);
      const tabs = deps.snapshot(scope).tabs.map((tab) => ({ ...tab }));
      return { scope, tabs: await Promise.all(tabs.map(readTab)) };
    },
    /** 返回目标 Reader 的选中内容，不更改用户选择或剪贴板。 */
    async selectedBoxes(requestedScope) {
      const scope = parseReaderQueryScope(requestedScope);
      const readers = deps
        .snapshot(scope)
        .readers.filter((reader) => reader.selectedRawIndexes.length > 0)
        .map((reader) => ({
          ...reader,
          selectedRawIndexes: [...reader.selectedRawIndexes],
        }));
      return { scope, readers: await Promise.all(readers.map(readSelection)) };
    },
  };

  /** 读取就绪状态，失败仅影响当前 tab。 */
  async function readTab(tab: ReaderTabSnapshot): Promise<ReaderTabResult> {
    const { pdf, preciseRunning, liteRunning, ...identity } = tab;
    const result: ReaderTabResult = { ...identity, parseStatus: null };
    if (
      !pdf ||
      tab.status !== "ok" ||
      tab.libraryId === null ||
      !tab.attachmentKey
    )
      return result;
    try {
      const ready = await deps.storage.readParseStatus({
        libraryID: tab.libraryId,
        key: tab.attachmentKey,
      });
      result.parseStatus = {
        ...ready,
        preciseRunning,
        liteRunning,
        preferredMode: ready.preciseReady
          ? "precise"
          : ready.liteReady
            ? "lite"
            : null,
      };
    } catch {
      result.status = "parse-status-unavailable";
    }
    return result;
  }

  /** 读取并格式化选择快照，保留失效索引与其他 Reader 的结果。 */
  async function readSelection(
    reader: ReaderSelectionSnapshot,
  ): Promise<ReaderSelectionResult> {
    const {
      pdf: _pdf,
      preciseRunning: _precise,
      liteRunning: _lite,
      selectedRawIndexes,
      status,
      ...identity
    } = reader;
    const selected = new Set(selectedRawIndexes);
    const result: ReaderSelectionResult = {
      ...identity,
      status: "ok",
      selectedCount: selected.size,
      boxes: [],
      markdown: "",
      missingRawIndexes: [],
    };
    if (status !== "ok" || reader.libraryId === null || !reader.attachmentKey) {
      result.status = "item-unavailable";
      return result;
    }
    try {
      const boxes = (
        await deps.storage.readBoxes({
          libraryID: reader.libraryId,
          key: reader.attachmentKey,
        })
      )
        .filter((box) => selected.has(box.rawIndex))
        .sort((a, b) => a.rawIndex - b.rawIndex);
      const found = new Set(boxes.map((box) => box.rawIndex));
      result.missingRawIndexes = [...selected]
        .filter((index) => !found.has(index))
        .sort((a, b) => a - b);
      result.boxes = boxes.map((box) => ({
        rawIndex: box.rawIndex,
        page: box.page,
        type: box.type,
        markdown: formatBoxForCopy(box),
      }));
      result.markdown = formatBoxesForCopy(boxes);
      if (result.missingRawIndexes.length) result.status = "stale-selection";
    } catch {
      result.status = "parse-result-unavailable";
    }
    return result;
  }
}
