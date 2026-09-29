import Addon from "./addon";
import { config } from "../package.json";

/**
 * Safely obtain the Zotero object during the early bundled loading stage.
 *
 * Under normal circumstances, `Zotero` is already available in the plugin scope;
 * if not yet injected, fall back to `chrome://zotero/content/zotero.mjs`,
 * matching the behavior of the legacy toolkit's `getGlobal`.
 */
function getZotero(): typeof Zotero {
  if (typeof Zotero !== "undefined") {
    return Zotero;
  }
  return (
    ChromeUtils.importESModule(
      "chrome://zotero/content/zotero.mjs",
    ) as unknown as {
      Zotero: typeof Zotero;
    }
  ).Zotero;
}

function defineGlobal(name: string, getter: () => unknown): void {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter();
    },
  });
}

// @ts-expect-error - Plugin instance is not typed
if (!getZotero()[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);
  // @ts-expect-error - Plugin instance is not typed
  getZotero()[config.addonInstance] = addon;
}
