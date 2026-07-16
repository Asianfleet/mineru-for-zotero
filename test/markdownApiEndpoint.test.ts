import { assert } from "chai";
import {
  createMarkdownQueryEndpoint,
  createMarkdownQueryEndpointClass,
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

  it("creates a constructible Zotero endpoint class", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    const EndpointClass = createMarkdownQueryEndpointClass(fakeService());
    const endpoint = new EndpointClass();

    const response = await endpoint.init(
      runtimeRequest("/mineru-for-zotero/markdown", {
        searchParams: new URLSearchParams({ libraryID: "1", key: "PDF1" }),
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), "# Body");
  });

  it("reads query parameters from Zotero runtime searchParams", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      runtimeRequest("/mineru-for-zotero/search", {
        searchParams: new URLSearchParams({ libraryID: "1", title: "Doc" }),
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"candidates":[]');
  });

  it("passes sectionNumber to markdown queries", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    let received: unknown;
    const endpoint = createMarkdownQueryEndpoint({
      async searchByTitle() {
        return { candidates: [] };
      },
      async queryMarkdown(input) {
        received = input;
        return { granularity: "section", groups: [] };
      },
      async queryTables() {
        return { tables: [] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown", {
        query: {
          libraryID: "1",
          key: "PDF1",
          granularity: "section",
          sectionNumber: "5.1,5.2",
        },
      }),
    );

    assert.equal(response[0], 200);
    assert.deepInclude(received as Record<string, unknown>, {
      sectionNumber: "5.1,5.2",
    });
  });

  it("returns grouped not-found results for legacy JSON array sectionPath", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    let received: unknown;
    const endpoint = createMarkdownQueryEndpoint({
      async searchByTitle() {
        return { candidates: [] };
      },
      async queryMarkdown(input) {
        received = input;
        return {
          granularity: "section",
          groups: [
            {
              query: "Doc / Missing",
              kind: "section-path",
              status: "not-found",
              matches: [],
              warnings: [],
            },
          ],
        };
      },
      async queryTables() {
        return { tables: [] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown", {
        query: {
          libraryID: "1",
          key: "PDF1",
          granularity: "section",
          sectionPath: '["Doc","Missing"]',
        },
      }),
    );

    assert.equal(response[0], 200);
    assert.deepEqual((received as { sectionPath?: unknown }).sectionPath, [
      "Doc",
      "Missing",
    ]);
    assert.deepEqual(JSON.parse(String(response[2])), {
      granularity: "section",
      groups: [
        {
          query: "Doc / Missing",
          kind: "section-path",
          status: "not-found",
          matches: [],
          warnings: [],
        },
      ],
    });
  });

  it("uses a generic internal-error message for unexpected errors", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    const endpoint = createMarkdownQueryEndpoint({
      async searchByTitle() {
        return { candidates: [] };
      },
      async queryMarkdown() {
        throw new Error("database path C:\\Users\\secret\\profile.sqlite");
      },
      async queryTables() {
        return { tables: [] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown", {
        query: { libraryID: "1", key: "PDF1" },
      }),
    );
    const payload = JSON.parse(String(response[2])) as {
      error: string;
      message: string;
    };

    assert.equal(response[0], 500);
    assert.equal(payload.error, "internal-error");
    assert.equal(payload.message, "Unexpected internal error");
    assert.notInclude(String(response[2]), "profile.sqlite");
  });

  it("routes table queries with match and format parameters", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    let received: unknown;
    const endpoint = createMarkdownQueryEndpoint({
      async searchByTitle() {
        return { candidates: [] };
      },
      async queryMarkdown() {
        return { granularity: "full", content: "# Body" };
      },
      async queryTables(input) {
        received = input;
        return { tables: [{ content: "result" }] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/tables", {
        query: {
          libraryID: "1",
          key: "PDF1",
          attachmentKey: "ATT1",
          q: "Dataset",
          match: "caption",
          tableFormat: "markdown",
        },
      }),
    );

    assert.equal(response[0], 200);
    assert.deepEqual(received, {
      libraryID: 1,
      key: "PDF1",
      attachmentKey: "ATT1",
      q: "Dataset",
      match: "caption",
      tableFormat: "markdown",
    });
    assert.include(String(response[2]), '"tables"');
  });

  it("rejects invalid table match values", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/tables", {
        query: {
          libraryID: "1",
          key: "PDF1",
          q: "Dataset",
          match: "summary",
        },
      }),
    );
    const payload = JSON.parse(String(response[2])) as { error: string };

    assert.equal(response[0], 400);
    assert.equal(payload.error, "invalid-request");
  });

  it("rejects invalid table format values", async function () {
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(false);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/tables", {
        query: {
          libraryID: "1",
          key: "PDF1",
          q: "Dataset",
          tableFormat: "csv",
        },
      }),
    );
    const payload = JSON.parse(String(response[2])) as { error: string };

    assert.equal(response[0], 400);
    assert.equal(payload.error, "invalid-request");
  });

  it("registers the expected endpoint paths", function () {
    assert.deepEqual(MARKDOWN_ENDPOINT_PATHS, [
      "/mineru-for-zotero/search",
      "/mineru-for-zotero/tables",
      "/mineru-for-zotero/markdown",
    ]);
  });

  it("registers the tables endpoint path", function () {
    assert.include(MARKDOWN_ENDPOINT_PATHS, "/mineru-for-zotero/tables");
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
    async queryTables() {
      return { tables: [] };
    },
  };
}

function runtimeRequest(
  pathname: string,
  overrides: Partial<{
    method: "GET" | "POST";
    searchParams: URLSearchParams;
    headers: Record<string, string>;
  }> = {},
) {
  return {
    method: overrides.method ?? "GET",
    pathname,
    pathParams: {},
    searchParams: overrides.searchParams ?? new URLSearchParams(),
    headers: overrides.headers ?? {},
    data: undefined,
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
