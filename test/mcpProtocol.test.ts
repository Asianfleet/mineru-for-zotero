import { assert } from "chai";
import {
  createMcpProtocol,
  parseMcpRequest,
} from "../src/modules/mcp/protocol";

describe("MCP protocol", function () {
  const context = {} as never;

  it("handles initialize and ping", async function () {
    const protocol = createMcpProtocol({
      context,
      authorize: () => undefined,
      listTools: () => [],
    });
    const initialize = await protocol.handle(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      }),
    );
    const payload = JSON.parse(initialize[2]);
    assert.equal(initialize[0], 200);
    assert.equal(payload.result.protocolVersion, "2024-11-05");

    const ping = await protocol.handle(
      request({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
      }),
    );
    assert.deepEqual(JSON.parse(ping[2]).result, {});
  });

  it("returns no body for initialized notifications and rejects invalid JSON", async function () {
    const protocol = createMcpProtocol({
      context,
      authorize: () => undefined,
      listTools: () => [],
    });
    const notification = await protocol.handle({
      method: "POST",
      pathname: "/mineru-for-zotero/mcp",
      headers: {},
      data: { jsonrpc: "2.0", method: "notifications/initialized" },
    });
    assert.equal(notification[0], 204);
    assert.equal(notification[2], "");

    const invalid = await protocol.handle({
      method: "POST",
      pathname: "/mineru-for-zotero/mcp",
      headers: {},
      data: "{",
    });
    assert.equal(invalid[0], 400);
    assert.equal(JSON.parse(invalid[2]).error.code, -32700);
  });

  it("requires authorization before listing tools", async function () {
    const protocol = createMcpProtocol({
      context,
      authorize: () => {
        throw new Error("invalid-token");
      },
      listTools: () => [{ name: "secret" }],
    });
    const response = await protocol.handle(
      request({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      }),
    );
    assert.equal(response[0], 403);
    assert.notInclude(response[2], "secret");
  });

  it("maps domain failures to an isError tool result without a stack", async function () {
    const protocol = createMcpProtocol({
      context,
      authorize: () => undefined,
      callTool: async () => {
        throw Object.assign(new Error("ambiguous-section"), {
          candidates: [{ path: ["Results"], file: "main.tex", line: 10 }],
        });
      },
    });
    const response = await protocol.handle(
      request({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "mineru_read_latex", arguments: {} },
      }),
    );
    const payload = JSON.parse(response[2]);
    assert.equal(payload.result.isError, true);
    assert.include(payload.result.content[0].text, "ambiguous-section");
    assert.notInclude(payload.result.content[0].text, "stack");
  });

  it("rejects unsupported HTTP methods", async function () {
    const protocol = createMcpProtocol({ context });
    const response = await protocol.handle({
      method: "GET",
      pathname: "/mineru-for-zotero/mcp",
      headers: {},
      data: undefined,
    });
    assert.equal(response[0], 405);
  });
});

function request(data: unknown) {
  return {
    method: "POST",
    pathname: "/mineru-for-zotero/mcp",
    headers: {},
    data,
  };
}

assert.isFunction(parseMcpRequest);
