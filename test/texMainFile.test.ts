import { expect } from "chai";
import { fetchLatex } from "../src/modules/sourceQuery/apiEndpoint";
import type { createTexSourceStorage } from "../src/modules/texSource/storage";

describe("LaTeX main file selection", function () {
  const document = "\\documentclass{article}\n\\begin{document}\n";

  /** 使用内存归档运行真实下载入口，并恢复运行时依赖。 */
  async function select(
    files: Array<[string, string]>,
    mainFile?: string,
    cachedMainFile?: string,
  ) {
    const originalFetch = globalThis.fetch;
    const originalGetItem = Zotero.Items.getByLibraryAndKeyAsync;
    const archive = makeArchive(files);
    globalThis.fetch = (async () => ({
      ok: true,
      arrayBuffer: async () => archive.buffer,
    })) as typeof fetch;
    Zotero.Items.getByLibraryAndKeyAsync = (async () => ({
      getField: () => "arXiv:1807.03819",
    })) as typeof originalGetItem;
    const store = {
      write: async () => undefined,
      readReadyManifest: async () => ({ mainFile: cachedMainFile }),
    } as unknown as ReturnType<typeof createTexSourceStorage>;
    try {
      return await fetchLatex(store, 1, "E8ALV3XU", !cachedMainFile, mainFile);
    } finally {
      globalThis.fetch = originalFetch;
      Zotero.Items.getByLibraryAndKeyAsync = originalGetItem;
    }
  }

  it("ignores style files and commented TeX entry commands", async function () {
    const manifest = await select([
      ["iclr2019_conference.sty", "% \\documentclass{article}"],
      ["example.tex", "% \\documentclass{article}\n% \\begin{document}"],
      ["main.tex", document],
    ]);
    expect(manifest.mainFile).to.equal("main.tex");
  });

  it("prefers a complete entry over a preamble fragment", async function () {
    expect(
      (
        await select([
          ["preamble.tex", "\\documentclass{article}"],
          ["paper.TEX", document],
        ])
      ).mainFile,
    ).to.equal("paper.TEX");
  });

  it("ignores similarly named commands and nested example arguments", async function () {
    expect(
      (
        await select([
          [
            "example.tex",
            "\\documentclassExample{article}\n\\newcommand{\\sample}{\\documentclass{article}}",
          ],
          ["main.tex", "\\documentclass[11pt]{article}\n\\begin {document}"],
        ])
      ).mainFile,
    ).to.equal("main.tex");
  });

  it("reports no entry when all document commands are commented", async function () {
    try {
      await select([["main.tex", "% \\documentclass{article}"]]);
      expect.fail("expected missing entry rejection");
    } catch (error) {
      expect((error as Error).message).to.equal("ambiguous-main-file");
      expect(
        (error as Error & { candidates: string[] }).candidates,
      ).to.deep.equal([]);
    }
  });

  it("honors an explicit entry that differs from the cached entry", async function () {
    expect(
      (
        await select(
          [
            ["a.tex", document],
            ["b.tex", document],
          ],
          "b.tex",
          "a.tex",
        )
      ).mainFile,
    ).to.equal("b.tex");
  });

  it("reports multiple entries instead of depending on archive order", async function () {
    try {
      await select([
        ["a.tex", document],
        ["b.tex", document],
      ]);
      expect.fail("expected ambiguous entry rejection");
    } catch (error) {
      expect((error as Error).message).to.equal("ambiguous-main-file");
      expect(
        (error as Error & { candidates: string[] }).candidates,
      ).to.deep.equal(["a.tex", "b.tex"]);
    }
  });

  it("rejects a non-TeX explicit entry", async function () {
    try {
      await select(
        [
          ["style.sty", document],
          ["main.tex", document],
        ],
        "style.sty",
      );
      expect.fail("expected invalid entry rejection");
    } catch (error) {
      expect((error as Error).message).to.equal("invalid-main-file");
    }
  });

  it("allows an explicit TeX entry and a unique partial entry", async function () {
    expect(
      (
        await select(
          [
            ["a.tex", document],
            ["b.tex", document],
          ],
          "b.tex",
        )
      ).mainFile,
    ).to.equal("b.tex");
    expect(
      (await select([["main.tex", "\\documentclass{article}"]])).mainFile,
    ).to.equal("main.tex");
  });
});

/** 生成多个普通文件组成的最小 ustar 归档。 */
function makeArchive(files: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder();
  const blocks = files.map(([path, content]) => {
    const bytes = encoder.encode(content);
    const block = new Uint8Array(512 + Math.ceil(bytes.length / 512) * 512);
    block.set(encoder.encode(path));
    block.set(
      encoder.encode(bytes.length.toString(8).padStart(11, "0") + "\0"),
      124,
    );
    block[156] = 48;
    block.set(encoder.encode("ustar\0"), 257);
    block.set(bytes, 512);
    return block;
  });
  const archive = new Uint8Array(
    blocks.reduce((size, block) => size + block.length, 1024),
  );
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
}
