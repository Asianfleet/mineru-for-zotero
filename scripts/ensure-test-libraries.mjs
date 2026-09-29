/**
 * Seeds the browser-side chai build for the scaffold tests.
 *
 * When zotero-plugin-scaffold generates the test resources and finds no cache
 * at `.scaffold/cache/chai.js`, it downloads the file from
 * https://www.chaijs.com/chai.js. CI may not reach that site
 * (`TypeError: fetch failed`), which makes the test run fail before it starts.
 *
 * This script copies the vendored UMD build from `scripts/vendor/chai.js` into
 * the cache directory so the scaffold hits the cache and the tests no longer
 * depend on the network. The script is idempotent: when a non-empty cache
 * already exists it does nothing.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_CHAI = resolve(ROOT, "scripts/vendor/chai.js");
const CACHE_DIR = resolve(ROOT, ".scaffold/cache");
const CACHE_CHAI = resolve(CACHE_DIR, "chai.js");

function isUsable(path) {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
}

if (isUsable(CACHE_CHAI)) {
  console.log("  [chai] .scaffold/cache/chai.js already exists, skipping.");
} else if (!isUsable(VENDOR_CHAI)) {
  console.error(
    `  [chai] Missing vendored file: ${VENDOR_CHAI}. Cannot seed chai for the scaffold.`,
  );
  process.exitCode = 1;
} else {
  mkdirSync(CACHE_DIR, { recursive: true });
  copyFileSync(VENDOR_CHAI, CACHE_CHAI);
  console.log(
    "  [chai] Seeded .scaffold/cache/chai.js from scripts/vendor/chai.js",
  );
}
