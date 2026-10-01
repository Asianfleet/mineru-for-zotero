import { assert } from "chai";
import {
  readChunkResult,
  serializeChunkValue,
  writeChunkResult,
} from "../src/modules/parseResume";

describe("parseResume chunk cache", function () {
  let dir: string;

  beforeEach(async function () {
    dir = PathUtils.join(
      PathUtils.tempDir,
      `mineru-chunk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await IOUtils.makeDirectory(dir, { createAncestors: true });
  });

  afterEach(async function () {
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  });

  it("keeps image bytes out of the cache JSON and restores them", async function () {
    const cachePath = PathUtils.join(dir, "part-0-result.json");
    const figure = new Uint8Array(1024 * 1024).map((_, index) => index % 251);
    const result = {
      kind: "precise",
      rawResult: { pages: [{ pageNo: 1 }] },
      markdown: "# A",
      images: [
        { path: "fig.png", bytes: figure },
        { path: "nested/b.jpg", bytes: new Uint8Array([1, 2, 3]) },
      ],
      _chunkPageCount: 12,
    };

    await writeChunkResult(cachePath, result);

    const json = await IOUtils.readUTF8(cachePath);
    assert.isBelow(json.length, 1024, "image bytes must not be inlined");
    assert.deepEqual(await readChunkResult(cachePath), result);
  });

  it("caches results without images", async function () {
    const cachePath = PathUtils.join(dir, "lite.json");
    const result = { kind: "lite", markdown: "# Lite", _chunkPageCount: 3 };

    await writeChunkResult(cachePath, result);

    assert.deepEqual(await readChunkResult(cachePath), result);
  });

  it("reads caches written with inline byte arrays", async function () {
    const cachePath = PathUtils.join(dir, "legacy.json");
    const legacy = {
      markdown: "# Old",
      images: [{ path: "a.png", bytes: new Uint8Array([9, 8, 7]) }],
    };
    await IOUtils.writeUTF8(
      cachePath,
      JSON.stringify(legacy, serializeChunkValue),
    );

    assert.deepEqual(await readChunkResult(cachePath), legacy);
  });

  it("treats a cache with a missing image file as a miss", async function () {
    const cachePath = PathUtils.join(dir, "broken.json");
    await writeChunkResult(cachePath, {
      markdown: "# A",
      images: [{ path: "a.png", bytes: new Uint8Array([1]) }],
    });
    await IOUtils.remove(`${cachePath}.image-0`);

    assert.isNull(await readChunkResult(cachePath));
  });
});
