import { assert } from "chai";
import {
  getMinerUStorageRoot,
  migrateResultStorage,
} from "../src/modules/storageLocation";

describe("storageLocation", function () {
  let root: string;
  let legacyRoot: string;
  let targetRoot: string;

  beforeEach(async function () {
    root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-location-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    legacyRoot = PathUtils.join(root, "profile", "mineru-copy");
    targetRoot = PathUtils.join(root, "data", "mineru-copy");
    await IOUtils.makeDirectory(root, { createAncestors: true });
  });

  afterEach(async function () {
    await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
  });

  it("stores results in the Zotero data directory", function () {
    assert.equal(
      getMinerUStorageRoot("C:\\Users\\me\\Zotero"),
      "C:\\Users\\me\\Zotero\\mineru-copy",
    );
    assert.equal(
      getMinerUStorageRoot("/home/me/Zotero"),
      "/home/me/Zotero/mineru-copy",
    );
  });

  it("moves results from the profile folder and removes it", async function () {
    await writeResult(legacyRoot, "1-AAAA1111", "# A");
    await writeResult(legacyRoot, "1-BBBB2222", "# B");

    const moved = await migrateResultStorage({ legacyRoot, targetRoot });

    assert.equal(moved, 2);
    assert.equal(await readResult(targetRoot, "1-AAAA1111"), "# A");
    assert.equal(await readResult(targetRoot, "1-BBBB2222"), "# B");
    assert.isFalse(await IOUtils.exists(legacyRoot));
  });

  it("keeps the data directory copy when both locations hold a result", async function () {
    await writeResult(legacyRoot, "1-AAAA1111", "# old");
    await writeResult(legacyRoot, "1-BBBB2222", "# B");
    await writeResult(targetRoot, "1-AAAA1111", "# new");

    const moved = await migrateResultStorage({ legacyRoot, targetRoot });

    assert.equal(moved, 1);
    assert.equal(await readResult(targetRoot, "1-AAAA1111"), "# new");
    assert.equal(await readResult(targetRoot, "1-BBBB2222"), "# B");
    // Nothing is deleted: the conflicting legacy result stays in place.
    assert.equal(await readResult(legacyRoot, "1-AAAA1111"), "# old");
  });

  it("does nothing when there is no legacy folder", async function () {
    const moved = await migrateResultStorage({ legacyRoot, targetRoot });

    assert.equal(moved, 0);
    assert.isFalse(await IOUtils.exists(targetRoot));
  });

  it("finishes an interrupted migration on the next run", async function () {
    await writeResult(legacyRoot, "1-AAAA1111", "# A");
    await writeResult(targetRoot, "1-BBBB2222", "# B");

    await migrateResultStorage({ legacyRoot, targetRoot });
    const movedAgain = await migrateResultStorage({ legacyRoot, targetRoot });

    assert.equal(movedAgain, 0);
    assert.equal(await readResult(targetRoot, "1-AAAA1111"), "# A");
    assert.isFalse(await IOUtils.exists(legacyRoot));
  });
});

async function writeResult(
  storageRoot: string,
  name: string,
  markdown: string,
): Promise<void> {
  const dir = PathUtils.join(storageRoot, "attachments", name);
  await IOUtils.makeDirectory(dir, { createAncestors: true });
  await IOUtils.writeUTF8(PathUtils.join(dir, "content.md"), markdown);
}

function readResult(storageRoot: string, name: string): Promise<string> {
  return IOUtils.readUTF8(
    PathUtils.join(storageRoot, "attachments", name, "content.md"),
  );
}
