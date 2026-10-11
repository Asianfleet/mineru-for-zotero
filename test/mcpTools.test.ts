import { assert } from "chai";
import { callMcpTool, listMcpTools } from "../src/modules/mcp/tools";
import { mapImageResult } from "../src/modules/mcp/resultMapper";

describe("MCP tools", function () {
  it("reports no selected boxes without reader metadata", async function () {
    const context = {
      reader: {
        async selectedBoxes() {
          return { scope: "active", readers: [] };
        },
      },
    } as never;
    const result = await callMcpTool("mineru_get_selected_boxes", {}, context);
    assert.deepEqual(result.structuredContent, {
      scope: "active",
      readers: [],
    });
    assert.deepEqual(result.content, [
      { type: "text", text: "No selected boxes." },
    ]);
    assert.isUndefined(result.isError);
  });

  it("lists the supported query tools with required identifiers", function () {
    const names = listMcpTools().map((tool) => tool.name);
    assert.deepEqual(names, [
      "zotero_search_items",
      "mineru_read_markdown",
      "mineru_query_markdown_table",
      "mineru_get_markdown_image",
      "mineru_fetch_latex",
      "mineru_read_latex",
      "mineru_query_latex_table",
      "mineru_get_latex_image",
      "zotero_list_tabs",
      "mineru_get_selected_boxes",
    ]);
  });

  it("queries runtime tabs without item identifiers", async function () {
    let received: unknown;
    const context = {
      reader: {
        async listTabs(scope: unknown) {
          received = scope;
          return { scope, tabs: [] };
        },
      },
    } as never;
    const result = await callMcpTool("zotero_list_tabs", {}, context);
    assert.equal(received, "active");
    assert.deepEqual(result.structuredContent.tabs, []);
    assert.match(result.content[0].text, /tabs/);
  });

  it("preserves partial selected content and marks selection failures", async function () {
    const readers = [
      { status: "ok", markdown: "selected" },
      { status: "stale-selection", missingRawIndexes: [9] },
    ];
    const context = {
      reader: {
        async selectedBoxes(scope: unknown) {
          return { scope, readers };
        },
      },
    } as never;
    const result = await callMcpTool(
      "mineru_get_selected_boxes",
      { scope: "all" },
      context,
    );
    assert.isTrue(result.isError);
    assert.deepEqual(result.structuredContent.readers, readers);
  });

  it("rejects invalid runtime scope", async function () {
    try {
      await callMcpTool("zotero_list_tabs", { scope: "visible" }, {} as never);
      assert.fail("expected invalid scope");
    } catch (error) {
      assert.equal((error as { code: string }).code, "invalid-params");
    }
  });

  it("converts MCP camelCase arguments to Markdown service arguments", async function () {
    let received: unknown;
    const context = {
      markdown: {
        async queryMarkdown(input: unknown) {
          received = input;
          return { item: { key: "A" }, content: "body" };
        },
      },
    } as never;
    const result = await callMcpTool(
      "mineru_read_markdown",
      {
        libraryId: 1,
        itemKey: "ABCD1234",
        granularity: "section",
        sectionPath: ["Results", "Ablation"],
      },
      context,
    );
    assert.deepEqual(received, {
      libraryID: 1,
      key: "ABCD1234",
      granularity: "section",
      sectionPath: ["Results", "Ablation"],
    });
    assert.equal(result.structuredContent.content, "body");
  });

  it("rejects missing required tool arguments", async function () {
    try {
      await callMcpTool("mineru_read_markdown", { libraryId: 1 }, {} as never);
      assert.fail("expected invalid params");
    } catch (error) {
      assert.equal((error as { code: string }).code, "invalid-params");
    }
  });

  it("returns image blocks while retaining partial image statuses", function () {
    const result = mapImageResult([
      {
        path: "images/a.jpg",
        status: "ok",
        mime: "image/jpeg",
        bytes: Uint8Array.from([1, 2, 3]),
      },
      { path: "images/a.jpg", status: "duplicate-path" },
      { path: "images/missing.jpg", status: "not-found" },
    ]);
    assert.deepEqual(result.structuredContent, {
      images: [
        { path: "images/a.jpg", status: "ok", mime: "image/jpeg" },
        { path: "images/a.jpg", status: "duplicate-path" },
        { path: "images/missing.jpg", status: "not-found" },
      ],
    });
    assert.deepEqual(result.content[1], {
      type: "image",
      data: "AQID",
      mimeType: "image/jpeg",
    });
  });

  it("rejects a non-boolean LaTeX refresh flag", async function () {
    try {
      await callMcpTool(
        "mineru_fetch_latex",
        { libraryId: 1, itemKey: "ABCD1234", refresh: "true" },
        {} as never,
      );
      assert.fail("expected invalid params");
    } catch (error) {
      assert.equal((error as { code: string }).code, "invalid-params");
    }
  });
});
