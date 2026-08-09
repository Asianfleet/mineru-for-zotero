import { config } from "../../package.json";
import {
  generateMarkdownApiToken,
  getMarkdownApiEnabled,
  getMarkdownApiRequireToken,
  getMarkdownApiToken,
  getSaveImages,
  getLocalApiTimeoutMinutes,
  getParseMode,
  getParseSource,
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
  setApiKey,
  setLocalApiBaseURL,
  setLocalApiTimeoutMinutes,
  setParseMode,
  setParseSource,
  setSaveImages,
  getSyncFolder,
  setSyncFolder,
  getAutoParsePageLimit,
  setAutoParsePageLimit,
  type ParseMode,
  type ParseSource,
} from "../utils/prefs";
import { createStorage } from "./storage";

const STORAGE_ROOT = "ProfD/mineru-copy";

interface ZoteroURLLauncher {
  launchURL(url: string): void;
}

interface ChoicePreferenceElement extends Element {
  value?: string;
}

interface CheckboxPreferenceElement extends Element {
  checked?: boolean;
}

export async function registerPrefsScripts(_window: Window) {
  const storageRoot = getMinerUStorageRoot();
  const storage = createStorage(storageRoot);
  const document = _window.document;

  registerPreferenceValueSync(document);
  void updateMarkdownApiTokenStatus(_window);

  setText(
    document,
    `${config.addonRef}-data-folder-path`,
    await formatL10n(_window, "pref-data-folder-path", { path: storageRoot }),
  );

  void updateParsedCount(_window, storage);

  document
    .getElementById(`${config.addonRef}-open-data-folder`)
    ?.addEventListener("click", () => {
      void storage.openDataFolder();
    });

  const backupBtn = document.getElementById(`${config.addonRef}-backup-data`);
  if (backupBtn) {
    backupBtn.addEventListener("click", async () => {
      const targetZipFile = await pickFileAsync(_window, "Save Backup ZIP", "modeSave");
      if (targetZipFile) {
        backupBtn.setAttribute("disabled", "true");
        backupBtn.textContent = "Backing up...";
        try {
          const PathUtils = (globalThis as any).PathUtils;
          const sourceDir = PathUtils.join(PathUtils.profileDir, "mineru-copy");
          const taskFile = (Zotero as any).DataDirectory.dir + "/mineru_tasks.json";
          
          let copiedSomething = false;
          const stagingDir = PathUtils.join(PathUtils.tempDir, `mineru_backup_staging_${Date.now()}`);
          await IOUtils.makeDirectory(stagingDir, { createAncestors: true, ignoreExisting: true });

          try {
            if (typeof IOUtils !== "undefined") {
              if (await IOUtils.exists(sourceDir)) {
                await copyDirRecursive(sourceDir, stagingDir + "/mineru-copy");
                copiedSomething = true;
              }
              if (await IOUtils.exists(taskFile)) {
                await IOUtils.copy(taskFile, stagingDir + "/mineru_tasks.json");
                copiedSomething = true;
              }
            }

            if (copiedSomething) {
              await (Zotero as any).File.zipDirectory(stagingDir, targetZipFile, null);
              backupBtn.textContent = "Backup Complete";
              _window.alert(`Data successfully backed up to ZIP:\n${targetZipFile}`);
            } else {
              backupBtn.textContent = "Nothing to Backup";
              _window.alert("No parsed data or tasks found to backup. Finish a task first.");
            }
          } finally {
            await IOUtils.remove(stagingDir, { recursive: true, ignoreAbsent: true });
          }
        } catch (e: any) {
          ztoolkit.log("Backup failed", e);
          backupBtn.textContent = "Failed: " + String(e.message || e).substring(0, 20);
        }
        setTimeout(() => {
          backupBtn.removeAttribute("disabled");
          backupBtn.textContent = "Backup Data";
        }, 3000);
      }
    });
  }

  const restoreBtn = document.getElementById(`${config.addonRef}-restore-data`);
  if (restoreBtn) {
    restoreBtn.addEventListener("click", async () => {
      const sourceZip = await pickFileAsync(_window, "Select Backup ZIP", "modeOpen");
      if (sourceZip) {
        restoreBtn.setAttribute("disabled", "true");
        restoreBtn.textContent = "Restoring...";
        try {
          const PathUtils = (globalThis as any).PathUtils;
          const targetDir = PathUtils.join(PathUtils.profileDir, "mineru-copy");
          const taskFile = (Zotero as any).DataDirectory.dir + "/mineru_tasks.json";
          
          if (typeof IOUtils !== "undefined") {
            const stagingDir = PathUtils.join(PathUtils.tempDir, `mineru_restore_staging_${Date.now()}`);
            await IOUtils.makeDirectory(stagingDir, { createAncestors: true, ignoreExisting: true });

            try {
              extractZipToDir(sourceZip, stagingDir);

              const children = await IOUtils.getChildren(stagingDir);
              for (const child of children) {
                const name = child.replace(/\\/g, "/").split("/").pop()!;
                if (name === "mineru_tasks.json") {
                  await IOUtils.copy(child, taskFile);
                } else if (name === "mineru-copy") {
                  const subChildren = await IOUtils.getChildren(child);
                  for (const subChild of subChildren) {
                    const subName = subChild.replace(/\\/g, "/").split("/").pop()!;
                    const destChild = targetDir + "/" + subName;
                    const stat = await IOUtils.stat(subChild);
                    if (stat.type === "directory") {
                      await copyDirRecursive(subChild, destChild);
                    } else {
                      if (!(await IOUtils.exists(targetDir))) {
                        await IOUtils.makeDirectory(targetDir, { createAncestors: true, ignoreExisting: true });
                      }
                      await IOUtils.copy(subChild, destChild);
                    }
                  }
                }
              }
            } finally {
              await IOUtils.remove(stagingDir, { recursive: true, ignoreAbsent: true });
            }
          }
          
          restoreBtn.textContent = "Restore Complete";
          void updateParsedCount(_window, storage);
          _window.alert("Data restored successfully. Please restart Zotero or reload the Task Manager if necessary.");
        } catch (e: any) {
          ztoolkit.log("Restore failed", e);
          restoreBtn.textContent = "Failed: " + String(e.message || e).substring(0, 20);
        }
        setTimeout(() => {
          restoreBtn.removeAttribute("disabled");
          restoreBtn.textContent = "Restore Data";
        }, 3000);
      }
    });
  }

  document
    .getElementById(`${config.addonRef}-open-task-manager`)
    ?.addEventListener("click", () => {
       const addonObj = (Zotero as any).MinerUForZotero;
       if (addonObj?.api?.openTaskManagerWindow) {
          addonObj.api.openTaskManagerWindow();
       }
    });

  document
    .getElementById(`${config.addonRef}-api-regenerate-token`)
    ?.addEventListener("click", () => {
      setMarkdownApiToken(generateMarkdownApiToken());
      void updateMarkdownApiTokenStatus(_window);
    });

  const syncAllButton = document.getElementById(`${config.addonRef}-sync-all`);
  if (syncAllButton) {
    syncAllButton.addEventListener("click", async () => {
      syncAllButton.setAttribute("disabled", "true");
      syncAllButton.textContent = "Syncing...";
      try {
        const addonObj = (Zotero as any).MinerUForZotero;
        if (addonObj?.api?.syncAllToAgentFolder) {
          const syncedCount = await addonObj.api.syncAllToAgentFolder(
            storage,
            (synced: number, total: number) => {
              syncAllButton.textContent = `Syncing... (${synced}/${total})`;
            }
          );
          syncAllButton.textContent = `Done (${syncedCount})`;
        }
      } catch (e) {
        syncAllButton.textContent = "Error";
      }
      setTimeout(() => {
        syncAllButton.removeAttribute("disabled");
        // Reset label to l10n default will require reloading the pane or just hardcoding it
        // We can just leave it as Done
      }, 3000);
    });
  }

  registerExternalLink(
    document,
    `${config.addonRef}-github-link`,
    "https://github.com/Asianfleet/mineru-for-zotero",
  );
  registerExternalLink(
    document,
    `${config.addonRef}-mineru-link`,
    "https://mineru.net/",
  );
}

function pickDirectoryAsync(window: Window, title: string): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const Components = (window as any).Components;
      const nsIFilePicker = Components.interfaces.nsIFilePicker;
      const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      fp.init((window as any).browsingContext || window, title, nsIFilePicker.modeGetFolder);
      fp.open((result: number) => {
        if (result === nsIFilePicker.returnOK && fp.file) {
          resolve(fp.file.path);
        } else {
          resolve(null);
        }
      });
    } catch (e) {
      ztoolkit.log("Failed to open file picker", e);
      resolve(null);
    }
  });
}

function pickFileAsync(window: Window, title: string, mode: "modeSave" | "modeOpen"): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const Components = (window as any).Components;
      const nsIFilePicker = Components.interfaces.nsIFilePicker;
      const fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      fp.init((window as any).browsingContext || window, title, nsIFilePicker[mode]);
      fp.appendFilter("ZIP Archive", "*.zip");
      if (mode === "modeSave") {
        fp.defaultString = "mineru_backup.zip";
      }
      fp.open((result: number) => {
        if ((result === nsIFilePicker.returnOK || result === nsIFilePicker.returnReplace) && fp.file) {
          let path = fp.file.path;
          if (mode === "modeSave" && !path.toLowerCase().endsWith(".zip")) {
             path += ".zip";
          }
          resolve(path);
        } else {
          resolve(null);
        }
      });
    } catch (e) {
      ztoolkit.log("Failed to open file picker", e);
      resolve(null);
    }
  });
}

function extractZipToDir(zipFilePath: string, destDir: string) {
  const Components = (globalThis as any).Components;
  const reader = Components.classes["@mozilla.org/libjar/zip-reader;1"].createInstance(Components.interfaces.nsIZipReader);
  const zipFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
  zipFile.initWithPath(zipFilePath);
  
  reader.open(zipFile);
  try {
    const entries = reader.findEntries("*");
    while (entries.hasMore()) {
      const name = entries.getNext();
      const destFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      destFile.initWithPath(destDir);
      name.split("/").forEach((part: string) => destFile.append(part));
      
      const entry = reader.getEntry(name);
      if (entry.isDirectory) {
        if (!destFile.exists()) {
          destFile.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
        }
      } else {
        const parent = destFile.parent;
        if (!parent.exists()) {
          parent.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);
        }
        reader.extract(name, destFile);
      }
    }
  } finally {
    reader.close();
  }
}

async function copyDirRecursive(src: string, dest: string) {
  if (typeof IOUtils === "undefined") return;
  if (!(await IOUtils.exists(src))) return;
  if (!(await IOUtils.exists(dest))) {
    await IOUtils.makeDirectory(dest, { createAncestors: true, ignoreExisting: true });
  }
  const children = await IOUtils.getChildren(src);
  for (const child of children) {
    const name = child.replace(/\\/g, "/").split("/").pop()!;
    const destChild = dest + "/" + name;
    const stat = await IOUtils.stat(child);
    if (stat.type === "directory") {
      await copyDirRecursive(child, destChild);
    } else {
      await IOUtils.copy(child, destChild);
    }
  }
}

export function getMinerUStorageRoot(): string {
  return STORAGE_ROOT;
}

/**
 * 显式同步 preferences.xhtml 控件值，避免 Zotero 重启前读取到旧偏好。
 */
export function registerPreferenceValueSync(document: Document): void {
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-api-key`,
    setApiKey,
  );
  registerChoicePreferenceSync<ParseSource>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-source`,
    ["online", "local"],
    getParseSource,
    setParseSource,
  );
  registerChoicePreferenceSync<ParseMode>(
    document,
    `zotero-prefpane-${config.addonRef}-parse-mode`,
    ["precise", "lite"],
    getParseMode,
    setParseMode,
  );
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-local-api-base-url`,
    setLocalApiBaseURL,
  );
  registerNumberPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-local-api-timeout-minutes`,
    getLocalApiTimeoutMinutes,
    setLocalApiTimeoutMinutes,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-api-enabled`,
    getMarkdownApiEnabled,
    setMarkdownApiEnabled,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-api-require-token`,
    getMarkdownApiRequireToken,
    setMarkdownApiRequireToken,
  );
  registerCheckboxPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-save-images`,
    getSaveImages,
    setSaveImages,
  );
  registerTextPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-sync-folder`,
    setSyncFolder,
  );
  registerNumberPreferenceSync(
    document,
    `zotero-prefpane-${config.addonRef}-auto-parse-page-limit`,
    getAutoParsePageLimit,
    setAutoParsePageLimit,
  );
}

export function openExternalURL(
  url: string,
  launcher: ZoteroURLLauncher = Zotero as unknown as ZoteroURLLauncher,
): void {
  launcher.launchURL(url);
}

function registerExternalLink(
  document: Document,
  id: string,
  url: string,
): void {
  const link = document.getElementById(id);
  link?.addEventListener("click", (event: Event) => {
    event.preventDefault();
    openExternalURL(url);
  });
}

/**
 * 注册文本输入控件的 preference 写入逻辑。
 */
function registerTextPreferenceSync(
  document: Document,
  id: string,
  persist: (value: string) => void,
): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  element?.addEventListener("change", () => {
    persist(element.value);
  });
}

/**
 * 注册数字输入控件的 preference 写入逻辑，并忽略无法解析的值。
 */
function registerNumberPreferenceSync(
  document: Document,
  id: string,
  read: () => number,
  persist: (value: number) => void,
): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (!element) {
    return;
  }

  element.value = String(read());
  element.setAttribute("value", element.value);
  element.addEventListener("change", () => {
    const value = Number(element.value);
    if (Number.isFinite(value)) {
      persist(value);
    }
  });
}

/**
 * 注册枚举控件的 preference 同步逻辑，并忽略未知值。
 */
function registerChoicePreferenceSync<T extends string>(
  document: Document,
  id: string,
  allowedValues: readonly T[],
  read: () => T,
  persist: (value: T) => void,
): void {
  const element = document.getElementById(id) as ChoicePreferenceElement | null;
  if (!element) {
    return;
  }

  setChoiceValue(element, read());
  const syncValue = () => {
    const value = getChoiceValue(element);
    if (allowedValues.includes(value as T)) {
      persist(value as T);
    }
  };

  element.addEventListener("command", syncValue);
  element.addEventListener("change", syncValue);
}

function getChoiceValue(element: ChoicePreferenceElement): string {
  return element.value ?? element.getAttribute("value") ?? "";
}

function setChoiceValue(element: ChoicePreferenceElement, value: string): void {
  element.value = value;
  element.setAttribute("value", value);
}

/**
 * 注册 checkbox 控件的 preference 写入逻辑。
 */
function registerCheckboxPreferenceSync(
  document: Document,
  id: string,
  read: () => boolean,
  persist: (value: boolean) => void,
): void {
  const element = document.getElementById(
    id,
  ) as CheckboxPreferenceElement | null;
  if (!element) {
    return;
  }

  setCheckboxChecked(element, read());
  const syncChecked = () => {
    persist(getCheckboxChecked(element));
  };

  element.addEventListener("command", syncChecked);
  element.addEventListener("change", syncChecked);
}

function getCheckboxChecked(element: CheckboxPreferenceElement): boolean {
  if (typeof element.checked === "boolean") {
    return element.checked;
  }
  return element.getAttribute("checked") === "true";
}

function setCheckboxChecked(
  element: CheckboxPreferenceElement,
  checked: boolean,
): void {
  element.checked = checked;
  element.setAttribute("checked", String(checked));
}

async function updateParsedCount(
  _window: Window,
  storage: ReturnType<typeof createStorage>,
): Promise<void> {
  try {
    const count = await storage.countReadyResults();
    setText(
      _window.document,
      `${config.addonRef}-parsed-count`,
      await formatL10n(_window, "pref-parsed-count", { count }),
    );
  } catch {
    setText(
      _window.document,
      `${config.addonRef}-parsed-count`,
      await formatL10n(_window, "pref-parsed-count-error"),
    );
  }
}

/**
 * 刷新 Markdown 查询 API token 的可见值与状态文案。
 */
async function updateMarkdownApiTokenStatus(_window: Window): Promise<void> {
  const token = getMarkdownApiToken();
  setInputValue(_window.document, `${config.addonRef}-api-token`, token);
  setText(
    _window.document,
    `${config.addonRef}-api-token-status`,
    await formatL10n(
      _window,
      token ? "pref-query-api-token-ready" : "pref-query-api-token-empty",
    ),
  );
}

async function formatL10n(
  _window: Window,
  id: string,
  args?: Record<string, string | number>,
): Promise<string> {
  const l10n = _window.document.l10n;
  if (l10n?.formatValue) {
    const value = await l10n.formatValue(id, args);
    if (value) {
      return value;
    }
  }

  if (id === "pref-data-folder-path") {
    return `Data folder: ${args?.path ?? ""}`;
  }
  if (id === "pref-parsed-count") {
    return `Parsed PDFs: ${args?.count ?? 0}`;
  }
  if (id === "pref-query-api-token-ready") {
    return "Token generated";
  }
  if (id === "pref-query-api-token-empty") {
    return "No token generated";
  }
  return "Parsed PDFs: failed to read";
}

function setText(document: Document, id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

/**
 * 同步只读输入框的当前值和 value 属性，便于偏好页立即显示 token。
 */
function setInputValue(document: Document, id: string, value: string): void {
  const element = document.getElementById(id) as HTMLInputElement | null;
  if (!element) {
    return;
  }

  element.value = value;
  element.setAttribute("value", value);
}
