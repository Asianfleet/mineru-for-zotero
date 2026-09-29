/**
 * Makes sure user.js exists in the test profile and keeps httpServer.port
 * inside user.js.
 *
 * By default the scaffold writes extensions.zotero.httpServer.port = 23124 into
 * prefs.js so the test profile does not clash with a running user instance
 * (port 23119). But preferences in prefs.js can be written back by Zotero at
 * runtime (on shutdown), so if the test profile and the real profile ever cross
 * (a mistake or plugin behavior), port 23124 leaks into the real profile and
 * the Zotero Connector browser extension can no longer detect the desktop
 * client.
 *
 * user.js overrides preferences on every Zotero start without persisting them
 * into prefs.js, which closes that leak path.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PROFILES = [
  ".scaffold/test/profile",
  ".scaffold/test/profile/chrome_debugger_profile",
];

const PORT_KEY = "extensions.zotero.httpServer.port";
const PORT_VALUE = 23124;

const USER_JS_CONTENT =
  `// The test profile uses the non-standard port ${PORT_VALUE} to avoid a clash\n` +
  `// with a running main Zotero instance (default 23119).\n` +
  `// user.js overrides prefs.js on every start but is never persisted into\n` +
  `// prefs.js, which keeps the test configuration out of the real Zotero profile.\n` +
  `user_pref("${PORT_KEY}", ${PORT_VALUE});\n`;

let count = 0;

for (const rel of PROFILES) {
  const userJsPath = resolve(ROOT, rel, "user.js");

  if (!existsSync(userJsPath)) {
    mkdirSync(dirname(userJsPath), { recursive: true });
    writeFileSync(userJsPath, USER_JS_CONTENT, "utf-8");
    console.log(`  [created] ${rel}/user.js`);
    count++;
  }
}

if (count === 0) {
  console.log("  All user.js files already exist, nothing to update.");
} else {
  console.log(`  Created ${count} user.js file(s)`);
}
