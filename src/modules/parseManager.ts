import type { AttachmentRef } from "./domain";
import type { FluentMessageId } from "../../typings/i10n";
import { normalizeMinerUBoxes } from "./boxNormalizer";
import { createMinerUClient } from "./mineruClient";
import { createStorage } from "./storage";
import { getString } from "../utils/locale";
import { getApiKey } from "../utils/prefs";
import { getMinerUStorageRoot } from "./preferenceScript";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 120;

export async function parseSelectedAttachment(
  options?: { force?: boolean },
): Promise<void> {
  const attachment = await getSelectedPDFAttachment();
  if (!attachment) {
    showMessage("parse-error-not-pdf");
    return;
  }

  await parseAttachment(attachment, options);
}

export async function parseAttachment(
  attachment: Zotero.Item,
  options?: { force?: boolean },
): Promise<void> {
  if (!attachment.isPDFAttachment()) {
    showMessage("parse-error-not-pdf");
    return;
  }

  const filePath = await attachment.getFilePathAsync();
  if (!filePath) {
    ztoolkit.log("MinerU PDF file access failed", attachment.id);
    showMessage("parse-error-file-access");
    return;
  }

  const apiKey = getApiKey().trim();
  if (!apiKey) {
    showMessage("parse-error-missing-api-key");
    return;
  }

  const attachmentRef = await toAttachmentRef(attachment, filePath);
  const storage = createStorage(getMinerUStorageRoot());
  const hasReady = await storage.hasReadyResult(attachmentRef);
  if (hasReady && options?.force !== true) {
    const shouldReparse = await confirmReparse();
    if (!shouldReparse) {
      showMessage("parse-use-existing-result");
      return;
    }
  }

  const client = createMinerUClient({ apiKey });
  try {
    showMessage("parse-started");
    const { taskID } = await client.submitPdf(filePath);
    await waitForTask(client, taskID);
    const result = await client.downloadResult(taskID);
    const boxes = normalizeMinerUBoxes(result.rawResult);

    if (boxes.length === 0) {
      showMessage("parse-error-empty-boxes");
      return;
    }

    await storage.writeResult({
      attachment: attachmentRef,
      mineruTaskID: taskID,
      rawResult: result.rawResult,
      markdown: result.markdown,
      boxes,
    });
    showMessage("parse-finished");
  } catch (error) {
    ztoolkit.log("MinerU parse failed", attachment.id, error);
    showMessage("parse-error-generic", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function selectedHasPDFAttachment(): Promise<boolean> {
  return Boolean(await getSelectedPDFAttachment());
}

async function getSelectedPDFAttachment(): Promise<Zotero.Item | null> {
  const pane = Zotero.getActiveZoteroPane();
  const items = pane.getSelectedItems();
  for (const item of items) {
    const attachment = await resolvePDFAttachment(item);
    if (attachment) {
      return attachment;
    }
  }
  return null;
}

async function resolvePDFAttachment(item: Zotero.Item): Promise<Zotero.Item | null> {
  if (item.isAttachment()) {
    return item.isPDFAttachment() ? item : null;
  }

  if (!item.isRegularItem()) {
    return null;
  }

  const attachments = await item.getBestAttachments();
  return attachments.find((attachment) => attachment.isPDFAttachment()) ?? null;
}

async function toAttachmentRef(
  attachment: Zotero.Item,
  filePath: string,
): Promise<AttachmentRef> {
  return {
    id: attachment.id,
    key: attachment.key,
    libraryID: attachment.libraryID,
    fileName: attachment.attachmentFilename || basename(filePath),
    filePath,
    mtime: (await attachment.attachmentModificationTime) ?? 0,
  };
}

async function waitForTask(
  client: ReturnType<typeof createMinerUClient>,
  taskID: string,
): Promise<void> {
  for (let count = 0; count < MAX_POLL_COUNT; count += 1) {
    const result = await client.pollTask(taskID);
    if (result.status === "succeeded") {
      return;
    }
    if (result.status === "failed") {
      throw new Error(result.error || "MinerU task failed");
    }
    await Zotero.Promise.delay(POLL_INTERVAL_MS);
  }
  throw new Error("MinerU task timed out");
}

async function confirmReparse(): Promise<boolean> {
  const win = Zotero.getMainWindow();
  const result = win.confirm(getString("parse-confirm-reparse"));
  return result;
}

function showMessage(id: FluentMessageId, args?: Record<string, string>): void {
  const text = args ? getString(id, { args }) : getString(id);
  new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeTime: 4000,
  })
    .createLine({
      text,
      type: "default",
      progress: 100,
    })
    .show();
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || "file.pdf";
}
