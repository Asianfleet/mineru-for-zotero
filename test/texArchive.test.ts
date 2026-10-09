import { expect } from "chai";
import { decodeSourceArchive } from "../src/modules/texSource/archive";

describe("arXiv source archive", function () {
  it("accepts one plain TeX file", async function () {
    const files = await decodeSourceArchive(
      new TextEncoder().encode("\\documentclass{article}"),
    );
    expect(files).to.have.length(1);
    expect(files[0].path).to.equal("main.tex");
  });

  it("rejects PDF-only responses", async function () {
    try {
      await decodeSourceArchive(new TextEncoder().encode("%PDF-1.7"));
      expect.fail("expected source rejection");
    } catch (error) {
      expect(String(error)).to.contain("arxiv-source-not-found");
    }
  });

  it("reads a tar archive and rejects traversal entries", async function () {
    const files = await decodeSourceArchive(
      makeTar("paper/main.tex", "\\documentclass{article}"),
    );
    expect(files.map((file) => file.path)).to.deep.equal(["paper/main.tex"]);
    try {
      await decodeSourceArchive(makeTar("../outside.tex", "bad"));
      expect.fail("expected unsafe archive rejection");
    } catch (error) {
      expect(String(error)).to.contain("unsafe-archive");
    }
  });

  it("reads a gzip-compressed tar without DecompressionStream", async function () {
    const runtime = globalThis as typeof globalThis & {
      DecompressionStream?: typeof DecompressionStream;
    };
    const original = runtime.DecompressionStream;
    runtime.DecompressionStream = undefined;
    try {
      const compressed = Uint8Array.from(
        atob(
          "H4sIAAAAAAAACitILEgt0s9NzMzTK0mtYKAJMDAwMDAzMQHTBgYG6LSBgZk5gm1gwKAABQa0cQ4qKC0uSSyih0WDE8Sk5CeX5qbmlSTnJBYXVycWlWQm56TWxiSlpmfmVcMka/OzY1LzUhD8gXb2KBgFo2AUjAIKAQDmTqrkAAgAAA==",
        ),
        (character) => character.charCodeAt(0),
      );
      const files = await decodeSourceArchive(compressed);
      expect(files.map((file) => file.path)).to.deep.equal(["paper/main.tex"]);
      expect(new TextDecoder().decode(files[0].bytes)).to.contain(
        "\\documentclass",
      );
    } finally {
      runtime.DecompressionStream = original;
    }
  });
});

/** 生成最小 ustar 归档供真实解析器测试。 */
function makeTar(name: string, content: string): Uint8Array {
  const bytes = new TextEncoder().encode(content);
  const archive = new Uint8Array(512 + 512 + 1024);
  archive.set(new TextEncoder().encode(name), 0);
  archive.set(new TextEncoder().encode("0000644\0"), 100);
  archive.set(new TextEncoder().encode("0000000\0"), 108);
  archive.set(new TextEncoder().encode("0000000\0"), 116);
  archive.set(
    new TextEncoder().encode(bytes.length.toString(8).padStart(11, "0") + "\0"),
    124,
  );
  archive.set(new TextEncoder().encode("00000000000\0"), 136);
  archive.set(new TextEncoder().encode("        "), 148);
  archive[156] = "0".charCodeAt(0);
  archive.set(new TextEncoder().encode("ustar\0"), 257);
  archive.set(bytes, 512);
  return archive;
}
