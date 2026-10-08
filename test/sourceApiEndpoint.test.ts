import { expect } from "chai";
import { createSourceQueryEndpoint } from "../src/modules/sourceQuery/apiEndpoint";
import { createTexSourceStorage } from "../src/modules/texSource/storage";

describe("source query endpoint", function () {
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
