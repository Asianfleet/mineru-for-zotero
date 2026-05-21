/** toolbar 暴露的 Reader overlay 可见性模式。 */
export type ReaderOverlayMode = "all" | "hover" | "off";

/** 本地化的 reader toolbar 消息 id。 */
export type ReaderMessageId =
  | "reader-clear-selection"
  | "reader-copy-full-markdown"
  | "reader-copy-selected-boxes"
  | "reader-disable-plugin"
  | "reader-mode-group-label"
  | "reader-selected-boxes-label"
  | "reader-show-all-boxes"
  | "reader-show-hover-box"
  | "reader-toolbar-label";

/** 跟踪 reader toolbar 菜单是否处于打开状态。 */
export interface ReaderToolbarMenuState {
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
}

/** 按 reader 实例存储菜单状态。 */
export interface ReaderToolbarPanelStore {
  ensure(readerInstanceID: string): ReaderToolbarMenuState;
  isOpen(readerInstanceID: string): boolean;
  toggle(readerInstanceID: string): void;
  close(readerInstanceID: string): void;
  delete(readerInstanceID: string): void;
  clear(): void;
}

/** 描述 toolbar button 应插入的位置。 */
export interface ReaderToolbarAnchor {
  parent: Element;
  after?: Element;
}

/** 保存一个 main-window toolbar 注册的清理句柄。 */
export interface WindowToolbarRegistration {
  cleanup: () => void;
}

/** 保存一个 reader toolbar button 的 DOM 节点和清理句柄。 */
export interface ReaderToolbarButtonBinding {
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  win: Window;
  attachmentKey: string;
  cleanup: () => void;
}

/** 保存已注册窗口及其 toolbar 生命周期句柄。 */
export interface ReaderToolbarRegistration {
  windows: WeakMap<Window, WindowToolbarRegistration>;
  registeredWindows: Set<Window>;
}
