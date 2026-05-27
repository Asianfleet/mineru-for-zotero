import { config } from "../../package.json";
import type { FluentMessageId } from "../../typings/i10n";
import type { AttachmentRef } from "./domain";
import { getMinerUStorageRoot } from "./preferenceScript";
import { createStorage, type StorageAdapter } from "./storage";
import { getString } from "../utils/locale";

export type ParseColumnModeState = "none" | "ready" | "running";
export type ParseColumnMode = "precise" | "lite";

export type ParseColumnStatus = {
  precise: ParseColumnModeState;
  lite: ParseColumnModeState;
};

export type ItemTreeColumnState = {
  registeredDataKey?: string;
  statuses: Map<string, ParseColumnStatus>;
};

type AttachmentStatusKeyRef = Pick<AttachmentRef, "libraryID" | "key">;

type ItemTreeColumnRegistration =
  _ZoteroTypes.ItemTreeManager.ItemTreeCustomColumnOptions;

type ItemTreeColumnManager = Pick<
  _ZoteroTypes.ItemTreeManager,
  "registerColumn" | "unregisterColumn" | "refreshColumns"
>;

type ItemTreeColumnDependencies = {
  storage?: StorageAdapter;
  createStorage?: () => StorageAdapter;
  itemTreeManager?: ItemTreeColumnManager;
  getString?: (id: FluentMessageId) => string;
  log?: (...args: unknown[]) => void;
};

export function createEmptyParseColumnStatus(): ParseColumnStatus {
  return {
    precise: "none",
    lite: "none",
  };
}

export function getAttachmentStatusKey(ref: AttachmentStatusKeyRef): string {
  return `${ref.libraryID}-${ref.key}`;
}

export function getMinerUParseColumnToken(
  item: Zotero.Item,
  statuses: Map<string, ParseColumnStatus>,
): string {
  if (!isPdfAttachment(item)) {
    return "";
  }
  const status = statuses.get(
    getAttachmentStatusKey({
      libraryID: item.libraryID,
      key: item.key,
    }),
  );
  if (!status) {
    return "";
  }
  return createTokenParts(status).join("|");
}

export function createMinerUParseColumnRegistration(input: {
  statuses: Map<string, ParseColumnStatus>;
  getString: (id: FluentMessageId) => string;
}): ItemTreeColumnRegistration {
  return {
    dataKey: "mineruParseStatus",
    label: input.getString("item-tree-column-mineru-parse"),
    pluginID: config.addonID,
    enabledTreeIDs: ["main"],
    width: "140",
    minWidth: 110,
    fixedWidth: false,
    staticWidth: false,
    showInColumnPicker: true,
    zoteroPersist: ["width", "hidden"],
    dataProvider: (item) => getMinerUParseColumnToken(item, input.statuses),
    renderCell: (index, data, column, isFirstColumn, doc) =>
      renderMinerUParseCell(
        index,
        data,
        column,
        isFirstColumn,
        doc,
        input.getString,
      ),
  };
}

export function renderMinerUParseCell(
  _index: number,
  data: string,
  column: { className: string },
  _isFirstColumn: boolean,
  doc: Document | undefined,
  resolveString: (id: FluentMessageId) => string,
): HTMLElement {
  const cellDoc = doc ?? Zotero.getMainWindow().document;
  const cell = cellDoc.createElement("span");
  cell.className = `${column.className} mineru-parse-column-cell`.trim();
  const tokens = data.split("|").filter(Boolean);
  if (tokens.length === 0) {
    return cell;
  }
  const badges = cellDoc.createElement("span");
  badges.className = "mineru-parse-column-badges";
  for (const token of tokens) {
    badges.append(createBadge(cellDoc, token, resolveString));
  }
  cell.append(badges);
  return cell;
}

export async function registerItemTreeColumn(
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  if (state.registeredDataKey) {
    return;
  }

  const manager = dependencies.itemTreeManager ?? Zotero.ItemTreeManager;
  const resolveString = dependencies.getString ?? getString;
  try {
    const registration = createMinerUParseColumnRegistration({
      statuses: state.statuses,
      getString: resolveString,
    });
    const registeredDataKey = manager.registerColumn(registration);
    if (!registeredDataKey) {
      return;
    }
    state.registeredDataKey = registeredDataKey;
    await refreshAllMinerUParseStatuses(dependencies);
  } catch (error) {
    state.registeredDataKey = undefined;
    (dependencies.log ?? ztoolkit.log)(
      "failed to register MinerU parse column",
      error,
    );
  }
}

export function unregisterItemTreeColumn(
  dependencies: ItemTreeColumnDependencies = {},
): void {
  const state = addon.data.itemTreeColumn;
  if (!state?.registeredDataKey) {
    addon.data.itemTreeColumn = undefined;
    return;
  }

  try {
    (dependencies.itemTreeManager ?? Zotero.ItemTreeManager).unregisterColumn(
      state.registeredDataKey,
    );
  } catch (error) {
    (dependencies.log ?? ztoolkit.log)(
      "failed to unregister MinerU parse column",
      error,
    );
  }
  addon.data.itemTreeColumn = undefined;
}

export async function refreshAllMinerUParseStatuses(
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const statuses = await getColumnStorage(dependencies).listParseStatuses();
  state.statuses.clear();
  for (const [key, status] of statuses) {
    state.statuses.set(key, {
      precise: status.preciseReady ? "ready" : "none",
      lite: status.liteReady ? "ready" : "none",
    });
  }
  refreshColumns(dependencies);
}

export async function markAttachmentParseRunning(
  ref: AttachmentStatusKeyRef,
  mode: ParseColumnMode,
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const key = getAttachmentStatusKey(ref);
  const status = {
    ...(state.statuses.get(key) ?? createEmptyParseColumnStatus()),
  };
  status[mode] = "running";
  state.statuses.set(key, status);
  refreshColumns(dependencies);
}

export async function markAttachmentParseReady(
  ref: AttachmentStatusKeyRef,
  mode: ParseColumnMode,
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const key = getAttachmentStatusKey(ref);
  const status = {
    ...(state.statuses.get(key) ?? createEmptyParseColumnStatus()),
  };
  status[mode] = "ready";
  state.statuses.set(key, status);
  refreshColumns(dependencies);
}

export async function clearAttachmentParseRunning(
  ref: AttachmentStatusKeyRef,
  mode: ParseColumnMode,
  dependencies: ItemTreeColumnDependencies = {},
): Promise<void> {
  const state = getOrCreateItemTreeColumnState();
  const key = getAttachmentStatusKey(ref);
  const status = {
    ...(state.statuses.get(key) ?? createEmptyParseColumnStatus()),
  };

  try {
    const diskStatus =
      await getColumnStorage(dependencies).readParseStatus(ref);
    status.precise = diskStatus.preciseReady ? "ready" : "none";
    status.lite = diskStatus.liteReady ? "ready" : "none";
  } catch {
    status[mode] = "none";
  }

  if (status.precise === "none" && status.lite === "none") {
    state.statuses.delete(key);
  } else {
    state.statuses.set(key, status);
  }
  refreshColumns(dependencies);
}

function createTokenParts(status: ParseColumnStatus): string[] {
  const parts: string[] = [];
  if (status.precise === "ready") {
    parts.push("precise");
  } else if (status.precise === "running") {
    parts.push("precise-running");
  }
  if (status.lite === "ready") {
    parts.push("lite");
  } else if (status.lite === "running") {
    parts.push("lite-running");
  }
  return parts;
}

function createBadge(
  doc: Document,
  token: string,
  resolveString: (id: FluentMessageId) => string,
): HTMLElement {
  const badge = doc.createElement("span");
  badge.className = "mineru-parse-column-badge";
  if (token.endsWith("-running")) {
    const mode = token.slice(0, -"-running".length);
    badge.classList.add(`mineru-parse-column-badge-${mode}`);
    badge.classList.add("mineru-parse-column-badge-running");
    badge.textContent = `${resolveModeLabel(mode, resolveString)}(${resolveString(
      "item-tree-column-mineru-parse-running",
    )})`;
    return badge;
  }
  badge.classList.add(`mineru-parse-column-badge-${token}`);
  badge.textContent = resolveModeLabel(token, resolveString);
  return badge;
}

function resolveModeLabel(
  mode: string,
  resolveString: (id: FluentMessageId) => string,
): string {
  return mode === "lite"
    ? resolveString("item-tree-column-mineru-parse-lite")
    : resolveString("item-tree-column-mineru-parse-precise");
}

function isPdfAttachment(item: Zotero.Item): boolean {
  return (
    typeof item.isAttachment === "function" &&
    typeof item.isPDFAttachment === "function" &&
    item.isAttachment() &&
    item.isPDFAttachment()
  );
}

function getOrCreateItemTreeColumnState(): ItemTreeColumnState {
  addon.data.itemTreeColumn ??= {
    statuses: new Map(),
  };
  return addon.data.itemTreeColumn;
}

function getColumnStorage(
  dependencies: ItemTreeColumnDependencies,
): StorageAdapter {
  if (dependencies.storage) {
    return dependencies.storage;
  }
  return (
    dependencies.createStorage?.() ?? createStorage(getMinerUStorageRoot())
  );
}

function refreshColumns(dependencies: ItemTreeColumnDependencies): void {
  (dependencies.itemTreeManager ?? Zotero.ItemTreeManager).refreshColumns();
}
