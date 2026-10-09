import { expect } from "chai";
import {
  createSourceQueryEndpoint,
  fetchLatex,
  readLatexImages,
} from "../src/modules/sourceQuery/apiEndpoint";
import { createTexSourceStorage } from "../src/modules/texSource/storage";

describe("source query endpoint", function () {
  it("rejects LaTeX section numbers and passes search context", async function () {
    const received: unknown[] = [];
    const endpoint = createSourceQueryEndpoint({
      authorized: () => undefined,
      read: async (input) => {
        received.push(input);
        return {};
      },
      table: async () => ({}),
      image: async () => ({}),
      fetch: async () => ({}),
    });
    const options = {
      pathname: "/mineru-for-zotero/latex/read",
      method: "GET" as const,
      headers: {},
    };
    const rejected = await endpoint.init({
      ...options,
      query: {
        libraryID: "1",
        key: "ABCD1234",
        granularity: "section",
        sectionNumber: "1",
      },
    });
    expect(rejected[0]).to.equal(400);
    expect(JSON.parse(rejected[2]).error).to.equal("invalid-request");
    expect(received).to.have.length(0);
    await endpoint.init({
      ...options,
      query: {
        libraryID: "1",
        key: "ABCD1234",
        granularity: "search",
        q: "attention",
        contextParagraphs: "2",
      },
    });
    expect(received[0]).to.include({
      query: "attention",
      contextParagraphs: 2,
    });
  });

  it("returns ambiguous section candidates from the query service", async function () {
    const endpoint = createSourceQueryEndpoint({
      authorized: () => undefined,
      read: async () => {
        throw Object.assign(new Error("ambiguous-section"), {
          candidates: [{ path: ["A", "Results"], file: "main.tex", line: 12 }],
        });
      },
      table: async () => ({}),
      image: async () => ({}),
      fetch: async () => ({}),
    });
    const response = await endpoint.init({
      pathname: "/mineru-for-zotero/latex/read",
      method: "GET",
      query: {
        libraryID: "1",
        key: "ABCD1234",
        granularity: "section",
        sectionPath: "Results",
      },
      headers: {},
    });
    expect(response[0]).to.equal(400);
    expect(JSON.parse(response[2]).candidates[0].path).to.deep.equal([
      "A",
      "Results",
    ]);
  });

  it("returns ordered status records for a mixed LaTeX image request", async function () {
    const root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-tex-images-${Date.now()}`,
    );
    const store = createTexSourceStorage(root);
    const ref = { libraryID: 1, key: "IMAGES12" };
    try {
      await store.write({
        ...ref,
        files: [
          { path: "main.tex", bytes: new TextEncoder().encode("source") },
          { path: "imgs/a.pdf", bytes: Uint8Array.from([1, 2]) },
          { path: "imgs/b.pdf", bytes: Uint8Array.from([3, 4]) },
        ],
        manifest: {
          libraryID: 1,
          itemKey: ref.key,
          arxivID: "2505.06708",
          resolvedVersion: "latest",
          downloadedAt: "2026-10-08T00:00:00.000Z",
          mainFile: "main.tex",
          files: ["main.tex", "imgs/a.pdf", "imgs/b.pdf"],
          fileCount: 3,
          status: "ready",
          resultVersion: 1,
        },
      });
      const result = await readLatexImages(store, {
        ...ref,
        path: "imgs/a.pdf,../bad,imgs/missing.pdf,imgs/a.pdf,imgs/b.pdf",
      });
      expect(result.images.map((image) => image.status)).to.deep.equal([
        "ok",
        "invalid-path",
        "tex-image-not-found",
        "duplicate-path",
        "ok",
      ]);
      expect(result.images[0].dataURL).to.match(
        /^data:application\/pdf;base64,/,
      );
      await IOUtils.remove(
        PathUtils.join(store.getDir(1, ref.key), "imgs", "b.pdf"),
      );
      const missingFile = await readLatexImages(store, {
        ...ref,
        path: "imgs/a.pdf,imgs/b.pdf",
      });
      expect(missingFile.images.map((image) => image.status)).to.deep.equal([
        "ok",
        "tex-image-not-found",
      ]);
    } finally {
      await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
    }
  });

  it("returns the same manifest shape for a cached fetch", async function () {
    const root = PathUtils.join(
      PathUtils.tempDir,
      `mineru-tex-fetch-${Date.now()}`,
    );
    const store = createTexSourceStorage(root);
    const ref = { libraryID: 1, key: "FETCH123" };
    const manifest = {
      libraryID: ref.libraryID,
      itemKey: ref.key,
      arxivID: "2505.06708",
      resolvedVersion: "latest",
      downloadedAt: "2026-10-08T00:00:00.000Z",
      mainFile: "main.tex",
      files: ["main.tex"],
      fileCount: 1,
      status: "ready" as const,
      resultVersion: 1 as const,
    };
    try {
      await store.write({
        ...ref,
        files: [{ path: "main.tex", bytes: new TextEncoder().encode("x") }],
        manifest,
      });
      expect(
        await fetchLatex(store, ref.libraryID, ref.key, false),
      ).to.deep.equal(manifest);
      await IOUtils.remove(
        PathUtils.join(store.getDir(1, ref.key), "main.tex"),
      );
      try {
        await fetchLatex(store, ref.libraryID, ref.key, false);
        throw new Error("expected cache miss to enter the download flow");
      } catch (error) {
        expect((error as Error).message).to.equal("item-not-found");
      }
    } finally {
      await IOUtils.remove(root, { recursive: true, ignoreAbsent: true });
    }
  });

  it("routes LaTeX table queries", async function () {
    const endpoint = createSourceQueryEndpoint({
      authorized: () => undefined,
      read: async () => ({}),
      table: async () => ({
        source: "latex",
        tables: [{ content: "\\begin{table}" }],
      }),
      image: async () => ({}),
      fetch: async () => ({}),
    });
    const response = await endpoint.init({
      pathname: "/mineru-for-zotero/latex/table",
      method: "GET",
      query: { libraryID: "1", key: "ABCD1234", q: "Table 1" },
      headers: {},
    });
    expect(response[0]).to.equal(200);
    expect(JSON.parse(response[2]).tables).to.have.length(1);
  });

  it("maps missing source to 404", async function () {
    const endpoint = createSourceQueryEndpoint({
      authorized: () => undefined,
      read: async () => {
        throw new Error("tex-source-not-found");
      },
      table: async () => ({}),
      image: async () => ({}),
      fetch: async () => ({}),
    });
    const response = await endpoint.init({
      pathname: "/mineru-for-zotero/latex/read",
      method: "GET",
      query: { libraryID: "1", key: "ABCD1234" },
      headers: {},
    });
    expect(response[0]).to.equal(404);
    expect(JSON.parse(response[2]).error).to.equal("tex-source-not-found");
  });

  it("passes the requested main file to LaTeX fetch", async function () {
    let received: unknown;
    const endpoint = createSourceQueryEndpoint({
      authorized: () => undefined,
      read: async () => ({}),
      table: async () => ({}),
      image: async () => ({}),
      fetch: async (input) => {
        received = input;
        return {};
      },
    });
    const response = await endpoint.init({
      pathname: "/mineru-for-zotero/latex/fetch",
      method: "POST",
      query: {
        libraryID: "1",
        key: "ABCD1234",
        refresh: "true",
        mainFile: "paper/main.tex",
      },
      headers: {},
    });
    expect(response[0]).to.equal(200);
    expect(received).to.deep.equal({
      libraryID: 1,
      key: "ABCD1234",
      refresh: true,
      mainFile: "paper/main.tex",
    });
  });

  it("returns source-not-found for an image when no source is stored", async function () {
    const store = createTexSourceStorage("ProfD/mineru-copy-archive-test");
    const endpoint = createSourceQueryEndpoint({
      authorized: () => undefined,
      read: async () => ({}),
      table: async () => ({}),
      image: (input) => store.readImage(input, input.path),
      fetch: async () => ({}),
    });
    const response = await endpoint.init({
      pathname: "/mineru-for-zotero/latex/image",
      method: "GET",
      query: {
        libraryID: "1",
        key: "MISSING1",
        path: "figures/a.pdf",
      },
      headers: {},
    });
    expect(response[0], response[2]).to.equal(404);
    expect(JSON.parse(response[2]).error).to.equal("tex-source-not-found");
  });
});
