import { expect } from "chai";
import { createTexSourceStorage } from "../src/modules/texSource/storage";

describe("arXiv source storage", function () {
  it("checks cached manifest without reading TeX content", async function () {
    const root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-tex-manifest-${Date.now()}`,
    );
    const store = createTexSourceStorage(root);
    const ref = { libraryID: 1, key: "CACHE123" };
    const manifest = {
      libraryID: ref.libraryID,
      itemKey: ref.key,
      arxivID: "2505.06708",
      resolvedVersion: "latest",
      downloadedAt: "2026-10-08T00:00:00.000Z",
      mainFile: "main.tex",
      files: ["main.tex", "appendix.tex", "figures/a.png"],
      fileCount: 3,
      status: "ready" as const,
      resultVersion: 1 as const,
    };
    try {
      await store.write({
        ...ref,
        files: [
          { path: "main.tex", bytes: new TextEncoder().encode("source") },
          { path: "appendix.tex", bytes: new TextEncoder().encode("more") },
          { path: "figures/a.png", bytes: Uint8Array.from([1]) },
        ],
        manifest,
      });
      const originalReadUTF8 = IOUtils.readUTF8;
      const reads: string[] = [];
      IOUtils.readUTF8 = async (path, ...args) => {
        reads.push(path);
        return originalReadUTF8(path, ...args);
      };
      try {
        expect(await store.readReadyManifest(ref)).to.deep.equal(manifest);
      } finally {
        IOUtils.readUTF8 = originalReadUTF8;
      }
      expect(reads).to.deep.equal([
        PathUtils.join(store.getDir(ref.libraryID, ref.key), "manifest.json"),
      ]);
      await IOUtils.remove(
        PathUtils.join(store.getDir(1, ref.key), "appendix.tex"),
      );
      try {
        await store.readReadyManifest(ref);
        throw new Error("expected missing TeX file to invalidate the cache");
      } catch (error) {
        expect((error as Error).message).to.equal("tex-source-not-found");
      }
      await IOUtils.writeUTF8(
        PathUtils.join(store.getDir(1, ref.key), "appendix.tex"),
        "source",
      );
      const manifestPath = PathUtils.join(
        store.getDir(1, ref.key),
        "manifest.json",
      );
      for (const invalid of [
        { ...manifest, itemKey: "OTHER123" },
        {
          ...manifest,
          mainFile: "../main.tex",
          files: ["../main.tex"],
          fileCount: 1,
        },
      ]) {
        await IOUtils.writeUTF8(manifestPath, JSON.stringify(invalid));
        try {
          await store.readReadyManifest(ref);
          throw new Error("expected invalid manifest to be rejected");
        } catch (error) {
          expect((error as Error).message).to.be.oneOf([
            "tex-source-not-found",
            "unsafe-archive",
          ]);
        }
      }
    } finally {
      await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
    }
  });

  it("writes and reads source files and a nested image", async function () {
    const root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-tex-storage-${Date.now()}`,
    );
    const store = createTexSourceStorage(root);
    const ref = { libraryID: 1, key: "ABCD1234" };
    const content =
      "\\documentclass{article}\\begin{document}ok\\end{document}";
    const imageBytes = Uint8Array.from([137, 80, 78, 71]);

    try {
      await store.write({
        ...ref,
        files: [
          { path: "main.tex", bytes: new TextEncoder().encode(content) },
          { path: "figures/a.png", bytes: imageBytes },
        ],
        manifest: {
          ...ref,
          itemKey: ref.key,
          arxivID: "2505.06708",
          resolvedVersion: "latest",
          downloadedAt: "2026-10-08T00:00:00.000Z",
          mainFile: "main.tex",
          files: ["main.tex", "figures/a.png"],
          fileCount: 2,
          status: "ready",
          resultVersion: 1,
        },
      });

      const source = await store.read(ref);
      expect(source.mainFile).to.equal("main.tex");
      expect(source.files).to.deep.equal([{ path: "main.tex", content }]);
      const image = await store.readImage(ref, "figures/a.png");
      expect(Array.from(image.bytes)).to.deep.equal(Array.from(imageBytes));
      expect(image.mime).to.equal("image/png");
    } finally {
      await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
    }
  });
});
