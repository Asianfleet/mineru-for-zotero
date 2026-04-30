import { config } from "../../package.json";
import { createStorage } from "./storage";

const STORAGE_ROOT = "ProfD/mineru-copy";

export async function registerPrefsScripts(_window: Window) {
  const storageRoot = getMinerUStorageRoot();
  const storage = createStorage(storageRoot);
  const document = _window.document;

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
}

export function getMinerUStorageRoot(): string {
  return STORAGE_ROOT;
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
  return "Parsed PDFs: failed to read";
}

function setText(document: Document, id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}
