import { assert } from "chai";
import { syncResultToAgentFolder } from "../src/modules/agentSync";

interface IndexEntry {
  key: string;
  attachmentKey?: string;
  markdownPath?: string;
}

describe("agentSync", function () {
  let root: string;
  let syncFolder: string;

  beforeEach(async function () {
    root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    syncFolder = PathUtils.join(root, "sync");
    await IOUtils.makeDirectory(root, { createAncestors: true });
  });

  afterEach(async function () {
    await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
  });

  it("syncs two PDFs of one item into separate folders and index entries", async function () {
    const parent = fakeParent("Shared Title");
    const first = await writePreciseResult("KEYA");
    const second = await writePreciseResult("KEYB");

    assert.isTrue(await sync(fakeAttachment("KEYA", parent), first));
    assert.isTrue(await sync(fakeAttachment("KEYB", parent), second));

    assert.equal(
      await readOwner("[2020] - Shared Title"),
      "KEYA",
      "the first attachment keeps the plain folder name",
    );
    assert.equal(await readOwner("[2020] - Shared Title [KEYB]"), "KEYB");
    const index = await readIndex();
    assert.deepEqual(
      index.map((entry) => [entry.attachmentKey, entry.markdownPath]),
      [
        ["KEYA", "[2020] - Shared Title/content.md"],
        ["KEYB", "[2020] - Shared Title [KEYB]/content.md"],
      ],
    );
  });

  it("replaces only the attachment's own folder when it syncs again", async function () {
    const parent = fakeParent("Shared Title");
    const source = await writePreciseResult("KEYA");

    assert.isTrue(await sync(fakeAttachment("KEYA", parent), source));
    assert.isTrue(await sync(fakeAttachment("KEYA", parent), source));

    const children = (await IOUtils.getChildren(syncFolder)).map((path) =>
      PathUtils.filename(path),
    );
    assert.sameMembers(children, ["[2020] - Shared Title", "_index.json"]);
    assert.lengthOf(await readIndex(), 1);
  });

  it("does not delete a folder that the sync did not create", async function () {
    const userFolder = PathUtils.join(syncFolder, "[2020] - Shared Title");
    await IOUtils.makeDirectory(userFolder, { createAncestors: true });
    await IOUtils.writeUTF8(PathUtils.join(userFolder, "notes.txt"), "mine");
    const source = await writePreciseResult("KEYA");

    assert.isTrue(
      await sync(fakeAttachment("KEYA", fakeParent("Shared Title")), source),
    );

    assert.isTrue(
      await IOUtils.exists(PathUtils.join(userFolder, "notes.txt")),
    );
    assert.equal(await readOwner("[2020] - Shared Title [KEYA]"), "KEYA");
  });

  it("points lite-only results at lite-content.md", async function () {
    const source = PathUtils.join(root, "results", "1-LITE1");
    await writeFiles(source, {
      "lite-manifest.json": JSON.stringify({
        attachmentKey: "LITE1",
        libraryID: 1,
        mode: "lite",
        status: "ready",
      }),
      "lite-content.md": "# Lite",
    });

    assert.isTrue(
      await sync(fakeAttachment("LITE1", fakeParent("Lite Paper")), source),
    );

    assert.deepEqual(
      (await readIndex()).map((entry) => entry.markdownPath),
      ["[2020] - Lite Paper/lite-content.md"],
    );
  });

  it("reports a sync that could not be written", async function () {
    const source = await writePreciseResult("KEYA");

    const synced = await syncResultToAgentFolder(
      fakeAttachment("KEYA", fakeParent("Shared Title")),
      source,
      // IOUtils only accepts absolute paths.
      { syncFolder: "relative/sync-folder", exportBibTeX: async () => "" },
    );

    assert.isFalse(synced);
  });

  function sync(attachment: Zotero.Item, source: string): Promise<boolean> {
    return syncResultToAgentFolder(attachment, source, {
      syncFolder,
      exportBibTeX: async () => "@misc{test}",
    });
  }

  async function writePreciseResult(key: string): Promise<string> {
    const dir = PathUtils.join(root, "results", `1-${key}`);
    await writeFiles(dir, {
      "manifest.json": JSON.stringify({
        attachmentKey: key,
        libraryID: 1,
        status: "ready",
      }),
      "content.md": `# ${key}`,
    });
    return dir;
  }

  async function readOwner(folderName: string): Promise<string> {
    const manifest = JSON.parse(
      await IOUtils.readUTF8(
        PathUtils.join(syncFolder, folderName, "manifest.json"),
      ),
    ) as { attachmentKey: string };
    return manifest.attachmentKey;
  }

  async function readIndex(): Promise<IndexEntry[]> {
    return JSON.parse(
      await IOUtils.readUTF8(PathUtils.join(syncFolder, "_index.json")),
    ) as IndexEntry[];
  }
});

async function writeFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  for (const [name, content] of Object.entries(files)) {
    await IOUtils.writeUTF8(PathUtils.join(dir, name), content);
  }
}

function fakeParent(title: string) {
  const fields: Record<string, string> = { title, date: "2020-05-01" };
  return {
    id: 50,
    key: "PARENT1",
    getField: (field: string) => fields[field] ?? "",
    getCreators: () => [{ lastName: "Doe" }],
  };
}

function fakeAttachment(
  key: string,
  parent: ReturnType<typeof fakeParent>,
): Zotero.Item {
  return {
    key,
    libraryID: 1,
    parentItem: parent,
    getFilePath: () => `/tmp/${key}.pdf`,
  } as unknown as Zotero.Item;
}
