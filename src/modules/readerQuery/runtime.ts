import { readAttachmentParseRunning } from "../itemTreeColumn";
import { getMinerUStorageRoot } from "../preferenceScript";
import { readReaderSelectedRawIndexes } from "../readerOverlay/state";
import { createStorage } from "../storage";
import { createReaderQueryService } from "./queryService";
import type {
  ReaderContextSnapshot,
  ReaderItemIdentity,
  ReaderQueryScope,
  ReaderTabSnapshot,
} from "./types";

/** 查询所需的最小 Zotero 条目接口。 */
export interface ReaderRuntimeItem {
  id: number;
  key: string;
  libraryID: number;
  parentItemID?: number | false;
  getField(name: string): unknown;
  isAttachment(): boolean;
  isPDFAttachment(): boolean;
}

/** 主窗口中 tab 的最小元数据。 */
interface RuntimeTab {
  id: string;
  type: string;
  title: string;
  data?: { itemID?: number };
}

/** 主窗口查询边界，避免服务持有真实 DOM。 */
interface RuntimeWindow {
  closed?: boolean;
  Zotero_Tabs?: { selectedID: string; _tabs: RuntimeTab[] };
}

/** PDF Reader 的生命周期和附件信息。 */
interface RuntimeReader {
  _instanceID: string;
  type: string;
  tabID?: string;
  itemID?: number;
  _item?: ReaderRuntimeItem;
  _window?: { closed: boolean };
}

/** 可注入的 Zotero 运行时边界。 */
export interface ReaderRuntimeDependencies {
  getMainWindows(): RuntimeWindow[];
  getMainWindow(): RuntimeWindow | null;
  getReaders(): RuntimeReader[];
  getItem(id: number): ReaderRuntimeItem | undefined | false;
  readSelectedIndexes(
    readerInstanceId: string,
    attachmentKey: string,
  ): number[];
  readRunning(ref: { libraryID: number; key: string }): {
    preciseRunning: boolean;
    liteRunning: boolean;
  };
}

/** 创建运行在 Zotero 内部、可供 HTTP 与 MCP 使用的查询服务。 */
export function createZoteroReaderQueryService() {
  const storage = createStorage(getMinerUStorageRoot());
  const deps: ReaderRuntimeDependencies = {
    getMainWindows: () => Zotero.getMainWindows(),
    getMainWindow: () => Zotero.getMainWindow() ?? null,
    getReaders: () => Zotero.Reader._readers,
    getItem: (id) => Zotero.Items.get(id),
    readSelectedIndexes: readReaderSelectedRawIndexes,
    readRunning: readAttachmentParseRunning,
  };
  return createReaderQueryService({
    snapshot: (scope) => snapshotReaderContext(deps, scope),
    storage: {
      /** 区分缓存缺失与缓存损坏，保留查询可见的不可用状态。 */
      readParseStatus: (ref) => storage.readParseStatus(ref, { strict: true }),
      /** 复用存储的 normalized box 读取与既有缓存刷新约定。 */
      readBoxes: (ref) => storage.readBoxes(ref),
    },
  });
}

/** 同步固定目标 tab、条目标识与选择，排除已关闭的 Reader。 */
export function snapshotReaderContext(
  deps: ReaderRuntimeDependencies,
  scope: ReaderQueryScope,
): ReaderContextSnapshot {
  const mainWindows = deps.getMainWindows().filter((win) => !win.closed);
  const recent = scope === "active" ? deps.getMainWindow() : null;
  const windows =
    scope === "active"
      ? mainWindows.filter((win) => win === recent)
      : mainWindows;
  const liveReaders = deps
    .getReaders()
    .filter((reader) => reader.type === "pdf" && !reader._window?.closed);
  const result: ReaderContextSnapshot = { tabs: [], readers: [] };
  const included = new Set<string>();
  for (const win of windows) {
    const manager = win.Zotero_Tabs;
    if (!manager) continue;
    // getState 是会话持久化快照，实际不包含运行时 tab ID。
    for (const tab of manager._tabs) {
      if (tab.type === "library" || tab.id === "zotero-pane") continue;
      if (scope === "active" && tab.id !== manager.selectedID) continue;
      if (
        !tab.data?.itemID &&
        !["reader", "reader-unloaded", "note", "note-unloaded"].includes(
          tab.type,
        )
      )
        continue;
      const reader = liveReaders.find((entry) => entry.tabID === tab.id);
      const identity = resolveIdentity(
        deps,
        tab.data?.itemID ?? reader?.itemID,
        reader?._item,
      );
      const entry: ReaderTabSnapshot = {
        ...identity,
        tabId: tab.id,
        active: tab.id === manager.selectedID,
        tabTitle: tab.title,
      };
      result.tabs.push(entry);
      if (reader) addReader(reader, entry);
    }
  }
  if (scope === "all") {
    for (const reader of liveReaders) {
      // 有 tabID 但没有存活 tab 的 Reader 已关闭或正在卸载。
      if (reader.tabID || !reader._window) continue;
      const identity = resolveIdentity(deps, reader.itemID, reader._item);
      addReader(reader, {
        ...identity,
        tabId: null,
        active: false,
        tabTitle: identity.title ?? "",
      });
    }
  }
  return result;

  /** 同一 Reader 仅返回一组独立选择，并复制索引数组。 */
  function addReader(reader: RuntimeReader, entry: ReaderTabSnapshot): void {
    if (included.has(reader._instanceID)) return;
    included.add(reader._instanceID);
    result.readers.push({
      ...entry,
      readerInstanceId: reader._instanceID,
      selectedRawIndexes: entry.attachmentKey
        ? [...deps.readSelectedIndexes(reader._instanceID, entry.attachmentKey)]
        : [],
    });
  }
}

/** 解析实际打开附件和父文献，条目缺失时保留已知标识。 */
function resolveIdentity(
  deps: ReaderRuntimeDependencies,
  itemID: number | undefined,
  readerItem?: ReaderRuntimeItem,
): ReaderItemIdentity &
  Pick<ReaderTabSnapshot, "pdf" | "status" | "preciseRunning" | "liteRunning"> {
  const result: ReaderItemIdentity &
    Pick<
      ReaderTabSnapshot,
      "pdf" | "status" | "preciseRunning" | "liteRunning"
    > = {
    libraryId: null,
    itemId: itemID ?? null,
    itemKey: null,
    title: null,
    attachmentId: null,
    attachmentKey: null,
    pdf: false,
    status: "item-unavailable",
    preciseRunning: false,
    liteRunning: false,
  };
  try {
    const item = readerItem ?? (itemID ? deps.getItem(itemID) : undefined);
    if (!item) return result;
    result.libraryId = item.libraryID;
    const attachment = item.isAttachment();
    result.attachmentId = attachment ? item.id : null;
    result.attachmentKey = attachment ? item.key : null;
    result.pdf = attachment && item.isPDFAttachment();
    result.itemId = item.parentItemID || item.id;
    if (result.pdf) {
      Object.assign(
        result,
        deps.readRunning({ libraryID: item.libraryID, key: item.key }),
      );
    }
    const parent = item.parentItemID ? deps.getItem(item.parentItemID) : item;
    if (!parent) return result;
    result.itemKey = parent.key;
    result.title = String(
      parent.getField("title") || item.getField("title") || "",
    );
    result.status = "ok";
  } catch {
    result.status = "item-unavailable";
  }
  return result;
}
