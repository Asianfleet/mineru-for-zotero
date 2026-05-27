import { config } from "../package.json";
import { ColumnOptions, DialogHelper } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import type { ItemTreeColumnState } from "./modules/itemTreeColumn";
import type {
  ReaderOverlayKey,
  ReaderOverlayState,
} from "./modules/readerOverlay";
import type { ReaderToolbarRegistration } from "./modules/readerToolbar";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    itemTreeColumn?: ItemTreeColumnState;
    readerOverlays?: Map<ReaderOverlayKey, ReaderOverlayState>;
    readerToolbar?: ReaderToolbarRegistration;
    dialog?: DialogHelper;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
