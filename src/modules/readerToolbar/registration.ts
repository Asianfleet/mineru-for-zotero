import {
  destroyReaderOverlaysByReaderID,
  readerOverlayNeedsWindowSync,
  renderReaderOverlayForReader,
} from "../readerOverlay";
import { ensureReaderToolbarAssetsLoaded } from "./assets";
import {
  cleanupWindowBindings,
  destroyButtonBinding,
  ensureButtonBinding,
  getButtonBindingsSnapshot,
  getWindowReaders,
} from "./binding";
import { createReaderToolbarPanelStore } from "./store";
import type {
  ReaderToolbarPanelStore,
  ReaderToolbarRegistration,
  WindowToolbarRegistration,
} from "./types";

const panelStore = createReaderToolbarPanelStore();

/** 为 Zotero main window 注册 MinerU toolbar button 集成。 */
export async function registerReaderToolbar(
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  await ensureReaderToolbarAssetsLoaded();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  addon.data.readerToolbar ??= {
    windows: new WeakMap<Window, WindowToolbarRegistration>(),
    registeredWindows: new Set<Window>(),
  };

  if (addon.data.readerToolbar.registeredWindows.has(win)) {
    return;
  }

  const registration = registerReaderToolbarWindow(win, panelStore);
  addon.data.readerToolbar.windows.set(win, registration);
  addon.data.readerToolbar.registeredWindows.add(win);
}

/** 取消一个窗口或所有已注册窗口的 toolbar 集成。 */
export function unregisterReaderToolbar(win?: Window): void {
  const registration = addon.data.readerToolbar;
  if (!registration) {
    return;
  }

  if (win && registration.registeredWindows.has(win)) {
    registration.windows.get(win)?.cleanup();
    registration.registeredWindows.delete(win);
  }

  if (!win) {
    for (const registeredWindow of registration.registeredWindows) {
      registration.windows.get(registeredWindow)?.cleanup();
    }
    registration.registeredWindows.clear();
  }

  if (!win || registration.registeredWindows.size === 0) {
    addon.data.readerToolbar = undefined;
    for (const [readerInstanceID] of getButtonBindingsSnapshot()) {
      destroyButtonBinding(readerInstanceID);
    }
    panelStore.clear();
  }
}

/** 为 Zotero main window 启动基于观察器和定时器的 toolbar 同步。 */
export function registerReaderToolbarWindow(
  win: _ZoteroTypes.MainWindow,
  store: ReaderToolbarPanelStore = panelStore,
): WindowToolbarRegistration {
  let timer = 0;
  let destroyed = false;
  // 在 Zotero 改动 reader toolbar DOM 后重新同步 toolbar 绑定。
  const observer = new win.MutationObserver(() => {
    syncWindowToolbar(win, store);
  });

  /** 开始观察 reader DOM 变化，以定位 toolbar 插入点。 */
  const start = () => {
    if (destroyed) {
      return;
    }
    observer.observe(win.document.documentElement, {
      childList: true,
      subtree: true,
    });
    syncWindowToolbar(win, store);
    // 周期性捕获不会通过 DOM mutation 暴露的 reader 生命周期变化。
    timer = win.setInterval(() => {
      syncWindowToolbar(win, store);
    }, 500);
  };

  /** 停止该窗口持有的观察器、定时器和绑定。 */
  const stop = () => {
    destroyed = true;
    observer.disconnect();
    if (timer) {
      win.clearInterval(timer);
      timer = 0;
    }
    cleanupWindowBindings(win, store);
  };

  start();
  return { cleanup: stop };
}

/** 将 toolbar 绑定与窗口中当前打开的 PDF reader 同步。 */
export function syncWindowToolbar(
  win: _ZoteroTypes.MainWindow,
  store: ReaderToolbarPanelStore = panelStore,
): void {
  const readers = getWindowReaders(win);
  const activeIDs = new Set<string>();

  for (const reader of readers) {
    const binding = ensureButtonBinding(win, reader, store);
    if (binding) {
      activeIDs.add(reader._instanceID);
      if (readerOverlayNeedsWindowSync(reader)) {
        void renderReaderOverlayForReader(reader);
      }
    }
  }

  for (const [readerInstanceID, binding] of getButtonBindingsSnapshot()) {
    if (binding.win !== win) {
      continue;
    }
    if (!activeIDs.has(readerInstanceID)) {
      destroyButtonBinding(readerInstanceID);
      destroyReaderOverlaysByReaderID(readerInstanceID);
      store.delete(readerInstanceID);
    }
  }
}

/** 返回 toolbar 注册生命周期使用的共享 panel store。 */
export function getReaderToolbarPanelStore(): ReaderToolbarPanelStore {
  return panelStore;
}
