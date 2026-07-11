import { assert } from "chai";
import {
  createMarkdownQueryEndpoint,
  MARKDOWN_ENDPOINT_PATHS,
} from "../src/modules/markdownQuery/apiEndpoint";
import {
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
} from "../src/utils/prefs";

describe("markdownApiEndpoint", function () {
  afterEach(function () {
    setMarkdownApiEnabled(false);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("");
  });

  it("returns api-disabled when the API is off", async function () {
    setMarkdownApiEnabled(false);
    const endpoint = createMarkdownQueryEndpoint(fakeService());
    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown"),
    );

    assert.deepEqual(response, [
      403,
      "application/json",
      JSON.stringify({
        error: "api-disabled",
        message: "Markdown query API is disabled",
      }),
    ]);
  });

  it("rejects missing tokens when token auth is required", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("secret");
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown"),
    );

    assert.include(String(response[2]), "invalid-token");
  });

  it("accepts bearer tokens", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("secret");
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown", {
        headers: { authorization: "Bearer secret" },
        query: { libraryID: "1", key: "PDF1" },
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), "# Body");
  });

  it("accepts query tokens", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("secret");
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: { libraryID: "1", title: "Doc", token: "secret" },
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"candidates":[]');
  });

  it("registers the expected endpoint paths", function () {
    assert.deepEqual(MARKDOWN_ENDPOINT_PATHS, [
      "/mineru-for-zotero/search",
      "/mineru-for-zotero/markdown",
    ]);
  });
});

function fakeService() {
  return {
    async searchByTitle() {
      return { candidates: [] };
    },
    async queryMarkdown() {
      return { granularity: "full", content: "# Body" };
    },
  };
}

function request(
  pathname: string,
  overrides: Partial<{
    method: "GET" | "POST";
    query: Record<string, string>;
    headers: Record<string, string>;
  }> = {},
) {
  return {
    method: overrides.method ?? "GET",
    pathname,
    query: overrides.query ?? {},
    headers: overrides.headers ?? {},
    data: undefined,
  };
}
