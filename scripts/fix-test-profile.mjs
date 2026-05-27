/**
 * 确保测试 profile 中存在 user.js，将 httpServer.port 隔离到 user.js 中
 *
 * scaffold 默认在 prefs.js 中写入 extensions.zotero.httpServer.port = 23124，
 * 用以避免与用户正式 Zotero 实例（端口 23119）冲突。但 prefs.js 中的偏好
 * 可能被 Zotero 在运行时写回（shutdown 时），如果测试 profile 与真实 profile
 * 发生交叉（如误操作或插件行为），端口 23124 会泄漏到真实 profile，导致
 * Zotero Connector 浏览器扩展检测不到桌面端。
 *
 * user.js 在每次 Zotero 启动时覆盖偏好，但不会持久化写入 prefs.js，
 * 从而阻断泄漏路径。
 */

import { writeFileSync, existsSync } from "node:fs";
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
  `// 测试 profile 使用非标准端口 ${PORT_VALUE}，避免与用户正在运行的主 Zotero 实例（默认 23119）冲突。\n` +
  `// user.js 在每次启动时覆盖 prefs.js，但不会持久化写入 prefs.js，\n` +
  `// 从而防止测试配置泄漏到用户真实 Zotero profile。\n` +
  `user_pref("${PORT_KEY}", ${PORT_VALUE});\n`;

let count = 0;

for (const rel of PROFILES) {
  const userJsPath = resolve(ROOT, rel, "user.js");

  if (!existsSync(userJsPath)) {
    writeFileSync(userJsPath, USER_JS_CONTENT, "utf-8");
    console.log(`  [创建] ${rel}/user.js`);
    count++;
  }
}

if (count === 0) {
  console.log("  所有 user.js 已存在，无需更新。");
} else {
  console.log(`  已创建 ${count} 个 user.js`);
}
