import { assert } from "chai";
import {
  createMarkdownQueryEndpoint,
  createMarkdownQueryEndpointClass,
  itemMatchesYear,
  MARKDOWN_ENDPOINT_PATHS,
} from "../src/modules/markdownQuery/apiEndpoint";
import { MarkdownQueryError } from "../src/modules/markdownQuery/types";
import type { ZoteroItemLike } from "../src/modules/markdownQuery/types";
import { setMarkdownApiEnabled } from "../src/utils/prefs";

describe("markdownApiEndpoint", function () {
  afterEach(function () {
    setMarkdownApiEnabled(false);
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

  it("forwards creator, year, tag, and limit search parameters", async function () {
    setMarkdownApiEnabled(true);
    const searches: unknown[] = [];
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async searchByTitle(input) {
        searches.push(input);
        return { candidates: [] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: {
          libraryID: "1",
          creator: "Chen",
          year: "2022",
          tag: "scheduling",
          limit: "5",
        },
      }),
    );

    assert.equal(response[0], 200);
    assert.deepEqual(searches[0], {
      libraryID: 1,
      creator: "Chen",
      year: "2022",
      tag: "scheduling",
      limit: 5,
    });
  });

  it("rejects malformed year parameters", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: { libraryID: "1", title: "Doc", year: "22" },
      }),
    );

    assert.equal(response[0], 400);
    assert.include(String(response[2]), "invalid-request");
    assert.include(String(response[2]), "Invalid year parameter");
  });

  it("rejects non-positive limit parameters", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: { libraryID: "1", title: "Doc", limit: "0" },
      }),
    );

    assert.equal(response[0], 400);
    assert.include(String(response[2]), "invalid-request");
  });

  it("surfaces the title-or-creator requirement from the service", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint({
      async searchByTitle() {
        throw new MarkdownQueryError(
          "invalid-request",
          400,
          "Missing title or creator",
        );
      },
      async queryMarkdown() {
        return { granularity: "full", content: "# Body" };
      },
      async triggerParse() {
        return { status: "submitted" };
      },
      async getTasks() {
        return { tasks: [] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: { libraryID: "1" },
      }),
    );

    assert.equal(response[0], 400);
    assert.include(String(response[2]), "Missing title or creator");
  });

  it("forwards includeSubsections to markdown queries", async function () {
    setMarkdownApiEnabled(true);
    const queries: unknown[] = [];
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async queryMarkdown(input) {
        queries.push(input);
        return { granularity: "section", content: "# Body" };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/markdown", {
        query: {
          libraryID: "1",
          key: "PDF1",
          granularity: "section",
          sectionPath: "Doc/A",
          includeSubsections: "true",
        },
      }),
    );

    assert.equal(response[0], 200);
    const query = queries[0] as { includeSubsections?: boolean };
    assert.equal(query.includeSubsections, true);
  });

  it("creates a constructible Zotero endpoint class", async function () {
    setMarkdownApiEnabled(true);
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
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      runtimeRequest("/mineru-for-zotero/search", {
        searchParams: new URLSearchParams({ libraryID: "1", title: "Doc" }),
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"candidates":[]');
  });

  it("uses a generic internal-error message for unexpected errors", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint({
      async searchByTitle() {
        return { candidates: [] };
      },
      async queryMarkdown() {
        throw new Error("database path C:\\Users\\secret\\profile.sqlite");
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

  it("registers the expected endpoint paths", function () {
    assert.deepEqual(MARKDOWN_ENDPOINT_PATHS, [
      "/mineru-for-zotero/search",
      "/mineru-for-zotero/markdown",
      "/mineru-for-zotero/parse",
      "/mineru-for-zotero/tasks",
      "/mineru-for-zotero/libraries",
      "/mineru-for-zotero/collections",
      "/mineru-for-zotero/tags",
    ]);
  });

  it("returns libraries through the libraries endpoint", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async getLibraries() {
        return {
          libraries: [{ libraryID: 1, name: "My Library", type: "user" }],
        };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/libraries"),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"libraries":');
    assert.include(String(response[2]), "My Library");
  });

  it("returns collections through the collections endpoint", async function () {
    setMarkdownApiEnabled(true);
    let captured: unknown;
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async getCollections(input) {
        captured = input;
        return {
          libraryID: 1,
          collections: [{ id: 10, key: "COL1", name: "AI", libraryID: 1 }],
        };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/collections", {
        query: { libraryID: "1", parentKey: "PARENT1" },
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"collections":');
    assert.include(String(response[2]), "COL1");
    assert.deepEqual(captured, { libraryID: 1, parentKey: "PARENT1" });
  });

  it("returns tags through the tags endpoint", async function () {
    setMarkdownApiEnabled(true);
    let captured: unknown;
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async getTags(input) {
        captured = input;
        return {
          libraryID: 1,
          tags: [{ tag: "deep-learning", numItems: 5 }],
        };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/tags", {
        query: { libraryID: "1", limit: "10" },
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"tags":');
    assert.include(String(response[2]), "deep-learning");
    assert.deepEqual(captured, { libraryID: 1, limit: 10 });
  });

  it("forwards enhanced search parameters to service", async function () {
    setMarkdownApiEnabled(true);
    const searches: unknown[] = [];
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async searchByTitle(input) {
        searches.push(input);
        return { candidates: [] };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: {
          libraryID: "1",
          collection: "AI",
          abstract: "transformer",
          publication: "NeurIPS",
          citekey: "vaswani2017",
          doi: "10.1000/182",
          itemType: "journalArticle",
          since: "2026-01-01",
          hasPdf: "true",
          parsedOnly: "1",
          sortBy: "dateAdded",
          sortOrder: "desc",
          limit: "10",
        },
      }),
    );

    assert.equal(response[0], 200);
    assert.deepEqual(searches[0], {
      libraryID: 1,
      collection: "AI",
      abstract: "transformer",
      publication: "NeurIPS",
      citekey: "vaswani2017",
      doi: "10.1000/182",
      itemType: "journalArticle",
      since: "2026-01-01",
      hasPdf: true,
      parsedOnly: true,
      sortBy: "dateAdded",
      sortOrder: "desc",
      limit: 10,
    });
  });

  it("rejects invalid sortBy parameters", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/search", {
        query: { libraryID: "1", title: "Doc", sortBy: "invalidField" },
      }),
    );

    assert.equal(response[0], 400);
    assert.include(String(response[2]), "Invalid sortBy parameter");
  });

  it("returns task records through the tasks endpoint", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async getTasks() {
        return { tasks: [{ id: "1", status: "running" }] };
      },
    });

    const response = await endpoint.init(request("/mineru-for-zotero/tasks"));

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"tasks":');
  });

  it("rejects non-POST parse triggers", async function () {
    setMarkdownApiEnabled(true);
    const endpoint = createMarkdownQueryEndpoint(fakeService());

    const response = await endpoint.init(
      request("/mineru-for-zotero/parse", {
        query: { libraryID: "1", key: "PDF1" },
      }),
    );

    assert.equal(response[0], 405);
    assert.include(String(response[2]), "invalid-request");
  });

  it("submits parse tasks through the parse endpoint", async function () {
    setMarkdownApiEnabled(true);
    let submitted: unknown;
    const endpoint = createMarkdownQueryEndpoint({
      ...fakeService(),
      async triggerParse(input) {
        submitted = input;
        return { status: "submitted", itemID: 1, key: "PDF1" };
      },
    });

    const response = await endpoint.init(
      request("/mineru-for-zotero/parse", {
        method: "POST",
        query: { libraryID: "1", key: "ABC1" },
      }),
    );

    assert.equal(response[0], 200);
    assert.include(String(response[2]), '"submitted"');
    const trigger = submitted as { libraryID: number; key: string };
    assert.equal(trigger.libraryID, 1);
    assert.equal(trigger.key, "ABC1");
  });

  describe("year matching", function () {
    function item(fields: Record<string, string>): ZoteroItemLike {
      return {
        getField: (name: string) => fields[name] ?? "",
      } as unknown as ZoteroItemLike;
    }

    it("matches a non-ISO date through Zotero's derived year field", function () {
      const march = item({ year: "2021", date: "March 4, 2021" });

      assert.isTrue(itemMatchesYear(march, "2021"));
      assert.isFalse(itemMatchesYear(march, "2020"));
    });

    it("falls back to scanning the date string when no year is derived", function () {
      assert.isTrue(itemMatchesYear(item({ date: "12 Jan 2019" }), "2019"));
      assert.isTrue(itemMatchesYear(item({ date: "Spring 2021" }), "2021"));
      assert.isFalse(itemMatchesYear(item({ date: "Spring 2021" }), "2020"));
      assert.isFalse(itemMatchesYear(item({ date: "" }), "2021"));
    });
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
    async triggerParse() {
      return { status: "submitted" };
    },
    async getTasks() {
      return { tasks: [] };
    },
    async getLibraries() {
      return { libraries: [] };
    },
    async getCollections() {
      return { libraryID: 1, collections: [] };
    },
    async getTags() {
      return { libraryID: 1, tags: [] };
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
