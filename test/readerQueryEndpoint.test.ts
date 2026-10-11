import { assert } from "chai";
import { createReaderQueryEndpoint } from "../src/modules/readerQuery/apiEndpoint";
import { MarkdownQueryError } from "../src/modules/markdownQuery/types";
import type { ReaderQueryService } from "../src/modules/readerQuery/types";

/** 创建返回空结果的服务，记录路由选定的 scope。 */
function service(): ReaderQueryService {
  return {
    async listTabs(scope = "active") {
      return { scope, tabs: [] };
    },
    async selectedBoxes(scope = "active") {
      return { scope, readers: [] };
    },
  };
}

/** 构造与 Zotero endpoint 相同的请求结构。 */
function request(
  pathname = "/mineru-for-zotero/tabs",
  query: Record<string, string> = {},
) {
  return { pathname, method: "GET", query, headers: {}, data: null };
}

describe("reader context HTTP endpoint", function () {
  it("routes both read-only queries and defaults to active", async function () {
    const endpoint = createReaderQueryEndpoint(service(), () => undefined);
    const tabs = await endpoint.init(request());
    assert.equal(tabs[0], 200);
    assert.deepEqual(JSON.parse(tabs[2]), { scope: "active", tabs: [] });
    const boxes = await endpoint.init(
      request("/mineru-for-zotero/boxes/selected", { scope: "all" }),
    );
    assert.deepEqual(JSON.parse(boxes[2]), { scope: "all", readers: [] });
  });

  it("authorizes before accessing runtime state or validating scope", async function () {
    const endpoint = createReaderQueryEndpoint({} as ReaderQueryService, () => {
      throw new MarkdownQueryError("api-disabled", 403, "API is disabled");
    });
    const response = await endpoint.init(
      request("/mineru-for-zotero/tabs", { scope: "bad" }),
    );
    assert.equal(response[0], 403);
    assert.equal(JSON.parse(response[2]).error, "api-disabled");
  });

  it("rejects invalid scope and non-GET requests", async function () {
    const endpoint = createReaderQueryEndpoint(service(), () => undefined);
    const invalid = await endpoint.init(
      request("/mineru-for-zotero/tabs", { scope: "visible" }),
    );
    assert.equal(invalid[0], 400);
    assert.equal(JSON.parse(invalid[2]).error, "invalid-request");
    const method = await endpoint.init({ ...request(), method: "POST" });
    assert.equal(method[0], 405);
  });

  it("uses runtime searchParams and does not expose unexpected exception details", async function () {
    const deps = service();
    deps.listTabs = async () => {
      throw new Error("private path and stack");
    };
    const response = await createReaderQueryEndpoint(
      deps,
      () => undefined,
    ).init({
      ...request(),
      searchParams: new URLSearchParams({ scope: "all" }),
    });
    assert.equal(response[0], 500);
    assert.equal(JSON.parse(response[2]).error, "internal-error");
    assert.notInclude(response[2], "private path");
  });
});
