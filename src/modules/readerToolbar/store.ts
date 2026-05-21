import type { ReaderToolbarMenuState, ReaderToolbarPanelStore } from "./types";

/** 为一个 reader toolbar 菜单创建打开/关闭状态对象。 */
export function createReaderToolbarMenuState(): ReaderToolbarMenuState {
  let open = false;
  return {
    /** 返回这个菜单当前是否打开。 */
    isOpen() {
      return open;
    },
    /** 标记这个菜单为打开。 */
    open() {
      open = true;
    },
    /** 标记这个菜单为关闭。 */
    close() {
      open = false;
    },
    /** 在打开和关闭状态之间切换这个菜单。 */
    toggle() {
      open = !open;
    },
  };
}

/** 为每个 reader 创建一个 toolbar 菜单状态存储。 */
export function createReaderToolbarPanelStore(): ReaderToolbarPanelStore {
  const panels = new Map<string, ReaderToolbarMenuState>();
  return {
    /** 获取或创建某个 reader 实例的菜单状态。 */
    ensure(readerInstanceID) {
      let state = panels.get(readerInstanceID);
      if (!state) {
        state = createReaderToolbarMenuState();
        panels.set(readerInstanceID, state);
      }
      return state;
    },
    /** 返回某个 reader 实例的菜单是否打开。 */
    isOpen(readerInstanceID) {
      return panels.get(readerInstanceID)?.isOpen() ?? false;
    },
    /** 切换某个 reader 实例的菜单状态。 */
    toggle(readerInstanceID) {
      this.ensure(readerInstanceID).toggle();
    },
    /** 如果存在，则关闭某个 reader 实例的菜单。 */
    close(readerInstanceID) {
      panels.get(readerInstanceID)?.close();
    },
    /** 删除某个 reader 实例对应的菜单状态。 */
    delete(readerInstanceID) {
      panels.delete(readerInstanceID);
    },
    /** 清空所有已存储的 reader 菜单状态。 */
    clear() {
      panels.clear();
    },
  };
}
