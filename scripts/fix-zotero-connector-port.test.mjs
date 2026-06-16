import assert from "node:assert/strict";
import test from "node:test";

import { fixConnectorPortContent } from "./fix-zotero-connector-port.mjs";
import { assertZoteroIsNotRunning } from "./fix-zotero-connector-port.mjs";

test("repairs leaked scaffold test port in real Zotero prefs", () => {
  const input =
    'user_pref("extensions.zotero.httpServer.enabled", true);\n' +
    'user_pref("extensions.zotero.httpServer.port", 23124);\n';

  const result = fixConnectorPortContent(input);

  assert.equal(result.changed, true);
  assert.equal(
    result.content,
    'user_pref("extensions.zotero.httpServer.enabled", true);\n' +
      'user_pref("extensions.zotero.httpServer.port", 23119);\n',
  );
});

test("preserves explicit non-test connector ports", () => {
  const input = 'user_pref("extensions.zotero.httpServer.port", 24000);\n';

  const result = fixConnectorPortContent(input);

  assert.equal(result.changed, false);
  assert.equal(result.content, input);
});

test("refuses to repair prefs while Zotero is running", () => {
  assert.throws(
    () => assertZoteroIsNotRunning(["zotero.exe"]),
    /请先完全退出 Zotero/,
  );
});
