import { expect } from "chai";
import { createTexSourceStorage } from "../src/modules/texSource/storage";

describe("arXiv source storage", function () {
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
