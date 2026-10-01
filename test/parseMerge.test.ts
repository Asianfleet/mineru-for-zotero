import { assert } from "chai";
import { mergeChunkResults } from "../src/modules/parseMerge";
import { formatSelectedBoxesForCopy } from "../src/modules/readerOverlay/copy";
import { mineruResultFixture } from "./domainFixtures";

describe("parseMerge", function () {
  it("concatenates lite markdown with separators", function () {
    const merged = mergeChunkResults(
      [
        { markdown: "# Part 1" },
        { markdown: "# Part 2" },
        { markdown: "# Part 3" },
      ],
      "lite",
    );

    assert.deepEqual(merged, {
      kind: "lite",
      markdown: "# Part 1\n\n---\n\n# Part 2\n\n---\n\n# Part 3",
    });
  });

  it("passes through a single precise chunk and defaults images", function () {
    const merged = mergeChunkResults(
      [{ markdown: "# Single", rawResult: mineruResultFixture }],
      "precise",
    );

    assert.equal(merged.kind, "precise");
    if (merged.kind !== "precise") return;
    assert.equal(merged.rawResult, mineruResultFixture);
    assert.equal(merged.markdown, "# Single");
    assert.deepEqual(merged.images, []);
    assert.isAbove(merged._mergedBoxes.length, 0);
  });

  it("namespaces image paths per chunk and rewrites markdown links", function () {
    const merged = mergeChunkResults(
      [
        {
          markdown: "![A](images/a.png)",
          rawResult: { ok: 1 },
          images: [{ path: "images/a.png", bytes: new Uint8Array([1]) }],
        },
        {
          markdown: "![B](images/b.png)",
          rawResult: { ok: 2 },
          images: [{ path: "images/b.png", bytes: new Uint8Array([2]) }],
        },
      ],
      "precise",
    );

    assert.equal(merged.kind, "precise");
    if (merged.kind !== "precise") return;
    assert.deepEqual(
      merged.images.map((image) => image.path),
      ["images/part0_a.png", "images/part1_b.png"],
    );
    assert.include(merged.markdown, "images/part0_a.png");
    assert.include(merged.markdown, "images/part1_b.png");
  });

  it("offsets box pages of later chunks by preceding page counts", function () {
    const merged = mergeChunkResults(
      [
        {
          markdown: "one",
          rawResult: mineruResultFixture,
          _chunkPageCount: 3,
        },
        {
          markdown: "two",
          rawResult: mineruResultFixture,
          _chunkPageCount: 3,
        },
      ],
      "precise",
    );

    assert.equal(merged.kind, "precise");
    if (merged.kind !== "precise") return;
    const firstHalf = merged._mergedBoxes.slice(0, 3).map((box) => box.page);
    const secondHalf = merged._mergedBoxes.slice(3).map((box) => box.page);
    assert.deepEqual(
      secondHalf,
      firstHalf.map((page) => page + 3),
    );
  });

  it("keeps box rawIndex values unique across merged chunks", function () {
    const merged = mergeChunkResults(
      [
        { markdown: "one", rawResult: mineruResultFixture, _chunkPageCount: 3 },
        { markdown: "two", rawResult: mineruResultFixture, _chunkPageCount: 3 },
      ],
      "precise",
    );

    assert.equal(merged.kind, "precise");
    if (merged.kind !== "precise") return;
    assert.deepEqual(
      merged._mergedBoxes.map((box) => box.rawIndex),
      [0, 1, 2, 3, 4, 5],
    );
  });

  it("copies only the selected box of a merged result", function () {
    const merged = mergeChunkResults(
      [
        { markdown: "one", rawResult: mineruResultFixture, _chunkPageCount: 3 },
        { markdown: "two", rawResult: mineruResultFixture, _chunkPageCount: 3 },
      ],
      "precise",
    );

    assert.equal(merged.kind, "precise");
    if (merged.kind !== "precise") return;
    // The overlay keys selection by rawIndex; select the first box on page 1.
    const selected = new Set([merged._mergedBoxes[0].rawIndex]);
    assert.equal(
      formatSelectedBoxesForCopy(merged._mergedBoxes, selected),
      "First paragraph",
    );
  });

  it("falls back to a 200 page offset when a chunk omits its page count", function () {
    const merged = mergeChunkResults(
      [
        { markdown: "one", rawResult: mineruResultFixture },
        { markdown: "two", rawResult: mineruResultFixture },
      ],
      "precise",
    );

    assert.equal(merged.kind, "precise");
    if (merged.kind !== "precise") return;
    const firstHalf = merged._mergedBoxes.slice(0, 3).map((box) => box.page);
    const secondHalf = merged._mergedBoxes.slice(3).map((box) => box.page);
    assert.deepEqual(
      secondHalf,
      firstHalf.map((page) => page + 200),
    );
  });
});
