import { assert } from "chai";
import {
  MCP_ENDPOINT_PATH,
  createMcpQueryEndpoint,
} from "../src/modules/mcp/apiEndpoint";

describe("MCP API endpoint", function () {
  it("exposes a POST endpoint that delegates to the protocol handler", async function () {
    const calls: unknown[] = [];
    const endpoint = createMcpQueryEndpoint({
      async handle(options) {
        calls.push(options);
        return [200, "application/json", '{"ok":true}'];
      },
    });

    assert.deepEqual(endpoint.supportedMethods, ["POST"]);
    const response = await endpoint.init({
      method: "POST",
      pathname: MCP_ENDPOINT_PATH,
      headers: {},
      data: { jsonrpc: "2.0", id: 1, method: "ping" },
    });

    assert.equal(response[0], 200);
    assert.lengthOf(calls, 1);
  });
});
