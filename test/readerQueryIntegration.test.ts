import { assert } from "chai";
import {
  createReaderQueryEndpoint,
  READER_QUERY_ENDPOINT_PATHS,
} from "../src/modules/readerQuery/apiEndpoint";
import { createZoteroReaderQueryService } from "../src/modules/readerQuery/runtime";
import { readReaderSelectedRawIndexes } from "../src/modules/readerOverlay/state";
import { readAttachmentParseRunning } from "../src/modules/itemTreeColumn";
import {
  setMarkdownApiEnabled,
  setMarkdownApiRequireToken,
  setMarkdownApiToken,
} from "../src/utils/prefs";

/** 构造使用默认鉴权的运行时请求。 */
function request(
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
) {
  return {
    pathname: "/mineru-for-zotero/tabs",
    method: "GET",
    headers,
    query,
    data: null,
  };
}

describe("reader context Zotero integration", function () {
  afterEach(function () {
    setMarkdownApiEnabled(false);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("");
  });

  it("reuses API enablement and token authorization", async function () {
    const service = createZoteroReaderQueryService();
    const endpoint = createReaderQueryEndpoint(service);
    setMarkdownApiEnabled(false);
    assert.equal((await endpoint.init(request()))[0], 403);
    setMarkdownApiEnabled(true);
    setMarkdownApiRequireToken(true);
    setMarkdownApiToken("test-reader-token");
    const invalid = await endpoint.init(request());
    assert.equal(JSON.parse(invalid[2]).error, "invalid-token");
    const valid = await endpoint.init(
      request({ Authorization: "Bearer test-reader-token" }),
    );
    assert.equal(valid[0], 200);
    assert.notInclude(valid[2], "test-reader-token");
    const queryToken = await endpoint.init(
      request({}, { token: "test-reader-token" }),
    );
    assert.equal(queryToken[0], 200);
  });

  it("readonly state getters do not create missing state", function () {
    const original = globalThis.addon;
    const fixture = { data: {} } as typeof addon;
    globalThis.addon = fixture;
    try {
      assert.deepEqual(
        readReaderSelectedRawIndexes("missing-query-reader", "MISSING"),
        [],
      );
      assert.isUndefined(fixture.data.readerOverlays);
      assert.deepEqual(
        readAttachmentParseRunning({ libraryID: -1, key: "MISSING" }),
        { preciseRunning: false, liteRunning: false },
      );
      assert.isUndefined(fixture.data.itemTreeColumn);
    } finally {
      globalThis.addon = original;
    }
  });

  it("registers runtime endpoints during startup", function () {
    for (const path of READER_QUERY_ENDPOINT_PATHS) {
      assert.isFunction(Zotero.Server.Endpoints[path]);
    }
    assert.isArray(Zotero.getMainWindows());
    const win = Zotero.getMainWindow();
    assert.isArray(win.Zotero_Tabs._tabs);
    assert.isTrue(
      win.Zotero_Tabs._tabs.every((tab) => typeof tab.id === "string"),
    );
    assert.isString(win.Zotero_Tabs.selectedID);
    assert.isArray(Zotero.Reader._readers);
  });
});
