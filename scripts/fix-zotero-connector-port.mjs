/**
 * 修复真实 Zotero profile 中误残留的 scaffold 测试端口。
 *
 * 该脚本只把明确的测试端口 23124 改回 Zotero Connector 默认端口 23119，
 * 不覆盖用户主动设置的其他端口。
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT_KEY = "extensions.zotero.httpServer.port";
const TEST_PROFILE_PORT = 23124;
const CONNECTOR_DEFAULT_PORT = 23119;

/**
 * 将 prefs.js 内容中的测试端口恢复为 Zotero Connector 默认端口。
 *
 * @param {string} content Zotero prefs.js 的文本内容。
 * @returns {{ changed: boolean, content: string }} 修复后的内容与变更标记。
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
 * 返回 Windows 下 Zotero 默认 profile 根目录。
 *
 * @param {NodeJS.ProcessEnv} env 当前进程环境变量。
 * @returns {string | undefined} profile 根目录路径。
 */
export function getDefaultZoteroProfilesRoot(env = process.env) {
  if (!env.APPDATA) {
    return undefined;
  }

  return join(env.APPDATA, "Zotero", "Zotero", "Profiles");
}

/**
 * 检查 Windows 进程列表中是否仍有 Zotero 正在运行。
 *
 * @returns {string[]} 匹配到的 Zotero 进程名。
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
 * 确保 Zotero 已完全退出，避免运行时内存偏好在退出时覆盖 prefs.js。
 *
 * @param {string[]} processNames 运行中的 Zotero 进程名。
 */
export function assertZoteroIsNotRunning(
  processNames = listRunningZoteroProcesses(),
) {
  if (processNames.length > 0) {
    throw new Error(
      "请先完全退出 Zotero，再运行本脚本；否则 Zotero 退出时可能把旧端口重新写回 prefs.js。",
    );
  }
}

/**
 * 修复指定 Zotero profile 根目录下的 prefs.js 文件。
 *
 * @param {string} profilesRoot Zotero Profiles 根目录。
 * @returns {{ path: string, changed: boolean }[]} 每个 profile 的处理结果。
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

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const profilesRoot = getDefaultZoteroProfilesRoot();

  if (!profilesRoot) {
    console.error("未找到 APPDATA，无法定位 Zotero Profiles 目录。");
    process.exitCode = 1;
  } else {
    try {
      assertZoteroIsNotRunning();

      const results = fixConnectorPortInProfiles(profilesRoot);
      const changed = results.filter((result) => result.changed);

      if (results.length === 0) {
        console.log(`未找到 Zotero Profiles 目录：${profilesRoot}`);
      } else if (changed.length === 0) {
        console.log("未发现真实 Zotero profile 中残留测试端口 23124。");
      } else {
        for (const result of changed) {
          console.log(`已修复：${result.path}`);
        }
        console.log("请启动 Zotero，使端口设置重新加载。");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
