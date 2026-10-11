import type { NormalizedBox } from "../domain";
import type { StorageAdapter } from "../storage";

/** 阅读上下文查询的范围。 */
export type ReaderQueryScope = "all" | "active";

/** 可用于继续调用既有查询工具的文献和附件标识。 */
export interface ReaderItemIdentity {
  libraryId: number | null;
  itemId: number | null;
  itemKey: string | null;
  title: string | null;
  attachmentId: number | null;
  attachmentKey: string | null;
}

/** tab 的基础信息，不持有窗口或 Reader 对象。 */
export interface ReaderTabIdentity extends ReaderItemIdentity {
  tabId: string | null;
  active: boolean;
  tabTitle: string;
  status: "ok" | "item-unavailable" | "parse-status-unavailable";
}

/** 从运行时同步复制的 tab 信息与运行状态。 */
export interface ReaderTabSnapshot extends ReaderTabIdentity {
  pdf: boolean;
  preciseRunning: boolean;
  liteRunning: boolean;
}

/** 存活 Reader 的选择快照。 */
export interface ReaderSelectionSnapshot extends ReaderTabSnapshot {
  readerInstanceId: string;
  selectedRawIndexes: number[];
}

/** 一次请求开始时固定的 tab 和选择范围。 */
export interface ReaderContextSnapshot {
  tabs: ReaderTabSnapshot[];
  readers: ReaderSelectionSnapshot[];
}

/** 实际打开 PDF 附件的就绪和解析中信息。 */
export interface ReaderParseStatus {
  preciseReady: boolean;
  liteReady: boolean;
  preciseRunning: boolean;
  liteRunning: boolean;
  preferredMode: "precise" | "lite" | null;
}

/** 外部可见的 tab 查询结果。 */
export interface ReaderTabResult extends ReaderTabIdentity {
  parseStatus: ReaderParseStatus | null;
}

/** 外部可见的单 Reader 选择结果。 */
export interface ReaderSelectionResult extends ReaderItemIdentity {
  readerInstanceId: string;
  tabId: string | null;
  active: boolean;
  tabTitle: string;
  status:
    | "ok"
    | "empty-selection"
    | "stale-selection"
    | "parse-result-unavailable"
    | "item-unavailable";
  selectedCount: number;
  boxes: Array<Pick<NormalizedBox, "rawIndex" | "page" | "type" | "markdown">>;
  markdown: string;
  missingRawIndexes: number[];
}

/** service 所需的最小依赖，方便验证快照与部分失败语义。 */
export interface ReaderQueryDependencies {
  snapshot(scope: ReaderQueryScope): ReaderContextSnapshot;
  storage: Pick<StorageAdapter, "readParseStatus" | "readBoxes">;
}

/** HTTP 和 MCP 共用的查询接口。 */
export interface ReaderQueryService {
  listTabs(
    scope?: ReaderQueryScope,
  ): Promise<{ scope: ReaderQueryScope; tabs: ReaderTabResult[] }>;
  selectedBoxes(
    scope?: ReaderQueryScope,
  ): Promise<{ scope: ReaderQueryScope; readers: ReaderSelectionResult[] }>;
}
