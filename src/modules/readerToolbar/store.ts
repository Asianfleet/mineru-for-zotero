import type { ReaderToolbarMenuState, ReaderToolbarPanelStore } from "./types";

/** Creates the open/closed state object for one reader toolbar menu. */
export function createReaderToolbarMenuState(): ReaderToolbarMenuState {
  let open = false;
  return {
    /** Returns whether this menu is currently open. */
    isOpen() {
      return open;
    },
    /** Marks this menu as open. */
    open() {
      open = true;
    },
    /** Marks this menu as closed. */
    close() {
      open = false;
    },
    /** Flips this menu between open and closed states. */
    toggle() {
      open = !open;
    },
  };
}

/** Creates a per-reader store for toolbar menu states. */
export function createReaderToolbarPanelStore(): ReaderToolbarPanelStore {
  const panels = new Map<string, ReaderToolbarMenuState>();
  return {
    /** Gets or creates the menu state for a reader instance. */
    ensure(readerInstanceID) {
      let state = panels.get(readerInstanceID);
      if (!state) {
        state = createReaderToolbarMenuState();
        panels.set(readerInstanceID, state);
      }
      return state;
    },
    /** Returns whether the menu for a reader instance is open. */
    isOpen(readerInstanceID) {
      return panels.get(readerInstanceID)?.isOpen() ?? false;
    },
    /** Toggles the menu for a reader instance. */
    toggle(readerInstanceID) {
      this.ensure(readerInstanceID).toggle();
    },
    /** Closes the menu for a reader instance if it exists. */
    close(readerInstanceID) {
      panels.get(readerInstanceID)?.close();
    },
    /** Removes the stored menu state for a reader instance. */
    delete(readerInstanceID) {
      panels.delete(readerInstanceID);
    },
    /** Removes every stored reader menu state. */
    clear() {
      panels.clear();
    },
  };
}
