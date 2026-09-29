/**
 * Repairs a scaffold test port that leaked into a real Zotero profile.
 *
 * The script only rewrites the known test port 23124 back to the Zotero
 * Connector default port 23119; it never overrides another port that the user
 * set on purpose.
 *
 * It is Windows-only: it locates the profile through APPDATA and lists running
 * processes with tasklist.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT_KEY = "extensions.zotero.httpServer.port";
const TEST_PROFILE_PORT = 23124;
const CONNECTOR_DEFAULT_PORT = 23119;

/**
 * Restores the Zotero Connector default port in the given prefs.js content.
 *
 * @param {string} content Text content of a Zotero prefs.js file.
 * @returns {{ changed: boolean, content: string }} Repaired content and change flag.
 */
export function fixConnectorPortContent(content) {
  const leakedPortPreference = `user_pref("${PORT_KEY}", ${TEST_PROFILE_PORT});`;
  const defaultPortPreference = `user_pref("${PORT_KEY}", ${CONNECTOR_DEFAULT_PORT});`;
  const fixed = content.replace(leakedPortPreference, defaultPortPreference);

  return {
    changed: fixed !== content,
    content: fixed,
  };
}

/**
 * Returns the default Zotero profile root on Windows.
 *
 * @param {NodeJS.ProcessEnv} env Current process environment.
 * @returns {string | undefined} Profile root path.
 */
export function getDefaultZoteroProfilesRoot(env = process.env) {
  if (!env.APPDATA) {
    return undefined;
  }

  return join(env.APPDATA, "Zotero", "Zotero", "Profiles");
}

/**
 * Checks the Windows process list for a running Zotero instance.
 *
 * @returns {string[]} Matching Zotero process names.
 */
export function listRunningZoteroProcesses() {
  try {
    const output = execFileSync(
      "tasklist",
      ["/FI", "IMAGENAME eq zotero.exe"],
      {
        encoding: "utf-8",
        windowsHide: true,
      },
    );

    return output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => name?.toLowerCase() === "zotero.exe");
  } catch {
    return [];
  }
}

/**
 * Ensures Zotero has fully exited, so in-memory preferences cannot overwrite
 * prefs.js on shutdown.
 *
 * @param {string[]} processNames Names of running Zotero processes.
 */
export function assertZoteroIsNotRunning(
  processNames = listRunningZoteroProcesses(),
) {
  if (processNames.length > 0) {
    throw new Error(
      "Quit Zotero completely before running this script; otherwise Zotero may write the old port back to prefs.js when it exits.",
    );
  }
}

/**
 * Repairs the prefs.js files under the given Zotero profile root.
 *
 * @param {string} profilesRoot Zotero Profiles root directory.
 * @returns {{ path: string, changed: boolean }[]} Result per profile.
 */
export function fixConnectorPortInProfiles(profilesRoot) {
  if (!existsSync(profilesRoot)) {
    return [];
  }

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const prefsPath = join(profilesRoot, entry.name, "prefs.js");

      if (!existsSync(prefsPath)) {
        return { path: prefsPath, changed: false };
      }

      const original = readFileSync(prefsPath, "utf-8");
      const result = fixConnectorPortContent(original);

      if (result.changed) {
        writeFileSync(prefsPath, result.content, "utf-8");
      }

      return { path: prefsPath, changed: result.changed };
    });
}

/**
 * Repairs the default Zotero profile, or reports the Windows-only limitation.
 *
 * The platform guard lives here, in the CLI entry point, so the exported
 * helpers stay testable on any platform.
 */
function runRepair() {
  if (process.platform !== "win32") {
    console.error(
      "This repair script is Windows-only: it finds the Zotero profile through APPDATA and lists running processes with tasklist.",
    );
    console.error(
      `Detected platform: ${process.platform}. Run this script on Windows, or set ${PORT_KEY} back to ${CONNECTOR_DEFAULT_PORT} manually in the Zotero prefs.js file.`,
    );
    process.exitCode = 1;
    return;
  }

  const profilesRoot = getDefaultZoteroProfilesRoot();

  if (!profilesRoot) {
    console.error(
      "APPDATA is not set, so the Zotero Profiles directory cannot be located.",
    );
    process.exitCode = 1;
    return;
  }

  try {
    assertZoteroIsNotRunning();

    const results = fixConnectorPortInProfiles(profilesRoot);
    const changed = results.filter((result) => result.changed);

    if (results.length === 0) {
      console.log(`Zotero Profiles directory not found: ${profilesRoot}`);
    } else if (changed.length === 0) {
      console.log(
        "No leaked scaffold test port 23124 found in a real Zotero profile.",
      );
    } else {
      for (const result of changed) {
        console.log(`Repaired: ${result.path}`);
      }
      console.log("Start Zotero so the port setting is loaded again.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runRepair();
}
